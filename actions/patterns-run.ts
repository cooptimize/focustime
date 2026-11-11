// WP-1: the DevOps patterns run. Two kinds, both started only by a person pressing a button on the page (Run inventory,
// Run classification, Resume): nothing here is scheduled, started at startup or restarted on its own. One run at a time
// for the whole deployment (the store refuses a second). A run goes through the clients one at a time, saving its place
// after every step, so a restart, a scale-down or a failure leaves it "Stopped" with Resume, which carries on from there
// and never reads a finished client again.
//
// DevOps: read-only, slow on purpose. One request at a time, at least `gapMs` apart, and before each one the reader says
// whether to wait (the poller's hold or its next check, a low budget). A refusal waits and tries again.
//
// AI: one client per request; item text masked (other clients' names as "[another client]", emails as "[email]") and
// sent under short refs, never stored or logged; only validated labels are kept, per item, revision and list version.
// Logs carry counts and kinds only: never a title, text, a client name (the logger keeps a one-way ref) or a person.
import type { AiService } from "../ai/service.ts";
import type { ClientEntry } from "../ai/guard.ts";
import { maskTranscript } from "../ai/guard.ts";
import { replaceMentions } from "../plan/boundary.ts";
import { costMicros, type Prices } from "../ai/cost.ts";
import type { Logger } from "../log/logger.ts";
import { F, historyOf, historySample, inventoryOf, itemOf, monthRanges, readFields, windowFrom, type ProcessFacts, type RawUpdate } from "../plan/patterns/inventory.ts";
import { BATCH, CHILD_TITLES, CLASSIFY_SCHEMA, MERGE_INSTRUCTIONS, MERGE_SCHEMA, OTHER, STARTING_LIST, TEXT_CAP, classifyInput, classifyInstructions, eligible, fingerprintOf, inAgreementSample, listFromMerge, mergeInput, parseLabels, pass1Counts, pass1Sample, plain, suggestionsOf, type ClassifyInput } from "../plan/patterns/labels.ts";
import { levelsOf } from "../plan/patterns/levels.ts";
import type { Labels, Level, PatternItem, TypeList } from "../plan/patterns/types.ts";
import type { ClientProgress, PatternsStore, Progress, Run } from "../store/patterns-store.ts";
import { DevOpsFailure } from "../sources/devops/source.ts";

/** What the run reads DevOps through (the real one is built in server/main.ts; tests give a fake). */
export type PatternsReader = {
  /** The clients a run covers: every client with DevOps set up, plus the Internal project. */
  clients(): Promise<string[]>;
  /** The client's process: which states are closed or not started, and its estimate fields. */
  process(clientKey: string): Promise<ProcessFacts>;
  /** A WIQL query in the client's project: the ids (at most `top`). */
  ids(clientKey: string, wiql: string, top: number): Promise<number[]>;
  batch(clientKey: string, ids: readonly number[], fields: readonly string[]): Promise<{ id: number; fields: Readonly<Record<string, unknown>> }[]>;
  /** An item's history, oldest first. */
  updates(clientKey: string, id: number): Promise<RawUpdate[]>;
  /** Why to wait before the next request to this client (plain words), or null to go. */
  wait(clientKey: string): Promise<string | null>;
};

/** What a classification needs from the person who pressed Run (their AI service and switches). */
export type ClassifyDeps = {
  ai: AiService;
  /** The client's Allow AI (Admin › AI) and AI for FocusTime. */
  aiAllowed(clientKey: string): Promise<boolean>;
  /** Every client's names, aliases, projects and known ids, for masking (the run's clients and the person's directory). */
  directory: ClientEntry[];
  isInternal(clientKey: string): boolean;
};

export type RunnerDeps = {
  store: PatternsStore;
  reader: PatternsReader;
  now: () => Temporal.Instant;
  sleep?: (ms: number) => Promise<void>;
  log: Logger;
  /** This process (a new one after every start): a run belongs to the process that runs it. */
  owner: string;
  /** Whether the person who started a run still has the page (the Admin switch). */
  allowed(userId: string): Promise<boolean>;
  /** Least time between two DevOps requests, and how long a wait lasts before asking again. */
  gapMs?: number;
  waitMs?: number;
  /** A running run with no heartbeat for this long, owned by another process, is stopped (a restart, a scale-down). */
  staleMs?: number;
  /** The app's AI prices, for the estimate. */
  prices?: () => Prices | null;
};

