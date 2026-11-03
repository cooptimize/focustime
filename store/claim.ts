// A2: the store's rows from before people (migration 24 keeps them with user_id '', no one's) go to the person who
// made them, at their first sign-in: the Microsoft account the store last recorded (ms_identity: same object id and
// tenant), or, when the store never recorded one, the work email the config file names (my_email). Anyone else's
// first sign-in leaves them where they are. One transaction; a person who already has rows of their own never gets
// them merged in (that would need a person to decide).
import type { Conn } from "./sql/conn.ts";
import { USER_TABLES } from "./scope.ts";

const UNOWNED = "";

/** How many rows belong to no one (all tables). */
export async function unownedRows(db: Conn): Promise<number> {
  let n = 0;
  for (const t of USER_TABLES) n += ((await db.get(`SELECT count(*) AS n FROM ${t} WHERE user_id = ?`, [UNOWNED])) as { n: number }).n;
  return n;
}

export type ClaimResult = { claimed: true; rows: number; byTable: Record<string, number> } | { claimed: false; reason: "not_owner" | "has_rows" | "nothing"; rows: number };

/** Whether this sign-in is the person the unowned rows were made by. */
export async function isOwner(db: Conn, who: { oid: string; tid: string; email: string | null; upn: string }, configEmail: string): Promise<boolean> {
  const r = (await db.get("SELECT value FROM account_state WHERE user_id = ? AND key = 'ms_identity'", [UNOWNED])) as { value: string } | undefined;
  if (r) {
    try {
      const id = JSON.parse(r.value) as { oid?: unknown; tid?: unknown } | null;
      if (id && typeof id.oid === "string") return id.oid === who.oid && typeof id.tid === "string" && id.tid.toLowerCase() === who.tid.toLowerCase();
    } catch {
      return false;
    }
  }
  const mine = configEmail.trim().toLowerCase();
  return !!mine && [who.email, who.upn].some((e) => e?.toLowerCase() === mine);
}

/** Gives every unowned row to `who` when they are its owner and have no rows yet. */
export async function claimUnowned(db: Conn, who: { oid: string; tid: string; email: string | null; upn: string }, configEmail: string): Promise<ClaimResult> {
  const rows = await unownedRows(db);
  if (!rows) return { claimed: false, reason: "nothing", rows };
  if (!(await isOwner(db, who, configEmail))) return { claimed: false, reason: "not_owner", rows };
  for (const t of USER_TABLES) if (await db.get(`SELECT 1 FROM ${t} WHERE user_id = ? LIMIT 1`, [who.oid])) return { claimed: false, reason: "has_rows", rows };
  return { claimed: true, rows, byTable: await giveUnowned(db, who.oid) };
}

/** Moves every unowned row to `userId` in one transaction; the count per table. */
export async function giveUnowned(db: Conn, userId: string): Promise<Record<string, number>> {
  const byTable: Record<string, number> = {};
  await db.tx(async () => {
    // picks reference day_plans by (user_id, date): checked at commit, once both have moved (SQLite; the claim only
    // ever finds rows in a store from before A2, which is SQLite).
    if (db.dialect === "sqlite") await db.run("PRAGMA defer_foreign_keys = ON");
    for (const t of USER_TABLES) {
      const n = (await db.run(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`, [userId, UNOWNED])).changes;
      if (n) byTable[t] = n;
    }
  });
  return byTable;
}
