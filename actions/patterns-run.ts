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
//
// WP-2: within a scope. The inventory first reads each project's layout (its area tree and teams, and for every item
// created in the window only its project, area, type and created date), then chooses the client's scope (the page's,
// else Admin › Clients' teams or area paths, else the whole project when it has one area) and reads in full only the
// items in it. A client whose scope needs a choice stops at "Choose its scope" with Resume. Items outside the scope are
// counted, never read further and never sent to AI. The classification labels every item in scope whose kind isn't
// Leave out, with an agreement sample of at least 100 items, and keeps the items whose answer failed its check (with the
// labels, in one transaction) so Resume never pays for them again.
//
// WP-3: one pass, against the list in use (a person's; plan/patterns/owned.ts), fixed when the run starts. A run never
// changes the list and makes no merge request: WP-2's pass 1 sample and the AI merge that wrote a second list are gone
// (pass 1 existed only to feed the merge). An item whose label carries to the list in use (made on an earlier version,
// renamed or merged since) is never sent again; one whose type was removed, or that is "other" or "can't tell" after an
// add, is. The agreement sample skips items whose second answer failed its check, so the next run tops it up.
import type { AiService } from "../ai/service.ts";
import type { ClientEntry } from "../ai/guard.ts";
import { maskTranscript } from "../ai/guard.ts";
import { OUTPUT_REFUSED } from "../ai/service.ts";
import { replaceMentions } from "../plan/boundary.ts";
import { costMicros, type Prices } from "../ai/cost.ts";
import type { Logger } from "../log/logger.ts";
import { F, LAYOUT_FIELDS, PARENT_FIELDS, historyOf, historySample, itemOf, monthRanges, readFields, windowFrom, type ProcessFacts, type RawUpdate, type Snapshot } from "../plan/patterns/inventory.ts";
import { AGREE_MIN, AGREE_SHARE, BATCH, CHILD_TITLES, CLASSIFY_SCHEMA, OTHER, TEXT_CAP, agreementPick, classifyInput, classifyInstructions, cleanList, parseLabels, plain, toClassify, type ClassifyInput } from "../plan/patterns/labels.ts";
import { inUseOf, resolveLabels } from "../plan/patterns/owned.ts";
import { analysisOf } from "../plan/patterns/analysis.ts";
import { kindFacts, kindOfType, kindsOf, type Kind } from "../plan/patterns/kinds.ts";
import { layoutOf, matcherOf, scopeChoice, usedMatcher, type AnalysisScope, type LayoutRow, type ProjectTree } from "../plan/patterns/scope.ts";
import type { DevOpsScope } from "../plan/devops-scope.ts";
import type { Labels, Level, PatternItem, TypeList } from "../plan/patterns/types.ts";
import type { ClientProgress, PatternsStore, Progress, Run } from "../store/patterns-store.ts";
import { DevOpsFailure } from "../sources/devops/source.ts";

/** What the run reads DevOps through (the real one is built in server/main.ts; tests give a fake). */
export type PatternsReader = {
  /** The clients a run covers: every client with DevOps set up, plus the Internal project. */
  clients(): Promise<string[]>;
  /** WP-2: the client's DevOps projects, its main one (Dataverse's) first. */
  projects(clientKey: string): Promise<string[]>;
  /** The client's process: which states are closed or not started, and its estimate fields. */
  process(clientKey: string, project?: string): Promise<ProcessFacts>;
  /** WP-2: a project's area tree and teams (never its people). */
  areas(clientKey: string, project: string): Promise<ProjectTree>;
  /** A WIQL query in one of the client's projects (its main one by default): the ids (at most `top`). */
  ids(clientKey: string, wiql: string, top: number, project?: string): Promise<number[]>;
  batch(clientKey: string, ids: readonly number[], fields: readonly string[], project?: string): Promise<{ id: number; fields: Readonly<Record<string, unknown>> }[]>;
  /** An item's history, oldest first. */
  updates(clientKey: string, id: number, project?: string): Promise<RawUpdate[]>;
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
  /** WP-2: Admin › Clients' scope for a client (null: automatic), the page's starting point. Never written from here. */
  adminScope?: (clientKey: string) => Promise<DevOpsScope | null>;
};

