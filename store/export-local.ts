// A3: `focustime export-local`: the local SQLite store (the A2 store, plan.db) as one person's export, the same JSON
// as Settings > Data > Export my data, for store/import.ts. The file is opened read-only and never migrated: a store
// that isn't at the export's schema version is refused (open it once with this FocusTime's service to bring it up to
// date, which takes its own backup first). Nothing in the file changes, and no secret is read.
import type { DatabaseSync } from "node:sqlite";
import { createAccountStore } from "./accounts.ts";
import { sqliteConn } from "./sql/sqlite.ts";
import { USER_SCHEMA_VERSION, exportUser } from "./user-data.ts";

export class ExportRefused extends Error {}

/** `raw`: the store opened read-only by the caller (scripts/focustime.ts: immutable when nothing is writing it). Closed here. */
export async function exportLocal(raw: DatabaseSync, o: { userId?: string; now: Temporal.Instant }): Promise<{ userId: string; json: Record<string, unknown> }> {
  try {
    const v = (raw.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number }).v;
    if (v !== USER_SCHEMA_VERSION) throw new ExportRefused(`The store is at schema version ${v}; export-local reads ${USER_SCHEMA_VERSION}. Start this FocusTime once on it first.`);
    const conn = sqliteConn(raw);
    const users = (await createAccountStore(conn, () => o.now).users.all()).filter((u) => !u.deletedAt);
    const user = o.userId ? users.find((u) => u.id === o.userId) : users.length === 1 ? users[0] : undefined;
    if (!user)
      throw new ExportRefused(o.userId ? `No person with id ${o.userId} in the store` : `The store has ${users.length} people; name one with --user (${users.map((u) => u.id).join(", ")})`);
    return { userId: user.id, json: await exportUser(conn, user, o.now) };
  } finally {
    raw.close();
  }
}