export const PAGE = 100;
export const HISTORY_MAX = 200;
export const PARENT_ROUNDS = 3;
const WIQL_TOP = 20_000;
/** A run stops once what it spent is more than this times the estimate. */
export const COST_STOP = 1.5;

/** Thrown to leave a run's loop without writing (the process lost the run, or a test stopped the "server"). */
class Halt extends Error {}
/** Thrown to end a run as stopped with plain words (the switch went off, the cost passed the estimate, AI stopped). */
class StopRun extends Error {}

const GONE = "Stopped: the server restarted or scaled down";
const words = (e: unknown): string => {
  if (e instanceof DevOpsFailure) return e.status === "auth_failed" ? "DevOps sign-in was refused" : e.status === "no_access" ? "No access to the DevOps project" : e.status === "unreachable" ? "DevOps couldn't be reached" : "DevOps couldn't be read";
  return "Something went wrong reading this client";
};

export function createPatternsRunner(d: RunnerDeps) {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gapMs = d.gapMs ?? 2_000;
  const waitMs = d.waitMs ?? 30_000;
  const staleMs = d.staleMs ?? 3 * 60_000;
  /** The run this process is working on (its loop is alive), and whether a test halted it. */
  let active: { id: number; loop: Promise<void> } | null = null;
  let halted = false;
  const lastAt = new Map<string, number>();
  const log = (op: string, extra: { count?: number; kind?: string; client?: string } = {}) => d.log({ source: "devops", op: `patterns_${op}`, ...extra });

  // ---------- one step at a time ----------

  async function save(run: Run, spent?: number) {
    if (halted) throw new Halt();
    if (!(await d.store.saveProgress(run.id, d.owner, run.progress, spent))) throw new Halt();
    if (!(await d.allowed(run.startedBy))) throw new StopRun("Stopped: DevOps patterns was turned off for the person who started it");
  }

  /** One DevOps request: waits while the reader says so (saying why on the page), keeps the gap, waits out a refusal. */
  async function req<T>(run: Run, k: string, c: ClientProgress, f: () => Promise<T>): Promise<T> {
    for (let refused = 0; ; ) {
      for (let why = await d.reader.wait(k); why; why = await d.reader.wait(k)) {
        c.reason = why;
        await save(run);
        await sleep(waitMs);
      }
      if (c.reason) {
        c.reason = null;
        await save(run);
      }
      const since = d.now().epochMilliseconds - (lastAt.get(k) ?? 0);
      if (since < gapMs) await sleep(gapMs - since);
      if (halted) throw new Halt();
      try {
        return await f();
      } catch (e) {
        // DevOps asked to wait (429 or Retry-After): the reader holds; wait and try again, a few times.
        if (e instanceof DevOpsFailure && e.status === "error" && /asked FocusTime to wait/.test(e.message) && ++refused < 10) {
          c.reason = "DevOps asked FocusTime to wait";
          await save(run);
          await sleep(waitMs);
          continue;
        }
        throw e;
      } finally {
        lastAt.set(k, d.now().epochMilliseconds);
      }
    }
  }

  // ---------- inventory ----------

  async function inventoryClient(run: Run, k: string, c: ClientProgress) {
    const proc = await req(run, k, c, () => d.reader.process(k));
    const fields = readFields(proc.estimateFields);
    const t0 = Temporal.Instant.from(run.startedAt);
    const from = windowFrom(t0);
    if (!c.phase || c.phase === "first") {
      // The client's first item ever: the oldest by created date.
      const first = await req(run, k, c, () => d.reader.ids(k, "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.CreatedDate] ASC", 1));
      const v = first.length ? await req(run, k, c, () => d.reader.batch(k, first.slice(0, 1), [F.id, F.created])) : [];
      c.firstItemAt = typeof v[0]?.fields[F.created] === "string" ? (v[0]!.fields[F.created] as string) : null;
      Object.assign(c, { phase: "months", month: 0, ids: [] });
      await save(run);
    }
    if (c.phase === "months") {
      const months = monthRanges(t0);
      for (let m = c.month ?? 0; m < months.length; m++) {
        const r = months[m]!;
        const ids = await req(run, k, c, () => d.reader.ids(k, `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.CreatedDate] >= '${r.from}' AND [System.CreatedDate] < '${r.to}' ORDER BY [System.Id]`, WIQL_TOP));
        if (ids.length >= WIQL_TOP) c.capped = true;
        c.ids = [...new Set([...(c.ids ?? []), ...ids])];
        c.month = m + 1;
        await save(run);
      }
      Object.assign(c, { phase: "items", next: 0 });
      await save(run);
    }
    if (c.phase === "items" || c.phase === "parents") {
      const inWindow = c.phase === "items";
      const ids = c.ids ?? [];
      for (let i = c.next ?? 0; i < ids.length; i += PAGE) {
        const values = await req(run, k, c, () => d.reader.batch(k, ids.slice(i, i + PAGE), fields));
        await d.store.putItems(k, run.id, values.map((v) => itemOf(v, proc, inWindow)));
        c.next = i + PAGE;
        await save(run);
      }
      // Parents not read yet (up to PARENT_ROUNDS levels up), wherever they were created.
      const round = inWindow ? 0 : (c.round ?? 0);
      const have = await d.store.items(k, run.id);
      const known = new Set(have.map((x) => x.id));
      const missing = [...new Set(have.map((x) => x.parentId).filter((p): p is number => p !== null && !known.has(p)))];
      if (missing.length && round < PARENT_ROUNDS) Object.assign(c, { phase: "parents", ids: missing, next: 0, round: round + 1 });
      else Object.assign(c, { phase: "history", ids: historySample(have, HISTORY_MAX), next: 0 });
      await save(run);
      if (c.phase === "parents") return inventoryClient(run, k, c);
    }
    if (c.phase === "history") {
      const ids = c.ids ?? [];
      const byId = new Map((await d.store.items(k, run.id)).map((x) => [x.id, x]));
      for (let i = c.next ?? 0; i < ids.length; i++) {
        const it = byId.get(ids[i]!);
        if (it) {
          const ups = await req(run, k, c, () => d.reader.updates(k, it.id));
          await d.store.setHistory(k, it.id, historyOf(ups, it.type, proc));
        }
        c.next = i + 1;
        if (i % 10 === 9 || i === ids.length - 1) await save(run);
      }
      Object.assign(c, { phase: "numbers", ids: [], next: 0 });
      await save(run);
    }
    const items = await d.store.items(k, run.id);
    const snap = inventoryOf(items, { firstItemAt: c.firstItemAt ?? null, windowFrom: from });
    await d.store.saveSnapshot(run.id, k, snap);
    log("inventory_client", { count: snap.items, client: k });
  }

  // ---------- classification ----------

  /** The labels this run needs for one client and list version: eligible items (or pass 1's sample) not labeled at this revision. */
  async function todo(k: string, list: TypeList, pass: 1 | 2): Promise<{ items: PatternItem[]; need: PatternItem[]; needB: PatternItem[]; all: PatternItem[] }> {
    const all = await d.store.items(k);
    const levels = levelsOf(all);
    const el = eligible(all, (t) => levels.get(t) ?? "other");
    const items = pass === 1 ? pass1Sample(el) : el;
    const have = await d.store.labels(k, list.version);
    const need = items.filter((i) => (have.get(i.id)?.rev ?? -1) < i.rev);
    // The agreement sample (pass 2 only): a second answer for items without one, those labeled in this run included.
    const needB = pass === 2 ? items.filter((i) => inAgreementSample(i.id) && (need.includes(i) || !have.get(i.id)?.labelsB)) : [];
    return { items, need, needB, all };
  }

  function inputsFor(k: string, values: { id: number; fields: Readonly<Record<string, unknown>> }[], all: readonly PatternItem[], c: ClassifyDeps): { input: ClassifyInput; id: number; rev: number }[] {
    const internal = c.isInternal(k);
    const mask = (t: string) => maskTranscript(t, k, c.directory, { internal }).text;
    const kids = new Map<number, string[]>();
    for (const i of all) if (i.parentId !== null) (kids.get(i.parentId) ?? kids.set(i.parentId, []).get(i.parentId)!).push(i.title);
    return values.map((v, n) => ({
      id: v.id,
      rev: typeof v.fields[F.rev] === "number" ? (v.fields[F.rev] as number) : 0,
      input: {
        ref: `i${n + 1}`,
        type: mask(String(v.fields[F.type] ?? "")),
        title: mask(String(v.fields[F.title] ?? "").slice(0, 300)),
        description: mask(plain(v.fields[F.description], TEXT_CAP)),
        acceptance: mask(plain(v.fields[F.acceptance], TEXT_CAP)),
        tags: mask(String(v.fields[F.tags] ?? "")).split(";").map((t) => t.trim()).filter(Boolean).slice(0, 10),
        children: (kids.get(v.id) ?? []).slice(0, CHILD_TITLES).map((t) => mask(t.slice(0, 100))),
      },
    }));
  }

  /** One AI request for up to BATCH items; a refused batch is tried one item at a time. Returns labels by item id. */
  async function classifyBatch(run: Run, k: string, list: TypeList, batch: { input: ClassifyInput; id: number; rev: number }[], c: ClassifyDeps): Promise<Map<number, { rev: number; labels: Labels }>> {
    const out = new Map<number, { rev: number; labels: Labels }>();
    const task = { name: "patterns.classify", client: k, instructions: classifyInstructions(list) };
    for (let attempt = 0; ; attempt++) {
      const r = await c.ai.run<unknown>(task, classifyInput(batch.map((b) => b.input)), CLASSIFY_SCHEMA);
      if (r.ok) {
        run.spentMicros += Math.round(r.costUsd * 1_000_000);
        const parsed = parseLabels(r.value, batch.map((b) => b.input.ref), list);
        for (const b of batch) {
          const l = parsed.labels.get(b.input.ref);
          if (l) out.set(b.id, { rev: b.rev, labels: l });
        }
        if (parsed.dropped) log("classify_dropped", { count: parsed.dropped, client: k });
        return out;
      }
      const kind = r.error.kind;
      if (kind === "refused_client" || kind === "refused_secret" || kind === "refused_email") {
        // Something in one item still can't go: each item on its own, and the ones refused stay unlabeled (counted).
        if (batch.length === 1) return out;
        for (const one of batch) for (const [id, v] of await classifyBatch(run, k, list, [{ ...one, input: { ...one.input, ref: "i1" } }], c)) out.set(id, v);
        return out;
      }
      if (kind === "invalid_output") return out;
      if ((kind === "provider" || kind === "timeout" || kind === "rate_limited") && attempt < 1) {
        await sleep(waitMs);
        continue;
      }
      throw new StopRun(`Stopped: ${r.error.message}`);
    }
  }

  async function classifyClient(run: Run, k: string, cp: ClientProgress, list: TypeList, pass: 1 | 2, c: ClassifyDeps) {
    const { need, needB, all, items } = await todo(k, list, pass);
    cp.total = items.length;
    cp.done = items.length - need.length;
    await save(run, run.spentMicros);
    const work: { item: PatternItem; second: boolean }[] = [...need.map((item) => ({ item, second: false })), ...needB.map((item) => ({ item, second: true }))];
    const readFieldsC = [F.id, F.rev, F.type, F.title, F.description, F.acceptance, F.tags];
    for (let i = 0; i < work.length; i += PAGE / 2) {
      const chunk = work.slice(i, i + PAGE / 2);
      // The text is read now, sent, and dropped: it is never stored.
      const values = await req(run, k, cp, () => d.reader.batch(k, chunk.map((w) => w.item.id), readFieldsC));
      const byId = new Map(values.map((v) => [v.id, v]));
      for (const second of [false, true]) {
        const part = chunk.filter((w) => w.second === second && byId.has(w.item.id));
        // The agreement sample's second answer goes in a separate request, in another order.
        const ordered = second ? [...part].reverse() : part;
        for (let j = 0; j < ordered.length; j += BATCH) {
          const vals = ordered.slice(j, j + BATCH).map((w) => byId.get(w.item.id)!);
          const got = await classifyBatch(run, k, list, inputsFor(k, vals, all, c), c);
          const rows = vals.map((v) => {
            const g = got.get(v.id);
            const it = all.find((x) => x.id === v.id)!;
            // Keyed by the revision the inventory read (what a rerun compares), or the newer one just read.
            const rev = Math.max(it.rev, g?.rev ?? 0);
            return g ? (second ? { itemId: v.id, rev, labelsB: g.labels } : { itemId: v.id, rev, labels: g.labels }) : null;
          });
          await d.store.putLabels(k, list.version, rows.filter((x): x is NonNullable<typeof x> => !!x));
          if (!second) {
            cp.done = (cp.done ?? 0) + rows.filter(Boolean).length;
            cp.dropped = (cp.dropped ?? 0) + rows.filter((x) => !x).length;
          }
          await save(run, run.spentMicros);
          // Checked once what was paid for is kept, so Resume never pays for it again.
          overBudget(run);
        }
      }
    }
  }

  function overBudget(run: Run) {
    if (run.estimateMicros > 0 && run.spentMicros > run.estimateMicros * COST_STOP) throw new StopRun("Stopped: cost passed the estimate");
  }

  /** After pass 1: the second list, from every client's "other" suggestions (names and meanings only, client names replaced). */
  async function secondList(run: Run, clients: string[], c: ClassifyDeps): Promise<TypeList> {
    const labels: Labels[] = [];
    for (const k of clients) {
      const { items } = await todo(k, STARTING_LIST, 1);
      const have = await d.store.labels(k, STARTING_LIST.version);
      for (const i of items) {
        const l = have.get(i.id)?.labels;
        if (l) labels.push(l);
      }
    }
    // GD-2: these cross clients, so every client's names, aliases and projects are replaced first (none is "own" here).
    const scrub = (t: string | null) => (t === null ? null : replaceMentions(t, "\u0000none", c.directory, { records: true, token: "another client" }).text);
    const clean = labels.map((l) => ({ ...l, otherName: scrub(l.otherName), otherMeaning: scrub(l.otherMeaning) }));
    const s = suggestionsOf(clean);
    const fp = fingerprintOf(STARTING_LIST, s);
    const reuse = (await d.store.lists()).filter((l) => l.version !== STARTING_LIST.version && l.fingerprint === fp).at(-1);
    if (reuse) return reuse;
    const at = d.now().toString();
    const version = `v2-r${run.id}`;
    if (!s.length) {
      const same: TypeList = { version, createdAt: at, types: [...STARTING_LIST.types], changes: [], fingerprint: fp };
      await d.store.saveList(same, run.id);
      return same;
    }
    const r = await c.ai.run<unknown>({ name: "patterns.merge", client: "none", instructions: MERGE_INSTRUCTIONS, mentions: { answer: "scrub" } }, mergeInput(STARTING_LIST, s), MERGE_SCHEMA);
    if (!r.ok) throw new StopRun(`Stopped: the second list couldn't be made (${r.error.message})`);
    run.spentMicros += Math.round(r.costUsd * 1_000_000);
    const made = listFromMerge(r.value, STARTING_LIST, s, pass1Counts(clean), at, version, fp);
    if (!made) throw new StopRun("Stopped: the AI's second list wasn't usable");
    // The answer was scrubbed by the service; once more here for names the service's directory may not hold.
    const list: TypeList = { ...made, types: made.types.map((t) => ({ name: scrub(t.name)!, meaning: scrub(t.meaning)!, example: scrub(t.example)! })), changes: made.changes.map((x) => ({ ...x, from: x.from.map((f) => scrub(f)!), to: x.to.map((f) => scrub(f)!), reason: scrub(x.reason)! })) };
    await d.store.saveList(list, run.id);
    overBudget(run);
    return list;
  }

  // ---------- the loops ----------

  async function inventoryLoop(run: Run) {
    for (const k of Object.keys(run.progress.clients)) {
      const c = run.progress.clients[k]!;
      if (c.state === "done" || c.state === "skipped") continue;
      c.state = "reading";
      c.reason = null;
      await save(run);
      try {
        await inventoryClient(run, k, c);
        Object.assign(c, { state: "done", phase: "done", ids: [], next: 0, reason: null });
      } catch (e) {
        if (e instanceof Halt || e instanceof StopRun) throw e;
        log("inventory_client", { kind: e instanceof DevOpsFailure ? e.status : "failed", client: k });
        c.state = "stopped";
        c.reason = words(e);
      }
      await save(run);
    }
  }

  async function classifyLoop(run: Run, c: ClassifyDeps) {
    const keys = Object.keys(run.progress.clients);
    for (const k of keys) {
      const cp = run.progress.clients[k]!;
      if (cp.state !== "done" && !(await c.aiAllowed(k))) Object.assign(cp, { state: "skipped", reason: "Allow AI is off for this client (Admin › AI)" });
      else if (cp.state === "skipped") Object.assign(cp, { state: "waiting", reason: null });
    }
    await save(run, run.spentMicros);
    const on = keys.filter((k) => run.progress.clients[k]!.state !== "skipped");
    if ((run.progress.pass ?? 1) === 1) {
      for (const k of on) {
        const cp = run.progress.clients[k]!;
        if (cp.phase === "pass1" && cp.state === "done") continue;
        Object.assign(cp, { state: "reading", phase: "pass1", reason: null });
        await save(run, run.spentMicros);
        try {
          await classifyClient(run, k, cp, STARTING_LIST, 1, c);
          cp.state = "done";
        } catch (e) {
          if (e instanceof Halt || e instanceof StopRun) throw e;
          Object.assign(cp, { state: "stopped", reason: words(e) });
        }
        await save(run, run.spentMicros);
      }
      await d.store.saveList(STARTING_LIST, null);
      const list = await secondList(run, on, c);
      run.progress.pass = 2;
      run.progress.listVersion = list.version;
      for (const k of on) Object.assign(run.progress.clients[k]!, { state: "waiting", phase: "pass2", done: 0, total: 0, dropped: 0 });
      await save(run, run.spentMicros);
    }
    const list = (await d.store.list(run.progress.listVersion ?? "")) ?? STARTING_LIST;
    for (const k of on) {
      const cp = run.progress.clients[k]!;
      if (cp.phase === "pass2" && cp.state === "done") continue;
      Object.assign(cp, { state: "reading", phase: "pass2", reason: null });
      await save(run, run.spentMicros);
      try {
        await classifyClient(run, k, cp, list, 2, c);
        cp.state = "done";
      } catch (e) {
        if (e instanceof Halt || e instanceof StopRun) throw e;
        Object.assign(cp, { state: "stopped", reason: words(e) });
      }
      await save(run, run.spentMicros);
    }
  }

  function launch(run: Run, body: () => Promise<void>) {
    const loop = (async () => {
      try {
        await body();
        const stopped = Object.entries(run.progress.clients).filter(([, c]) => c.state === "stopped");
        await d.store.finish(run.id, d.owner, stopped.length ? "stopped" : "done", stopped.length ? `Stopped: ${stopped.length === 1 ? "1 client" : `${stopped.length} clients`} couldn't be read` : null, run.progress);
        log(`${run.kind}_end`, { count: Object.keys(run.progress.clients).length, kind: stopped.length ? "stopped" : "done" });
      } catch (e) {
        if (e instanceof Halt) return;
        const reason = e instanceof StopRun ? e.message : "Stopped: something went wrong";
        for (const c of Object.values(run.progress.clients)) if (c.state === "reading") c.state = "stopped";
        await d.store.finish(run.id, d.owner, "stopped", reason, run.progress).catch(() => undefined);
        log(`${run.kind}_end`, { kind: e instanceof StopRun ? "stopped" : "failed" });
      } finally {
        if (active?.id === run.id) active = null;
      }
    })();
    active = { id: run.id, loop };
  }

  // ---------- what the page calls ----------

  /** Stops a run whose process went away (no heartbeat, or this process isn't running it). Never restarts it. */
  async function reconcile(): Promise<void> {
    const r = await d.store.running();
    if (!r) return;
    if (r.owner === d.owner && active?.id === r.id) return;
    const old = d.now().epochMilliseconds - Date.parse(r.heartbeatAt) > staleMs;
    if (r.owner === d.owner || old) await d.store.markGone(r.id, GONE);
  }

  async function startInventory(by: string): Promise<{ ok: true; run: Run } | { ok: false; why: "busy" | "no_clients" }> {
    await reconcile();
    const keys = await d.reader.clients();
    if (!keys.length) return { ok: false, why: "no_clients" };
    const progress: Progress = { clients: Object.fromEntries(keys.map((k) => [k, { state: "waiting" as const }])) };
    const run = await d.store.startRun({ kind: "inventory", startedBy: by, owner: d.owner, progress });
    if (!run) return { ok: false, why: "busy" };
    log("inventory_start", { count: keys.length });
    launch(run, () => inventoryLoop(run));
    return { ok: true, run };
  }

  async function startClassify(by: string, c: ClassifyDeps, estimateMicros: number, keys: string[]): Promise<{ ok: true; run: Run } | { ok: false; why: "busy" | "no_clients" }> {
    await reconcile();
    if (!keys.length) return { ok: false, why: "no_clients" };
    const progress: Progress = { pass: 1, clients: Object.fromEntries(keys.map((k) => [k, { state: "waiting" as const, phase: "pass1" }])) };
    const run = await d.store.startRun({ kind: "classify", startedBy: by, owner: d.owner, progress, estimateMicros });
    if (!run) return { ok: false, why: "busy" };
    log("classify_start", { count: keys.length });
    launch(run, () => classifyLoop(run, c));
    return { ok: true, run };
  }

  /** Resume a stopped run: inventory as it was; classification with a new estimate. Stopped clients are tried again. */
  async function resume(id: number, by: string, c?: { deps: ClassifyDeps; estimateMicros: number }): Promise<{ ok: true; run: Run } | { ok: false; why: "busy" | "not_stopped" | "needs_estimate" }> {
    await reconcile();
    const before = await d.store.run(id);
    if (!before || before.state !== "stopped") return { ok: false, why: "not_stopped" };
    if (before.kind === "classify" && !c) return { ok: false, why: "needs_estimate" };
    const run = await d.store.resumeRun(id, { owner: d.owner, startedBy: by, ...(c ? { estimateMicros: c.estimateMicros } : {}) });
    if (!run) return { ok: false, why: "busy" };
    for (const cp of Object.values(run.progress.clients)) if (cp.state === "stopped" || cp.state === "reading") Object.assign(cp, { state: "waiting", reason: null });
    log(`${run.kind}_resume`);
    launch(run, () => (run.kind === "inventory" ? inventoryLoop(run) : classifyLoop(run, c!.deps)));
    return { ok: true, run };
  }

  /** The estimate for a classification now: per client, the items it would send and the expected cost. */
  async function estimate(keys: string[], aiAllowed: (k: string) => Promise<boolean>): Promise<{ clients: Record<string, { items: number; micros: number; skipped: string | null }>; totalItems: number; totalMicros: number }> {
    const prices = d.prices?.() ?? null;
    const latest = (await d.store.lists()).filter((l) => l.version !== STARTING_LIST.version).at(-1) ?? null;
    const instr = classifyInstructions(latest ?? STARTING_LIST).length / 4;
    const clients: Record<string, { items: number; micros: number; skipped: string | null }> = {};
    let totalItems = 0;
    let totalTokens = { input: 0, output: 0 };
    for (const k of keys) {
      if (!(await aiAllowed(k))) {
        clients[k] = { items: 0, micros: 0, skipped: "Allow AI is off for this client (Admin › AI)" };
        continue;
      }
      const p1 = await todo(k, STARTING_LIST, 1);
      // Pass 2 with the newest second list, or (none yet) every eligible item, the conservative guess.
      const levels = levelsOf(p1.all);
      const p2 = latest ? await todo(k, latest, 2) : { need: eligible(p1.all, (t) => levels.get(t) ?? "other"), needB: [] as PatternItem[] };
      const kids = new Map<number, number>();
      for (const i of p1.all) if (i.parentId !== null) kids.set(i.parentId, (kids.get(i.parentId) ?? 0) + 1);
      const tokensOf = (i: PatternItem) => (i.title.length + Math.min(i.facts.descLen, TEXT_CAP) + Math.min(i.facts.acLen, TEXT_CAP) + Math.min(kids.get(i.id) ?? 0, CHILD_TITLES) * 50 + 120) / 4;
      const agreeB = latest ? p2.needB.length : Math.ceil(p2.need.length * 0.05);
      const sent = [...p1.need, ...p2.need];
      const n = sent.length + agreeB;
      const input = sent.reduce((s, i) => s + tokensOf(i), 0) * (1 + agreeB / Math.max(1, sent.length)) + (n / BATCH) * instr;
      const output = n * 90;
      const micros = prices ? costMicros({ inputTokens: Math.round(input), cachedTokens: 0, outputTokens: output }, prices) : 0;
      clients[k] = { items: n, micros, skipped: null };
      totalItems += n;
      totalTokens = { input: totalTokens.input + input, output: totalTokens.output + output };
    }
    // The merge: one request with names and meanings only.
    const merge = prices && totalItems ? costMicros({ inputTokens: 3000, cachedTokens: 0, outputTokens: 2500 }, prices) : 0;
    const totalMicros = Object.values(clients).reduce((s, c) => s + c.micros, 0) + merge;
    return { clients, totalItems, totalMicros };
  }

  return {
    reconcile,
    startInventory,
    startClassify,
    resume,
    estimate,
    /** The run this process is working on, if any (tests wait on its loop). */
    activeLoop: () => active?.loop ?? null,
    /** Tests: stop like a process that went away (no writes, the loop just ends). */
    halt: () => {
      halted = true;
    },
  };
}

export type PatternsRunner = ReturnType<typeof createPatternsRunner>;
export type { Level };
export { OTHER };
