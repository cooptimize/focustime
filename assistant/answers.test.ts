// AS-3: the assistant answers real questions. A golden set (the six from the brief, Nov 7, and more from the same week) on
// fake data: two clients of mine (Tailspin and Wingtip) and one that isn't (Initech, present in every fake read so a leak
// would show), a fake dispatch, a real plan store and a scripted model that returns structured output. Each case
// checks the path (answer, action or choices), what the context held (and never Initech), and that the reply links
// real items and suggests only allowlisted proposals. Requests 4 to 6 still go through AS-2's actions with one
// Confirm and one Undo; AI off is one line and the command menu; the Teams bot gives the same answer with buttons.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { AiLogEntry, AiRules, ProviderCall, ProviderReply } from "../ai/types.ts";
import type { ActionName } from "../actions/registry.ts";
import type { ActionResponse } from "../actions/types.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { aClient, aClientEntry, aFocusBlock, aMeeting, anAheadClient, anAheadItem, anAheadLoad, anAiApp, anAiRules, anAssignee, aPto, aStatusLoad, aWeek } from "../test/builders/index.ts";
import { SIZE_MINUTES } from "../plan/types.ts";
import { SUGGEST_TOOLS, TOOLS } from "./allowlist.ts";
import { createAssistant, type AssistantEnv } from "./service.ts";
import { teamsAssistant } from "../server/teams/assistant.ts";
import type { Card, ConfirmResult, HandleResult } from "./types.ts";

const NOW = "2026-11-05T15:00:00Z"; // Thursday Nov 5, 10:00 in New York
const ZONE = "America/New_York";
const Tailspin = "tailspin", QD = "wingtip", INI = "initech";
const NEXT_MON = "2026-11-09", NEXT_TUE = "2026-11-10", NEXT_WED = "2026-11-11", NEXT_THU = "2026-11-12", NEXT_FRI = "2026-11-13";
const SAT = "2026-11-07";
const CANNED = /I can look things up/;

type Reply = ProviderReply | ((c: ProviderCall) => ProviderReply);
const usage = { inputTokens: 100, cachedTokens: 0, outputTokens: 20 };
const say = (reply: string): ProviderReply => ({ ok: true, text: JSON.stringify({ reply }), usage, model: "test-model" });
let n = 0;
const call = (...calls: [string, Record<string, unknown>][]): ProviderReply => ({ ok: true, text: "", usage, model: "test-model", calls: calls.map(([name, args]) => ({ callId: `c${++n}`, name, arguments: JSON.stringify(args) })), items: [] });

type Ask = { topic: string; period?: string; date?: string | null; lateOnly?: boolean };

