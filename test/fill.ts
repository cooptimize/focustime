// A3: a person with something in every user table (the isolation test, and the import's round trip). Test-only.
import { createDemoContext, seedDemo } from "../server/demo.ts";
import { DEMO_TZ } from "../sources/demo/data.ts";
import { starterToml } from "../config/starter.ts";
import { planStoreOn, type PlanStore } from "../store/plan-store.ts";
import type { Conn } from "../store/sql/conn.ts";
import { createUserSettings } from "../store/user-settings.ts";
import { createUserSecrets, fakeKeyProvider } from "../store/user-secrets.ts";
import { createPushDevices } from "../store/push-devices.ts";

export const FILL_NOW = "2026-11-02T14:30:00Z";
export const FILL_MON = "2026-11-02";
const NOW = FILL_NOW;
const MON = FILL_MON;
const zoned = () => Temporal.Instant.from(NOW).toZonedDateTimeISO(DEMO_TZ);

/** Everything a person can have: the demo's week, plus a row in each table the demo leaves empty. */
export const KEYS = fakeKeyProvider();

export async function fill(db: Conn, userId: string): Promise<PlanStore> {
  const plan = planStoreOn(db, { userId, now: zoned });
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} }, plan });
  await seedDemo(ctx);
  const tag = `${userId}-row`;
  (await plan.start(MON));
  const pick = (await plan.addPick({ date: MON, half: "AM", clientKey: "cooptimize", kind: "intention", title: tag, size: "S" }));
  (await plan.makeUp(pick.id, { date: "2026-11-03", half: "AM" }, { minutes: 30, payback: "friday" }));
  (await plan.logAzureWrite({ op: "start", vmId: `/vm/${tag}`, vmName: tag, before: null, after: null, auto: false }));
  (await plan.markBreakdown("cooptimize", 7001, true));
  (await plan.setDevopsIdentity({ clientKey: "cooptimize", org: "org", id: tag, name: tag, email: `${tag}@example.com`, expires: null }));
  const draft = (await plan.addDraft({ clientKey: "cooptimize", parentItemId: null, title: tag, size: "S", level: "feature" }));
  (await plan.setWeekDraft(MON, draft.id, "must"));
  (await plan.setWeekQuiet(MON, "proseware", true));
  (await plan.logDevopsWrite({ clientKey: "cooptimize", org: "org", project: "p", op: "create", itemId: null, parentId: null, title: tag, identity: tag, before: {}, after: {}, ops: null, revBefore: null, revAfter: null, commentId: null, draftId: draft.id, followUpId: null, undoOf: null }));
  (await plan.addFlex({ date: MON, clientKey: "cooptimize", start: "18:00", end: "19:00", note: tag }));
  (await plan.addUnavailable({ date: MON, title: tag, start: "12:00", end: "13:00" }));
  const box = (await plan.addTimebox({ date: MON, clientKey: "cooptimize", title: tag, start: "2026-11-02T10:00:00-05:00", end: "2026-11-02T11:00:00-05:00", outlook: true }));
  const F = { subject: tag, body: "", start: "2026-11-02T15:00:00Z", end: "2026-11-02T16:00:00Z", showAs: "busy" as const, reminder: false as const };
  (await plan.recordOwnEvent(box.uid, box.id, `E-${tag}`, F));
  (await plan.logWrite({ op: "create", uid: box.uid, eventId: `E-${tag}`, account: null, calendar: null, before: null, after: F, localBefore: null, localAfter: null, auto: false }));
  (await plan.addInvite({ uid: `inv-${tag}`, clientKey: "cooptimize", itemId: null, pickId: null, timeboxId: null, title: tag, url: null, start: "2026-11-03T15:00:00Z", end: "2026-11-03T15:30:00Z", attendees: [], teams: false, note: null }));
  (await plan.markOnce("reminder", MON));
  (await plan.setSetupStep("day", "done"));
  await plan.addDeliveryChat("cooptimize", { chatId: `19:${tag}@thread.v2`, displayName: `${tag} delivery`, webUrl: null });
  await plan.setDeliveryChatMembers(`19:${tag}@thread.v2`, [{ userId: null, displayName: tag, email: `${tag}@example.com`, tenantId: null }], NOW);
  (await plan.addNotice({ key: `n-${tag}`, kind: "followups", title: tag, body: tag, route: "inbox" }));
  (await plan.setRoadmapDates("cooptimize", 7001, { start: "2026-11-02", end: "2026-11-20" }));
  (await plan.logTeamsStatus({ op: "set", status: "Busy", minutes: 25, result: "done", message: null }));
  await createUserSettings({ db, userId, app: { dataverse: null, entra: null, google: null }, person: () => ({ email: `${tag}@example.com`, upn: `${tag}@example.com`, timeZone: null }), setZone: () => {}, defaultZone: DEMO_TZ, now: () => Temporal.Instant.from(NOW) }).seed(starterToml(DEMO_TZ));
  await createUserSecrets({ db, userId, keys: KEYS, now: () => Temporal.Instant.from(NOW) }).set("devops-write-pat:cooptimize", `pat-${tag}`);
  await createPushDevices({ db, userId, keys: KEYS, now: () => Temporal.Instant.from(NOW) }).save(`device-${tag}-0000000000`, "Phone", { endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`, keys: { p256dh: "x", auth: "y" } });
  // Only migration 21 writes the dedupe log; a row as it would have left one.
  await db.run("INSERT INTO dedupe_log (user_id, at, table_name, removed_id, kept_id) VALUES (?, ?, 'week_features', 1, 2)", [userId, NOW]);
  // Links within a table: a pick moved to another day (carried_from), and undone writes (undo_of, undone_by).
  const moving = (await plan.addPick({ date: MON, half: "PM", clientKey: "cooptimize", kind: "intention", title: `${tag} moved`, size: "S" }));
  (await plan.move(moving.id, "2026-11-04", "PM"));
  const dw = (await plan.logDevopsWrite({ clientKey: "cooptimize", org: "org", project: "p", op: "create", itemId: 9001, parentId: null, title: `${tag} 2`, identity: tag, before: {}, after: {}, ops: null, revBefore: null, revAfter: null, commentId: null, draftId: null, followUpId: null, undoOf: null }));
  const du = (await plan.logDevopsWrite({ clientKey: "cooptimize", org: "org", project: "p", op: "undo_create", itemId: 9001, parentId: null, title: `${tag} 2`, identity: tag, before: {}, after: {}, ops: null, revBefore: null, revAfter: null, commentId: null, draftId: null, followUpId: null, undoOf: dw.id }));
  await plan.markDevopsUndone(dw.id, du.id);
  const w2 = (await plan.logWrite({ op: "update", uid: box.uid, eventId: `E-${tag}`, account: null, calendar: null, before: F, after: F, localBefore: null, localAfter: null, auto: false }));
  const u2 = (await plan.logWrite({ op: "update", uid: box.uid, eventId: `E-${tag}`, account: null, calendar: null, before: F, after: F, localBefore: null, localAfter: null, auto: false, undoOf: w2.id }));
  await plan.markUndone(w2.id, u2.id);
  return plan;
}

