// WP-1: the DevOps patterns page's actions. Every one checks the person's switch first (Admin › People, "DevOps
// patterns (preview)"): without it the answer is the same as for a page that doesn't exist (404), admin or not. Who sees
// what: counts, shares, labels and shapes for every client; item rows (id, title, labels) only for clients the person
// is on, checked here on every request. Runs start only from these actions; nothing here is scheduled.
//
// WP-2: each client's layout (projects, teams and area paths with counts and types; shown to anyone with the switch),
// its analysis scope (the page's own, set here; Admin › Clients' scope is read as the starting point and never written),
// each type's kind (guessed, or set here), and coverage: items in scope, labeled, and not labeled by reason.
import type { ActionResponse } from "./dispatch.ts";
import type { ClassifyDeps, PatternsRunner } from "./patterns-run.ts";
import { STARTING_LIST, WP1_START } from "../plan/patterns/labels.ts";
import { handCheck, resultsOf, type ClientResults } from "../plan/patterns/results.ts";
import { summaryMarkdown, typesMarkdown, type ReportClient } from "../plan/patterns/report.ts";
import { levelsOf } from "../plan/patterns/levels.ts";
import { windowFrom, type Snapshot } from "../plan/patterns/inventory.ts";
import { analysisOf, type ClientAnalysis } from "../plan/patterns/analysis.ts";
import { KINDS, type Kind } from "../plan/patterns/kinds.ts";
import { AnalysisScopeError, analysisScopeWords, layoutOf, matcherOf, parseAnalysisScope, sameScope, scopeChoice, type AnalysisScope, type Layout } from "../plan/patterns/scope.ts";
import { scopeWords, type DevOpsScope } from "../plan/devops-scope.ts";
import { PLATFORMS, type Platform } from "../plan/patterns/types.ts";
import type { ClientProgress, PatternsStore, Run } from "../store/patterns-store.ts";

export const PATTERNS_ACTIONS = ["patterns.access", "patterns.status", "patterns.run_inventory", "patterns.estimate", "patterns.run_classification", "patterns.resume", "patterns.set_platform", "patterns.set_scope", "patterns.set_kind", "patterns.check", "patterns.download"] as const;
export type PatternsAction = (typeof PATTERNS_ACTIONS)[number];

/** The app-level parts (server/main.ts builds them where DevOps is read centrally). */
export type PatternsPort = {
  store: PatternsStore;
  runner: PatternsRunner;
  /** The clients a run covers (with DevOps set up), Internal included. */
  clients(): Promise<string[]>;
  /** A link to an item in DevOps (from the poller's target; no PAT), or null. */
  itemUrl(clientKey: string, id: number): Promise<string | null>;
  /** A client's DevOps project names (from the poller's target), so every client's projects are masked in AI text. */
  projects?(clientKey: string): Promise<string[]>;
  /** WP-2: Admin › Clients' scope for a client (null: automatic). Read only: the page never writes it. */
  adminScope?(clientKey: string): Promise<DevOpsScope | null>;
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
    const { ids: _ids, outsideNow: _o, kinds: _k, ...rest } = c;
    clients[k] = { ...rest, ...(c.ids && c.phase && c.phase !== "done" ? { total: c.total ?? c.ids.length } : {}) };
  }
  return { id: r.id, kind: r.kind, state: r.state, rules: r.progress.rules ?? 1, reason: r.reason, startedAt: r.startedAt, finishedAt: r.finishedAt, heartbeatAt: r.heartbeatAt, pass: r.progress.pass ?? null, listVersion: r.progress.listVersion ?? null, estimateMicros: r.estimateMicros, spentMicros: r.spentMicros, clients };
}

/**
 * The list version the results show: the newest second list whose classification finished (a run still labeling with a
 * new list, or stopped partway, leaves the previous results on screen), else the newest second list, else the starting one.
 */
async function shownVersion(store: PatternsStore): Promise<string> {
  const second = (await store.lists()).filter((l) => l.version !== STARTING_LIST.version);
  for (const l of [...second].reverse()) {
    const id = /^v2-r(\d+)$/.exec(l.version)?.[1];
    if (id && (await store.run(Number(id)))?.state === "done") return l.version;
  }
  return second.at(-1)?.version ?? STARTING_LIST.version;
}

/** The classify run a list version came from (v2-r<id>), or null for a starting list. */
async function runOfVersion(store: PatternsStore, version: string): Promise<Run | null> {
  const id = /^v2-r(\d+)$/.exec(version)?.[1];
  return id ? store.run(Number(id)) : null;
}

