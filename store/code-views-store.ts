// RB-1: the code view log (app table code_views, store/migrations/20261113T0022_code_views.ts). Each row says who opened
// which client's repo or file, or used Find, and when: never any content. The actions write a file's row before its
// text is returned (actions/code-actions.ts); only admins read the list (Admin › Audit › Code views). Kept 12 months.
import type { Conn, Row } from "./sql/conn.ts";
import { CODE_EVENTS, type CodeEvent } from "../plan/code.ts";

export type CodeView = { id: number; at: string; actorId: string; actorName: string; clientKey: string; repoId: string; repoName: string; path: string; event: CodeEvent };
export type CodeViewInput = Omit<CodeView, "id" | "at">;
export type CodeViewFilter = { clientKey?: string | null; actorId?: string | null };
/** Admin › Audit › Code views shows the newest this many. */
export const CODE_VIEWS_SHOWN = 200;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" ? Temporal.Instant.from(v).toString() : "");
const toView = (r: Row): CodeView => ({
  id: Number(r.id),
  at: iso(r.at),
  actorId: r.actor_id as string,
  actorName: r.actor_name as string,
  clientKey: r.client_key as string,
  repoId: r.repo_id as string,
  repoName: r.repo_name as string,
  path: r.path as string,
  event: (CODE_EVENTS as readonly string[]).includes(r.event as string) ? (r.event as CodeEvent) : "file_opened",
});

export function codeViewsStoreOn(db: Conn, now: () => Temporal.Instant) {
  return {
    /** One row, in its own transaction. Throws when it can't be written (the caller then returns no text). */
    async add(v: CodeViewInput): Promise<void> {
      if (!(CODE_EVENTS as readonly string[]).includes(v.event)) throw new Error("not a code view event");
      await db.tx(() =>
        db.run("INSERT INTO code_views (at, actor_id, actor_name, client_key, repo_id, repo_name, path, event) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
          now().toString(),
          v.actorId.toLowerCase().slice(0, 100),
          (v.actorName || "Someone").slice(0, 200),
          v.clientKey.slice(0, 100),
          v.repoId.slice(0, 40),
          v.repoName.slice(0, 200),
          v.path.slice(0, 1100),
          v.event,
        ]),
      );
    },
    /** The newest rows first, filtered by client and person. */
    async list(f: CodeViewFilter = {}): Promise<CodeView[]> {
      const where: string[] = [];
      const params: string[] = [];
      if (f.clientKey) (where.push("client_key = ?"), params.push(f.clientKey));
      if (f.actorId) (where.push("actor_id = ?"), params.push(f.actorId.toLowerCase()));
      const rows = (await db.all(`SELECT id, at, actor_id, actor_name, client_key, repo_id, repo_name, path, event FROM code_views${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ${CODE_VIEWS_SHOWN}`, params)) as Row[];
      return rows.map(toView);
    },
    /** Rows per client since a time (the last 30 days on Admin › Audit), most first. */
    async counts(since: string): Promise<{ clientKey: string; views: number }[]> {
      const rows = (await db.all("SELECT client_key, COUNT(*) AS n FROM code_views WHERE at >= ? GROUP BY client_key", [since])) as Row[];
      return rows.map((r) => ({ clientKey: r.client_key as string, views: Number(r.n) })).sort((a, b) => b.views - a.views || a.clientKey.localeCompare(b.clientKey));
    },
    /** The people in the log (for the person filter): id and the latest name kept. */
    async people(): Promise<{ id: string; name: string }[]> {
      const rows = (await db.all("SELECT actor_id, MAX(actor_name) AS name FROM code_views GROUP BY actor_id", [])) as Row[];
      return rows.map((r) => ({ id: r.actor_id as string, name: r.name as string })).sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

export type CodeViewsStore = ReturnType<typeof codeViewsStoreOn>;
