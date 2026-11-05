// A3: a person with something in every user table (the isolation test, and the import's round trip). Test-only.
import { createDemoContext, seedDemo } from "../server/demo.ts";
import { DEMO_TZ } from "../sources/demo/data.ts";
import { starterToml } from "../config/starter.ts";
import { planStoreOn, type PlanStore } from "../store/plan-store.ts";
import type { Conn } from "../store/sql/conn.ts";
import { createUserSettings } from "../store/user-settings.ts";
import { createUserSecrets, fakeKeyProvider } from "../store/user-secrets.ts";
import { createPushDevices } from "../store/push-devices.ts";
import { createTeamsBotStore } from "../store/teams-bot-store.ts";

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
  // DM-1: not a demo client key (the demo sets its own identities; SQL Server compares keys without case).
  (await plan.setDevopsIdentity({ clientKey: "proseware", org: "org", id: tag, name: tag, email: `${tag}@example.com`, expires: null }));
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
  await plan.addDeliveryChat("cooptimize", "delivery", { chatId: `19:${tag}@thread.v2`, displayName: `${tag} delivery`, webUrl: null });
  await plan.setDeliveryChatMembers(`19:${tag}@thread.v2`, [{ userId: null, displayName: tag, email: `${tag}@example.com`, tenantId: null }], NOW);
  await plan.setAsksOn(`19:${tag}@thread.v2`, true, "2026-11-02T14:00:00Z");
  await plan.addChatMessages([{ chatId: `19:${tag}@thread.v2`, messageId: "1730000000001", clientKey: "cooptimize", authorId: null, authorTenant: null, createdAt: "2026-11-02T15:00:00Z", text: tag, hasImage: false, hasFile: false, replyToId: null }]);
  await plan.addAiRequest({ at: "2026-11-02T15:00:00Z", task: "test_ai", clientKey: null, model: tag, inputTokens: 10, outputTokens: 2, costMicros: 3, latencyMs: 400, outcome: "ok", detail: null });
  await plan.rememberItemClient(`client-${tag}`, [4100 + tag.length]);
  // DS-1: a draft with one card, its write, and a house style.
  const sd = await plan.addStoryDraft("cooptimize", 7001, { featureTitle: tag, storyType: "User Story", note: "", exemplarIds: [], proposals: [{ id: "P1", title: tag, description: "", acceptance: [], dependsOn: [], size: "S", evidence: [], questions: [], keep: true }], rationale: "", setAside: [], costMicros: 0 });
  await plan.linkStoryDraftWrite(sd.id, "P1", 1);
  await plan.editHouseStyle("cooptimize", `${tag} style`);
  await plan.addAsk({ chatId: `19:${tag}@thread.v2`, messageId: "1730000000001", clientKey: "cooptimize", rule: "question", ruleDetail: null, at: "2026-11-02T15:00:00Z" });
  await plan.addPromise({ chatId: `19:${tag}@thread.v2`, messageId: "1730000000001", clientKey: "cooptimize", phrase: "i'll", at: "2026-11-02T15:00:00Z", draft: { what: tag, due: null, toWhom: null, answers: null, reason: null }, aiStatus: null });
  await plan.seeConversation(1, 1);
  (await plan.addNotice({ key: `n-${tag}`, kind: "followups", title: tag, body: tag, route: "inbox" }));
  (await plan.setRoadmapDates("cooptimize", 7001, { start: "2026-11-02", end: "2026-11-20" }));
  // AH-1: a pending change and a kept half-day.
  await plan.stageAheadChange({ clientKey: "cooptimize", itemId: 7001, field: "target", value: "2026-11-27", half: "PM", baseRev: 3, baseValue: null });
  await plan.setAheadHalf("cooptimize", 7001, "start", "2026-11-02", "PM");
  // AS-1: a turn of the assistant's history and a proposal from it.
  const turn = await plan.addAssistantTurn({ channel: "panel", role: "me", text: `${tag} what's next?`, cards: [] });
  await plan.addAssistantProposal({ turnId: turn, action: "pick.move", input: { tool: "move_pick" }, clientKey: "cooptimize", view: { title: tag }, snapshot: null, expiresAt: "2026-11-02T16:00:00Z" });
  // PL-1: a carry decision, a Watching row with its check-in, and a pick with its own minutes.
  await plan.decideCarry(MON, "cooptimize", 7001, "carry", "kept");
  await plan.addWatch({ weekStart: MON, clientKey: "cooptimize", itemId: 7002, title: tag, itemType: "Feature", url: null, why: "owner", checkin: { date: MON, half: "AM", minutes: 30 } });
  (await plan.addPick({ date: MON, half: "AM", clientKey: "cooptimize", kind: "intention", title: `${tag} check-in`, size: "S", minutes: 30 }));
  (await plan.logTeamsStatus({ op: "set", status: "Busy", minutes: 25, result: "done", message: null }));
  await createUserSettings({ db, userId, app: { dataverse: null, entra: null, google: null }, person: () => ({ email: `${tag}@example.com`, upn: `${tag}@example.com`, timeZone: null }), setZone: () => {}, defaultZone: DEMO_TZ, now: () => Temporal.Instant.from(NOW) }).seed(starterToml(DEMO_TZ));
  await createUserSecrets({ db, userId, keys: KEYS, now: () => Temporal.Instant.from(NOW) }).set("devops-write-pat:cooptimize", `pat-${tag}`);
  await createPushDevices({ db, userId, keys: KEYS, now: () => Temporal.Instant.from(NOW) }).save(`device-${tag}-0000000000`, "Phone", { endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`, keys: { p256dh: "x", auth: "y" } });
  const bot = createTeamsBotStore({ db, userId, now: () => Temporal.Instant.from(NOW) });
  await bot.saveChat({ conversationId: `a:conv-${tag}`, serviceUrl: "https://smba.trafficmanager.net/amer/", tenantId: "tenant-1", botId: "28:bot" });
  await bot.cardSent(`p-${tag}`, `act-${tag}`, "2026-11-02T14:45:00Z", tag);
  await bot.firstSeen(`act-in-${tag}`);
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