/** Everything the page and the summary show for one client, worked out now. */
type ClientView = { key: string; snapshot: Snapshot | null; analysis: ClientAnalysis | null; results: ClientResults | null; layout: Layout | null; scope: AnalysisScope | null };
async function clientView(store: PatternsStore, k: string, o: { version: string; run: Run | null; snaps: Record<string, { runId: number; at: string; numbers: unknown }[]>; kinds: Record<string, Record<string, Kind>>; aiAllowed: boolean; now: string }): Promise<ClientView> {
  const snapshot = (o.snaps[k]?.[0]?.numbers as Snapshot | undefined) ?? null;
  const [items, labels, fails, rows, trees] = await Promise.all([store.currentItems(k), store.labels(k, o.version), store.failures(k, o.version), store.layout(k), store.trees(k)]);
  const layout = trees.length || rows.length ? layoutOf(rows, trees) : null;
  if (!snapshot) return { key: k, snapshot, analysis: null, results: null, layout, scope: null };
  const analysis = analysisOf(items, o.kinds[k] ?? {}, { firstItemAt: snapshot.firstItemAt, windowFrom: snapshot.windowFrom ?? windowFrom(Temporal.Instant.from(o.now)) });
  const cp = o.run?.progress.clients[k];
  const results = labels.size || fails.a.size || snapshot.run
    ? resultsOf(items, labels, analysis.kindsMap, { read: snapshot.run?.read ?? null, outside: snapshot.run?.outside ?? null, skippedForAi: (cp?.state === "skipped" && /Allow AI/.test(cp.reason ?? "")) || (!labels.size && !o.aiAllowed), failed: new Set(items.filter((x) => (fails.a.get(x.id) ?? -1) >= x.rev).map((x) => x.id)), movedOut: new Set(cp?.outsideNow ?? []) })
    : null;
  return { key: k, snapshot, analysis, results, layout, scope: snapshot.run?.scope ?? null };
}

