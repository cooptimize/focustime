// WP-1, WP-2: the DevOps patterns store, ten app tables (store/migrations/20261130T1100_devops_patterns.ts and
// 20261201T0900_patterns_scope.ts: the layout, each project's tree, the page's scopes and kinds). Written only by
// the patterns run and the page's own actions (actions/patterns.ts), which decide who may see what. No description,
// acceptance or comment text, no person's name: items keep ids, type, state, dates, parent, title and numbers. Every
// write is one transaction.
import type { Conn, Row } from "./sql/conn.ts";
import type { Facts, Labels, PatternItem, Platform, TypeList } from "../plan/patterns/types.ts";
import type { AnalysisScope, LayoutRow, ProjectTree } from "../plan/patterns/scope.ts";
import type { Kind } from "../plan/patterns/kinds.ts";

export type RunKind = "inventory" | "classify";
export type RunState = "running" | "stopped" | "done";
/** One client's place in a run. */
export type ClientProgress = {
  /** WP-2: needs_scope, the layout is read and the person must choose the client's scope before Resume reads the rest. */
  state: "waiting" | "reading" | "done" | "stopped" | "skipped" | "needs_scope";
  /** Plain words: why it stopped or was skipped, or what it waits for while reading. */
  reason?: string | null;
  /** Inventory: first, months, items, parents, history, numbers. Classification: pass1, pass2. */
  phase?: string;
  /** Inventory: months queried so far; the ids still to read in the current phase and how far through them. */
  month?: number;
  /** Inventory: how many levels of parents have been read. */
  round?: number;
  ids?: number[];
  next?: number;
  firstItemAt?: string | null;
  /** Classification: items to classify, done, sent requests, items the answer couldn't label. */
  total?: number;
  done?: number;
  dropped?: number;
  capped?: boolean;
  /** WP-2 inventory: the client's projects, the one being read, and the scope this run uses (fixed when chosen). */
  projects?: string[];
  project?: number;
  scope?: AnalysisScope | null;
  scopeSource?: string | null;
  /** WP-2 inventory: items the layout read, and those it left outside the scope (moved out mid-run included). */
  read?: number;
  outside?: number;
  /** WP-2 classification: items found outside the scope when their text was read (moved since the inventory): never sent. */
  outsideNow?: number[];
  /** WP-2 classification: the kinds this run uses (fixed at its start; a change applies to the next run). */
  kinds?: Record<string, Kind>;
};
export type Progress = { clients: Record<string, ClientProgress>; pass?: 1 | 2; listVersion?: string; /** 2 from WP-2. */ rules?: 2; /** WP-2: the clients pass 2's agreement sample covers. */ agreeOn?: string[] };
export type Run = { id: number; kind: RunKind; state: RunState; startedBy: string; startedAt: string; heartbeatAt: string; finishedAt: string | null; owner: string; reason: string | null; progress: Progress; estimateMicros: number; spentMicros: number };
export type LabelRow = { itemId: number; rev: number; labels: Labels; labelsB: Labels | null };

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => Number(v ?? 0);

const runOf = (r: Row): Run => ({
  id: n(r.id),
  kind: String(r.kind) as RunKind,
  state: String(r.state) as RunState,
  startedBy: String(r.started_by),
  startedAt: String(r.started_at),
  heartbeatAt: String(r.heartbeat_at),
  finishedAt: s(r.finished_at),
  owner: String(r.owner),
  reason: s(r.reason),
  progress: JSON.parse(String(r.progress)) as Progress,
  estimateMicros: n(r.estimate_micros),
  spentMicros: n(r.spent_micros),
});

const itemOf = (r: Row): PatternItem => ({
  id: n(r.item_id),
  rev: n(r.rev),
  type: String(r.type),
  state: String(r.state),
  createdAt: s(r.created_at),
  activatedAt: s(r.activated_at),
  closedAt: s(r.closed_at),
  parentId: r.parent_id === null || r.parent_id === undefined ? null : n(r.parent_id),
  title: String(r.title),
  facts: JSON.parse(String(r.facts)) as Facts,
  inWindow: n(r.in_window) === 1,
});

