// WP-1: the DevOps patterns page's actions. Every one checks the person's switch first (Admin › People, "DevOps
// patterns (preview)"): without it the answer is the same as for a page that doesn't exist (404), admin or not. Who sees
// what: counts, shares, labels and shapes for every client; item rows (id, title, labels) only for clients the person
// is on, checked here on every request. Runs start only from these actions; nothing here is scheduled.
//
// WP-2: each client's layout (projects, teams and area paths with counts and types; shown to anyone with the switch),
// its analysis scope (the page's own, set here; Admin › Clients' scope is read as the starting point and never written),
// each type's kind (guessed, or set here), and coverage: items in scope, labeled, and not labeled by reason.
//
// WP-3: the list in use is a person's. patterns.list_change previews (what it costs) and saves one change as a new
// version (who, when, why), refused when someone saved another version since; patterns.suggestion ignores an "other"
// suggestion or brings it back. Results are every item's newest label carried to the list in use (no AI): labels on a
// list that can't be carried are counted "on an earlier list", or, when nothing carries at all, shown on their own list
// with a note. Nothing here makes an AI request.
import type { ActionResponse } from "./dispatch.ts";
import type { ClassifyDeps, PatternsRunner } from "./patterns-run.ts";
import { STARTING_LIST, WP1_START, norm, suggestionsOf } from "../plan/patterns/labels.ts";
import { handCheck, resultsOf, type ClientResults } from "../plan/patterns/results.ts";
import { OWN_START, applyEdit, clientNamer, editCost, inUseOf, isAiList, isOwned, nameProblem, ownNumber, parseEdit, resolveLabels, withOwnStart, type Resolved } from "../plan/patterns/owned.ts";
import { summaryMarkdown, typesMarkdown, type ReportClient } from "../plan/patterns/report.ts";
import { levelsOf } from "../plan/patterns/levels.ts";
import { windowFrom, type Snapshot } from "../plan/patterns/inventory.ts";
import { analysisOf, type ClientAnalysis } from "../plan/patterns/analysis.ts";
import { KINDS, type Kind } from "../plan/patterns/kinds.ts";
import { AnalysisScopeError, analysisScopeWords, layoutOf, matcherOf, parseAnalysisScope, sameScope, scopeChoice, type AnalysisScope, type Layout } from "../plan/patterns/scope.ts";
import { scopeWords, type DevOpsScope } from "../plan/devops-scope.ts";
import { PLATFORMS, type Labels, type Platform, type TypeList } from "../plan/patterns/types.ts";
import type { ClientProgress, PatternsStore, Run } from "../store/patterns-store.ts";

export const PATTERNS_ACTIONS = ["patterns.access", "patterns.status", "patterns.run_inventory", "patterns.estimate", "patterns.run_classification", "patterns.resume", "patterns.set_platform", "patterns.set_scope", "patterns.set_kind", "patterns.check", "patterns.download", "patterns.list_change", "patterns.suggestion"] as const;
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
  /** WP-3: a FocusTime person's name for "who changed the list" (null: not known). */
  nameOf?(userId: string): Promise<string | null>;
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
 * WP-2's way, kept for a database where nothing carries to the list in use: the newest second list whose classification
 * finished, else the newest second list, else the starting one.
 */
async function shownVersion(store: PatternsStore): Promise<string> {
  const second = (await store.lists()).filter((l) => isAiList(l.version));
  for (const l of [...second].reverse()) {
    if ((await store.run(Number(l.version.slice(4))))?.state === "done") return l.version;
  }
  return second.at(-1)?.version ?? ((await store.lists()).some((l) => l.version === STARTING_LIST.version) ? STARTING_LIST.version : WP1_START);
}

/** The classify run a WP-2 list version came from (v2-r<id>), or null. */
async function runOfVersion(store: PatternsStore, version: string): Promise<Run | null> {
  return isAiList(version) ? store.run(Number(version.slice(4))) : null;
}