const sortedKeys = (m: Record<string, string>) => Object.keys(m).sort().map((k) => [k, m[k]]);

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
      const [keys, mine, snaps, platforms, lists, inv, cls, scopes, kinds] = await Promise.all([pc.port.clients(), pc.myClients(), store.snapshots(), store.platforms(), store.lists(), store.latest("inventory"), store.latest("classify"), store.scopes(), store.kinds()]);
      const version = await shownVersion(store);
      const shownRun = await runOfVersion(store, version);
      const all = [...new Set([...keys, ...Object.keys(snaps)])].sort((a, b) => a.localeCompare(b));
      const clients = await Promise.all(
        all.map(async (k) => {
          const [now, prev] = snaps[k] ?? [];
          const v = await clientView(store, k, { version, run: shownRun, snaps, kinds, aiAllowed: await pc.aiAllowed(k).catch(() => false), now: pc.now() });
          const admin = (await pc.port!.adminScope?.(k).catch(() => null)) ?? null;
          const page = scopes[k]?.scope ?? null;
          const mainProject = (await pc.port!.projects?.(k).catch(() => []))?.[0] ?? v.layout?.projects[0]?.project ?? null;
          const choice = scopeChoice({ page, admin, mainProject, layout: v.layout });
          const trees = await store.trees(k);
          return {
            key: k,
            mine: mine.some((m) => m.toLowerCase() === k.toLowerCase()),
            platform: platforms[k] ?? null,
            platformHint: await pc.dataPlatform(k).catch(() => null),
            snapshot: now ? (now.numbers as Snapshot) : null,
            snapshotAt: now?.at ?? null,
            previous: prev ? (prev.numbers as Snapshot) : null,
            previousAt: prev?.at ?? null,
            analysis: v.analysis,
            results: v.results,
            layout: v.layout,
            scope: {
              page,
              admin: admin ? scopeWords(admin) : "Automatic",
              adminKind: admin?.kind ?? "automatic",
              next: choice.scope,
              nextWords: choice.words,
              nextSource: choice.source,
              problems: choice.scope ? matcherOf(choice.scope, trees).problems : [],
              used: v.scope,
              usedWords: v.snapshot?.run ? analysisScopeWords(v.scope) : null,
              changed: !!v.snapshot?.run && !!choice.scope && !sameScope(choice.scope, v.scope),
            },
            kindsChanged: !!v.snapshot?.run && !!v.analysis && JSON.stringify(sortedKeys(v.snapshot.run.kinds)) !== JSON.stringify(sortedKeys(v.analysis.kindsMap)),
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
          shownRules: shownRun?.progress.rules ?? (version === WP1_START ? 1 : version === STARTING_LIST.version ? 2 : 1),
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
        return r.ok ? { ok: true, data: { run: runView(r.run) } } : bad(r.why === "busy" ? "A run is going already" : r.why === "old_rules" ? "That run was made before scopes and kinds. Run it again." : "That run can't be resumed", 409, r.why);
      }
      // Classification: only after an estimate, and only for the total it named (a fresh estimate here must agree).
      if (typeof i.total !== "number" || !Number.isFinite(i.total) || i.total < 0) return bad("Estimate first: Run classification names the estimate's total", 422, "needs_estimate");
      const ai = await pc.ai();
      if ("why" in ai) return bad(ai.why, 422, "no_ai");
      const keys = await pc.port.clients();
      const e = await runner.estimate(keys, (k) => pc.aiAllowed(k));
      if (Math.abs(e.totalMicros - i.total) > Math.max(10_000, e.totalMicros * 0.05)) return bad("The estimate changed. Estimate again.", 409, "estimate_changed");
      const r = run ? await runner.resume(run.id, me, { deps: ai.deps, estimateMicros: e.totalMicros }) : await runner.startClassify(me, ai.deps, e.totalMicros, keys);
      if (!r.ok) return bad(r.why === "busy" ? "A run is going already. Wait for it to finish." : r.why === "no_clients" ? "No client has DevOps set up here" : r.why === "old_rules" ? "That run was made before scopes and kinds. Run it again." : "That run can't be resumed", 409, r.why);
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
    case "patterns.set_scope": {
      const extra = only(i, ["clientKey", "scope"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.clientKey !== "string" || !i.clientKey.trim() || i.clientKey.length > 100) return bad("clientKey names the client");
      const keys = await pc.port.clients();
      if (!keys.includes(i.clientKey)) return bad("No such client here", 404);
      let scope: AnalysisScope | null = null;
      if (i.scope !== null) {
        try {
          scope = parseAnalysisScope(i.scope);
        } catch (e) {
          return bad(e instanceof AnalysisScopeError ? e.message : "That scope can't be used");
        }
        // Only the client's own projects (those its layout read).
        const trees = await store.trees(i.clientKey);
        const projects = new Set(trees.map((t) => t.project.toLowerCase()));
        const roots = new Set(trees.map((t) => (t.root ?? t.project).toLowerCase()));
        const ok = scope.kind === "whole" ? scope.projects.every((p) => projects.has(p.toLowerCase())) : scope.kind === "teams" ? scope.teams.every((t) => projects.has(t.project.toLowerCase())) : scope.areas.every((x) => roots.has(x.path.split("\\")[0]!.toLowerCase()));
        if (!ok) return bad("Choose from this client's projects, teams and area paths (run inventory first to read them)", 422, "not_in_layout");
      }
      // The page's own: Admin › Clients is never written here.
      await store.setScope(i.clientKey, scope, me);
      return { ok: true, data: { clientKey: i.clientKey, scope, words: scope ? `Saved for this page only. Admin › Clients is unchanged. ${analysisScopeWords(scope)} applies from the next inventory or Resume.` : "Cleared. The page goes back to Admin › Clients' scope, if it names teams or area paths." } };
    }
    case "patterns.set_kind": {
      const extra = only(i, ["clientKey", "type", "kind"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.clientKey !== "string" || typeof i.type !== "string" || !i.type.trim() || i.type.length > 200) return bad("patterns.set_kind takes { clientKey, type, kind }");
      if (i.kind !== null && !(KINDS as readonly unknown[]).includes(i.kind)) return bad(`kind is one of ${KINDS.join(", ")} or null`);
      const keys = await pc.port.clients();
      if (!keys.includes(i.clientKey)) return bad("No such client here", 404);
      const types = new Set([...(await store.currentItems(i.clientKey)).map((x) => x.type), ...(await store.layout(i.clientKey)).map((x) => x.type)]);
      if (!types.has(i.type)) return bad("That type isn't in this client's items", 404);
      await store.setKind(i.clientKey, i.type, i.kind as Kind | null, me);
      return { ok: true, data: { clientKey: i.clientKey, type: i.type, kind: i.kind } };
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
      const [items, labels] = await Promise.all([store.currentItems(k), store.labels(k, version)]);
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
      const [keys, mine, snaps, platforms, kinds] = await Promise.all([pc.port.clients(), pc.myClients(), store.snapshots(), store.platforms(), store.kinds()]);
      const version = await shownVersion(store);
      const shownRun = await runOfVersion(store, version);
      const all = [...new Set([...keys, ...Object.keys(snaps)])].sort((a, b) => a.localeCompare(b));
      const rows: ReportClient[] = await Promise.all(
        all.map(async (k) => {
          const v = await clientView(store, k, { version, run: shownRun, snaps, kinds, aiAllowed: await pc.aiAllowed(k).catch(() => false), now: pc.now() });
          // Team, area and project names only in the scope line of a client the person is on.
          return { key: k, mine: mine.some((m) => m.toLowerCase() === k.toLowerCase()), platform: platforms[k] ?? null, scope: v.scope, analysis: v.analysis, snapshot: v.snapshot, results: v.results };
        }),
      );
      return { ok: true, data: { filename: "devops-patterns-summary.md", text: summaryMarkdown(rows, pc.now(), { listVersion: version, wp1Labels: !!shownRun && shownRun.progress.rules !== 2 }) } };
    }
  }
}