function setup(o: { rules?: Partial<AiRules>; channel?: "panel" | "teams"; noAi?: boolean } = {}) {
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO(ZONE) });
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
    now: () => NOW,
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
    ], editable: [9100, 9101] } as never),
    anAheadClient({ clientKey: INI, clientName: "Initech", items: [anAheadItem({ id: 7100, title: "Initech secret migration", type: "Feature", target: NEXT_TUE })] } as never),
  ]);
  const tailspin = aClient({ name: "Tailspin" }), qd = aClient({ name: "Wingtip" }), ini = aClient({ name: "Initech" });
  const patterns = [aFocusBlock({ client: tailspin, days: { Mon: "AM", Wed: "PM" } }), aFocusBlock({ client: qd, days: { Tue: "AM", Wed: "AM", Thu: "PM" } }), aFocusBlock({ client: ini, days: { Thu: "AM" } })];
  const events = [aMeeting({ title: "Quarterly review", start: `${NEXT_TUE}T09:00`, end: `${NEXT_TUE}T15:00` })];
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
      const all = Object.values(plan7).flatMap((x) => (x as { picks: import("../plan/types.ts").Pick[] }).picks);
      const parts = all.filter((p) => p.todoKind === "deployment").map((p) => ({ pickId: p.id, date: p.date, title: p.title, minutes: 120, why: "deployment" as const }));
      return { ok: true, data: { weekStart, week: aWeek({ weekStart, patterns, events, pto: weekStart === NEXT_MON ? [aPto({ date: NEXT_THU })] : [], weekendPlanned: new Set(all.filter((p) => p.date === SAT).map((p) => p.date)) }), afterHours: { minutes: parts.reduce((x, p) => x + p.minutes, 0), parts }, planning: { sizes: SIZE_MINUTES }, plan: plan7, promises, followUps: [], timer: null, weekCommitted: confirmed, focused: {}, resumeNotes: {}, hours: { timeZone: ZONE, weekdays: {}, lunch: null, overrides: [] }, planDay: { date: "2026-11-05", workday: true, committed: false, available: true } } };
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
      { key: "commitment:51", kind: "commitment", views: ["waiting"], clientKey: Tailspin, title: "Send the sample extract", who: "Dana Reyes", due: "2026-11-04", late: true, itemId: null },
      { key: "commitment:52", kind: "commitment", views: ["waiting"], clientKey: INI, title: "Initech secret file", who: "Bob", due: null, late: false, itemId: null },
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
    "devops.done_offer": (i) => ({ ok: true, data: { itemOffers: [{ clientKey: (i as { clientKey: string }).clientKey, clientName: "Tailspin", itemId: (i as { itemIds: number[] }).itemIds[0], title: "t", type: "User Story", state: "Active", choices: ["Closed"] }], why: null } }),
    "devops.preview": (i) => {
      const ch = (i as { change: { kind: string; text?: string; state?: string } }).change;
      return { ok: true, data: { preview: { previewId: `pv${++n}`, expiresAt: NOW, op: ch.kind === "state" ? "state" : "comment", summary: "x", system: "DevOps", org: "contoso", project: "Analytics", item: "#8101", identity: "Sam Tester <sam@cooptimize.example>", fields: ch.kind === "state" ? [{ label: "State", before: "Active", after: ch.state!, changed: true }] : [{ label: "Comment", before: null, after: ch.text!, changed: true }], links: [], notes: [], visibility: "Visible to everyone on the Analytics project.", undo: true } } };
    },
    "devops.confirm": () => ({ ok: true, data: { entry: { id: 77 }, confirmed: true, message: "Written in DevOps" } }),
  };
  const env: AssistantEnv = {
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
    now: () => NOW,
    zone: ZONE,
    channel: o.channel ?? "panel",
    publicUrl: "https://focustime.example.com",
  };
  const a = createAssistant(env);
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
    a, plan, ran, calls, log, seed, env,
    question: (ask: Ask, o2: { followUp?: boolean } = {}, ...replies: Reply[]) => ((intent = { tools: [], ask: { period: "this_week", date: null, lateOnly: false, ...ask }, followUp: !!o2.followUp }), (answers = replies)),
    action: (tools: string[], o2: { followUp?: boolean } = {}, ...replies: Reply[]) => ((intent = { tools, ask: null, followUp: !!o2.followUp }), (answers = replies)),
  };
}