/**
 * WP-3: what the results are on. "in use": every item's newest label carried to the list in use (labels that can't be
 * carried are counted "on an earlier list"). "earlier": nothing carries at all but labels exist, so they show on their
 * own list (WP-2's way), never mixed with another list.
 */
type LabelView = { mode: "in use"; inUse: TypeList; lists: TypeList[] } | { mode: "earlier"; inUse: TypeList; lists: TypeList[]; version: string; run: Run | null };
async function labelView(store: PatternsStore, keys: readonly string[]): Promise<LabelView> {
  const lists = withOwnStart(await store.lists());
  const inUse = inUseOf(lists);
  let carried = 0;
  let earlier = 0;
  for (const k of keys) {
    const r = resolveLabels(await store.allLabels(k), lists, inUse);
    carried += r.carried.size;
    earlier += r.earlier.size;
  }
  if (carried || !earlier) return { mode: "in use", inUse, lists };
  const version = await shownVersion(store);
  return { mode: "earlier", inUse, lists, version, run: await runOfVersion(store, version) };
}

/** One client's labels as the view shows them, with the items on an earlier list and the failed ones. */
async function labelsFor(store: PatternsStore, k: string, v: LabelView): Promise<{ labels: Map<number, Resolved>; earlier: Map<number, string>; failedA: Map<number, number> }> {
  if (v.mode === "earlier") {
    const [labels, fails] = await Promise.all([store.labels(k, v.version), store.failures(k, v.version)]);
    return { labels: new Map([...labels].map(([id, r]) => [id, { rev: r.rev, labels: r.labels, labelsB: r.labelsB, from: v.version, stale: null, failedB: false }])), earlier: new Map(), failedA: fails.a };
  }
  const [rows, fails] = await Promise.all([store.allLabels(k), store.failures(k, v.inUse.version)]);
  const r = resolveLabels(rows, v.lists, v.inUse);
  return { labels: r.carried, earlier: r.earlier, failedA: fails.a };
}

/** Everything the page and the summary show for one client, worked out now. */
type ClientView = { key: string; snapshot: Snapshot | null; analysis: ClientAnalysis | null; results: ClientResults | null; layout: Layout | null; scope: AnalysisScope | null; labels: Map<number, Resolved> };
async function clientView(store: PatternsStore, k: string, o: { view: LabelView; run: Run | null; snaps: Record<string, { runId: number; at: string; numbers: unknown }[]>; kinds: Record<string, Record<string, Kind>>; aiAllowed: boolean; now: string }): Promise<ClientView> {
  const snapshot = (o.snaps[k]?.[0]?.numbers as Snapshot | undefined) ?? null;
  const [items, got, rows, trees] = await Promise.all([store.currentItems(k), labelsFor(store, k, o.view), store.layout(k), store.trees(k)]);
  const labels = got.labels;
  const layout = trees.length || rows.length ? layoutOf(rows, trees) : null;
  if (!snapshot) return { key: k, snapshot, analysis: null, results: null, layout, scope: null, labels };
  const analysis = analysisOf(items, o.kinds[k] ?? {}, { firstItemAt: snapshot.firstItemAt, windowFrom: snapshot.windowFrom ?? windowFrom(Temporal.Instant.from(o.now)) });
  const cp = o.run?.progress.clients[k];
  const results = labels.size || got.failedA.size || got.earlier.size || snapshot.run
    ? resultsOf(items, labels, analysis.kindsMap, { read: snapshot.run?.read ?? null, outside: snapshot.run?.outside ?? null, skippedForAi: (cp?.state === "skipped" && /Allow AI/.test(cp.reason ?? "")) || (!labels.size && !o.aiAllowed), failed: new Set(items.filter((x) => (got.failedA.get(x.id) ?? -1) >= x.rev).map((x) => x.id)), movedOut: new Set(cp?.outsideNow ?? []), earlier: new Set(got.earlier.keys()) })
    : null;
  return { key: k, snapshot, analysis, results, layout, scope: snapshot.run?.scope ?? null, labels };
}

