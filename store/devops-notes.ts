// AH-1 (D664): notices for other people from a committed change set. An app table (no person in it), read and written
// on the database itself like devops_takes: the committer's write records a note; the recipient's own scheduler pass
// reads the notes for their DevOps email and sends one notice each. Never a title, never a token.
import type { Conn } from "./sql/conn.ts";

export type DevOpsNoteKind = "assigned" | "dates";
export type DevOpsNote = { id: number; kind: DevOpsNoteKind; clientKey: string; org: string; itemIds: number[]; toEmail: string; byName: string; at: string };
/** ED-1: "<name> edited #<id>", at most one per item, recipient and day (devops_edit_notes). */
export type EditNote = { id: number; clientKey: string; org: string; itemId: number; toEmail: string; byName: string; at: string };
export type NotesStore = {
  /** ED-1: an edit of someone else's item: one note a day at most for the same item and recipient (false: one was there). */
  edited?: (n: Omit<EditNote, "id" | "at">) => Promise<boolean>;
  /** ED-1: edit notes to these emails since the instant, oldest first. */
  editedTo?: (emails: readonly string[], since: string) => Promise<EditNote[]>;
  add: (n: Omit<DevOpsNote, "id" | "at">) => Promise<void>;
  /** An undo took an assignment back: no notice for it. */
  remove: (n: Pick<DevOpsNote, "kind" | "org" | "toEmail"> & { itemId: number }) => Promise<void>;
  /** Notes to these emails since the instant, oldest first. */
  to: (emails: readonly string[], since: string) => Promise<DevOpsNote[]>;
};

export const NOTE_DAYS = 14;

export function notesStore(conn: Conn, now: () => Temporal.Instant): NotesStore {
  const lc = (s: string) => s.trim().toLowerCase();
  return {
    async add(n) {
      const at = now();
      const ids = [...new Set(n.itemIds)].filter((i) => Number.isInteger(i) && i > 0).slice(0, 200);
      if (!ids.length) return;
      await conn.tx(async () => {
        await conn.run("DELETE FROM devops_notes WHERE at < ?", [at.subtract({ hours: 24 * NOTE_DAYS }).toString()]);
        await conn.run("INSERT INTO devops_notes (kind, client_key, org, item_ids, to_email, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)", [n.kind, n.clientKey, lc(n.org), JSON.stringify(ids), lc(n.toEmail), n.byName.slice(0, 200), at.toString()]);
      });
    },
    async remove(n) {
      const rows = (await conn.all("SELECT id, item_ids FROM devops_notes WHERE kind = ? AND org = ? AND to_email = ?", [n.kind, lc(n.org), lc(n.toEmail)])) as { id: number; item_ids: string }[];
      const hit = rows.filter((r) => (JSON.parse(r.item_ids) as number[]).includes(n.itemId)).map((r) => Number(r.id));
      if (hit.length) await conn.tx(async () => { for (const id of hit) await conn.run("DELETE FROM devops_notes WHERE id = ?", [id]); });
    },
    async edited(n) {
      const at = now();
      if (!Number.isInteger(n.itemId) || n.itemId <= 0) return false;
      const day = at.toString().slice(0, 10);
      return conn.tx(async () => {
        await conn.run("DELETE FROM devops_edit_notes WHERE at < ?", [at.subtract({ hours: 24 * NOTE_DAYS }).toString()]);
        const had = await conn.all("SELECT id FROM devops_edit_notes WHERE org = ? AND item_id = ? AND to_email = ? AND day = ?", [lc(n.org), n.itemId, lc(n.toEmail), day]);
        if (had.length) return false;
        await conn.run("INSERT INTO devops_edit_notes (client_key, org, item_id, to_email, by_name, day, at) VALUES (?, ?, ?, ?, ?, ?, ?)", [n.clientKey, lc(n.org), n.itemId, lc(n.toEmail), n.byName.slice(0, 200), day, at.toString()]);
        return true;
      });
    },
    async editedTo(emails, since) {
      const list = [...new Set(emails.map(lc).filter(Boolean))];
      if (!list.length) return [];
      const rows = (await conn.all(`SELECT * FROM devops_edit_notes WHERE to_email IN (${list.map(() => "?").join(", ")}) AND at > ? ORDER BY at, id`, [...list, since])) as Record<string, unknown>[];
      return rows.map((r) => ({ id: Number(r.id), clientKey: String(r.client_key), org: String(r.org), itemId: Number(r.item_id), toEmail: String(r.to_email), byName: String(r.by_name), at: String(r.at) }));
    },
    async to(emails, since) {
      const list = [...new Set(emails.map(lc).filter(Boolean))];
      if (!list.length) return [];
      const rows = (await conn.all(`SELECT * FROM devops_notes WHERE to_email IN (${list.map(() => "?").join(", ")}) AND at > ? ORDER BY at, id`, [...list, since])) as Record<string, unknown>[];
      return rows.map((r) => ({ id: Number(r.id), kind: r.kind as DevOpsNoteKind, clientKey: String(r.client_key), org: String(r.org), itemIds: JSON.parse(String(r.item_ids)) as number[], toEmail: String(r.to_email), byName: String(r.by_name), at: String(r.at) }));
    },
  };
}
