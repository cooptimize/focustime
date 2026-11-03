// A3: the idle rule's one stored next-due time (server/scheduler.ts). On SQL Server, a single row in scheduler_state,
// so a restarted server knows it may stay asleep; on SQLite (the local fallback and the demo, which never pause) it
// is kept in memory.
import type { Conn } from "./sql/conn.ts";

/** The stored next-due time. */
export type WakeStore = { load(): Promise<Temporal.Instant | null>; save(at: Temporal.Instant): Promise<void> };

export function wakeStoreOn(conn: Conn, now: () => Temporal.Instant): WakeStore {
  if (conn.dialect === "sqlite") {
    let kept: Temporal.Instant | null = null;
    return { load: async () => kept, save: async (at) => void (kept = at) };
  }
  return {
    async load() {
      const r = await conn.get("SELECT next_due FROM scheduler_state WHERE id = 1");
      return r?.next_due ? Temporal.Instant.from(r.next_due as string) : null;
    },
    async save(at) {
      await conn.run("INSERT INTO scheduler_state (id, next_due, updated_at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET next_due = excluded.next_due, updated_at = excluded.updated_at", [at.toString(), now().toString()]);
    },
  };
}