/** The "other" suggestions across clients and per client, without ignored ones or any that names a client or how unclear an item is. */
function suggestionsView(views: readonly ClientView[], ignored: readonly string[], namesClient: (t: string) => boolean) {
  const usable = (n: string) => !ignored.includes(norm(n)) && !nameProblem(n, namesClient);
  const others = (v: ClientView): Labels[] => [...v.labels.values()].map((r) => r.labels).filter((l) => l.otherName && usable(l.otherName));
  const all = suggestionsOf(views.flatMap(others)).slice(0, 30);
  const per = Object.fromEntries(views.map((v) => [v.key, Object.fromEntries(suggestionsOf(others(v)).map((x) => [norm(x.name), x.count]))]));
  return all.map((x) => ({ name: x.name, meaning: x.meaning, count: x.count, clients: Object.fromEntries(Object.entries(per).filter(([, m]) => m[norm(x.name)]).map(([k, m]) => [k, m[norm(x.name)]!])) }));
}

/** Who made a version, as the page says it: "you", their name, or "someone with the page". */
async function whoWords(pc: PatternsContext, me: string, by: string | null | undefined): Promise<string | null> {
  if (!by) return null;
  if (by.toLowerCase() === me.toLowerCase()) return "you";
  return (await pc.nameOf?.(by).catch(() => null)) ?? "someone with the page";
}

