// WP-1: the DevOps patterns page's actions. Every one checks the person's switch first (Admin › People, "DevOps
// patterns (preview)"): without it the answer is the same as for a page that doesn't exist (404), admin or not. Who sees
// what: counts, shares, labels and shapes for every client; item rows (id, title, labels) only for clients the person
// is on, checked here on every request. Runs start only from these actions; nothing here is scheduled.
import type { ActionResponse } from "./dispatch.ts";
import type { ClassifyDeps, PatternsRunner } from "./patterns-run.ts";
import { STARTING_LIST } from "../plan/patterns/labels.ts";
import { handCheck, resultsOf, sumResults, type ClientResults } from "../plan/patterns/results.ts";
import { summaryMarkdown, typesMarkdown } from "../plan/patterns/report.ts";
import { levelsOf } from "../plan/patterns/levels.ts";
import type { Snapshot } from "../plan/patterns/inventory.ts";
import { PLATFORMS, type Platform } from "../plan/patterns/types.ts";
import type { ClientProgress, PatternsStore, Run } from "../store/patterns-store.ts";

export const PATTERNS_ACTIONS = ["patterns.access", "patterns.status", "patterns.run_inventory", "patterns.estimate", "patterns.run_classification", "patterns.resume", "patterns.set_platform", "patterns.check", "patterns.download"] as const;
export type PatternsAction = (typeof PATTERNS_ACTIONS)[number];

/** The app-level parts (server/main.ts builds them where DevOps is read centrally). */
export type PatternsPort = {
  store: PatternsStore;
  runner: PatternsRunner;
  /** The clients a run covers (with DevOps set up), Internal included. */
  clients(): Promise<string[]>;
  /** A link to an item in DevOps (from the poller's target; no PAT), or null. */
  itemUrl(clientKey: string, id: number): Promise<string | null>;
  /** The app's AI prices are set (the estimate uses them). */
};

/** What one request needs, built per request by dispatch. */
export type PatternsContext = {
  port: PatternsPort | null;
  /** The signed-in person's id, and whether their switch is on. */
  me(): Promise<string | null>;
  allowed(userId: string): Promise<boolean>;
  /** The clients this person is on (Account Workers). */
  myClients(): Promise<string[]>;
  /** DP-2's data platform for a client (a hint only), or null. */
  dataPlatform(clientKey: string): Promise<string | null>;
  /** The person's AI for a classification, or why there is none (plain words). */
  ai(): Promise<{ deps: ClassifyDeps } | { why: string }>;
  aiAllowed(clientKey: string): Promise<boolean>;
  now(): string;
};

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
const NOT_FOUND = (): ActionResponse => bad("No such page", 404, "not_found");
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const only = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).find((k) => !keys.includes(k)) ?? null;

/** A run as the page sees it: states and reasons, never the ids it is working through, never who started it. */
function runView(r: Run | null) {
  if (!r) return null;
  const clients: Record<string, Omit<ClientProgress, "ids">> = {};
  for (const [k, c] of Object.entries(r.progress.clients)) {
    const { ids: _ids, ...rest } = c;
    clients[k] = { ...rest, ...(c.ids && c.phase && c.phase !== "done" ? { total: c.total ?? c.ids.length } : {}) };
  }
  return { id: r.id, kind: r.kind, state: r.state, reason: r.reason, startedAt: r.startedAt, finishedAt: r.finishedAt, heartbeatAt: r.heartbeatAt, pass: r.progress.pass ?? null, listVersion: r.progress.listVersion ?? null, estimateMicros: r.estimateMicros, spentMicros: r.spentMicros, clients };
}

/** The list version the results show: the newest second list, else the starting one. */
async function shownVersion(store: PatternsStore): Promise<string> {
  return (await store.lists()).filter((l) => l.version !== STARTING_LIST.version).at(-1)?.version ?? STARTING_LIST.version;
}