/** Everything a person sees in an answer, as one string (to check it never shows another client's words). */
const shown = (r: HandleResult) => JSON.stringify({ reply: r.reply, cards: r.cards, links: r.links, proposals: r.proposals });
/** Every call the model got, as one string (to check what went to the AI). */
const sent = (s: ReturnType<typeof setup>) => JSON.stringify(s.calls.map((c) => [c.instructions.length, c.input, c.rounds]));
const sections = (r: HandleResult) => r.cards.filter((c): c is Extract<Card, { kind: "section" }> => c.kind === "section");
const suggest = (r: HandleResult) => r.cards.find((c): c is Extract<Card, { kind: "suggest" }> => c.kind === "suggest") ?? null;
const lines = (r: HandleResult) => sections(r).flatMap((x) => x.lines.map((l) => l.text));
const expectNoLeak = (r: HandleResult, s: ReturnType<typeof setup>) => {
  expect(shown(r)).not.toMatch(/Initech|7100|secret/i);
  expect(sent(s)).not.toMatch(/Initech|7100|secret/i);
  expect(shown(r)).not.toMatch(CANNED);
};
/** Every line with a link points at a real thing of mine (a block's day, #id in Ahead, a promise, the Inbox, Status). */
const expectGrounded = (r: HandleResult) => {
  for (const sec of sections(r)) for (const l of sec.lines) {
    const id = /#(\d+)/.exec(l.text)?.[1];
    if (id) expect([8100, 8101, 8102, 8200, 8300, 8301, 9100, 9101]).toContain(Number(id));
    if (l.link) expect(l.link.href).toMatch(/^#\/(week|ahead|inbox|meetings|commands|guide)/);
  }
};

describe("AS-3 golden set: the six questions from the brief", () => {
  it("1. \"I'm planning next week. What should I look out for?\": the answer path, grouped by client, with suggested steps", async () => {
    const s = setup();
    const t = await s.seed();
    s.question({ topic: "plan_check", period: "next_week" });
    const r = await s.a.handle("I'm planning next week. What should I look out for?");
    expect(r.status).toBe("ok");
    expect(r.proposals).toEqual([]);
    expect(r.reply).toMatch(/^For next week \(Mon, Nov 9 to Fri, Nov 13\), \d+ things to look at, by client\.$/);
    expect(sections(r).map((x) => x.title)).toEqual(["Your days", "Tailspin", "Wingtip"]);
    const all = lines(r);
    // Days: a meeting-heavy Tuesday and Thursday's PTO.
    expect(all).toContain("Tue, Nov 10: 6h of meetings");
    expect(all).toContain("Thu, Nov 12: PTO");
    // Tailspin: the over-full Wed PM, the late promise, gaps for work dated then, the missing update, the call to review.
    expect(all.some((l) => /^Wed PM: about 10h planned, 5h free$/.test(l))).toBe(true);
    expect(all).toContain("Late promise to Dana Reyes: Send the row counts (was due Nov 3)");
    expect(all).toContain("#8200 Usage export: needs stories (target Nov 12)");
    expect(all).toContain("#8100 Data Staleness: no update yet for Monday's report");
    expect(all).toContain("Tailspin weekly status on Nov 5: proposals to review");
    // Wingtip: the unassigned feature dated then and its missing update.
    expect(all).toContain("#9100 Claims intake: unassigned (target Nov 11)");
    expect(all).toContain("#9100 Claims intake: no update yet for Monday's report");
    expectGrounded(r);
    expectNoLeak(r, s);
    // Up to 3 suggestions, only allowlisted proposals: move the over-full block's to-dos, confirm next week.
    const sg = suggest(r)!;
    expect(sg.choices.map((c) => c.label)).toEqual(["Move the Tailspin to-dos from Wed PM to Fri AM", "Confirm next week"]);
    for (const t2 of SUGGEST_TOOLS) expect(TOOLS[t2].kind).toBe("proposal");
    // Only the intent round went to the AI, and it heard only my words.
    expect(s.calls.map((c) => c.schemaName)).toEqual(["assistant_intent"]);
    expect(s.calls[0]!.input).not.toMatch(/Flag stale rows|Data Staleness|Dana/);
    // A tap builds the move with its preview; nothing moves until Confirm, and one Undo puts it back.
    const before = s.calls.length;
    const tap = await s.a.handle(sg.choices[0]!.label, {}, sg.choices[0]!.value);
    expect(s.calls.length).toBe(before);
    expect(tap.proposals).toHaveLength(1);
    const p = tap.proposals[0]!;
    expect(p.preview.rows.map((x) => x.label).sort()).toEqual(["Flag stale rows", "Staleness banner", "Usage export notes"]);
    expect((await s.plan.getPick(t.p1.id))!.date).toBe(NEXT_WED);
    const c = (await s.a.confirm(p.id)) as Extract<ConfirmResult, { ok: true }>;
    expect(c.ok).toBe(true);
    expect((await s.plan.picksFor(NEXT_FRI)).map((x) => x.title).sort()).toEqual(["Flag stale rows", "Staleness banner", "Usage export notes"]);
    expect((await s.a.undo(p.id)).ok).toBe(true);
    expect(await s.plan.picksFor(NEXT_FRI)).toEqual([]);
  });

  it("2. \"What can you help me with here exactly?\": 4 to 6 examples from my own week, each a tap; never the canned paragraph", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "capabilities" });
    const r = await s.a.handle("What can you help me with here exactly?");
    expect(r.reply).toMatch(/^I answer questions about your plan and make changes you confirm/);
    const ex = sections(r).find((x) => x.title === "Try asking")!.lines.map((l) => l.text);
    expect(ex.length).toBeGreaterThanOrEqual(4);
    expect(ex.length).toBeLessThanOrEqual(6);
    // Drawn from my week: my client, my block and day, my item's #id, my promise's person.
    expect(ex).toContain("Move the Tailspin to-dos from Friday AM to Monday AM");
    expect(ex).toContain("Mark #8101 done and comment that it's ready for review");
    expect(ex).toContain("Close the loop with Dana Reyes");
    expect(ex.some((e) => /Tailspin|Wingtip/.test(e))).toBe(true);
    expect(suggest(r)!.choices.map((c) => c.label)).toEqual(ex);
    expectNoLeak(r, s);
    // A tap asks it, as if I'd typed it (the intent round runs on those words).
    s.question({ topic: "promises", lateOnly: true });
    const tap = await s.a.handle(ex.at(-1)!, {}, suggest(r)!.choices.at(-1)!.value);
    expect(s.calls.at(-1)!.input).toContain(ex.at(-1)!);
    expect(tap.status).toBe("ok");
  });

  it("3. \"Can't you read that the Feature name they're under is data staleness?\" resolves the feature against the previous request", async () => {
    const s = setup();
    const t = await s.seed();
    // The earlier request didn't name the feature by its title, so nothing matched.
    s.action(["move_plan"], {}, call(["move_plan", { fromDate: null, fromHalf: null, toDate: NEXT_FRI, toHalf: "AM", which: "named" }]), say("I couldn't tell which to-dos those are."));
    const first = await s.a.handle("Move the stale data stories to Friday AM next week");
    expect(first.proposals).toEqual([]);
    // The follow-up: the intent round hears the earlier words (client names and ids hidden) and says it's a follow-up.
    s.action(["move_plan"], { followUp: true }, call(["move_plan", { fromDate: null, fromHalf: null, toDate: NEXT_FRI, toHalf: "AM", which: "named" }]), say("Here's the move to confirm."));
    const r = await s.a.handle("Can't you read that the Feature name they're under is data staleness?");
    const intent = s.calls.filter((c) => c.schemaName === "assistant_intent").at(-1)!;
    expect(intent.input).toContain("Earlier in this conversation I asked: Move the stale data stories to Friday AM next week");
    expect(r.proposals).toHaveLength(1);
    const p = r.proposals[0]!;
    expect(p.clientKey).toBe(Tailspin);
    expect(p.preview.rows.map((x) => x.label).sort()).toEqual(["Flag stale rows", "Flag stale rows draft", "Staleness banner"]);
    expect((await s.a.confirm(p.id)).ok).toBe(true);
    expect((await s.plan.getPick(t.p3.id))!.date).toBe(NEXT_WED);
    expect((await s.a.undo(p.id)).ok).toBe(true);
  });

  it("3b. as a question: the follow-up names the feature from the last answer and gets its card and my to-dos under it", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "agenda", period: "day", date: NEXT_WED });
    const first = await s.a.handle("What's on my Wednesday next week?");
    expect(lines(first).some((l) => l.includes("Flag stale rows (#8101)"))).toBe(true);
    s.question({ topic: "items" }, { followUp: true });
    const r = await s.a.handle("Can't you read that the Feature name they're under is data staleness?");
    expect(r.reply).toBe("#8100 Data Staleness: 2 open children, 3 of your to-dos under it.");
    expect(r.cards[0]).toMatchObject({ kind: "item", id: 8100, clientKey: Tailspin });
    expect(sections(r).find((x) => x.title === "Your to-dos under it")!.lines.map((l) => l.text)).toEqual(expect.arrayContaining(["Wed PM: Flag stale rows", "Wed PM: Staleness banner"]));
    expectNoLeak(r, s);
  });

  it("4. \"Move the Data Staleness items to Friday AM\": AS-2's move, one Confirm, one Undo", async () => {
    const s = setup();
    const t = await s.seed();
    s.action(["move_plan"], {}, call(["move_plan", { fromDate: null, fromHalf: null, toDate: NEXT_FRI, toHalf: "AM", which: "named" }]), say("Here's the move."));
    const r = await s.a.handle("Move the Data Staleness items to Friday AM");
    const p = r.proposals[0]!;
    expect(p.clientKey).toBe(Tailspin);
    expect(p.preview.rows.map((x) => x.label).sort()).toEqual(["Flag stale rows", "Flag stale rows draft", "Staleness banner"]);
    expect(s.ran.filter((x) => x.action === "pick.move")).toEqual([]);
    expect((await s.a.confirm(p.id)).ok).toBe(true);
    expect((await s.plan.picksFor(NEXT_FRI)).map((x) => x.title)).toContain("Flag stale rows");
    expect((await s.plan.getPick(t.p3.id))!.date).toBe(NEXT_WED);
    expect((await s.a.undo(p.id))).toMatchObject({ ok: true });
  });

  it("5. \"Move all the items I have on my Wednesday PM block to Friday AM\": only that block's to-dos, mine only", async () => {
    const s = setup();
    const t = await s.seed();
    s.action(["move_plan"], {}, call(["move_plan", { fromDate: NEXT_WED, fromHalf: "PM", toDate: NEXT_FRI, toHalf: "AM", which: "all" }]), say("Here's the move."));
    const r = await s.a.handle("Move all the items I have on my Wednesday PM block to Friday AM");
    const p = r.proposals[0]!;
    expect(p.preview.rows.map((x) => x.label).sort()).toEqual(["Flag stale rows", "Staleness banner", "Usage export notes"]);
    expect(shown(r)).not.toMatch(/Initech/);
    expect((await s.a.confirm(p.id)).ok).toBe(true);
    expect((await s.plan.getPick(t.p4.id))!.date).toBe(NEXT_WED);
    expect((await s.plan.getPick(t.ini1.id))!.date).toBe(NEXT_WED);
    expect(await s.a.undo(p.id)).toMatchObject({ ok: true, notBack: [] });
  });

  it("6. \"Mark the user story for Flag stale rows as complete and add a comment\": one card, two parts on one Confirm", async () => {
    const s = setup();
    await s.seed();
    s.action(["item_update"], {}, call(["item_update", { itemId: 8101, done: true, comment: "The flags are live.", target: null }]), say("Here's the update to confirm."));
    const r = await s.a.handle("Mark the user story for Flag stale rows as complete and add a comment that the flags are live");
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.preview.rows).toEqual(expect.arrayContaining([{ label: "State", before: "Active", after: "Closed" }, { label: "Comment", before: null, after: "The flags are live." }]));
    expect(s.ran.filter((x) => x.action === "devops.confirm")).toEqual([]);
    const c = (await s.a.confirm(r.proposals[0]!.id)) as Extract<ConfirmResult, { ok: true }>;
    expect(c.parts!.map((x) => x.ok)).toEqual([true, true]);
    expect(c.parts!.every((x) => x.undo?.kind === "devops")).toBe(true);
  });
});