export const PAGE = 100;
export const HISTORY_MAX = 200;
export const PARENT_ROUNDS = 3;
const WIQL_TOP = 20_000;
/** A run stops once what it spent is more than this times the estimate. */
export const COST_STOP = 1.5;
/** WP-2: the rough time a classification takes, for the estimate: an AI request of up to BATCH items, a DevOps read. */
export const AI_SECONDS = 10;
export const READ_SECONDS = 3;

/** Thrown to leave a run's loop without writing (the process lost the run, or a test stopped the "server"). */
class Halt extends Error {}
/** Thrown to end a run as stopped with plain words (the switch went off, the cost passed the estimate, AI stopped). */
class StopRun extends Error {}
/** Thrown to leave one client of a classification as skipped (its Allow AI went off mid-run); the others carry on. */
class SkipClient extends Error {}
/** Emails in the AI's own words (its "other" names and meanings) are replaced before they are kept. */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const GONE = "Stopped: the server restarted or scaled down";
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** A client's newest inventory's scope as a test (null: no inventory under WP-2's rules yet: nothing is classified). */
type ScopeNow = { scope: AnalysisScope; match: (r: Pick<LayoutRow, "project" | "area">) => boolean } | null;
/** WP-2 review: a client whose newest inventory is WP-1's (whole project, no scope) is never classified. */
export const OLD_INVENTORY = "Its last inventory was made before scopes and kinds. Run inventory again.";
const words = (e: unknown): string => {
  if (e instanceof DevOpsFailure) return e.status === "auth_failed" ? "DevOps sign-in was refused" : e.status === "no_access" ? "No access to the DevOps project" : e.status === "unreachable" ? "DevOps couldn't be reached" : "DevOps couldn't be read";
  return "Something went wrong reading this client";
};

export function createPatternsRunner(d: RunnerDeps) {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gapMs = d.gapMs ?? 2_000;
  const waitMs = d.waitMs ?? 30_000;
  /** A request's cost from its size, at the app's prices (for paid answers the service refused). */
  const guessMicros = (items: number, inputChars: number) => {
    const p = d.prices?.() ?? null;
    return p ? costMicros({ inputTokens: Math.round(inputChars / 4) + 600, cachedTokens: 0, outputTokens: items * 90 }, p) : 0;
  };
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

  /** The client's scope for this run (fixed once chosen), or null with the client left at "needs_scope". */
  async function chooseScope(run: Run, k: string, c: ClientProgress): Promise<{ scope: AnalysisScope; match: (r: Pick<LayoutRow, "project" | "area">) => boolean } | null> {
    const trees = await d.store.trees(k);
    if (c.scope) return { scope: c.scope, match: matcherOf(c.scope, trees).match };
    const rows = await d.store.layout(k, run.id);
    const page = (await d.store.scopes())[k]?.scope ?? null;
    const admin = (await d.adminScope?.(k).catch(() => null)) ?? null;
    const choice = scopeChoice({ page, admin, mainProject: c.projects?.[0] ?? null, layout: layoutOf(rows, trees) });
    if (!choice.scope) {
      Object.assign(c, { state: "needs_scope", reason: choice.words });
      return null;
    }
    const m = matcherOf(choice.scope, trees);
    const ids = rows.filter((r) => m.match(r)).map((r) => r.id);
    if (!ids.length) {
      Object.assign(c, { state: "needs_scope", reason: `The scope (${choice.words.toLowerCase()}) matches no item from the last 24 months. Choose another, then Resume.${m.problems.length ? ` ${m.problems.join(". ")}.` : ""}` });
      return null;
    }
    Object.assign(c, { scope: choice.scope, scopeSource: choice.source, read: rows.length, outside: rows.length - ids.length, ids, next: 0, phase: "items" });
    await save(run);
    return { scope: choice.scope, match: m.match };
  }

  /** One client's inventory. False: it stopped at "needs_scope" (the layout is kept; Resume carries on from there). */
  async function inventoryClient(run: Run, k: string, c: ClientProgress): Promise<boolean> {
    if (!c.projects?.length) {
      const ps = await req(run, k, c, () => d.reader.projects(k));
      Object.assign(c, { projects: ps.length ? ps : [], project: 0 });
      if (!ps.length) throw new DevOpsFailure("error", "No DevOps project");
      await save(run);
    }
    const projects = c.projects!;
    const main = projects[0]!;
    const proc = await req(run, k, c, () => d.reader.process(k, main));
    const fields = readFields(proc.estimateFields);
    const t0 = Temporal.Instant.from(run.startedAt);
    const from = windowFrom(t0);
    if (!c.phase || c.phase === "first") {
      // The client's first item ever: the oldest by created date (its main project).
      const first = await req(run, k, c, () => d.reader.ids(k, "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.CreatedDate] ASC", 1, main));
      const v = first.length ? await req(run, k, c, () => d.reader.batch(k, first.slice(0, 1), [F.id, F.created], main)) : [];
      c.firstItemAt = typeof v[0]?.fields[F.created] === "string" ? (v[0]!.fields[F.created] as string) : null;
      Object.assign(c, { phase: "tree", project: 0 });
      await save(run);
    }
    // The layout, project by project: the tree and teams, the window's ids, then each item's project, area, type and date.
    while (c.phase === "tree" || c.phase === "months" || c.phase === "rows") {
      const p = projects[c.project ?? 0]!;
      if (c.phase === "tree") {
        const tree = await req(run, k, c, () => d.reader.areas(k, p));
        await d.store.putTree(k, run.id, { ...tree, project: p });
        Object.assign(c, { phase: "months", month: 0, ids: [] });
        await save(run);
      }
      if (c.phase === "months") {
        const months = monthRanges(t0);
        for (let m = c.month ?? 0; m < months.length; m++) {
          const r = months[m]!;
          const ids = await req(run, k, c, () => d.reader.ids(k, `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.CreatedDate] >= '${r.from}' AND [System.CreatedDate] < '${r.to}' ORDER BY [System.Id]`, WIQL_TOP, p));
          if (ids.length >= WIQL_TOP) c.capped = true;
          c.ids = [...new Set([...(c.ids ?? []), ...ids])];
          c.month = m + 1;
          await save(run);
        }
        Object.assign(c, { phase: "rows", next: 0 });
        await save(run);
      }
      if (c.phase === "rows") {
        const ids = c.ids ?? [];
        for (let i = c.next ?? 0; i < ids.length; i += PAGE) {
          // Only what the layout needs: never a title or text.
          const values = await req(run, k, c, () => d.reader.batch(k, ids.slice(i, i + PAGE), [...LAYOUT_FIELDS], p));
          await d.store.putLayout(k, run.id, values.map((v) => ({ id: v.id, project: str(v.fields[F.project]) || p, area: str(v.fields[F.area]) || null, type: str(v.fields[F.type]), createdAt: str(v.fields[F.created]) || null })));
          c.next = i + PAGE;
          await save(run);
        }
        const more = (c.project ?? 0) + 1 < projects.length;
        Object.assign(c, more ? { phase: "tree", project: (c.project ?? 0) + 1, ids: [], next: 0 } : { phase: "scope", ids: [], next: 0 });
        await save(run);
      }
    }
    // The scope: chosen once the layout is read (phase "scope"), then fixed for the rest of this run.
    const sc = await chooseScope(run, k, c);
    if (!sc) return false;
    if (c.phase === "items" || c.phase === "parents") {
      const inWindow = c.phase === "items";
      const ids = c.ids ?? [];
      const projectOf = new Map((await d.store.layout(k, run.id)).map((r) => [r.id, r.project]));
      for (let i = c.next ?? 0; i < ids.length; i += PAGE) {
        const values = await req(run, k, c, () => d.reader.batch(k, ids.slice(i, i + PAGE), inWindow ? fields : [...PARENT_FIELDS], main));
        const keep: PatternItem[] = [];
        for (const v of values) {
          // An item that moved out of the scope since the layout read: counted outside, nothing of it kept.
          if (inWindow && !sc.match({ project: str(v.fields[F.project]) || projectOf.get(v.id) || main, area: str(v.fields[F.area]) || null })) {
            c.outside = (c.outside ?? 0) + 1;
            await d.store.moveLayout(k, v.id, str(v.fields[F.area]) || null);
            continue;
          }
          keep.push(itemOf(v, proc, inWindow));
        }
        await d.store.putItems(k, run.id, keep);
        c.next = i + PAGE;
        await save(run);
      }
      // Parents not read yet (up to PARENT_ROUNDS levels up), wherever they were created or sit: title and type only.
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
          const ups = await req(run, k, c, () => d.reader.updates(k, it.id, main));
          await d.store.setHistory(k, it.id, historyOf(ups, it.type, proc));
        }
        c.next = i + 1;
        if (i % 10 === 9 || i === ids.length - 1) await save(run);
      }
      Object.assign(c, { phase: "numbers", ids: [], next: 0 });
      await save(run);
    }
    const items = await d.store.items(k, run.id);
    const chosen = (await d.store.kinds())[k] ?? {};
    const a = analysisOf(items, chosen, { firstItemAt: c.firstItemAt ?? null, windowFrom: from });
    const inScope = items.filter((i) => i.inWindow).length;
    // Read = outside + in scope, always: an item the layout saw and the full read didn't (deleted since) is counted as gone.
    const outside = c.outside ?? 0;
    const gone = Math.max(0, (c.read ?? inScope + outside) - outside - inScope);
    const teamAreas = c.scope?.kind === "teams" ? matcherOf(c.scope, await d.store.trees(k)).rules : undefined;
    await d.store.saveSnapshot(run.id, k, { ...a.build, run: { scope: c.scope ?? null, scopeSource: c.scopeSource ?? null, read: inScope + outside, outside, inScope, kinds: a.kindsMap, ...(teamAreas ? { teamAreas } : {}), ...(gone ? { gone } : {}) } });
    log("inventory_client", { count: inScope, client: k });
    return true;
  }

  // ---------- classification ----------

  /** The kinds a classification uses for a client: the person's choices, else the guesses, from its items now. */
  async function kindsNow(k: string): Promise<Record<string, Kind>> {
    return kindsOf(kindFacts(await d.store.currentItems(k)), (await d.store.kinds())[k] ?? {});
  }

  /** The newest inventory's scope for a client, to check an item again when its text is read (null: none recorded). */
  async function scopeNow(k: string): Promise<ScopeNow> {
    const snap = (await d.store.snapshots())[k]?.[0]?.numbers as Snapshot | undefined;
    const scope = snap?.run?.scope ?? null;
    return scope ? { scope, match: usedMatcher(scope, snap!.run!.teamAreas, await d.store.trees(k)) } : null;
  }

  /**
   * The labels this run needs for one client against the list in use: every item in scope whose kind isn't Leave out
   * with no label that carries to the list at its revision (a stale carried label counts as none), not already failed on
   * this list. The agreement sample's second answers: items in `agree` without one.
   */
  async function todo(k: string, list: TypeList, kinds: Readonly<Record<string, Kind>>, o: { agree?: ReadonlySet<string> } = {}) {
    const sc = await scopeNow(k);
    // Only items in the scope the newest inventory used (a later, unfinished inventory may have read a wider one); no
    // WP-2 inventory: nothing at all.
    const where = new Map((await d.store.layout(k)).map((r) => [r.id, r]));
    const all = sc ? (await d.store.currentItems(k)).filter((i) => !i.inWindow || (where.has(i.id) && sc.match(where.get(i.id)!))) : [];
    const pool = toClassify(all, (t) => kindOfType(kinds, t));
    const [rows, lists, fails] = await Promise.all([d.store.allLabels(k), d.store.lists(), d.store.failures(k, list.version)]);
    const { carried } = resolveLabels(rows, lists, list);
    // An answer that failed its check at this revision was paid for: never sent again (until the item changes).
    const failed = (i: PatternItem) => (fails.a.get(i.id) ?? -1) >= i.rev;
    const good = (i: PatternItem) => {
      const c = carried.get(i.id);
      return !!c && c.rev >= i.rev && !c.stale;
    };
    const need = pool.filter((i) => !good(i) && !failed(i));
    const needB = o.agree ? pool.filter((i) => o.agree!.has(`${k}\u0000${i.id}`) && !failed(i) && (fails.b.get(i.id) ?? -1) < i.rev && (need.includes(i) || !carried.get(i.id)?.labelsB)) : [];
    // Out of the agreement sample, so the next items take their place: a second answer (or a first) that failed its check.
    const skipB = pool.filter((i) => failed(i) || (fails.b.get(i.id) ?? -1) >= i.rev || (!!carried.get(i.id)?.failedB && !carried.get(i.id)?.labelsB)).map((i) => `${k}\u0000${i.id}`);
    return { items: pool, need, needB, all, pool, failedHere: pool.filter(failed).length, sc, carried, skipB };
  }

  function inputsFor(k: string, values: { id: number; fields: Readonly<Record<string, unknown>> }[], pool: readonly PatternItem[], c: ClassifyDeps): { input: ClassifyInput; id: number; rev: number }[] {
    const internal = c.isInternal(k);
    const mask = (t: string) => maskTranscript(t, k, c.directory, { internal }).text;
    // Children's titles only from items in scope that are classified (never a parent read for structure, never Leave out).
    const kids = new Map<number, string[]>();
    for (const i of pool) if (i.parentId !== null) (kids.get(i.parentId) ?? kids.set(i.parentId, []).get(i.parentId)!).push(i.title);
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
        // The "other" name and meaning are the AI's free text from one client's items, shown to everyone with the page
        // and sent to the merge: every client's names (this one's too) and any email are replaced before they're kept.
        const scrub = (t: string | null) => (t === null ? null : replaceMentions(t, "\u0000none", c.directory, { records: true, token: "another client" }).text.replace(EMAIL, "[email]"));
        for (const b of batch) {
          const l = parsed.labels.get(b.input.ref);
          if (l) out.set(b.id, { rev: b.rev, labels: { ...l, otherName: scrub(l.otherName), otherMeaning: scrub(l.otherMeaning) } });
        }
        if (parsed.dropped) log("classify_dropped", { count: parsed.dropped, client: k });
        return out;
      }
      const kind = r.error.kind;
      // A request that reached the provider and was then refused on its answer is paid for: counted at a guess, so the
      // cost stop sees it (the service's own log has the real figure).
      if (kind === "invalid_output" || r.error.message === OUTPUT_REFUSED) run.spentMicros += guessMicros(batch.length, classifyInput(batch.map((b) => b.input)).length);
      if (kind === "client_off") throw new SkipClient("Allow AI is off for this client (Admin › AI)");
      // An answer refused for naming another client was paid for: its items count as failed, never sent again one by one.
      if (r.error.message === OUTPUT_REFUSED) return out;
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

  async function classifyClient(run: Run, k: string, cp: ClientProgress, list: TypeList, c: ClassifyDeps, agree: ReadonlySet<string>) {
    const kinds = cp.kinds ?? {};
    const t = await todo(k, list, kinds, { agree });
    const sc = t.sc;
    if (!sc) throw new SkipClient(OLD_INVENTORY);
    const failed = new Set<number>();
    cp.total = t.items.length;
    cp.done = t.items.length - t.need.length - t.failedHere;
    cp.dropped = t.failedHere;
    await save(run, run.spentMicros);
    const work: { item: PatternItem; second: boolean }[] = [...t.need.map((item) => ({ item, second: false })), ...t.needB.map((item) => ({ item, second: true }))];
    const readFieldsC = [F.id, F.rev, F.type, F.title, F.description, F.acceptance, F.tags, F.area, F.project];
    const outside = new Set(cp.outsideNow ?? []);
    const projectOf = new Map((await d.store.layout(k)).map((r) => [r.id, r.project]));
    for (let i = 0; i < work.length; i += PAGE / 2) {
      const chunk = work.slice(i, i + PAGE / 2).filter((w) => !outside.has(w.item.id));
      if (!chunk.length) continue;
      // The text is read now, sent, and dropped: it is never stored.
      const values = await req(run, k, cp, () => d.reader.batch(k, chunk.map((w) => w.item.id), readFieldsC));
      const byId = new Map<number, { id: number; fields: Readonly<Record<string, unknown>> }>();
      for (const v of values) {
        // An item that moved out of the scope since the inventory: never sent, counted outside.
        if (!sc.match({ project: str(v.fields[F.project]) || projectOf.get(v.id) || "", area: str(v.fields[F.area]) || null })) {
          if (!outside.has(v.id)) (cp.outsideNow ??= []).push(v.id);
          outside.add(v.id);
          continue;
        }
        byId.set(v.id, v);
      }
      for (const second of [false, true]) {
        // The second answer only for items whose first answer was kept.
        const part = chunk.filter((w) => w.second === second && byId.has(w.item.id) && !(second && failed.has(w.item.id)));
        // The agreement sample's second answer goes in a separate request, in another order.
        const ordered = second ? [...part].reverse() : part;
        for (let j = 0; j < ordered.length; j += BATCH) {
          const vals = ordered.slice(j, j + BATCH).map((w) => byId.get(w.item.id)!);
          const got = await classifyBatch(run, k, list, inputsFor(k, vals, t.pool.filter((x) => !outside.has(x.id)), c), c);
          const rows = vals.map((v) => {
            const g = got.get(v.id);
            const it = t.all.find((x) => x.id === v.id)!;
            // Keyed by the revision the inventory read (what a rerun compares), or the newer one just read.
            const rev = Math.max(it.rev, g?.rev ?? 0);
            if (!g) return null;
            if (!second) return { itemId: v.id, rev, labels: g.labels };
            // A second answer for an item whose first is carried from an earlier list: the first goes on this list's row
            // with it (as carried), so the pair stays together; the earlier list's row is left as it was.
            const had = t.carried.get(v.id);
            const onList = t.need.some((x) => x.id === v.id) || had?.from === list.version;
            return onList || !had ? { itemId: v.id, rev, labelsB: g.labels } : { itemId: v.id, rev: Math.max(had.rev, rev), labels: had.labels, labelsB: g.labels };
          });
          // Paid for and not kept: written with the labels (one transaction), so Resume never sends them again.
          const revRead = (v: { fields: Readonly<Record<string, unknown>> }) => (typeof v.fields[F.rev] === "number" ? (v.fields[F.rev] as number) : 0);
          const fails = vals.map((v, n) => (rows[n] ? null : { itemId: v.id, rev: Math.max(t.all.find((x) => x.id === v.id)!.rev, revRead(v)), ...(second ? { failedB: true } : { failed: true }) }));
          if (!second) for (const f of fails) if (f) failed.add(f.itemId);
          await d.store.putLabels(k, list.version, [...rows, ...fails].filter((x): x is NonNullable<typeof x> => !!x));
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

  // ---------- the loops ----------

  async function inventoryLoop(run: Run) {
    for (const k of Object.keys(run.progress.clients)) {
      const c = run.progress.clients[k]!;
      if (c.state === "done" || c.state === "skipped") continue;
      c.state = "reading";
      c.reason = null;
      await save(run);
      try {
        if (await inventoryClient(run, k, c)) Object.assign(c, { state: "done", phase: "done", ids: [], next: 0, reason: null });
      } catch (e) {
        if (e instanceof Halt || e instanceof StopRun) throw e;
        log("inventory_client", { kind: e instanceof DevOpsFailure ? e.status : "failed", client: k });
        c.state = "stopped";
        c.reason = words(e);
      }
      await save(run);
    }
  }

  /** The agreement sample over the clients it covers (fixed when the run starts); failed second answers give their place. */
  async function agreement(run: Run, list: TypeList): Promise<Set<string>> {
    const on = run.progress.agreeOn ?? [];
    const per = await Promise.all(on.map(async (k) => {
      const t = await todo(k, list, run.progress.clients[k]?.kinds ?? {});
      return { key: k, ids: t.pool.map((i) => i.id), skip: t.skipB };
    }));
    return agreementPick(per, AGREE_MIN, AGREE_SHARE, new Set(per.flatMap((p) => p.skip)));
  }

  async function classifyLoop(run: Run, c: ClassifyDeps) {
    const keys = Object.keys(run.progress.clients);
    for (const k of keys) {
      const cp = run.progress.clients[k]!;
      if (cp.state !== "done" && !(await c.aiAllowed(k))) Object.assign(cp, { state: "skipped", reason: "Allow AI is off for this client (Admin › AI)" });
      else if (cp.state === "skipped") Object.assign(cp, { state: "waiting", reason: null });
    }
    const on = keys.filter((k) => run.progress.clients[k]!.state !== "skipped");
    run.progress.agreeOn ??= on;
    await save(run, run.spentMicros);
    // The list fixed when the run started: a person's change since applies to the next run.
    const list = cleanList((await d.store.list(run.progress.listVersion ?? "")) ?? inUseOf(await d.store.lists()));
    const agree = await agreement(run, list);
    for (const k of on) {
      const cp = run.progress.clients[k]!;
      if (cp.state === "done") continue;
      Object.assign(cp, { state: "reading", phase: "labels", reason: null });
      await save(run, run.spentMicros);
      try {
        await classifyClient(run, k, cp, list, c, agree);
        cp.state = "done";
      } catch (e) {
        if (e instanceof Halt || e instanceof StopRun) throw e;
        Object.assign(cp, e instanceof SkipClient ? { state: "skipped", reason: e.message } : { state: "stopped", reason: words(e) });
      }
      await save(run, run.spentMicros);
    }
  }

  function launch(run: Run, body: () => Promise<void>) {
    const loop = (async () => {
      try {
        await body();
        const stopped = Object.values(run.progress.clients).filter((c) => c.state === "stopped").length;
        const scope = Object.values(run.progress.clients).filter((c) => c.state === "needs_scope").length;
        const n = (k: number) => (k === 1 ? "1 client" : `${k} clients`);
        const reason = [stopped ? `${n(stopped)} couldn't be read` : null, scope ? `${n(scope)} ${scope === 1 ? "needs" : "need"} a scope: choose it below, then Resume inventory` : null].filter(Boolean).join("; ");
        await d.store.finish(run.id, d.owner, reason ? "stopped" : "done", reason ? `Stopped: ${reason}` : null, run.progress);
        log(`${run.kind}_end`, { count: Object.keys(run.progress.clients).length, kind: reason ? "stopped" : "done" });
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
    const progress: Progress = { rules: 2, clients: Object.fromEntries(keys.map((k) => [k, { state: "waiting" as const }])) };
    const run = await d.store.startRun({ kind: "inventory", startedBy: by, owner: d.owner, progress });
    if (!run) return { ok: false, why: "busy" };
    log("inventory_start", { count: keys.length });
    launch(run, () => inventoryLoop(run));
    return { ok: true, run };
  }

  async function startClassify(by: string, c: ClassifyDeps, estimateMicros: number, keys: string[]): Promise<{ ok: true; run: Run } | { ok: false; why: "busy" | "no_clients" }> {
    await reconcile();
    if (!keys.length) return { ok: false, why: "no_clients" };
    // The kinds and the list are fixed now: a kind or a list changed while the run goes applies to the next run.
    const kinds = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await kindsNow(k)] as const)));
    const list = inUseOf(await d.store.lists());
    await d.store.saveList(list, null);
    const progress: Progress = { rules: 3, listVersion: list.version, clients: Object.fromEntries(keys.map((k) => [k, { state: "waiting" as const, phase: "labels", kinds: kinds[k] ?? {} }])) };
    const run = await d.store.startRun({ kind: "classify", startedBy: by, owner: d.owner, progress, estimateMicros });
    if (!run) return { ok: false, why: "busy" };
    log("classify_start", { count: keys.length });
    launch(run, () => classifyLoop(run, c));
    return { ok: true, run };
  }

  /**
   * Resume a stopped run: inventory as it was (clients waiting for a scope carry on with the one chosen since);
   * classification with a new estimate. Stopped clients are tried again. A run made before WP-2 isn't resumed.
   */
  async function resume(id: number, by: string, c?: { deps: ClassifyDeps; estimateMicros: number }): Promise<{ ok: true; run: Run } | { ok: false; why: "busy" | "not_stopped" | "needs_estimate" | "old_rules" }> {
    await reconcile();
    const before = await d.store.run(id);
    if (!before || before.state !== "stopped") return { ok: false, why: "not_stopped" };
    // Inventory under WP-2's rules; a classification only under WP-3's (one pass against the list in use).
    if (before.kind === "inventory" ? before.progress.rules !== 2 : before.progress.rules !== 3) return { ok: false, why: "old_rules" };
    if (before.kind === "classify" && !c) return { ok: false, why: "needs_estimate" };
    const run = await d.store.resumeRun(id, { owner: d.owner, startedBy: by, ...(c ? { estimateMicros: c.estimateMicros } : {}) });
    if (!run) return { ok: false, why: "busy" };
    for (const cp of Object.values(run.progress.clients)) if (cp.state === "stopped" || cp.state === "reading" || cp.state === "needs_scope") Object.assign(cp, { state: "waiting", reason: null });
    log(`${run.kind}_resume`);
    launch(run, () => (run.kind === "inventory" ? inventoryLoop(run) : classifyLoop(run, c!.deps)));
    return { ok: true, run };
  }

  /**
   * The estimate for a classification now, against the list in use: per client, the items it would send (those with no
   * label on the list, or one that needs labeling again) and the agreement sample's second answers, the expected cost and
   * a rough time.
   */
  async function estimate(keys: string[], aiAllowed: (k: string) => Promise<boolean>): Promise<Estimate> {
    const prices = d.prices?.() ?? null;
    const list = inUseOf(await d.store.lists());
    const instr = classifyInstructions(list).length / 4;
    const clients: Estimate["clients"] = {};
    const allowed: string[] = [];
    const kinds: Record<string, Record<string, Kind>> = {};
    const per: { key: string; ids: number[]; skip: string[] }[] = [];
    for (const k of keys) {
      kinds[k] = await kindsNow(k);
      const p = await todo(k, list, kinds[k]!);
      if (!p.sc) {
        clients[k] = { items: 0, toClassify: 0, micros: 0, seconds: 0, skipped: OLD_INVENTORY };
        continue;
      }
      if (!(await aiAllowed(k))) {
        clients[k] = { items: 0, toClassify: p.items.length, micros: 0, seconds: 0, skipped: "Allow AI is off for this client (Admin › AI)" };
        continue;
      }
      allowed.push(k);
      per.push({ key: k, ids: p.pool.map((i) => i.id), skip: p.skipB });
    }
    const agree = agreementPick(per, AGREE_MIN, AGREE_SHARE, new Set(per.flatMap((p) => p.skip)));
    for (const k of allowed) {
      const p = await todo(k, list, kinds[k]!, { agree });
      const kids = new Map<number, number>();
      for (const i of p.all) if (i.parentId !== null) kids.set(i.parentId, (kids.get(i.parentId) ?? 0) + 1);
      const tokensOf = (i: PatternItem) => (i.title.length + Math.min(i.facts.descLen, TEXT_CAP) + Math.min(i.facts.acLen, TEXT_CAP) + Math.min(kids.get(i.id) ?? 0, CHILD_TITLES) * 50 + 120) / 4;
      const sent = [...p.need, ...p.needB];
      const n = sent.length;
      const input = sent.reduce((s, i) => s + tokensOf(i), 0) + Math.ceil(n / BATCH) * instr;
      const output = n * 90;
      const micros = prices ? costMicros({ inputTokens: Math.round(input), cachedTokens: 0, outputTokens: output }, prices) : 0;
      const requests = Math.ceil(p.need.length / BATCH) + Math.ceil(p.needB.length / BATCH);
      const reads = Math.ceil((p.need.length + p.needB.filter((i) => !p.need.includes(i)).length) / (PAGE / 2));
      clients[k] = { items: n, toClassify: p.items.length, micros, seconds: requests * AI_SECONDS + reads * READ_SECONDS, skipped: null };
    }
    const totalItems = Object.values(clients).reduce((s, c) => s + c.items, 0);
    const totalMicros = Object.values(clients).reduce((s, c) => s + c.micros, 0);
    const totalSeconds = Object.values(clients).reduce((s, c) => s + c.seconds, 0);
    return { clients, totalItems, totalMicros, totalSeconds, agreement: agree.size, list: list.version };
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
/** What Estimate answers: per client, the requests' items (labels and the agreement answers), the items in scope to classify, cost and time; the list in use. */
export type Estimate = { clients: Record<string, { items: number; toClassify: number; micros: number; seconds: number; skipped: string | null }>; totalItems: number; totalMicros: number; totalSeconds: number; agreement: number; list: string };
export type { Level };
export { OTHER };