async function clientResults(store: PatternsStore, k: string, version: string): Promise<ClientResults | null> {
  const labels = await store.labels(k, version);
  if (!labels.size) return null;
  return resultsOf(await store.items(k), labels);
}

export async function patternsAction(pc: PatternsContext, action: PatternsAction, input: unknown): Promise<ActionResponse> {
  const i = obj(input ?? {});
  if (!i) return bad("input must be an object");
  const me = await pc.me();
  const on = !!pc.port && !!me && (await pc.allowed(me));
  if (action === "patterns.access") {
    if (Object.keys(i).length) return bad("patterns.access takes {}");
    return { ok: true, data: { on } };
  }
  // The one check, on the server, for everything behind the page.
  if (!on || !pc.port || !me) return NOT_FOUND();
  const { store, runner } = pc.port;

  switch (action) {
    case "patterns.status": {
      if (Object.keys(i).length) return bad("patterns.status takes {}");
      await runner.reconcile();
      const [keys, mine, snaps, platforms, lists, inv, cls] = await Promise.all([pc.port.clients(), pc.myClients(), store.snapshots(), store.platforms(), store.lists(), store.latest("inventory"), store.latest("classify")]);
      const version = await shownVersion(store);
      const all = [...new Set([...keys, ...Object.keys(snaps)])].sort((a, b) => a.localeCompare(b));
      const clients = await Promise.all(
        all.map(async (k) => {
          const [now, prev] = snaps[k] ?? [];
          return {
            key: k,
            mine: mine.some((m) => m.toLowerCase() === k.toLowerCase()),
            platform: platforms[k] ?? null,
            platformHint: await pc.dataPlatform(k).catch(() => null),
            snapshot: (now?.numbers as Snapshot | undefined) ?? null,
            snapshotAt: now?.at ?? null,
            previous: prev ? (prev.numbers as Snapshot).headline : null,
            previousAt: prev?.at ?? null,
            results: await clientResults(store, k, version),
          };
        }),
      );
      const ai = await pc.ai();
      return {
        ok: true,
        data: {
          clients,
          inventory: { last: runView(inv.last), lastDone: inv.done?.finishedAt ?? null },
          classify: { last: runView(cls.last), lastDone: cls.done?.finishedAt ?? null },
          lists,
          shownVersion: version,
          ai: "why" in ai ? { ready: false, words: ai.why } : { ready: true, words: null },
        },
      };
    }
    case "patterns.run_inventory": {
      if (Object.keys(i).length) return bad("patterns.run_inventory takes {}");
      const r = await runner.startInventory(me);
      if (!r.ok) return r.why === "busy" ? bad("A run is going already. Wait for it to finish.", 409, "busy") : bad("No client has DevOps set up here", 422, "no_clients");
      return { ok: true, data: { run: runView(r.run) } };
    }
    case "patterns.estimate": {
      if (Object.keys(i).length) return bad("patterns.estimate takes {}");
      const ai = await pc.ai();
      if ("why" in ai) return bad(ai.why, 422, "no_ai");
      const keys = await pc.port.clients();
      const e = await runner.estimate(keys, (k) => pc.aiAllowed(k));
      return { ok: true, data: e };
    }
    case "patterns.run_classification":
    case "patterns.resume": {
      const extra = only(i, action === "patterns.resume" ? ["runId", "total"] : ["total"]);
      if (extra) return bad(`unknown input field ${extra}`);
      const resumeId = action === "patterns.resume" ? i.runId : null;
      if (action === "patterns.resume" && (typeof resumeId !== "number" || !Number.isInteger(resumeId))) return bad("patterns.resume takes { runId, total? }");
      const run = resumeId !== null ? await store.run(resumeId as number) : null;
      if (action === "patterns.resume" && run?.kind === "inventory") {
        const r = await runner.resume(run.id, me);
        return r.ok ? { ok: true, data: { run: runView(r.run) } } : bad(r.why === "busy" ? "A run is going already" : "That run can't be resumed", 409, r.why);
      }
      // Classification: only after an estimate, and only for the total it named (a fresh estimate here must agree).
      if (typeof i.total !== "number" || !Number.isFinite(i.total) || i.total < 0) return bad("Estimate first: Run classification names the estimate's total", 422, "needs_estimate");
      const ai = await pc.ai();
      if ("why" in ai) return bad(ai.why, 422, "no_ai");
      const keys = await pc.port.clients();
      const e = await runner.estimate(keys, (k) => pc.aiAllowed(k));
      if (Math.abs(e.totalMicros - i.total) > Math.max(10_000, e.totalMicros * 0.05)) return bad("The estimate changed. Estimate again.", 409, "estimate_changed");
      const r = run ? await runner.resume(run.id, me, { deps: ai.deps, estimateMicros: e.totalMicros }) : await runner.startClassify(me, ai.deps, e.totalMicros, keys);
      if (!r.ok) return bad(r.why === "busy" ? "A run is going already. Wait for it to finish." : r.why === "no_clients" ? "No client has DevOps set up here" : "That run can't be resumed", 409, r.why);
      return { ok: true, data: { run: runView(r.run) } };
    }
    case "patterns.set_platform": {
      const extra = only(i, ["clientKey", "platform"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.clientKey !== "string" || !i.clientKey.trim() || i.clientKey.length > 100) return bad("clientKey names the client");
      if (i.platform !== null && !(PLATFORMS as readonly unknown[]).includes(i.platform)) return bad(`platform is one of ${PLATFORMS.join(", ")} or null`);
      const keys = await pc.port.clients();
      if (!keys.includes(i.clientKey)) return bad("No such client here", 404);
      await store.setPlatform(i.clientKey, i.platform as Platform | null, me);
      return { ok: true, data: { clientKey: i.clientKey, platform: i.platform } };
    }
    case "patterns.check": {
      const extra = only(i, ["clientKey"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.clientKey !== "string") return bad("patterns.check takes { clientKey }");
      // Item rows only for a client the person is on, checked now (a person taken off a client loses it at once).
      const mine = await pc.myClients();
      const k = mine.find((m) => m.toLowerCase() === (i.clientKey as string).toLowerCase());
      if (!k) return bad("Check by hand is only for clients you're on", 403, "not_yours");
      const version = await shownVersion(store);
      const [items, labels] = await Promise.all([store.items(k), store.labels(k, version)]);
      const levels = levelsOf(items);
      const rows = await Promise.all(
        handCheck(items.filter((x) => x.inWindow), labels).map(async (it) => ({ id: it.id, url: await pc.port!.itemUrl(k, it.id).catch(() => null), title: it.title, type: it.type, level: levels.get(it.type) ?? "other", labels: labels.get(it.id)!.labels })),
      );
      return { ok: true, data: { clientKey: k, version, rows } };
    }
    case "patterns.download": {
      const extra = only(i, ["kind"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (i.kind !== "summary" && i.kind !== "types") return bad("kind is summary or types");
      const lists = await store.lists();
      if (i.kind === "types") return { ok: true, data: { filename: "devops-request-types.md", text: typesMarkdown(lists.length ? lists : [STARTING_LIST]) } };
      const [keys, snaps, platforms] = await Promise.all([pc.port.clients(), store.snapshots(), store.platforms()]);
      const version = await shownVersion(store);
      const all = [...new Set([...keys, ...Object.keys(snaps)])].sort((a, b) => a.localeCompare(b));
      const rows = await Promise.all(all.map(async (k) => ({ key: k, platform: platforms[k] ?? null, snapshot: (snaps[k]?.[0]?.numbers as Snapshot | undefined) ?? null, results: await clientResults(store, k, version) })));
      const total = sumResults(rows.map((r) => r.results).filter((r): r is ClientResults => !!r));
      return { ok: true, data: { filename: "devops-patterns-summary.md", text: summaryMarkdown(rows, total, pc.now()) } };
    }
  }
}
