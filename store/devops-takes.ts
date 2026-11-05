// PV-1 (D573): Take one's notices. An app table (no person in it), read and written on the database itself, like
// ai_app_spend: the taker's write records a take; the previous assignee's own scheduler pass reads the takes from them
// (by their DevOps sign-in email) and sends one quiet notice each. Never a title, never a token.
import type { Conn } from "./sql/conn.ts";

export type Take = { id: number; clientKey: string; org: string; itemId: number; fromEmail: string; byName: string; takenAt: string };
export type TakesStore = {
  add: (t: Omit<Take, "id" | "takenAt">) => Promise<void>;
  /** An undo took it back: no notice for it (or none more). */
  remove: (t: Pick<Take, "org" | "itemId" | "fromEmail">) => Promise<void>;
  /** Takes from these emails since the instant, oldest first. */
  from: (emails: readonly string[], since: string) => Promise<Take[]>;
};

/** How long a take is kept (and noticed). */
export const TAKE_DAYS = 14;

export function takesStore(conn: Conn, now: () => Temporal.Instant): TakesStore {
  const lc = (s: string) => s.trim().toLowerCase();
  return {
    async add(t) {
      const at = now();
      await conn.tx(async () => {
        await conn.run("DELETE FROM devops_takes WHERE taken_at < ?", [at.subtract({ hours: 24 * TAKE_DAYS }).toString()]);
        await conn.run("INSERT INTO devops_takes (client_key, org, item_id, from_email, by_name, taken_at) VALUES (?, ?, ?, ?, ?, ?)", [t.clientKey, lc(t.org), t.itemId, lc(t.fromEmail), t.byName.slice(0, 200), at.toString()]);
      });
    },
    async remove(t) {
      await conn.tx(() => conn.run("DELETE FROM devops_takes WHERE org = ? AND item_id = ? AND from_email = ?", [lc(t.org), t.itemId, lc(t.fromEmail)]));
    },
    async from(emails, since) {
      const list = [...new Set(emails.map(lc).filter((e) => e.includes("@")))];
      if (!list.length) return [];
      const rows = await conn.all(`SELECT * FROM devops_takes WHERE from_email IN (${list.map(() => "?").join(", ")}) AND taken_at >= ? ORDER BY taken_at, id`, [...list, since]);
      return rows.map((r) => ({ id: Number(r.id), clientKey: String(r.client_key), org: String(r.org), itemId: Number(r.item_id), fromEmail: String(r.from_email), byName: String(r.by_name), takenAt: String(r.taken_at) }));
    },
  };
}
