import { legacyHours } from "../../config/schema.ts";
// AS-3: the fake world the assistant is tested in: two clients of mine (Tailspin and Wingtip) and one that isn't (Initech,
// present in every fake read so a leak would show), a fake dispatch, a real plan store and a scripted model that returns
// structured output. assistant/answers.test.ts (the golden set) and assistant/parity.test.ts (TB-3: the same through the
// Teams path) both run on it, so a golden question means the same thing in both.
import { createAi } from "../../ai/service.ts";
import { stubProvider } from "../../ai/stub.ts";
import type { AiLogEntry, AiRules, ProviderCall, ProviderReply } from "../../ai/types.ts";
import type { ActionName } from "../../actions/registry.ts";
import type { ActionResponse } from "../../actions/types.ts";
import { createPlanStore } from "../../store/plan-store.ts";
import { aClient, aClientEntry, aFocusBlock, aMeeting, anAheadClient, anAheadItem, anAheadLoad, anAiApp, anAiRules, anAssignee, aPto, aStatusLoad, aWeek } from "./index.ts";
import { SIZE_MINUTES } from "../../plan/types.ts";
import { createAssistant, type AssistantEnv } from "../../assistant/service.ts";
export const NOW = "2026-11-05T15:00:00Z"; // Thursday Nov 5, 10:00 in New York
export const ZONE = "America/New_York";
export const Tailspin = "tailspin", QD = "wingtip", INI = "initech";
export const NEXT_MON = "2026-11-09", NEXT_TUE = "2026-11-10", NEXT_WED = "2026-11-11", NEXT_THU = "2026-11-12", NEXT_FRI = "2026-11-13";
export const SAT = "2026-11-07";
export const CANNED = /I can look things up/;

export type Reply = ProviderReply | ((c: ProviderCall) => ProviderReply);
export const usage = { inputTokens: 100, cachedTokens: 0, outputTokens: 20 };
export const say = (reply: string): ProviderReply => ({ ok: true, text: JSON.stringify({ reply }), usage, model: "test-model" });
let n = 0;
export const call = (...calls: [string, Record<string, unknown>][]): ProviderReply => ({ ok: true, text: "", usage, model: "test-model", calls: calls.map(([name, args]) => ({ callId: `c${++n}`, name, arguments: JSON.stringify(args) })), items: [] });

export type Ask = { topic: string; period?: string; date?: string | null; lateOnly?: boolean };

