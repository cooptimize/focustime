// A2: a person's own data, all of it: the export (Settings > Data > Export my data) and the delete (soft now, hard 30
// days later). The export is every row of theirs in every user table (generated from the table list, so a new table
// is in it), their settings and who they are; never a token, secret or session (those live elsewhere and are left
// out by construction). The delete keeps only a hash of the user id, so the log can say it happened.
import { createHash } from "node:crypto";
import type { UserRow } from "./accounts.ts";
import { scopedDb, USER_TABLES } from "./scope.ts";
import { createTeamsBotStore } from "./teams-bot-store.ts";
import type { Conn } from "./sql/conn.ts";

/**
 * User tables left out of the export: sealed secrets, push subscriptions (sealed, and tied to one browser), and the
 * Teams bot's tables (TB-1, TB-1b): technical addresses (the 1:1 chat's conversation id and service URL), card state
 * (a proposal id, its title and the outcome card) and hashes of handled activity ids. No content of the person's;
 * meaningless outside this tenant's bot, and rebuilt by their next message. Delete my data removes them at once.
 * CAL-1: calendar links (the link is sealed) and their events (rebuilt by the next fetch).
 */
export const NOT_EXPORTED: readonly string[] = ["user_secrets", "push_devices", "teams_bot_chats", "teams_bot_cards", "teams_bot_seen", "teams_rhythm", "calendar_links", "calendar_link_events"];

/** How long a soft delete waits before everything is removed. */
export const HARD_DELETE_AFTER_DAYS = 30;

/** The export's format name (store/import.ts reads it back). */
export const EXPORT_FORMAT = "focustime-export-1";
/**
 * The schema version of the user tables an export holds: SQLite's migration 28, SQL Server's migration 30 (27 and 28
 * add only app tables), then one more for each timestamped migration that adds a user table the export holds: 29 is
 * IB-1's inbox_marks, 30 is AS-2's assistant_turns.pending_json, 31 is LP-1's loop_sends, 32 is AH-5's ahead_state_changes, 33 is WK-3's picks.todo_kind, window and links, 34 is DP-2's picks.deploy_items, 35 is IB-2's follow_ups.changed_at, 36 is KB-1's draft_stories.ai_standards, 37 is TX-1's size_xs, picks' spent and remaining and timeboxes' settled columns. 38 is TX-1c's picks.done_removed, 39 is QC-1's draft_stories.item_type and assign_to, 40 is TP-1's draft_stories.brief. A migration that changes a user table raises it, and the import learns to read the older one
 * (an older export simply has no rows for the newer tables). store/import.test.ts checks it against both.
 */
export const USER_SCHEMA_VERSION = 40;
/**
 * Older exports the import still reads: 26 (whole feature blocks) and 27 (half blocks) hold week_features.blocks, which
 * the import turns into estimate minutes at 1 block = 4h (E2).
 */
export const READABLE_SCHEMA_VERSIONS: readonly number[] = [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40];

/**
 * The user tables in an order where every table comes after the ones it references (picks after day_plans, draft
 * stories and follow-ups; borrowed and timeboxes after picks; slots after week items): the import inserts in this
 * order and the delete removes in the reverse. store/import.test.ts checks it against the schema's references.
 */
export const PARENTS_FIRST: readonly string[] = [
  "day_plans", "draft_stories", "follow_ups", "week_features", "picks", "borrowed", "timeboxes", "week_feature_slots", "week_drafts",
  ...USER_TABLES.filter((t) => !["day_plans", "draft_stories", "follow_ups", "week_features", "picks", "borrowed", "timeboxes", "week_feature_slots", "week_drafts"].includes(t)),
];

const hashOf = (userId: string) => createHash("sha256").update(`focustime-user:${userId}`).digest("hex");

/** Everything of one person's, as JSON-ready data, with the store's schema version (store/import.ts loads it). */
export async function exportUser(db: Conn, user: UserRow, now: Temporal.Instant): Promise<Record<string, unknown>> {
  const s = scopedDb(db, user.id, () => user.timeZone ?? "UTC");
  const tables: Record<string, unknown[]> = {};
  for (const t of USER_TABLES) {
    // Secrets (sealed or not) never leave the server.
    if (NOT_EXPORTED.includes(t)) continue;
    const rows = await s.all(`SELECT * FROM ${t}`);
    tables[t] = rows.map(({ user_id: _u, ...rest }) => rest);
  }
  return {
    exportedAt: now.toString(),
    format: EXPORT_FORMAT,
    schemaVersion: USER_SCHEMA_VERSION,
    you: { id: user.id, tenantId: user.tenantId, upn: user.upn, displayName: user.displayName, email: user.email, timeZone: user.timeZone, createdAt: user.createdAt, lastSignInAt: user.lastSignInAt },
    tables,
  };
}

/**
 * A soft delete: recorded now; the plan's rows stay until the hard delete. The Teams bot's rows go now (TB-1b): where
 * the person's 1:1 chat is, their cards' state and handled activity ids are only for reaching them, which ends here.
 * The caller ends sessions and forgets secrets.
 */
export async function recordSoftDelete(db: Conn, userId: string, at: Temporal.Instant): Promise<void> {
  await db.run("INSERT INTO deletions (user_hash, requested_at) VALUES (?, ?)", [hashOf(userId), at.toString()]);
  await createTeamsBotStore({ db, userId, now: () => at }).forget();
}

/** Removes every row of everyone whose soft delete is 30 days old; returns how many people. */
export async function hardDeleteDue(db: Conn, now: Temporal.Instant): Promise<number> {
  const cutoff = now.subtract({ hours: 24 * HARD_DELETE_AFTER_DAYS }).toString();
  const due = (await db.all("SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at <= ?", [cutoff])) as { id: string }[];
  for (const { id } of due) await hardDeleteUser(db, id, now);
  return due.length;
}

/** Every row of one person, now: their plan, settings, secrets, sessions and account row (ADM-1: an admin removed them). */
export async function hardDeleteUser(db: Conn, id: string, now: Temporal.Instant): Promise<void> {
  await db.tx(async () => {
    for (const t of [...PARENTS_FIRST].reverse()) await db.run(`DELETE FROM ${t} WHERE user_id = ?`, [id]);
    await db.run("DELETE FROM sessions WHERE user_id = ?", [id]);
    await db.run("DELETE FROM auth_requests WHERE user_id = ?", [id]);
    await db.run("DELETE FROM users WHERE id = ?", [id]);
    // SW-1: what they published for their team (commitments) and the sends and asks they're in (app tables).
    const pid = id.toLowerCase();
    await db.run("DELETE FROM week_commitments WHERE person_id = ?", [pid]);
    await db.run("DELETE FROM sends WHERE from_id = ? OR to_id = ?", [pid, pid]);
    await db.run("DELETE FROM look_asks WHERE from_id = ? OR to_id = ?", [pid, pid]);
    // IN-1: an admin's record of having invited them.
    await db.run("DELETE FROM people_invites WHERE person_id = ?", [pid]);
    await db.run("UPDATE deletions SET hard_deleted_at = ? WHERE user_hash = ? AND hard_deleted_at IS NULL", [now.toString(), hashOf(id)]);
  });
}
