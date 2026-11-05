// DV-1: the central DevOps store, three app tables (no person in them): each client's work items as DevOps returned
// their fields, the change log (30 days) and each client's poll state. Written only by the poller; read by the poller
// and, through it, by everyone's screens (who may see a client is decided by the reader, as before: active Account
// Workers). Never a PAT, a header or a response body. Every write is one transaction.
import type { ChangeEntry, Fields } from "../sources/devops/changes.ts";
import type { Conn, Row } from "./sql/conn.ts";

/** How long the change log is kept. */
export const CHANGE_DAYS = 30;

export type StoredItem = { id: number; project: string; rev: number; changedAt: string; fields: Fields };

export type PollRow = {
  clientKey: string;
  /** DevOps's newest System.ChangedDate seen (its clock, not ours). */
  watermark: string | null;
  checkedAt: string | null;
  /** The last check that worked: what "Updated 1 min ago" and "Showing items from" read. */
  okAt: string | null;
  /** When the first full load finished (null: the store is still empty for this client). */
  loadedAt: string | null;
  /** The day (UTC) of the last full reconcile. */
  reconciledOn: string | null;
  errorKind: string | null;
  error: string | null;
  slow: number;
  slowReason: string | null;
  retryAt: string | null;
  /** The UTC day the counts below are for. */
  day: string | null;
  changedToday: number;
  callsToday: number;
};

export const emptyPoll = (clientKey: string): PollRow => ({ clientKey, watermark: null, checkedAt: null, okAt: null, loadedAt: null, reconciledOn: null, errorKind: null, error: null, slow: 1, slowReason: null, retryAt: null, day: null, changedToday: 0, callsToday: 0 });

export type LoggedChange = ChangeEntry & { id: number; clientKey: string; loggedAt: string };

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => Number(v ?? 0);

const pollOf = (r: Row): PollRow => ({
  clientKey: String(r.client_key),
  watermark: s(r.watermark),
  checkedAt: s(r.checked_at),
  okAt: s(r.ok_at),
  loadedAt: s(r.loaded_at),
  reconciledOn: s(r.reconciled_on),
  errorKind: s(r.error_kind),
  error: s(r.error),
  slow: n(r.slow) || 1,
  slowReason: s(r.slow_reason),
  retryAt: s(r.retry_at),
  day: s(r.day),
  changedToday: n(r.changed_today),
  callsToday: n(r.calls_today),
});

export function createDevOpsStore(conn: Conn, now: () => Temporal.Instant) {
  async function writeState(p: PollRow) {
    await conn.run(
      `INSERT INTO devops_poll (client_key, watermark, checked_at, ok_at, loaded_at, reconciled_on, error_kind, error, slow, slow_reason, retry_at, day, changed_today, calls_today) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (client_key) DO UPDATE SET watermark = excluded.watermark, checked_at = excluded.checked_at, ok_at = excluded.ok_at, loaded_at = excluded.loaded_at, reconciled_on = excluded.reconciled_on, error_kind = excluded.error_kind, error = excluded.error, slow = excluded.slow, slow_reason = excluded.slow_reason, retry_at = excluded.retry_at, day = excluded.day, changed_today = excluded.changed_today, calls_today = excluded.calls_today`,
      [p.clientKey.slice(0, 100), p.watermark, p.checkedAt, p.okAt, p.loadedAt, p.reconciledOn, p.errorKind, p.error?.slice(0, 300) ?? null, p.slow, p.slowReason?.slice(0, 200) ?? null, p.retryAt, p.day, p.changedToday, p.callsToday],
    );
  }

  return {
    async states(): Promise<PollRow[]> {
      return (await conn.all("SELECT * FROM devops_poll ORDER BY client_key")).map(pollOf);
    },
    async state(clientKey: string): Promise<PollRow | null> {
      const r = await conn.get("SELECT * FROM devops_poll WHERE client_key = ?", [clientKey]);
      return r ? pollOf(r) : null;
    },
    async saveState(p: PollRow): Promise<void> {
      await conn.tx(() => writeState(p));
    },
    async items(clientKey: string): Promise<StoredItem[]> {
      const rows = await conn.all("SELECT item_id, project, rev, changed_at, fields FROM devops_items WHERE client_key = ? ORDER BY item_id", [clientKey]);
      return rows.map((r) => ({ id: n(r.item_id), project: String(r.project), rev: n(r.rev), changedAt: String(r.changed_at), fields: JSON.parse(String(r.fields)) as Fields }));
    },
    /**
     * One check's result in one transaction: the items read (inserted or replaced), the ones gone (removed), the
     * change log entries, and the poll state. Old change log rows go here too (30 days).
     */
    async apply(clientKey: string, o: { upsert: readonly StoredItem[]; remove?: readonly number[]; changes: readonly ChangeEntry[]; state: PollRow }): Promise<void> {
      const at = now().toString();
      await conn.tx(async () => {
        for (const i of o.upsert)
          await conn.run(
            "INSERT INTO devops_items (client_key, item_id, project, rev, changed_at, fields, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_key, item_id) DO UPDATE SET project = excluded.project, rev = excluded.rev, changed_at = excluded.changed_at, fields = excluded.fields, stored_at = excluded.stored_at",
            [clientKey, i.id, i.project.slice(0, 200), i.rev, i.changedAt, JSON.stringify(i.fields), at],
          );
        for (const id of o.remove ?? []) await conn.run("DELETE FROM devops_items WHERE client_key = ? AND item_id = ?", [clientKey, id]);
        for (const c of o.changes)
          await conn.run(
            "INSERT INTO devops_changes (client_key, item_id, kind, old_value, new_value, by_name, by_unique, changed_at, rev, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [clientKey, c.itemId, c.kind, c.oldValue, c.newValue, c.byName?.slice(0, 200) ?? null, c.byUnique?.slice(0, 320) ?? null, c.changedAt || at, c.rev, at],
          );
        if (o.changes.length || o.remove?.length) await conn.run("DELETE FROM devops_changes WHERE logged_at < ?", [now().subtract({ hours: 24 * CHANGE_DAYS }).toString()]);
        await writeState(o.state);
      });
    },
    /** Drops change log rows older than 30 days (also done by every write that logs). */
    async prune(): Promise<number> {
      return (await conn.tx(() => conn.run("DELETE FROM devops_changes WHERE logged_at < ?", [now().subtract({ hours: 24 * CHANGE_DAYS }).toString()]))).changes;
    },
    /** The change log for a client since an instant, oldest first (NT-1 reads this). */
    async changes(clientKey: string, since: string): Promise<LoggedChange[]> {
      const rows = await conn.all("SELECT * FROM devops_changes WHERE client_key = ? AND logged_at >= ? ORDER BY id", [clientKey, since]);
      return rows.map((r) => ({
        id: n(r.id),
        clientKey: String(r.client_key),
        itemId: n(r.item_id),
        kind: String(r.kind) as ChangeEntry["kind"],
        oldValue: s(r.old_value),
        newValue: s(r.new_value),
        byName: s(r.by_name),
        byUnique: s(r.by_unique),
        changedAt: String(r.changed_at),
        rev: n(r.rev),
        loggedAt: String(r.logged_at),
      }));
    },
  };
}

export type DevOpsStore = ReturnType<typeof createDevOpsStore>;