export function setup(o: { rules?: Partial<AiRules>; channel?: "panel" | "teams"; noAi?: boolean; standards?: AssistantEnv["standards"]; /** A feature with the same name in a second client. */ twin?: boolean; /** The second DevOps confirm fails. */ failSecondWrite?: boolean } = {}) {
  let clock = NOW;
  let confirms = 0;
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock).toZonedDateTimeISO(ZONE) });
  const ran: { action: ActionName; input: unknown }[] = [];
  const calls: ProviderCall[] = [];
  let intent: { tools: string[]; ask: unknown; followUp: boolean } = { tools: [], ask: null, followUp: false };
  let answers: Reply[] = [];
  const log: AiLogEntry[] = [];
  const provider = stubProvider({
    respond: (c) => {
      calls.push(c);
      if (c.schemaName === "assistant_intent") return JSON.stringify(intent);
      const r = answers.shift() ?? say("Here's what I found.");
      return typeof r === "function" ? r(c) : r;
    },
  });
  const rules = anAiRules({ on: true, allowedClients: [Tailspin, QD], ...o.rules });
  const dir = [
    aClientEntry({ key: Tailspin, names: ["Tailspin"], projects: ["Analytics"], itemIds: [8100, 8101, 8102, 8200, 8300] }),
    aClientEntry({ key: QD, names: ["Wingtip"], projects: ["Claims"], itemIds: [9100, 9101] }),
  ];
  const ai = createAi({
    provider: async () => provider,
    app: anAiApp(),
    rules: async () => rules,
    guard: async () => ({ directory: dir, homeDomains: ["cooptimize.example"], forbidden: [], internal: false }),
    log: { add: async (e) => void log.push(e), spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => clock,
  });
  const mine = new Set([Tailspin, QD]);
  const story = (id: number, title: string, parentId: number, assignee = "Sam Tester") => anAheadItem({ id, title, type: "User Story", level: "child", rung: 2, parentId, assignee: anAssignee(assignee), size: 3 });
  const ahead = anAheadLoad([
    anAheadClient({ clientKey: Tailspin, clientName: "Tailspin", items: [
      anAheadItem({ id: 8100, title: "Data Staleness", type: "Feature", assignee: anAssignee("Sam Tester"), start: "2026-11-02", target: NEXT_FRI, size: 8 }),
      story(8101, "Flag stale rows", 8100), story(8102, "Staleness banner", 8100),
      anAheadItem({ id: 8200, title: "Usage export", type: "Feature", assignee: anAssignee("Sam Tester"), start: "2026-11-09", target: NEXT_THU, size: 5 }),
      anAheadItem({ id: 8300, title: "Ingest monitor", type: "Feature", assignee: anAssignee("Sam Tester"), start: "2026-11-02", target: "2026-12-18", size: 5 }),
      story(8301, "Ingest alert email", 8300),
    ], editable: [8100, 8101, 8102, 8200, 8300, 8301] } as never),
    anAheadClient({ clientKey: QD, clientName: "Wingtip", items: [
      anAheadItem({ id: 9100, title: "Claims intake", type: "Feature", assignee: null, start: "2026-11-09", target: NEXT_WED, size: 5 }),
      story(9101, "Intake form", 9100),
      ...(o.twin ? [anAheadItem({ id: 9200, title: "Data Staleness", type: "Feature" }), story(9201, "Twin stale rows", 9200)] : []),
    ], editable: [9100, 9101, ...(o.twin ? [9200, 9201] : [])] } as never),
    anAheadClient({ clientKey: INI, clientName: "Initech", items: [anAheadItem({ id: 7100, title: "Initech secret migration", type: "Feature", target: NEXT_TUE })] } as never),
  ]);
  const tailspin = aClient({ name: "Tailspin" }), qd = aClient({ name: "Wingtip" }), ini = aClient({ name: "Initech" });
  const patterns = [aFocusBlock({ client: tailspin, days: { Mon: "AM", Wed: "PM" } }), aFocusBlock({ client: qd, days: { Tue: "AM", Wed: "AM", Thu: "PM" } }), aFocusBlock({ client: ini, days: { Thu: "AM" } })];
  // QT-2: Wednesday afternoon has a long meeting, so the calendar puts Tailspin's block at risk (the only reason an
  // answer names a block or suggests moving its to-dos; how much is planned there never does).
  const events = [aMeeting({ title: "Quarterly review", start: `${NEXT_TUE}T09:00`, end: `${NEXT_TUE}T15:00` }), aMeeting({ title: "Data review", start: `${NEXT_WED}T13:00`, end: `${NEXT_WED}T16:45` })];
  const promises = [
    { id: 41, what: "Send the row counts", toName: "Dana Reyes", clientKey: Tailspin, clientName: "Tailspin", dueAt: null, dueDate: "2026-11-03", overdue: true },
    { id: 42, what: "Share the intake mockups", toName: "Lee Park", clientKey: QD, clientName: "Wingtip", dueAt: null, dueDate: NEXT_TUE, overdue: false },
    { id: 43, what: "Initech secret thing", toName: "Bob", clientKey: INI, clientName: "Initech", dueAt: null, dueDate: "2026-11-02", overdue: true },
  ];
  const confirmed: Record<string, boolean> = { "2026-11-02": true, [NEXT_MON]: false };
  const handlers: Partial<Record<ActionName, (input: unknown) => ActionResponse | Promise<ActionResponse>>> = {
    "week.load": async (i) => {
      const weekStart = (i as { weekStart: string }).weekStart;
      const days = [0, 1, 2, 3, 4, 5, 6].map((k) => Temporal.PlainDate.from(weekStart).add({ days: k }).toString());
      const plan7 = Object.fromEntries(await Promise.all(days.map(async (d) => [d, { committedAt: null, picks: await plan.picksFor(d) }])));
      const all = Object.values(plan7).flatMap((x) => (x as { picks: import("../../plan/types.ts").Pick[] }).picks);
      const parts = all.filter((p) => p.todoKind === "deployment").map((p) => ({ pickId: p.id, date: p.date, title: p.title, minutes: 120, why: "deployment" as const }));
      return { ok: true, data: { weekStart, week: aWeek({ weekStart, patterns, events, pto: weekStart === NEXT_MON ? [aPto({ date: NEXT_THU })] : [], weekendPlanned: new Set(all.filter((p) => p.date === SAT).map((p) => p.date)) }), afterHours: { minutes: parts.reduce((x, p) => x + p.minutes, 0), parts }, planning: { sizes: SIZE_MINUTES }, plan: plan7, promises, followUps: [], timer: null, weekCommitted: confirmed, focused: {}, resumeNotes: {}, hours: legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: ZONE }), planDay: { date: "2026-11-05", workday: true, committed: false, available: true } } };
    },
    "ahead.load": () => ({ ok: true, data: ahead }),
    "status.load": () => {
      const a = aStatusLoad({ clientKey: Tailspin, clientName: "Tailspin", updates: [0, 1], ids: [8100, 8200] });
      const b = aStatusLoad({ clientKey: QD, clientName: "Wingtip", updates: [0], ids: [9100] });
      const c = aStatusLoad({ clientKey: INI, clientName: "Initech", updates: [0], ids: [7100] });
      const named = (x: typeof a, t: Record<number, string>) => x.clients.map((k) => ({ ...k, features: k.features.map((f) => ({ ...f, title: t[f.id] ?? f.title })) }));
      return { ok: true, data: { ...a, clients: [...named(a, { 8100: "Data Staleness", 8200: "Usage export" }), ...named(b, { 9100: "Claims intake" }), ...named(c, { 7100: "Initech secret migration" })] } };
    },
    "inbox.list": () => ({ ok: true, data: { today: "2026-11-05", counts: {}, needsYou: 0, items: [
      { key: "v41", kind: "conversation", views: ["needs_you"], clientKey: Tailspin, title: "Invoice export", who: null, due: null, late: false, itemId: null },
      { key: "commitment:51", kind: "commitment", views: ["waiting"], clientKey: Tailspin, title: "Send the sample extract", who: "Dana Reyes", due: "2026-11-04", late: true, itemId: null },
      { key: "commitment:52", kind: "commitment", views: ["waiting"], clientKey: INI, title: "Initech secret file", who: "Bob", due: null, late: false, itemId: null },
      { key: "c42", kind: "chatPromise", views: ["in_progress"], clientKey: Tailspin, title: "Send the linked export", who: "Dana Reyes", due: null, dueAt: null, late: false, done: false, itemId: 8101 },
      { key: "chatPromise:41", kind: "chatPromise", views: ["promises", "needs_you"], clientKey: Tailspin, title: "Send the row counts", who: "Dana Reyes", due: "2026-11-03", dueAt: null, late: true, done: false, itemId: null },
      { key: "chatPromise:42", kind: "chatPromise", views: ["promises"], clientKey: QD, title: "Share the intake mockups", who: "Lee Park", due: NEXT_TUE, dueAt: null, late: false, done: false, itemId: null },
      { key: "chatPromise:43", kind: "chatPromise", views: ["promises"], clientKey: INI, title: "Initech secret thing", who: "Bob", due: "2026-11-02", dueAt: null, late: true, done: false, itemId: null },
    ] } }),
    "meeting.mine": () => ({ ok: true, data: { meetings: [], occurrences: [], nudges: [
      { kind: "review", key: "meeting_review:1", occurrenceId: 1, seriesId: 1, clientKey: Tailspin, meeting: "Tailspin weekly status", date: "2026-11-05", clientName: "Tailspin", dateLabel: "Thu, Nov 5" },
      { kind: "review", key: "meeting_review:2", occurrenceId: 2, seriesId: 2, clientKey: INI, meeting: "Initech sync", date: "2026-11-05", clientName: "Initech", dateLabel: "Thu, Nov 5" },
    ] } }),
    "pick.move": async (i) => {
      const x = i as { id: number; date: string; half: "AM" | "PM" };
      return { ok: true, data: { pick: await plan.move(x.id, x.date, x.half) } };
    },
    "pick.uncarry": async (i) => ({ ok: true, data: { pick: await plan.uncarry((i as { id: number }).id) } }),
    "weekplan.commit": (i) => ((confirmed[(i as { weekStart: string }).weekStart] = true), { ok: true, data: {} }),
    "devops.done_offer": (i) => ({ ok: true, data: { offers: [{ clientKey: Tailspin, itemId: 8101, followUpId: null, choices: ["Closed"] }], itemOffers: [{ clientKey: (i as { clientKey?: string }).clientKey ?? Tailspin, clientName: "Tailspin", itemId: (i as { itemIds?: number[] }).itemIds?.[0] ?? 8101, title: "t", type: "User Story", state: "Active", choices: ["Closed"] }], why: null } }),
    // FN-1: Wrap it up's offer, its one preview and its writes (wrap_up on a Teams card).
    "wrapup.offer": () => ({ ok: true, data: { pick: { id: 1, title: "t", status: "done", date: "2026-11-05", leftMinutes: 60, spentMinutes: 0, timeboxedMinutes: 0 }, clientKey: Tailspin, itemId: 8101, offer: { clientKey: Tailspin, clientName: "Tailspin", itemId: 8101, title: "Stale flags", type: "User Story", state: "Active", done: false, choices: ["Closed"], chosen: "Closed", activate: null, hasRemaining: true, remaining: 3, canEdit: true, editNote: null, parent: null }, why: null, code: null, setting: "ask" } }),
    "wrapup.preview": (i) => {
      const x = i as { outcome: string; comment: string; left: number | null };
      const fields = x.outcome === "finished" ? [{ label: "State", before: "Active", after: "Closed", changed: true }] : [{ label: "Remaining Work", before: "3", after: String((x.left ?? 60) / 60), changed: true }];
      return { ok: true, data: { previews: [{ previewId: `pv${++n}`, expiresAt: NOW, op: x.outcome === "finished" ? "state" : "remaining_work", summary: "x", system: "DevOps", org: "contoso", project: "Analytics", item: "#8101", identity: "Sam Tester <sam@cooptimize.example>", fields: x.comment ? [...fields, { label: "Comment", before: null, after: x.comment, changed: true }] : fields, links: [], notes: [], visibility: "Visible to everyone on the Analytics project.", undo: true, key: "state" }], refused: [], nothing: [], summary: x.outcome === "finished" ? "#8101: state Active → Closed" : "#8101: Remaining Work 1" } };
    },
    "wrapup.apply": () => ({ ok: true, data: { results: [{ key: "state", itemId: 8101, ok: true, message: "Written in DevOps", writeId: 77, retry: null }], landed: 1, message: "Saved to DevOps" } }),
    "devops.preview": (i) => {
      const ch = (i as { change: { kind: string; text?: string; state?: string; after?: string } }).change;
      return { ok: true, data: { preview: { previewId: `pv${++n}`, expiresAt: NOW, op: ch.kind === "state" ? "state" : "comment", summary: "x", system: "DevOps", org: "contoso", project: "Analytics", item: "#8101", identity: "Sam Tester <sam@cooptimize.example>", fields: ch.kind === "state" ? [{ label: "State", before: "Active", after: ch.state!, changed: true }] : ch.kind === "undo" ? [{ label: "Comment", before: "Ready.", after: "Removed", changed: true }] : ch.kind === "description_edit" ? [{ label: "Description", before: "Old text", after: ch.after ?? "New text", changed: true }] : [{ label: "Comment", before: null, after: ch.text ?? "", changed: true }], links: [], notes: [], visibility: "Visible to everyone on the Analytics project.", undo: true } } };
    },
    "devops.confirm": () => (o.failSecondWrite && ++confirms === 2 ? { ok: false, status: 409, error: "The item changed in DevOps since" } : { ok: true, data: { entry: { id: 77 }, confirmed: true, message: "Written in DevOps" } }),
    "pick.remove": () => ({ ok: true, data: { result: "removed" } }),
    "pick.mark_done": () => ({ ok: true, data: {} }),
    "closeout.commit": () => ({ ok: true, data: {} }),
    "planday.commit": () => ({ ok: true, data: {} }),
    "weekplan.add": () => ({ ok: true, data: {} }),
    "ahead.stage": () => ({ ok: true, data: { changes: [] } }),
    "team.commit": () => ({ ok: true, data: { weekStart: "2026-11-02", clients: [] } }),
    "send.today": () => ({ ok: true, data: { sends: [] } }),
    "send.people": () => ({ ok: true, data: { people: [{ id: "p-dana", name: "Dana Reyes", email: "dana@cooptimize.example", lead: true }], canSend: true, canMust: false, why: null } }),
    "send.create": () => ({ ok: true, data: { send: { id: 1 } } }),
    "capture.add": () => ({ ok: true, data: { capture: { id: 5 } } }),
    "capture.route": () => ({ ok: true, data: { capture: { id: 5, routedId: 12 } } }),
    "draft.prepare": () => ({ ok: true, data: {} }),
    "conversations.claim": () => ({ ok: true, data: {} }),
    "conversations.list": () => ({ ok: true, data: { needsYou: [{ id: 41, clientKey: Tailspin, clientName: "Tailspin", title: "Invoice export", commitments: [], shared: { state: "open", view: "up_for_grabs", owner: null, helpers: [], offer: null, history: [], canUndo: false, mayHandOff: true, team: [] } }], teammates: [], inProgress: [], handled: [], closed: [], chatter: [], unsorted: [] } }),
    "conversations.search_items": () => ({ ok: true, data: { available: true, items: [{ id: 8101, title: "Flag stale rows", type: "User Story", state: "Active" }] } }),
    "conversations.unlink": () => ({ ok: true, data: {} }),
    "my_promises.unlink": () => ({ ok: true, data: {} }),
    "inbox.seen": () => ({ ok: true, data: {} }),
    "inbox.snooze": () => ({ ok: true, data: {} }),
    "loop.find": () => ({ ok: true, data: { matches: [{ key: "chatPromise:41", what: "Send the row counts", who: "Dana Reyes", clientKey: Tailspin, clientName: "Tailspin", href: "#/inbox/item/chatPromise:41" }] } }),
    "deploy.items": () => ({ ok: true, data: { groups: [] } }),
    "deploy.add": async (i) => { const x = i as { clientKey: string; date: string; title: string }; return { ok: true, data: { pick: await plan.addPick({ date: x.date, half: "EVE", clientKey: x.clientKey, kind: "intention", title: x.title, size: null, minutes: 120, todoKind: "deployment", window: { start: "09:00", end: "11:00" } } as never) } }; },
    "devops.undo_offer": () => ({ ok: true, data: { offer: { writeId: 77, clientKey: Tailspin, itemId: 8101, before: "Active" } } }),
  };
  const env: AssistantEnv = {
    ...(o.standards ? { standards: o.standards } : {}),
    run: async (action, input) => {
      ran.push({ action, input });
      const h = handlers[action];
      return h ? h(input) : { ok: false, status: 404, error: `no fake for ${action}` };
    },
    plan,
    ai: o.noAi ? null : ai,
    directory: dir,
    isMine: (k) => mine.has(k),
    isInternal: () => false,
    clientName: (k) => (k === Tailspin ? "Tailspin" : k === QD ? "Wingtip" : k === INI ? "Initech" : k),
    now: () => clock,
    zone: ZONE,
    channel: o.channel ?? "panel",
  };
  const a = createAssistant(env);
  const panel = createAssistant({ ...env, channel: "panel" });
  // My to-dos: next week's Wed PM Tailspin block is over-full (three L stories under Data Staleness and Usage export).
  const seed = async () => {
    const p1 = await plan.addPick({ date: NEXT_WED, half: "PM", clientKey: Tailspin, kind: "item", itemId: 8101, title: "Flag stale rows", size: "L" });
    const p2 = await plan.addPick({ date: NEXT_WED, half: "PM", clientKey: Tailspin, kind: "item", itemId: 8102, title: "Staleness banner", size: "L" });
    const p3 = await plan.addPick({ date: NEXT_WED, half: "PM", clientKey: Tailspin, kind: "intention", title: "Usage export notes", size: "M" });
    const p4 = await plan.addPick({ date: NEXT_WED, half: "AM", clientKey: QD, kind: "item", itemId: 9101, title: "Intake form", size: "M" });
    const d1 = await plan.addPick({ date: "2026-11-02", half: "AM", clientKey: Tailspin, kind: "item", itemId: 8301, title: "Ingest alert email", size: "S" });
    await plan.setDone(d1.id, true);
    const d2 = await plan.addPick({ date: "2026-11-03", half: "AM", clientKey: QD, kind: "intention", title: "Claims walkthrough", size: "S" });
    await plan.setDone(d2.id, true);
    const dep = await plan.addPick({ date: SAT, half: "EVE", clientKey: QD, kind: "intention", title: "Claims release", size: null, minutes: 120, todoKind: "deployment", window: { start: "09:00", end: "11:00" } } as never);
    const tomorrow = await plan.addPick({ date: "2026-11-06", half: "AM", clientKey: Tailspin, kind: "item", itemId: 8101, title: "Flag stale rows draft", size: "S" });
    const ini1 = await plan.addPick({ date: NEXT_WED, half: "PM", clientKey: INI, kind: "intention", title: "Initech secret plan", size: "L" });
    return { p1, p2, p3, p4, d1, d2, dep, tomorrow, ini1 };
  };
  return {
    a, panel, plan, ran, calls, log, seed, env, setNow: (t: string) => void (clock = t),
    question: (ask: Ask, o2: { followUp?: boolean } = {}, ...replies: Reply[]) => ((intent = { tools: [], ask: { period: "this_week", date: null, lateOnly: false, ...ask }, followUp: !!o2.followUp }), (answers = replies)),
    action: (tools: string[], o2: { followUp?: boolean } = {}, ...replies: Reply[]) => ((intent = { tools, ask: null, followUp: !!o2.followUp }), (answers = replies)),
  };
}

