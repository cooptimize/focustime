// A2: a person's own data, all of it: the export (Settings > Data > Export my data) and the delete (soft now, hard 30
// days later). The export is every row of theirs in every user table (generated from the table list, so a new table
// is in it), their settings and who they are; never a token, secret or session (those live elsewhere and are left
// out by construction). The delete keeps only a hash of the user id, so the log can say it happened.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { UserRow } from "./accounts.ts";
import { scopedDb, USER_TABLES } from "./scope.ts";

/** How long a soft delete waits before everything is removed. */
export const HARD_DELETE_AFTER_DAYS = 30;

const hashOf = (userId: string) => createHash("sha256").update(`focustime-user:${userId}`).digest("hex");

/** Everything of one person's, as JSON-ready data. */
export function exportUser(db: DatabaseSync, user: UserRow, now: Temporal.Instant): Record<string, unknown> {
  const s = scopedDb(db, user.id);
  const tables: Record<string, unknown[]> = {};
  for (const t of USER_TABLES) {
    const rows = s.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
    tables[t] = rows.map(({ user_id: _u, ...rest }) => rest);
  }
  return {
    exportedAt: now.toString(),
    format: "focustime-export-1",
    you: { id: user.id, upn: user.upn, displayName: user.displayName, email: user.email, timeZone: user.timeZone, createdAt: user.createdAt, lastSignInAt: user.lastSignInAt },
    tables,
  };
}

/** A soft delete: recorded now; the rows stay until the hard delete. The caller ends sessions and forgets secrets. */
export function recordSoftDelete(db: DatabaseSync, userId: string, at: Temporal.Instant): void {
  db.prepare("INSERT INTO deletions (user_hash, requested_at) VALUES (?, ?)").run(hashOf(userId), at.toString());
}

/** Removes every row of everyone whose soft delete is 30 days old; returns how many people. */
export function hardDeleteDue(db: DatabaseSync, now: Temporal.Instant): number {
  const cutoff = now.subtract({ hours: 24 * HARD_DELETE_AFTER_DAYS }).toString();
  const due = db.prepare("SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at <= ?").all(cutoff) as { id: string }[];
  for (const { id } of due) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("PRAGMA defer_foreign_keys = ON");
      for (const t of [...USER_TABLES].reverse()) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      db.prepare("DELETE FROM auth_requests WHERE user_id = ?").run(id);
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      db.prepare("UPDATE deletions SET hard_deleted_at = ? WHERE user_hash = ? AND hard_deleted_at IS NULL").run(now.toString(), hashOf(id));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return due.length;
}