/** Only the numbers of Facts go into the facts column: never text, whatever a caller passes. */
const factsJson = (f: Facts): string =>
  JSON.stringify({ descLen: n(f.descLen), acLen: n(f.acLen), tags: n(f.tags), estimate: !!f.estimate, comments: n(f.comments), closed: !!f.closed, ...(f.history ? { history: { changedAfterStart: !!f.history.changedAfterStart, emptyAtClose: !!f.history.emptyAtClose } } : {}) });
/** Only the label fields, each from its list (validated before), into the labels column. */
const labelsJson = (l: Labels): string => JSON.stringify({ requestType: l.requestType, otherName: l.otherName, otherMeaning: l.otherMeaning, layers: l.layers, readiness: l.readiness, missing: l.missing, confidence: l.confidence });

export function createPatternsStore(conn: Conn, now: () => Temporal.Instant) {
  /** A write that broke the one-running-run index means someone else's run started first: busy (null). */
  const busyOnClash = async (f: () => Promise<Run | null>): Promise<Run | null> => {
    try {
      return await f();
    } catch (e) {
      if (await conn.get("SELECT id FROM patterns_runs WHERE state = 'running'").catch(() => null)) return null;
      throw e;
    }
  };
  const at = () => now().toString();
  return {
    // ---------- runs ----------
    /** Starts a run unless one is running (one at a time for the whole deployment); null when one is. */
    async startRun(o: { kind: RunKind; startedBy: string; owner: string; progress: Progress; estimateMicros?: number }): Promise<Run | null> {
      // The check is for the plain case; the filtered unique index (one 'running' row) decides a race (SQL Server reads
      // committed rows, so two presses can both pass the check): the loser's insert fails and it is "busy".
      return busyOnClash(() => conn.tx(async () => {
        if (await conn.get("SELECT id FROM patterns_runs WHERE state = 'running'")) return null;
        const t = at();
        const r = await conn.run("INSERT INTO patterns_runs (kind, state, started_by, started_at, heartbeat_at, owner, progress, estimate_micros, spent_micros) VALUES (?, 'running', ?, ?, ?, ?, ?, ?, 0)", [o.kind, o.startedBy.slice(0, 64), t, t, o.owner.slice(0, 64), JSON.stringify(o.progress), o.estimateMicros ?? 0]);
        const id = r.lastId ?? n((await conn.get("SELECT MAX(id) AS id FROM patterns_runs"))?.id);
        return runOf((await conn.get("SELECT * FROM patterns_runs WHERE id = ?", [id]))!);
      }));
    },
    /** Takes a stopped run back (Resume) for this owner, unless another run is going. */
    async resumeRun(id: number, o: { owner: string; startedBy: string; estimateMicros?: number }): Promise<Run | null> {
      return busyOnClash(() => conn.tx(async () => {
        if (await conn.get("SELECT id FROM patterns_runs WHERE state = 'running'")) return null;
        const r = await conn.run(`UPDATE patterns_runs SET state = 'running', owner = ?, heartbeat_at = ?, reason = NULL, started_by = ?${o.estimateMicros !== undefined ? ", estimate_micros = ?, spent_micros = 0" : ""} WHERE id = ? AND state = 'stopped'`, [o.owner.slice(0, 64), at(), o.startedBy.slice(0, 64), ...(o.estimateMicros !== undefined ? [o.estimateMicros] : []), id]);
        if (!r.changes) return null;
        return runOf((await conn.get("SELECT * FROM patterns_runs WHERE id = ?", [id]))!);
      }));
    },
    async run(id: number): Promise<Run | null> {
      const r = await conn.get("SELECT * FROM patterns_runs WHERE id = ?", [id]);
      return r ? runOf(r) : null;
    },
    /** The newest run of a kind (any state), and the newest finished one. */
    async latest(kind: RunKind): Promise<{ last: Run | null; done: Run | null }> {
      const last = await conn.get("SELECT * FROM patterns_runs WHERE kind = ? ORDER BY id DESC LIMIT 1", [kind]);
      const done = await conn.get("SELECT * FROM patterns_runs WHERE kind = ? AND state = 'done' ORDER BY id DESC LIMIT 1", [kind]);
      return { last: last ? runOf(last) : null, done: done ? runOf(done) : null };
    },
    async running(): Promise<Run | null> {
      const r = await conn.get("SELECT * FROM patterns_runs WHERE state = 'running' ORDER BY id DESC LIMIT 1");
      return r ? runOf(r) : null;
    },
    /** Saves progress and the heartbeat; only while this owner holds the run (false: it doesn't any more). */
    async saveProgress(id: number, owner: string, progress: Progress, spentMicros?: number): Promise<boolean> {
      const r = await conn.tx(() => conn.run(`UPDATE patterns_runs SET progress = ?, heartbeat_at = ?${spentMicros !== undefined ? ", spent_micros = ?" : ""} WHERE id = ? AND owner = ? AND state = 'running'`, [JSON.stringify(progress), at(), ...(spentMicros !== undefined ? [spentMicros] : []), id, owner]));
      return r.changes > 0;
    },
    async finish(id: number, owner: string, state: "stopped" | "done", reason: string | null, progress?: Progress): Promise<void> {
      await conn.tx(() => conn.run(`UPDATE patterns_runs SET state = ?, reason = ?, finished_at = ?, heartbeat_at = ?${progress ? ", progress = ?" : ""} WHERE id = ? AND owner = ? AND state = 'running'`, [state, reason?.slice(0, 300) ?? null, state === "done" ? at() : null, at(), ...(progress ? [JSON.stringify(progress)] : []), id, owner]));
    },
    /** A run whose owner went away (a restart, a scale-down): stopped, with the reason. Never restarted. */
    async markGone(id: number, reason: string): Promise<void> {
      await conn.tx(() => conn.run("UPDATE patterns_runs SET state = 'stopped', reason = ? WHERE id = ? AND state = 'running'", [reason.slice(0, 300), id]));
    },

    // ---------- snapshots ----------
    async saveSnapshot(runId: number, clientKey: string, numbers: unknown): Promise<void> {
      await conn.tx(async () => {
        await conn.run("DELETE FROM patterns_snapshots WHERE run_id = ? AND client_key = ?", [runId, clientKey]);
        await conn.run("INSERT INTO patterns_snapshots (run_id, client_key, at, numbers) VALUES (?, ?, ?, ?)", [runId, clientKey.slice(0, 100), at(), JSON.stringify(numbers)]);
      });
    },
    /** Each client's two newest snapshots (the newest first), for the change since the previous one. */
    async snapshots(): Promise<Record<string, { runId: number; at: string; numbers: unknown }[]>> {
      const rows = await conn.all("SELECT run_id, client_key, at, numbers FROM patterns_snapshots ORDER BY run_id DESC");
      const out: Record<string, { runId: number; at: string; numbers: unknown }[]> = {};
      for (const r of rows) {
        const k = String(r.client_key);
        const list = (out[k] ??= []);
        if (list.length < 2) list.push({ runId: n(r.run_id), at: String(r.at), numbers: JSON.parse(String(r.numbers)) });
      }
      return out;
    },

    // ---------- items ----------
    async putItems(clientKey: string, runId: number, items: readonly PatternItem[]): Promise<void> {
      if (!items.length) return;
      await conn.tx(async () => {
        for (const i of items)
          await conn.run(
            "INSERT INTO patterns_items (client_key, item_id, rev, type, state, created_at, activated_at, closed_at, parent_id, title, facts, in_window, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_key, item_id) DO UPDATE SET rev = excluded.rev, type = excluded.type, state = excluded.state, created_at = excluded.created_at, activated_at = excluded.activated_at, closed_at = excluded.closed_at, parent_id = excluded.parent_id, title = excluded.title, facts = excluded.facts, in_window = excluded.in_window, run_id = excluded.run_id",
            [clientKey.slice(0, 100), i.id, i.rev, i.type.slice(0, 200), i.state.slice(0, 200), i.createdAt, i.activatedAt, i.closedAt, i.parentId, i.title.slice(0, 400), factsJson(i.facts), i.inWindow ? 1 : 0, runId],
          );
      });
    },
    /** A client's items as last read; `runId`: only those read by that run. */
    async items(clientKey: string, runId?: number): Promise<PatternItem[]> {
      const rows = runId === undefined ? await conn.all("SELECT * FROM patterns_items WHERE client_key = ? ORDER BY item_id", [clientKey]) : await conn.all("SELECT * FROM patterns_items WHERE client_key = ? AND run_id = ? ORDER BY item_id", [clientKey, runId]);
      return rows.map(itemOf);
    },
    /**
     * A client's items as of its newest finished inventory (its newest snapshot): items an earlier run read and the
     * newest didn't (deleted in DevOps, or now older than the window) are left out. Items a later, unfinished run read
     * again count too (their run id only grows). No snapshot yet: every item.
     */
    async currentItems(clientKey: string): Promise<PatternItem[]> {
      const s = await conn.get("SELECT MAX(run_id) AS run_id FROM patterns_snapshots WHERE client_key = ?", [clientKey]);
      const since = s && s.run_id !== null && s.run_id !== undefined ? n(s.run_id) : null;
      const rows = since === null ? await conn.all("SELECT * FROM patterns_items WHERE client_key = ? ORDER BY item_id", [clientKey]) : await conn.all("SELECT * FROM patterns_items WHERE client_key = ? AND run_id >= ? ORDER BY item_id", [clientKey, since]);
      return rows.map(itemOf);
    },
    /** The run that last read each client's items (the newest inventory that reached it). */
    async itemRuns(): Promise<Record<string, number>> {
      const rows = await conn.all("SELECT client_key, MAX(run_id) AS run_id FROM patterns_items GROUP BY client_key");
      return Object.fromEntries(rows.map((r) => [String(r.client_key), n(r.run_id)]));
    },
    async setHistory(clientKey: string, id: number, history: { changedAfterStart: boolean; emptyAtClose: boolean }): Promise<void> {
      await conn.tx(async () => {
        const r = await conn.get("SELECT facts FROM patterns_items WHERE client_key = ? AND item_id = ?", [clientKey, id]);
        if (!r) return;
        const f = JSON.parse(String(r.facts)) as Facts;
        await conn.run("UPDATE patterns_items SET facts = ? WHERE client_key = ? AND item_id = ?", [factsJson({ ...f, history }), clientKey, id]);
      });
    },

    // ---------- labels ----------
    /** The labels kept for a client and list version (an answer that failed its check is not a label; see failures). */
    async labels(clientKey: string, version: string): Promise<Map<number, LabelRow>> {
      const rows = await conn.all("SELECT item_id, rev, labels, labels_b FROM patterns_labels WHERE client_key = ? AND list_version = ?", [clientKey, version]);
      const out = new Map<number, LabelRow>();
      for (const r of rows) {
        const a = JSON.parse(String(r.labels)) as Labels & { failed?: boolean };
        if (a.failed) continue;
        const b = r.labels_b ? (JSON.parse(String(r.labels_b)) as Labels & { failed?: boolean }) : null;
        out.set(n(r.item_id), { itemId: n(r.item_id), rev: n(r.rev), labels: a, labelsB: b && !b.failed ? b : null });
      }
      return out;
    },
    /**
     * WP-2: the items whose answer failed its check (paid for, nothing kept), with the revision asked about, per list
     * version: first answers and the agreement sample's second ones. Kept with the labels, in the same transaction, so
     * Resume never pays for them again whatever stopped the run.
     */
    async failures(clientKey: string, version: string): Promise<{ a: Map<number, number>; b: Map<number, number> }> {
      const rows = await conn.all("SELECT item_id, rev, labels, labels_b FROM patterns_labels WHERE client_key = ? AND list_version = ?", [clientKey, version]);
      const a = new Map<number, number>();
      const b = new Map<number, number>();
      for (const r of rows) {
        if ((JSON.parse(String(r.labels)) as { failed?: boolean }).failed) a.set(n(r.item_id), n(r.rev));
        if (r.labels_b && (JSON.parse(String(r.labels_b)) as { failed?: boolean }).failed) b.set(n(r.item_id), n(r.rev));
      }
      return { a, b };
    },
    async putLabels(clientKey: string, version: string, rows: readonly { itemId: number; rev: number; labels?: Labels; labelsB?: Labels; failed?: boolean; failedB?: boolean }[]): Promise<void> {
      if (!rows.length) return;
      const FAILED = JSON.stringify({ failed: true });
      await conn.tx(async () => {
        for (const r of rows) {
          const a = r.labels ? labelsJson(r.labels) : r.failed ? FAILED : null;
          if (a)
            await conn.run("INSERT INTO patterns_labels (client_key, item_id, list_version, rev, labels, labels_b, at) VALUES (?, ?, ?, ?, ?, NULL, ?) ON CONFLICT (client_key, item_id, list_version) DO UPDATE SET rev = excluded.rev, labels = excluded.labels, labels_b = NULL, at = excluded.at", [clientKey.slice(0, 100), r.itemId, version.slice(0, 40), r.rev, a, at()]);
          const b = r.labelsB ? labelsJson(r.labelsB) : r.failedB ? FAILED : null;
          // The second answer goes with whatever first answer the item has (a newer first answer clears it again).
          if (b) await conn.run("UPDATE patterns_labels SET labels_b = ? WHERE client_key = ? AND item_id = ? AND list_version = ?", [b, clientKey, r.itemId, version]);
        }
      });
    },

    // ---------- the request type lists ----------
    async list(version: string): Promise<TypeList | null> {
      const r = await conn.get("SELECT * FROM patterns_type_lists WHERE version = ?", [version]);
      return r ? { version: String(r.version), createdAt: String(r.created_at), types: JSON.parse(String(r.list)), changes: JSON.parse(String(r.changes)), fingerprint: String(r.fingerprint) } : null;
    },
    async lists(): Promise<TypeList[]> {
      const rows = await conn.all("SELECT * FROM patterns_type_lists ORDER BY created_at, version");
      return rows.map((r) => ({ version: String(r.version), createdAt: String(r.created_at), types: JSON.parse(String(r.list)), changes: JSON.parse(String(r.changes)), fingerprint: String(r.fingerprint) }));
    },
    async saveList(l: TypeList, runId: number | null): Promise<void> {
      await conn.tx(async () => {
        if (await conn.get("SELECT version FROM patterns_type_lists WHERE version = ?", [l.version])) return;
        await conn.run("INSERT INTO patterns_type_lists (version, run_id, created_at, list, changes, fingerprint) VALUES (?, ?, ?, ?, ?, ?)", [l.version.slice(0, 40), runId, l.createdAt, JSON.stringify(l.types), JSON.stringify(l.changes), l.fingerprint.slice(0, 80)]);
      });
    },

    // ---------- WP-2: the layout ----------
    async putTree(clientKey: string, runId: number, tree: ProjectTree): Promise<void> {
      const clean: ProjectTree = { project: tree.project, root: tree.root, paths: tree.paths.slice(0, 2000), areasProblem: tree.areasProblem, teams: tree.teams?.map((t) => ({ name: t.name, otherField: t.otherField, areas: t.areas.map((a) => ({ path: a.path, sub: a.sub })) })) ?? null, teamsProblem: tree.teamsProblem };
      await conn.tx(async () => {
        await conn.run("DELETE FROM patterns_projects WHERE client_key = ? AND project = ?", [clientKey, tree.project]);
        await conn.run("INSERT INTO patterns_projects (client_key, project, run_id, at, tree) VALUES (?, ?, ?, ?, ?)", [clientKey.slice(0, 100), tree.project.slice(0, 256), runId, at(), JSON.stringify(clean)]);
      });
    },
    /** A client's projects as the newest layout read them (projects an older run read and the newest didn't are left out). */
    async trees(clientKey: string): Promise<(ProjectTree & { runId: number })[]> {
      const rows = await conn.all("SELECT project, run_id, tree FROM patterns_projects WHERE client_key = ? ORDER BY project", [clientKey]);
      const newest = Math.max(0, ...rows.map((r) => n(r.run_id)));
      return rows.filter((r) => n(r.run_id) === newest).map((r) => ({ ...(JSON.parse(String(r.tree)) as ProjectTree), runId: n(r.run_id) }));
    },
    async putLayout(clientKey: string, runId: number, rows: readonly LayoutRow[]): Promise<void> {
      if (!rows.length) return;
      await conn.tx(async () => {
        for (const r of rows)
          await conn.run(
            "INSERT INTO patterns_layout (client_key, item_id, project, area, type, created_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_key, item_id) DO UPDATE SET project = excluded.project, area = excluded.area, type = excluded.type, created_at = excluded.created_at, run_id = excluded.run_id",
            [clientKey.slice(0, 100), r.id, r.project.slice(0, 256), r.area?.slice(0, 1000) ?? null, r.type.slice(0, 200), r.createdAt, runId],
          );
      });
    },
    /** One item's area as the full read found it (it moved since the layout read). */
    async moveLayout(clientKey: string, id: number, area: string | null): Promise<void> {
      await conn.tx(() => conn.run("UPDATE patterns_layout SET area = ? WHERE client_key = ? AND item_id = ?", [area?.slice(0, 1000) ?? null, clientKey, id]));
    },
    /** The layout rows of a client's newest layout read (rows of items it didn't find again are left out). */
    async layout(clientKey: string, runId?: number): Promise<LayoutRow[]> {
      const newest = runId ?? n((await conn.get("SELECT MAX(run_id) AS run_id FROM patterns_projects WHERE client_key = ?", [clientKey]))?.run_id);
      const rows = await conn.all("SELECT item_id, project, area, type, created_at FROM patterns_layout WHERE client_key = ? AND run_id = ? ORDER BY item_id", [clientKey, newest]);
      return rows.map((r) => ({ id: n(r.item_id), project: String(r.project), area: s(r.area), type: String(r.type), createdAt: s(r.created_at) }));
    },

    // ---------- WP-2: the page's scopes and kinds (never Admin › Clients') ----------
    async scopes(): Promise<Record<string, { scope: AnalysisScope; setAt: string }>> {
      const rows = await conn.all("SELECT client_key, scope, set_at FROM patterns_scopes");
      return Object.fromEntries(rows.map((r) => [String(r.client_key), { scope: JSON.parse(String(r.scope)) as AnalysisScope, setAt: String(r.set_at) }]));
    },
    async setScope(clientKey: string, scope: AnalysisScope | null, by: string): Promise<void> {
      await conn.tx(async () => {
        await conn.run("DELETE FROM patterns_scopes WHERE client_key = ?", [clientKey]);
        if (scope) await conn.run("INSERT INTO patterns_scopes (client_key, scope, set_by, set_at) VALUES (?, ?, ?, ?)", [clientKey.slice(0, 100), JSON.stringify(scope), by.slice(0, 64), at()]);
      });
    },
    async kinds(): Promise<Record<string, Record<string, Kind>>> {
      const rows = await conn.all("SELECT client_key, type, kind FROM patterns_kinds");
      const out: Record<string, Record<string, Kind>> = {};
      for (const r of rows) (out[String(r.client_key)] ??= {})[String(r.type)] = String(r.kind) as Kind;
      return out;
    },
    async setKind(clientKey: string, type: string, kind: Kind | null, by: string): Promise<void> {
      await conn.tx(async () => {
        await conn.run("DELETE FROM patterns_kinds WHERE client_key = ? AND type = ?", [clientKey, type]);
        if (kind) await conn.run("INSERT INTO patterns_kinds (client_key, type, kind, set_by, set_at) VALUES (?, ?, ?, ?, ?)", [clientKey.slice(0, 100), type.slice(0, 200), kind, by.slice(0, 64), at()]);
      });
    },

    // ---------- platforms ----------
    async platforms(): Promise<Record<string, Platform>> {
      const rows = await conn.all("SELECT client_key, platform FROM patterns_platforms");
      return Object.fromEntries(rows.map((r) => [String(r.client_key), String(r.platform) as Platform]));
    },
    async setPlatform(clientKey: string, platform: Platform | null, by: string): Promise<void> {
      await conn.tx(async () => {
        await conn.run("DELETE FROM patterns_platforms WHERE client_key = ?", [clientKey]);
        if (platform) await conn.run("INSERT INTO patterns_platforms (client_key, platform, set_by, set_at) VALUES (?, ?, ?, ?)", [clientKey.slice(0, 100), platform, by.slice(0, 64), at()]);
      });
    },
  };
}

export type PatternsStore = ReturnType<typeof createPatternsStore>;