describe("AS-3 golden set: more from the same week", () => {
  it("\"What's on my plate tomorrow?\": tomorrow's blocks and to-dos", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "agenda", period: "tomorrow" });
    const r = await s.a.handle("What's on my plate tomorrow?");
    expect(r.reply).toBe("Tomorrow (Fri, Nov 6): 0 blocks, 1 to-do planned.");
    expect(lines(r)).toContain("AM: Flag stale rows draft (#8101) · Tailspin");
    expectGrounded(r);
    expectNoLeak(r, s);
  });

  it("\"Which promises are late?\": only late ones, mine, by client", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "promises", lateOnly: true });
    const r = await s.a.handle("Which promises are late?");
    expect(r.reply).toBe("1 promise is late.");
    expect(sections(r)).toEqual([{ kind: "section", title: "Tailspin", lines: [{ text: "Late, to Dana Reyes: Send the row counts (was due Nov 3)", link: { label: "Open the promise", href: "#/inbox/item/chatPromise:41" } }] }]);
    expectNoLeak(r, s);
  });

  it("\"What's not ready for the Wingtip work next week?\": Wingtip only, the gaps of work dated then", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "readiness", period: "next_week" });
    const r = await s.a.handle("What's not ready for the Wingtip work next week?");
    expect(r.reply).toBe("1 item isn't ready for next week (Mon, Nov 9 to Fri, Nov 13).");
    expect(lines(r)).toEqual(["#9100 Claims intake: unassigned (target Nov 11)"]);
    expect(shown(r)).not.toMatch(/Tailspin|8200/);
    expectNoLeak(r, s);
  });

  it("\"Do I have any deployments this weekend?\": the deployment and its after-hours time", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "deployments", period: "weekend" });
    const r = await s.a.handle("Do I have any deployments this weekend?");
    expect(r.reply).toBe("1 deployment this weekend (Sat, Nov 7 and Sun, Nov 8), about 2h after hours in all.");
    expect(lines(r)).toEqual(["Sat evening: Deployment 9:00–11:00, Claims release"]);
    expectNoLeak(r, s);
  });

  it("\"Which features still need an update for Monday?\": features with no comment in the report's window, mine only", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "status_updates" });
    const r = await s.a.handle("Which features still need an update for Monday?");
    expect(r.reply).toBe("2 features have no update yet for Status report · for Monday, Nov 9.");
    expect(sections(r).map((x) => [x.title, x.lines.map((l) => l.text)])).toEqual([["Tailspin", ["#8100 Data Staleness"]], ["Wingtip", ["#9100 Claims intake"]]]);
    expectNoLeak(r, s);
  });

  it("\"What did I get done this week for Tailspin?\": Tailspin's done to-dos only", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "done" });
    const r = await s.a.handle("What did I get done this week for Tailspin?");
    expect(r.reply).toBe("1 to-do done this week (Mon, Nov 2 to Fri, Nov 6) for Tailspin.");
    expect(lines(r)).toEqual(["Done: Mon AM: Ingest alert email (#8301)"]);
    expect(shown(r)).not.toMatch(/Claims walkthrough/);
  });

  it("\"What am I waiting on?\" and \"Any client calls to review?\": mine only", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "waiting" });
    const w = await s.a.handle("What am I waiting on?");
    expect(lines(w)).toEqual(["Dana Reyes: Send the sample extract (was due Nov 4)"]);
    expectNoLeak(w, s);
    s.question({ topic: "calls" });
    const c = await s.a.handle("Any client calls to review?");
    expect(lines(c)).toEqual(["Tailspin weekly status on Nov 5: proposals to review"]);
    expectNoLeak(c, s);
  });

  it("a general question about one client sends only that client's context, quoted, and links only its items", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "general", period: "next_week" }, {}, { ok: true, text: JSON.stringify({ reply: "Claims intake (#9100) is due Nov 11 and has no owner yet. #7100 too.", itemIds: [9100, 7100] }), usage, model: "test-model" });
    const r = await s.a.handle("How is the Wingtip claims work looking next week?");
    const q = s.calls.find((c) => c.schemaName === "assistant_question")!;
    expect(q.input).toContain('"title":{"quoted":"Claims intake"}');
    expect(q.input).not.toMatch(/Tailspin|Data Staleness|Initech/);
    // The model's #7100 is in no context of mine: no card for it.
    expect(r.cards.filter((c) => c.kind === "item").map((c) => (c as { id: number }).id)).toEqual([9100]);
    expect(s.log.filter((e) => e.task === "assistant.question").every((e) => e.clientKey === QD)).toBe(true);
  });

  it("a general question across clients asks which client first, with choices from my own clients", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "general", period: "next_week" });
    const r = await s.a.handle("How is next week looking for the main feature?");
    const q = r.cards.find((c) => c.kind === "question") as Extract<Card, { kind: "question" }>;
    expect(q.text).toBe("Which client is that about?");
    expect(q.choices.map((c) => c.label)).toEqual(["Tailspin", "Wingtip"]);
    expect(s.calls.filter((c) => c.schemaName === "assistant_question")).toEqual([]);
  });

  it("a feature name in two clients is a question with choices, never a guess", async () => {
    const s = setup();
    await s.seed();
    s.env.run = ((orig) => async (action: ActionName, input: unknown) => {
      const r = await orig(action, input);
      if (action !== "ahead.load" || !r.ok) return r;
      const d = r.data as ReturnType<typeof anAheadLoad>;
      return { ok: true, data: { ...d, clients: d.clients.map((c) => (c.clientKey === QD ? { ...c, items: [...c.items, anAheadItem({ id: 9200, title: "Data Staleness", type: "Feature" })] } : c)) } };
    })(s.env.run);
    const a2 = createAssistant(s.env);
    s.question({ topic: "items" });
    const r = await a2.handle("What's under the Data Staleness feature?");
    const q = r.cards.find((c) => c.kind === "question") as Extract<Card, { kind: "question" }>;
    // AS-2's pattern: which client first (names and counts only), before anything goes to the AI.
    expect(q.text).toBe("That matches more than one client. Which one?");
    expect(q.choices.map((c) => c.label)).toEqual(["Tailspin · 3 to-dos", "Wingtip · 1 item"]);
    expect(s.calls.filter((c) => c.schemaName === "assistant_intent")).toEqual([]);
    // Choosing answers it: Wingtip's feature only.
    const r2 = await a2.handle("Wingtip · 1 item", {}, q.choices[1]!.value);
    expect(r2.cards[0]).toMatchObject({ kind: "item", id: 9200, clientKey: QD });
  });
});

