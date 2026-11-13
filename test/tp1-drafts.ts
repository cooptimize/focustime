// TP-1b tests: a draft as TP-1 saved it (draft_stories.brief held a request type, four lines and their choices; the
// shape is test/builders' aTp1Brief). The code no longer writes it, so tests plant it with SQL on the store's own
// database, the way an older build left it.
import type { DatabaseSync } from "node:sqlite";
import { openPlanDb, planStoreOn, SOLO_USER } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";

/** The words TP-1b carries from aTp1Brief() into the draft's description, once, one per line. */
export const TP1_CARRIED = ["From your earlier draft:", "Environment: Test.", "Touches: Data, Model.", "Checked by: the finance lead.", "How far and who signs off: Only the margin page", "Done when it is: In test.", "Signed off by: Sam Lee.", "Not without asking: Deploy to production."].join("\n");

/** A plan store with its raw database, so a test can plant a TP-1 draft's column. */
export function planWithRaw(now: () => Temporal.ZonedDateTime, path = ":memory:") {
  const raw: DatabaseSync = openPlanDb({ path, now });
  const plan = planStoreOn(sqliteConn(raw), { now, userId: SOLO_USER });
  return { plan, raw, plantBrief: (draftId: number, json: string) => void raw.prepare("UPDATE draft_stories SET brief = ? WHERE id = ?").run(json, draftId), briefOf: (draftId: number) => (raw.prepare("SELECT brief FROM draft_stories WHERE id = ?").get(draftId) as { brief: string | null } | undefined)?.brief ?? null };
}
