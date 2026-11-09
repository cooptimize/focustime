// AS-3: the assistant answers real questions. A golden set (the six from the brief, Nov 7, and more from the same week) on
// test/builders/assistant-world.ts's fake data. assistant/parity.test.ts runs the same set through Teams. Each case
// checks the path (answer, action or choices), what the context held (and never Initech), and that the reply links
// real items and suggests only allowlisted proposals. Requests 4 to 6 still go through AS-2's actions with one
// Confirm and one Undo; AI off is one line and the command menu; the Teams bot gives the same answer with buttons.
import { describe, expect, it } from "vitest";
import type { ProviderReply } from "../ai/types.ts";
import type { ActionName } from "../actions/registry.ts";
import { anAheadItem, anAheadLoad } from "../test/builders/index.ts";
import { call, CANNED, NEXT_FRI, NEXT_WED, NOW, QD, say, setup, Tailspin, usage } from "../test/builders/assistant-world.ts";
import { renderAnswer } from "../server/teams/render.ts";
import { SUGGEST_TOOLS, TOOLS } from "./allowlist.ts";
import { createAssistant, type AssistantEnv } from "./service.ts";
import { NOT_IN_STANDARDS, retrieveStandards } from "../plan/standards.ts";
import { aStandardsArticle, STD_COMMIT, STD_REPO } from "../test/builders/standards.ts";
import type { Card, ConfirmResult, HandleResult } from "./types.ts";

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
    const r = await s.a.handle("I'm planning next week. What should I look out for?");
    expect(r.reply).toMatch(/^For next week/);
    const t = renderAnswer(r, "https://focustime.example.com");
    const shown2 = JSON.stringify(t.cards);
    for (const x of ["Your days", "Tailspin", "Wingtip", "Late promise to Dana Reyes: Send the row counts (was due Nov 3)"]) expect(shown2).toContain(x);
    expect(shown2).toContain("https://focustime.example.com/#/");
    expect(t.question).toMatchObject({ suggest: true, choices: [{ label: "Move the Tailspin to-dos from Wed PM to Fri AM" }, { label: "Confirm next week" }] });
    expect(JSON.stringify(t)).not.toMatch(/Initech/);
  });
});


describe("Ask about the standards (KB-1)", () => {
  const articles = [
    aStandardsArticle({ title: "Gold Fact Tables", layer: "gold", artifact: "fact_table", path: "SQL/Gold/Fact Tables.md", body: "# Gold Fact Tables\n\n- Use `fact` and PascalCase table and column names." }),
    aStandardsArticle({ title: "Power BI DAX", domain: "powerbi", layer: "semantic_model", artifact: "dax_expression", technology: "power_bi", path: "Power BI/DAX.md", body: "- Use DIVIDE instead of the division operator." }),
  ];
  const library = { repo: STD_REPO, commit: STD_COMMIT, articles };
  const standards: AssistantEnv["standards"] = async (q) => ({ library, retrieved: retrieveStandards(articles, { text: [q], dataPlatform: null, sourceSystems: [], question: true }) });
  const reply = (v: object): ProviderReply => ({ ok: true, text: JSON.stringify(v), usage, model: "test-model" });

  it("answers from the matching article: the rule, a quote checked against it, and a link at the synced commit", async () => {
    const s = setup({ standards });
    s.question({ topic: "standards" }, {}, reply({ found: true, article_title: "Gold Fact Tables", answer: "Use the fact schema with PascalCase names.", quote: "Use fact and PascalCase table and column names." }));
    const r = await s.a.handle("What's our standard for fact table naming?");
    expect(r.reply).toBe("Use the fact schema with PascalCase names.");
    const line = sections(r)[0]!.lines[0]!;
    expect(line.text).toContain("PascalCase");
    expect(line.link?.href).toBe(`https://github.com/contoso/standards/blob/${STD_COMMIT}/SQL/Gold/Fact%20Tables.md`);
    const c = s.calls.find((x) => x.schemaName === "assistant_standards")!;
    expect(c.input).toContain("Gold Fact Tables");
    expect(c.input).not.toContain("Power BI DAX");
    expectNoLeak(r, s);
  });

  it("says Not in the standards when no article matches, without asking the AI", async () => {
    const s = setup({ standards });
    s.question({ topic: "standards" });
    const r = await s.a.handle("What's our standard for expense reports?");
    expect(r.reply).toBe(NOT_IN_STANDARDS);
    expect(s.calls.some((x) => x.schemaName === "assistant_standards")).toBe(false);
  });

  it("says Not in the standards when the model finds no answer or quotes something that isn't there", async () => {
    const s = setup({ standards });
    s.question({ topic: "standards" }, {}, reply({ found: false, article_title: null, answer: "", quote: "" }));
    expect((await s.a.handle("What's our standard for fact table colors?")).reply).toBe(NOT_IN_STANDARDS);
    s.question({ topic: "standards" }, {}, reply({ found: true, article_title: "Gold Fact Tables", answer: "Use snake_case.", quote: "Always use snake_case for facts." }));
    expect((await s.a.handle("What's our standard for fact table naming?")).reply).toBe(NOT_IN_STANDARDS);
  });

  it("says when the standards haven't been read yet instead of guessing", async () => {
    const s = setup({ standards: async () => null });
    s.question({ topic: "standards" });
    expect((await s.a.handle("What's our standard for fact table naming?")).reply).toMatch(/haven't been read yet/);
  });
});