describe("AS-3 rules", () => {
  it("AI off: one line and the command menu, never the canned paragraph", async () => {
    const s = setup({ rules: { on: false } });
    await s.seed();
    s.question({ topic: "plan_check", period: "next_week" });
    const r = await s.a.handle("I'm planning next week. What should I look out for?");
    expect(r.status).toBe("off");
    expect(r.reply.split("\n")).toHaveLength(1);
    expect(r.reply).not.toMatch(CANNED);
    expect(r.links).toEqual([{ label: "Open the command menu", href: "#/commands" }]);
    const none = setup({ noAi: true });
    const r2 = await none.a.handle("What can you help me with here exactly?");
    expect(r2).toMatchObject({ status: "not_set_up", links: [{ href: "#/commands" }] });
    expect(r2.reply).not.toMatch(CANNED);
  });

  it("a request no tool does is answered as a question, never with the canned paragraph", async () => {
    const s = setup();
    await s.seed();
    s.action([], {}, { ok: true, text: JSON.stringify({ reply: "I don't know that from your plan.", itemIds: [] }), usage, model: "test-model" });
    const r = await s.a.handle("Is the Tailspin thing fine?");
    expect(r.reply).toBe("I don't know that from your plan.");
    expect(s.calls.map((c) => c.schemaName)).toEqual(["assistant_intent", "assistant_question"]);
  });

  it("the conversation memory is mine, kept on the answer's turn, and gone after 2 hours", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "agenda", period: "day", date: NEXT_WED });
    await s.a.handle("What's on my Wednesday next week?");
    const open = await s.plan.assistantQuestion();
    expect(open!.pending).toMatchObject({ kind: "context", memory: { request: "What's on my Wednesday next week?", topic: "agenda" } });
    expect(Temporal.Instant.from((open!.pending as { memory: { expiresAt: string } }).memory.expiresAt).since(NOW).total("minutes")).toBe(120);
    expect(await s.plan.clearAssistant()).toBeGreaterThan(0);
    expect(await s.plan.assistantQuestion()).toBeNull();
  });

  it("an answer's suggestions only ever build allowlisted proposals; a stale tap builds nothing", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "plan_check", period: "next_week" });
    const r = await s.a.handle("I'm planning next week. What should I look out for?");
    const sg = suggest(r)!;
    const confirm = sg.choices.find((c) => c.label === "Confirm next week")!;
    const p = await s.a.handle(confirm.label, {}, confirm.value);
    expect(p.proposals[0]).toMatchObject({ action: "weekplan.commit" });
    expect(s.ran.filter((x) => x.action === "weekplan.commit")).toEqual([]);
    // The same tap again: that answer's turn is no longer the newest, so it's a fresh request.
    s.action([], {}, say("ok"));
    const again = await s.a.handle(confirm.label, {}, confirm.value);
    expect(again.proposals).toEqual([]);
  });

  it("the Teams bot gets the same answer: sections as cards, suggestions as buttons", async () => {
    const s = setup({ channel: "teams" });
    await s.seed();
    s.question({ topic: "plan_check", period: "next_week" });
    // The Teams adapter calls handle({ person, text, ... }); the service here takes (text, context, answer).
    const svc = { handle: (i: { text: string; answer?: string }) => s.a.handle(i.text, {}, i.answer), confirm: async () => ({ ok: false, reason: "gone", message: "" }), cancel: async () => ({ ok: true }), propose: async () => ({ ok: false, message: "" }) };
    const r = await teamsAssistant(svc as never, "https://focustime.example.com").handle({ person: { userId: "u" }, channel: "teams", text: "I'm planning next week. What should I look out for?", context: { surface: "teams", conversation: "personal", locale: null, timeZone: null } });
    expect(r.reply).toMatch(/^For next week/);
    expect(r.cards.map((c) => c.title)).toEqual(["Your days", "Tailspin", "Wingtip"]);
    expect(r.cards[1]!.lines).toContain("Late promise to Dana Reyes: Send the row counts (was due Nov 3)");
    expect(r.cards[1]!.links!.every((l) => l.url.startsWith("https://focustime.example.com/#/"))).toBe(true);
    expect(r.question).toMatchObject({ suggest: true, choices: [{ label: "Move the Tailspin to-dos from Wed PM to Fri AM" }, { label: "Confirm next week" }] });
    expect(JSON.stringify(r)).not.toMatch(/Initech/);
  });
});