/** Whether a text names any client the page covers (keys, and the names and aliases the person's AI directory knows). */
async function namerFor(pc: PatternsContext, keys: readonly string[]): Promise<(t: string) => boolean> {
  const ai = await pc.ai().catch(() => null);
  const dir = ai && "deps" in ai ? ai.deps.directory : [];
  return clientNamer([...keys.map((k) => ({ key: k, names: [] })), ...dir]);
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
      const [keys, mine, snaps, platforms, inv, cls, scopes, kinds, ignored] = await Promise.all([pc.port.clients(), pc.myClients(), store.snapshots(), store.platforms(), store.latest("inventory"), store.latest("classify"), store.scopes(), store.kinds(), store.ignored()]);
      const all = [...new Set([...keys, ...Object.keys(snaps)])].sort((a, b) => a.localeCompare(b));
      const view = await labelView(store, all);
      const shownRun = view.mode === "earlier" ? view.run : null;
      const views: ClientView[] = [];
      const clients = await Promise.all(
        all.map(async (k) => {
          const [now, prev] = snaps[k] ?? [];
          const v = await clientView(store, k, { view, run: shownRun ?? cls.last, snaps, kinds, aiAllowed: await pc.aiAllowed(k).catch(() => false), now: pc.now() });
          views.push(v);
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
      const namesClient = await namerFor(pc, all);
      const versions = await Promise.all(view.lists.filter((l) => isOwned(l.version)).sort((a, b) => ownNumber(b.version) - ownNumber(a.version)).map(async (l) => ({ version: l.version, number: ownNumber(l.version), at: l.createdAt, by: await whoWords(pc, me, l.by), why: l.why ?? null, change: l.version === "own-1" ? null : (l.changes[0] ?? null) })));
      const ai = await pc.ai();
      return {
        ok: true,
        data: {
          clients,
          inventory: { last: runView(inv.last), lastDone: inv.done?.finishedAt ?? null },
          classify: { last: runView(cls.last), lastDone: cls.done?.finishedAt ?? null },
          lists: view.lists,
          inUse: view.inUse,
          versions,
          labelsOn: view.mode === "in use" ? { mode: "in use", version: view.inUse.version } : { mode: "earlier", version: view.version, wp1: view.version === WP1_START || (!!view.run && view.run.progress.rules !== 2) },
          suggestions: suggestionsView(views, ignored, namesClient),
          ignored,
          shownVersion: view.mode === "in use" ? view.inUse.version : view.version,
          shownRules: view.mode === "in use" ? 3 : view.version === WP1_START || (!!view.run && view.run.progress.rules !== 2) ? 1 : 2,
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
      const view = await labelView(store, [k]);
      const [items, got] = await Promise.all([store.currentItems(k), labelsFor(store, k, view)]);
      const labels = got.labels;
      const version = view.mode === "in use" ? view.inUse.version : view.version;
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
      const lists = withOwnStart(await store.lists());
      if (i.kind === "types") return { ok: true, data: { filename: "devops-request-types.md", text: typesMarkdown(lists, inUseOf(lists).version) } };
      const [keys, mine, snaps, platforms, kinds, cls] = await Promise.all([pc.port.clients(), pc.myClients(), store.snapshots(), store.platforms(), store.kinds(), store.latest("classify")]);
      const all = [...new Set([...keys, ...Object.keys(snaps)])].sort((a, b) => a.localeCompare(b));
      const view = await labelView(store, all);
      const shownRun = view.mode === "earlier" ? view.run : null;
      const rows: ReportClient[] = await Promise.all(
        all.map(async (k) => {
          const v = await clientView(store, k, { view, run: shownRun ?? cls.last, snaps, kinds, aiAllowed: await pc.aiAllowed(k).catch(() => false), now: pc.now() });
          // Team, area and project names only in the scope line of a client the person is on.
          return { key: k, mine: mine.some((m) => m.toLowerCase() === k.toLowerCase()), platform: platforms[k] ?? null, scope: v.scope, analysis: v.analysis, snapshot: v.snapshot, results: v.results };
        }),
      );
      const on = view.mode === "in use" ? { mode: "in use" as const, version: view.inUse.version } : { mode: "earlier" as const, version: view.version };
      return { ok: true, data: { filename: "devops-patterns-summary.md", text: summaryMarkdown(rows, pc.now(), { listVersion: on.version, labelsOn: on.mode, wp1Labels: view.mode === "earlier" && (view.version === WP1_START || (!!view.run && view.run.progress.rules !== 2)) }) } };
    }
    case "patterns.list_change": {
      const extra = only(i, ["edit", "base", "why", "preview"]);
      if (extra) return bad(`unknown input field ${extra}`);
      const edit = parseEdit(i.edit);
      if (typeof edit === "string") return bad(edit);
      if (typeof i.base !== "string" || i.base.length > 40) return bad("base names the version you changed");
      if (i.why !== undefined && typeof i.why !== "string") return bad("why is one line");
      if (i.preview !== undefined && typeof i.preview !== "boolean") return bad("preview is true or false");
      const keys = [...new Set([...(await pc.port.clients()), ...Object.keys(await store.snapshots())])];
      const lists = withOwnStart(await store.lists());
      const inUse = inUseOf(lists);
      if (i.base !== inUse.version) return bad("The list changed since you opened it. Look at the new version, then change it again.", 409, "list_changed");
      const namesClient = await namerFor(pc, keys);
      const next = applyEdit(inUse, edit, { why: typeof i.why === "string" && i.why.trim() ? i.why : "(preview)", by: me, at: pc.now(), namesClient });
      if (typeof next === "string") return bad(next, 422, "refused");
      // What it costs, from the labels on the list in use now (every client's: counts only).
      const labels: Resolved[] = [];
      for (const k of keys) labels.push(...resolveLabels(await store.allLabels(k), lists, inUse).carried.values());
      const cost = editCost(edit, labels);
      if (i.preview) return { ok: true, data: { preview: true, cost, version: next.version } };
      if (typeof i.why !== "string" || i.why.trim().length < 3) return bad("Say why in one line", 422, "needs_why");
      if (!(await store.saveOwned(next, OWN_START))) return bad("The list changed since you opened it. Look at the new version, then change it again.", 409, "list_changed");
      return { ok: true, data: { saved: true, version: next.version, cost } };
    }
    case "patterns.suggestion": {
      const extra = only(i, ["name", "ignore"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.name !== "string" || !i.name.trim() || i.name.length > 100 || typeof i.ignore !== "boolean") return bad("patterns.suggestion takes { name, ignore }");
      await store.setIgnored(i.name, i.ignore, me);
      return { ok: true, data: { name: norm(i.name), ignored: i.ignore } };
    }
  }
}
