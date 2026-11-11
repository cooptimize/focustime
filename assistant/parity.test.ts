// TB-3: the rule that keeps the Teams bot and Ask the same. Every golden question (AS-3) and every action (AS-1, AS-2)
// runs twice on fresh copies of one fake world: through the panel's entry point and through the real Teams bot core
// (fake activities, fake sender, a real card store). Both must get the same result from the Assistant, Teams must draw
// all of it as cards, and Confirm must make the same writes. A topic, a tool or a card kind with no case here fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLS, TOOL_NAMES, type ToolName } from "./allowlist.ts";
import { TOPICS, type Topic } from "./answer.ts";
import type { Assistant, Card, HandleResult } from "./types.ts";
import { retrieveStandards } from "../plan/standards.ts";
import { aStandardsArticle, STD_COMMIT, STD_REPO } from "../test/builders/standards.ts";
import { call, NEXT_FRI, NEXT_WED, NOW, QD, say, setup, Tailspin, usage } from "../test/builders/assistant-world.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { createTeamsBotStore } from "../store/teams-bot-store.ts";
import { teamsAssistant } from "../server/teams/assistant.ts";
import { createBotCore, type InActivity, type OutActivity } from "../server/teams/bot.ts";
import { MAX_MESSAGE_BYTES, renderAnswer, renderCard } from "../server/teams/render.ts";
import { MAX_PREVIEW_ROWS, proposalCard, tapOf } from "../server/teams/cards.ts";

const URL_ = "https://focustime.example.com";
const TENANT = "abf29d42-0000-0000-0000-000000000001";
const ME = "aaaaaaaa-0000-0000-0000-00000000000a";

type World = ReturnType<typeof setup>;
type Seed = Awaited<ReturnType<World["seed"]>>;
type Case = { name: string; text: string; covers: Topic | ToolName; prep?: (s: World, t: Seed) => Promise<unknown>; script: (s: World, t: Seed) => void; world?: Parameters<typeof setup>[0]; /** An earlier turn in the same conversation. */ first?: { text: string; script: (s: World) => void }; /** Tap this choice of the question, then compare again. */ choose?: { index: number; script?: (s: World) => void }; /** The answer is words only: nothing to preview. */ noProposal?: true; propose?: (t: Seed) => { tool: string; args: Record<string, unknown> } };

const reply = (v: object) => ({ ok: true as const, text: JSON.stringify(v), usage, model: "test-model" });
const later = (o: object) => reply({ reply: "Tailspin looks fine.", itemIds: [], ...o });
const articles = [aStandardsArticle({ title: "Gold Fact Tables", layer: "gold", artifact: "fact_table", path: "SQL/Gold/Fact Tables.md", body: "- Use `fact` and PascalCase table and column names." })];
const standards = async (q: string) => ({ library: { repo: STD_REPO, commit: STD_COMMIT, articles }, retrieved: retrieveStandards(articles, { text: [q], dataPlatform: null, sourceSystems: [], question: true }) });

const WED = NEXT_WED, FRI = NEXT_FRI, TODAY = "2026-11-05";
const todayPicks = async (s: World) => {
  await s.plan.addPick({ date: TODAY, half: "AM", clientKey: QD, kind: "intention", title: "Export spec", size: "M" });
  await s.plan.addPick({ date: TODAY, half: "PM", clientKey: Tailspin, kind: "intention", title: "Ledger review", size: "S" });
};
const inboxThen = (next: (s: World) => unknown[]) => (s: World) => next(s);

/** The golden questions, one per topic and more, and one request per tool. */
const CASES: Case[] = [
  // AS-3: the golden questions.
  { covers: "plan_check", name: "planning next week", text: "I'm planning next week. What should I look out for?", script: (s) => s.question({ topic: "plan_check", period: "next_week" }) },
  { covers: "capabilities", name: "what can you help with", text: "What can you help me with here exactly?", script: (s) => s.question({ topic: "capabilities" }) },
  { covers: "agenda", name: "my plate tomorrow", text: "What's on my plate tomorrow?", script: (s) => s.question({ topic: "agenda", period: "tomorrow" }) },
  { covers: "promises", name: "late promises", text: "Which promises are late?", script: (s) => s.question({ topic: "promises", lateOnly: true }) },
  { covers: "waiting", name: "waiting on", text: "What am I waiting on?", script: (s) => s.question({ topic: "waiting" }) },
  { covers: "readiness", name: "not ready", text: "What's not ready for the Wingtip work next week?", script: (s) => s.question({ topic: "readiness", period: "next_week" }) },
  { covers: "deployments", name: "deployments this weekend", text: "Do I have any deployments this weekend?", script: (s) => s.question({ topic: "deployments", period: "weekend" }) },
  { covers: "status_updates", name: "updates for Monday", text: "Which features still need an update for Monday?", script: (s) => s.question({ topic: "status_updates" }) },
  { covers: "done", name: "done this week", text: "What did I get done this week for Tailspin?", script: (s) => s.question({ topic: "done" }) },
  { covers: "calls", name: "client calls", text: "Any client calls to review?", script: (s) => s.question({ topic: "calls" }) },
  { covers: "items", name: "under a feature", text: "What's under the Data Staleness feature?", script: (s) => s.question({ topic: "items" }) },
  { covers: "general", name: "a general question", text: "How is the Tailspin work looking next week?", script: (s) => s.question({ topic: "general", period: "next_week" }, {}, later({})) },
  { covers: "general", name: "general across clients asks which", text: "How is next week looking for the main feature?", script: (s) => s.question({ topic: "general", period: "next_week" }) },
  { covers: "standards", name: "the standards", text: "What's our standard for fact table naming?", script: (s) => s.question({ topic: "standards" }, {}, reply({ found: true, article_title: "Gold Fact Tables", answer: "Use the fact schema with PascalCase names.", quote: "Use fact and PascalCase table and column names." })) },
  // AS-1: reads.
  { covers: "today", name: "what's next", text: "What's next?", script: (s) => s.action(["today"], {}, call(["today", { when: "now" }]), say("Here's what's next.")) },
  { covers: "day", name: "a day", text: "What's planned on Wednesday next week?", script: (s) => s.action(["day"], {}, call(["day", { date: WED }]), say("Here's that day.")) },
  { covers: "item", name: "an item", text: "What's the state of #8100?", script: (s) => s.action(["item"], {}, call(["item", { id: 8100 }]), say("Here it is.")) },
  { covers: "gaps", name: "gaps", text: "What's missing on Tailspin's features?", script: (s) => s.action(["gaps"], {}, call(["gaps", {}]), say("Here are the gaps.")) },
  { covers: "commitments", name: "commitments", text: "What did people commit to on Tailspin?", script: (s) => s.action(["commitments"], {}, call(["commitments", { person: null }]), say("Here's what they said.")) },
  { covers: "status", name: "the status report", text: "Write my status updates", script: (s) => s.action(["status"], {}, call(["status", {}]), say("Here's the report.")) },
  { covers: "sends", name: "sends", text: "What's the state of my sends?", script: (s) => s.action(["sends"], {}, call(["sends", {}]), say("Here are your sends.")) },
  { covers: "inbox", name: "the inbox", text: "What needs me?", script: (s) => s.action(["inbox"], {}, call(["inbox", { view: "promises" }]), say("Here's your Inbox.")) },
  { covers: "link_search", name: "link search", text: "Which Tailspin item should my promise link to?", script: inboxThen((s) => s.action(["inbox", "link_search"], {}, call(["inbox", { view: "promises" }]), call(["link_search", { conversationId: null, promiseId: 41, query: "stale" }]), say("Here are the items."))) },
  { covers: "close_loop", name: "close the loop", text: "Close the loop with Dana", script: (s) => s.action(["close_loop"], {}, call(["close_loop", { who: "Dana", about: null }]), say("Here's the draft.")) },
  // AS-1, AS-2: every change, previewed and confirmed.
  { covers: "move_pick", name: "move a to-do", text: "Move Staleness banner to Friday morning", script: (s, t) => s.action(["move_pick"], {}, call(["move_pick", { pickId: t.p2.id, date: FRI, half: "AM" }]), say("Here's the move.")) },
  { covers: "drop_pick", name: "drop a to-do", text: "Drop Staleness banner", script: (s, t) => s.action(["drop_pick"], {}, call(["drop_pick", { pickId: t.p2.id }]), say("Here's the drop.")) },
  { covers: "keep_pick", name: "keep a to-do", text: "Keep Ingest alert email this afternoon", prep: (s, t) => s.plan.setDone(t.d1.id, false), script: (s, t) => s.action(["keep_pick"], {}, call(["keep_pick", { pickId: t.d1.id, half: "PM" }]), say("Here it is.")) },
  { covers: "add_to_week", name: "add to the week", text: "Add #8200 to this week", script: (s) => s.action(["add_to_week"], {}, call(["add_to_week", { itemId: 8200, weekStart: null }]), say("Here it is.")) },
  { covers: "ahead_change", name: "a target date", text: "Set the target date of #8200 to 2026-12-01", script: (s) => s.action(["ahead_change"], {}, call(["ahead_change", { itemId: 8200, field: "target", value: "2026-12-01" }]), say("Here it is.")) },
  { covers: "send", name: "a send", text: "Send #8200 to Dana for next week", script: (s) => s.action(["send"], {}, call(["send", { itemId: 8200, to: "Dana", kind: "suggested", week: "next", note: null }]), say("Here it is.")) },
  { covers: "comment", name: "a comment", text: "Comment on #8101 that the export is ready", script: (s) => s.action(["comment"], {}, call(["comment", { itemId: 8101, text: "The export is ready." }]), say("Here it is.")) },
  { covers: "description", name: "a description", text: "Rewrite the description of #8101 to say it covers PDF too", script: (s) => s.action(["description"], {}, call(["description", { itemId: 8101, after: "Covers PDF too." }]), say("Here it is.")) },
  { covers: "move_picks", name: "several to-dos", text: "Move Staleness banner and Flag stale rows to Friday morning", script: (s, t) => s.action(["move_picks"], {}, call(["move_picks", { moves: [{ pickId: t.p1.id, date: FRI, half: "AM" }, { pickId: t.p2.id, date: FRI, half: "AM" }] }]), say("Here it is.")) },
  { covers: "close_day", name: "close out", text: "Close out my day", script: (s) => s.action(["close_day"], {}, call(["close_day", { date: "2026-11-05", donePickIds: [] }]), say("Here it is.")) },
  { covers: "capture", name: "a capture", text: "Remember to check the nightly job", script: (s) => s.action(["capture"], {}, call(["capture", { text: "check the nightly job", as: "sort_later" }]), say("Here it is.")) },
  { covers: "move_plan", name: "a move by day", text: "Move all the items I have on my Wednesday PM block to Friday AM", script: (s) => s.action(["move_plan"], {}, call(["move_plan", { fromDate: WED, fromHalf: "PM", toDate: FRI, toHalf: "AM", which: "all" }]), say("Here's the move.")) },
  { covers: "item_update", name: "a compound update", text: "Mark #8101 as complete and add a comment that the flags are live", script: (s) => s.action(["item_update"], {}, call(["item_update", { itemId: 8101, done: true, comment: "The flags are live.", target: null }]), say("Here it is.")) },
  { covers: "unlink", name: "unlink", text: "Take the link off my Tailspin promise to Dana", script: inboxThen((s) => s.action(["inbox", "unlink"], {}, call(["inbox", { view: "in_progress" }]), call(["unlink", { conversationId: null, promiseId: 42 }]), say("Here it is."))) },
  { covers: "link_comment", name: "a linked comment", text: "Comment on #8101 from my Tailspin promise with the chat link", script: inboxThen((s) => s.action(["inbox", "link_comment"], {}, call(["inbox", { view: "in_progress" }]), call(["link_comment", { conversationId: null, promiseId: 42, itemId: 8101, text: null }]), say("Here it is."))) },
  { covers: "inbox_seen", name: "mark seen", text: "I've seen my promises", script: inboxThen((s) => s.action(["inbox", "inbox_seen"], {}, call(["inbox", { view: "promises" }]), call(["inbox_seen", { keys: ["chatPromise:41"] }]), say("Here it is."))) },
  { covers: "snooze", name: "snooze", text: "Snooze that promise until tomorrow", script: inboxThen((s) => s.action(["inbox", "snooze"], {}, call(["inbox", { view: "promises" }]), call(["snooze", { key: "chatPromise:41", until: "tomorrow" }]), say("Here it is."))) },
  { covers: "conversation_owner", name: "taking a conversation", text: "I'll take that Tailspin conversation", script: inboxThen((s) => s.action(["inbox", "conversation_owner"], {}, call(["inbox", { view: "needs_you" }]), call(["conversation_owner", { conversationId: 41, change: "claim", person: null }]), say("Here it is."))) },
  { covers: "plan_deployment", name: "a deployment", text: "Plan a Tailspin deployment Saturday nine to eleven", script: (s) => s.action(["plan_deployment"], {}, call(["plan_deployment", { date: "2026-11-14", start: "09:00", end: "11:00", title: null, note: null, items: [], itemIds: [] }]), say("Here it is.")) },
  // A multi-action request.
  { covers: "comment", name: "two changes in one request", text: "Comment on #8101 that it's ready and move #8102's target", script: (s) => s.action(["comment", "ahead_change"], {}, call(["comment", { itemId: 8101, text: "Ready." }], ["ahead_change", { itemId: 8102, field: "target", value: "2026-12-01" }]), say("Here they are.")) },
  // The rest of the golden set.
  { covers: "move_plan", name: "golden 4, a move by feature", text: "Move the Data Staleness items to Friday AM", script: (s) => s.action(["move_plan"], {}, call(["move_plan", { fromDate: null, fromHalf: null, toDate: FRI, toHalf: "AM", which: "named" }]), say("Here's the move.")) },
  { covers: "item_update", name: "golden 6, one card and two parts", text: "Mark the user story for Flag stale rows as complete and add a comment that the flags are live", script: (s) => s.action(["item_update"], {}, call(["item_update", { itemId: 8101, done: true, comment: "The flags are live.", target: null }]), say("Here's the update to confirm.")) },
  { covers: "general", name: "a general question on one client", text: "How is the Wingtip claims work looking next week?", script: (s) => s.question({ topic: "general", period: "next_week" }, {}, reply({ reply: "Claims intake (#9100) is due Nov 11 and has no owner yet.", itemIds: [9100] })) },
  { covers: "general", name: "no tool does it", text: "Is the Tailspin thing fine?", script: (s) => s.action([], {}, reply({ reply: "I don't know that from your plan.", itemIds: [] })) },
  { covers: "standards", name: "not in the standards", text: "What's our standard for expense reports?", script: (s) => s.question({ topic: "standards" }) },
  { covers: "standards", name: "the model finds nothing", text: "What's our standard for fact table colors?", script: (s) => s.question({ topic: "standards" }, {}, reply({ found: false, article_title: null, answer: "", quote: "" })) },
  { covers: "items", name: "golden 3b, a follow-up question", first: { text: "What's on my Wednesday next week?", script: (s) => s.question({ topic: "agenda", period: "day", date: WED }) }, text: "Can't you read that the Feature name they're under is data staleness?", script: (s) => s.question({ topic: "items" }, { followUp: true }) },
  { covers: "move_plan", name: "golden 3, a follow-up move", first: { text: "Move the stale data stories to Friday AM next week", script: (s) => s.action(["move_plan"], {}, call(["move_plan", { fromDate: null, fromHalf: null, toDate: FRI, toHalf: "AM", which: "named" }]), say("I couldn't tell which to-dos those are.")) }, text: "Can't you read that the Feature name they're under is data staleness?", script: (s) => s.action(["move_plan"], { followUp: true }, call(["move_plan", { fromDate: null, fromHalf: null, toDate: FRI, toHalf: "AM", which: "named" }]), say("Here's the move to confirm.")) },
  { covers: "items", name: "a feature in two clients asks, and the tap answers", world: { twin: true }, text: "What's under the Data Staleness feature?", script: (s) => s.question({ topic: "items" }), choose: { index: 1 } },
  // AS-2's flows on this world: choices, across clients, a part failing, the client boundary.
  { covers: "move_plan", name: "AS-2, which to-dos, then a tap", prep: todayPicks, text: "Move some of today's to-dos to next Wednesday", script: (s) => s.action(["move_plan"], {}, call(["move_plan", { fromDate: TODAY, fromHalf: null, toDate: WED, toHalf: null, which: "named" }]), say("Which ones?")), choose: { index: 0 } },
  { covers: "move_plan", name: "AS-2, across clients with one Confirm", prep: todayPicks, text: "Push everything from today to tomorrow.", script: (s) => s.action(["move_plan"], {}, call(["move_plan", { fromDate: TODAY, fromHalf: null, toDate: "2026-11-06", toHalf: null, which: "all" }]), say("Here's the move.")) },
  { covers: "move_plan", name: "AS-2, matches in two clients ask which", world: { twin: true }, prep: (s) => s.plan.addPick({ date: WED, half: "AM", clientKey: QD, kind: "item", itemId: 9201, title: "Twin stale rows", size: "S" }), text: "Move the Data Staleness items to Friday.", script: (s) => s.action(["move_plan"], {}, call(["move_plan", { fromDate: null, fromHalf: null, toDate: FRI, toHalf: null, which: "named" }]), say("Here's the move.")), choose: { index: 0 } },
  { covers: "item_update", name: "AS-2, one part fails and says which", world: { failSecondWrite: true }, text: "Mark #8101 as complete and comment that the flags are live", script: (s) => s.action(["item_update"], {}, call(["item_update", { itemId: 8101, done: true, comment: "The flags are live.", target: null }]), say("Here's the update.")) },
  { covers: "comment", name: "GD-1, a comment naming another client isn't proposed", noProposal: true, text: "Comment on #8101: same fix as Wingtip had", script: (s) => s.action(["comment"], {}, call(["comment", { itemId: 8101, text: "Same fix as Wingtip had." }]), say("I can't name another client there.")) },
  // Button-only proposals (PK-1): the same preview and Confirm.
  { covers: "item_done", name: "a to-do's done state", text: "", script: () => {}, propose: (t) => ({ tool: "item_done", args: { pickId: t.tomorrow.id, state: null } }) },
  { covers: "wrap_up", name: "FN-1, Wrap it up from a Teams card", text: "", script: () => {}, propose: (t) => ({ tool: "wrap_up", args: { pickId: t.tomorrow.id, outcome: "finished", left: null, comment: null } }) },
  { covers: "item_undo", name: "a to-do's done state undone", text: "", script: () => {}, propose: (t) => ({ tool: "item_undo", args: { pickId: t.tomorrow.id } }) },
];
/** Covered by the Undo test below: it needs a write made first. */
const COVERED_BELOW: readonly ToolName[] = ["write_undo"];

const READS = new Set(["week.load", "ahead.load", "status.load", "inbox.list", "meeting.mine", "conversations.list", "team.commit", "send.today", "send.people", "devops.preview", "deploy.items", "conversations.search_items", "loop.find", "devops.done_offer", "devops.undo_offer", "wrapup.offer", "wrapup.preview"]);
const writesOf = (s: World) => s.ran.filter((r) => !READS.has(r.action)).map((r) => JSON.parse(JSON.stringify(r).replace(/"previewId":"pv\d+"/g, '"previewId":"pv"')) as unknown);

const world = (o: Parameters<typeof setup>[0]) => setup({ standards, ...o });
const hubOf = (s: World, seen: HandleResult[]): Pick<Assistant, "handle" | "confirm" | "cancel" | "propose" | "undo" | "refresh" | "undoWrite"> => ({
  handle: async (i) => {
    const r = await s.a.handle(i.text, i.context ?? {}, i.answer, i.asked);
    seen.push(r);
    return r;
  },
  confirm: async (i) => s.a.confirm(i.proposalId, i.edits ?? {}),
  cancel: async (i) => s.a.cancel(i.proposalId),
  propose: async (i) => s.a.propose(i.tool, i.args),
  undo: async (i) => s.a.undo(i.proposalId),
  refresh: async (i) => s.a.refresh(i.proposalId),
  undoWrite: async (i) => s.a.undoWrite(i.proposalId, i.writeId),
});

/** The real bot core on a fake Teams, talking to a world. */
function teams(s: World) {
  const db = sqliteDb();
  const seen: HandleResult[] = [];
  const sent: OutActivity[] = [];
  const updates: OutActivity[] = [];
  const pending: Promise<void>[] = [];
  let id = 0;
  const now = () => Temporal.Instant.from(s.env.now());
  const assistant = teamsAssistant(hubOf(s, seen), URL_);
  const ready = addUsers(db.conn, ME);
  const core = createBotCore({
    publicUrl: URL_,
    gate: { tenantId: TENANT, user: async () => ({ id: ME, upn: "sam@cooptimize.example", email: "sam@cooptimize.example", deletedAt: null }), isCooptimizer: async () => true },
    assistant,
    store: (userId) => createTeamsBotStore({ db: db.conn, userId, now }),
    sender: { send: async (_to, a) => (sent.push(a), { id: `m${sent.length}` }), update: async (_to, _id, a) => void updates.push(a) },
    log: () => {},
    now,
    ackAfterMs: 5000,
    confirmWaitMs: 2000,
    background: (p) => void pending.push(p),
    rhythm: null,
  });
  const base = (): InActivity => ({ id: `in-${++id}`, type: "message", text: "", channelId: "msteams", serviceUrl: "https://smba.trafficmanager.net/amer/", conversation: { id: "a:1", conversationType: "personal", tenantId: TENANT }, from: { aadObjectId: ME }, recipient: { id: "28:bot" } });
  const settle = async () => {
    while (pending.length) await pending.shift();
  };
  return {
    seen, sent, updates, assistant, store: createTeamsBotStore({ db: db.conn, userId: ME, now }),
    async say(text: string) {
      await ready;
      await core.activity({ ...base(), text });
      await settle();
    },
    async tap(data: Record<string, unknown>) {
      await ready;
      const verb = data.ft as string;
      const r = await core.activity({ ...base(), type: "invoke", name: "adaptiveCard/action", replyToId: "m1", value: { action: { type: "Action.Execute", verb, data }, trigger: "manual" } });
      await settle();
      return r as { value: unknown };
    },
    cards: () => sent.flatMap((a) => (a.type === "message" ? (a.attachments ?? []).map((x) => (x as { content: unknown }).content) : [])),
    words: () => sent.flatMap((a) => (a.type === "message" && a.text ? [a.text] : [])),
  };
}

const J = (v: unknown) => JSON.stringify(v);
/** Everything the Assistant said must be on a card: a part left out (without a link to it) is a parity failure. */
function expectRendered(r: HandleResult, t: ReturnType<typeof teams>): void {
  const all = J(t.cards());
  if (r.reply && !r.cards.some((c) => c.kind === "question" && c.text === r.reply)) expect(t.words().join(" ")).toContain(r.reply);
  for (const c of r.cards) {
    const need: string[] =
      c.kind === "section" ? [c.title, ...c.lines.map((l) => l.text)]
      : c.kind === "note" ? [c.text]
      : c.kind === "question" || c.kind === "suggest" ? [c.text, ...c.choices.map((x) => x.label)]
      : c.kind === "item" ? [c.title, c.clientName, ...c.children.map((k) => k.title)]
      : c.kind === "block" ? [c.clientName, c.status, ...c.picks.map((p) => p.title)]
      : c.kind === "promise" ? [c.what, c.clientName]
      : [c.title, c.clientName];
    for (const x of need) expect(all, `missing "${x}"`).toContain(J(x).slice(1, -1));
    // Each line's own link, as the panel shows it.
    if (c.kind === "section") for (const l of c.lines) if (l.link) expect(all).toContain(l.link.href.startsWith("#") ? `${URL_}/${l.link.href}` : l.link.href);
  }
  for (const l of r.links) expect(all).toContain(`${URL_}/${l.href}`);
  for (const p of r.proposals) {
    expect(all).toContain(J(p.title).slice(1, -1));
    expect(all).toContain(J(p.whoSees).slice(1, -1));
    expect(all).toContain(J(p.preview.summary).slice(1, -1));
    expect(all).toContain(J(p.preview.target).slice(1, -1));
    if (p.preview.identity) expect(all).toContain(J(p.preview.identity).slice(1, -1));
    for (const row of p.preview.rows) {
      expect(all).toContain(J(row.label).slice(1, -1));
      if (row.after) expect(all).toContain(J(row.after).slice(1, -1));
    }
    expect(all).toContain(`"proposalId":"${p.id}"`);
    expect(all).toContain('"verb":"confirm"');
    expect(all).toContain('"verb":"cancel"');
  }
}

describe("TB-3 parity: the same result and the same writes through Teams", () => {
  it("every Ask topic and every tool has a case, and a new one without a case fails here", () => {
    const covered = new Set(CASES.map((c) => c.covers));
    expect(TOPICS.filter((t) => !covered.has(t))).toEqual([]);
    expect(TOOL_NAMES.filter((t) => !covered.has(t) && !COVERED_BELOW.includes(t))).toEqual([]);
  });

  it("every golden question in the AS-3 tests has a case here", () => {
    const source = readFileSync(new URL("./answers.test.ts", import.meta.url), "utf8");
    const asked = [...source.matchAll(/\.handle\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]!);
    expect(asked.length).toBeGreaterThan(15);
    const here = new Set(CASES.flatMap((c) => [c.text, ...(c.first ? [c.first.text] : [])]));
    expect([...new Set(asked)].filter((q) => !here.has(q))).toEqual([]);
  });

  it.each(CASES)("$covers: $name", async (c) => {
    const web = world({ channel: "panel", ...c.world });
    const wt = await web.seed();
    await c.prep?.(web, wt);
    const bot = world({ channel: "teams", ...c.world });
    const bt = await bot.seed();
    await c.prep?.(bot, bt);
    const t = teams(bot);
    if (c.first) {
      c.first.script(web);
      c.first.script(bot);
      await web.a.handle(c.first.text);
      await t.say(c.first.text);
      t.seen.length = 0;
      t.sent.length = 0;
    }
    c.script(web, wt);
    c.script(bot, bt);

    if (c.propose) {
      const { tool, args } = c.propose(wt);
      const a = await web.a.propose(tool, args);
      const b = await bot.a.propose(tool, args);
      expect(a.ok && b.ok, a.ok ? "" : a.message).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(b.proposal).toEqual(a.proposal);
      const shown = J(proposalCard({ id: String(b.proposal.id), title: b.proposal.title, whoSees: b.proposal.whoSees, changes: b.proposal.preview.rows.map((r) => ({ field: r.label, before: r.before, after: r.after })), expiresAt: b.proposal.expiresAt, system: b.proposal.preview.system }, { publicUrl: URL_ }));
      for (const row of b.proposal.preview.rows) expect(shown).toContain(J(row.label).slice(1, -1));
      return;
    }

    let panel = await web.a.handle(c.text);
    await t.say(c.text);
    let onTeams = t.seen[0];
    expect(onTeams, "the Teams message never reached the Assistant").toBeDefined();
    expect(onTeams).toEqual(panel);
    expectRendered(onTeams!, t);
    if (c.choose) {
      const q = panel.cards.find((x) => x.kind === "question") as Extract<Card, { kind: "question" }>;
      const choice = q.choices[c.choose.index]!;
      c.choose.script?.(web);
      c.choose.script?.(bot);
      panel = await web.a.handle(choice.label, {}, choice.value, q.asked);
      t.sent.length = 0;
      await t.tap({ ft: "answer", questionId: `q${onTeams!.turnId}`, value: choice.value, label: choice.label, asked: q.asked });
      onTeams = t.seen.at(-1);
      expect(onTeams).toEqual(panel);
      expectRendered(onTeams!, t);
    }
    if (!c.noProposal && TOOLS[c.covers as ToolName]?.kind === "proposal") expect(panel.proposals.length, `no proposal was made: ${panel.reply}`).toBeGreaterThan(0);

    // Nothing is written until Confirm, and Confirm writes the same thing.
    expect(writesOf(bot)).toEqual(writesOf(web));
    for (const p of panel.proposals) {
      const a = await web.a.confirm(p.id);
      const shown = J((await t.tap({ ft: "confirm", proposalId: String(p.id) })).value);
      expect(a.ok, a.ok ? "" : a.message).toBe(true);
      for (const words of a.ok ? (a.parts ? a.parts.map((x) => x.message) : [a.message]) : []) expect(shown).toContain(J(words).slice(1, -1));
    }
    expect(writesOf(bot)).toEqual(writesOf(web));
  });

  it("a card kind without a Teams rendering doesn't compile, and each kind draws", () => {
    const link = { label: "Open", href: "#/today" };
    const samples: Record<Card["kind"], Card> = {
      note: { kind: "note", text: "A note", link },
      section: { kind: "section", title: "A section", lines: [{ text: "A line", link }] },
      item: { kind: "item", clientKey: "c", clientName: "C", id: 1, title: "An item", type: "Feature", state: "Active", owner: null, start: null, target: null, children: [], link, devopsUrl: "https://dev.azure.com/contoso/p/_workitems/edit/1" },
      block: { kind: "block", clientKey: "c", clientName: "C", date: "2026-11-05", half: "AM", time: "9:00 to 12:00", status: "0 of 0 done", picks: [], link },
      pick: { kind: "pick", id: 1, clientKey: "c", clientName: "C", title: "A to-do", date: "2026-11-05", half: "AM", time: null, done: false, link },
      send: { kind: "send", id: 1, clientKey: "c", clientName: "C", title: "A send", to: "Dana", from: "Sam", tier: "suggested", weekStart: "2026-11-02", state: "Open", link },
      promise: { kind: "promise", id: 1, clientKey: "c", clientName: "C", who: "You", what: "A promise", toWhom: null, due: null, link },
      question: { kind: "question", text: "Which?", choices: [{ label: "A", value: "a" }], expiresAt: NOW },
      suggest: { kind: "suggest", text: "Try", choices: [{ label: "A", value: "a" }], expiresAt: NOW },
    };
    for (const [kind, c] of Object.entries(samples)) {
      const drawn = renderCard(c, URL_);
      if (kind === "question" || kind === "suggest") expect(drawn).toBeNull();
      else expect(drawn).not.toBeNull();
    }
    // FN-1: an item opens its story card in FocusTime, never DevOps.
    expect(J(renderCard(samples.item, URL_))).toContain("#/item/c/1");
    expect(J(renderCard(samples.item, URL_))).not.toContain("dev.azure.com");
  });
});

describe("TB-3 in Teams: Confirm, Undo, stale cards", () => {
  const moveWed = (s: World) => s.action(["move_plan"], {}, call(["move_plan", { fromDate: WED, fromHalf: "PM", toDate: FRI, toHalf: "AM", which: "all" }]), say("Here's the move."));
  const TEXT = "Move all the items I have on my Wednesday PM block to Friday AM";

  it("preview, Confirm and one Undo for moved to-dos, the same action as the panel", async () => {
    const s = world({ channel: "teams" });
    const seed = await s.seed();
    const t = teams(s);
    moveWed(s);
    await t.say(TEXT);
    const p = t.seen[0]!.proposals[0]!;
    expect((await s.plan.getPick(seed.p1.id))!.date).toBe(WED);
    const done = J((await t.tap({ ft: "confirm", proposalId: String(p.id) })).value);
    expect(done).toContain("Moved 3 to-dos");
    expect(done).toContain('"verb":"undo"');
    expect((await s.plan.picksFor(FRI)).map((x) => x.title).sort()).toEqual(["Flag stale rows", "Staleness banner", "Usage export notes"]);
    const undone = J((await t.tap({ ft: "undo", proposalId: String(p.id) })).value);
    expect(undone).toContain("Undone");
    expect(await s.plan.picksFor(FRI)).toEqual([]);
  });

  it("Undo on a DevOps write is that write's own undo: a preview, then Confirm; only a write of this proposal", async () => {
    const s = world({ channel: "teams" });
    await s.seed();
    const t = teams(s);
    s.action(["comment"], {}, call(["comment", { itemId: 8101, text: "Ready." }]), say("Here it is."));
    await t.say("Comment on #8101 that it's ready");
    const id = String(t.seen[0]!.proposals[0]!.id);
    const done = (await t.tap({ ft: "confirm", proposalId: id })).value;
    const undo = (tapOf(((done as { actions: { data: unknown }[] }).actions).find((a) => (a.data as { ft: string }).ft === "undo")!.data))!;
    expect(undo).toEqual({ ft: "undo", proposalId: id, writeId: 77 });
    const before = writesOf(s).length;
    const preview = (await t.tap({ ...undo })).value as { actions: { data: { proposalId: string; ft: string } }[] };
    expect(J(preview)).toContain("Undo:");
    expect(writesOf(s).length).toBe(before);
    expect(s.ran.at(-1)).toMatchObject({ action: "devops.preview", input: { change: { kind: "undo", writeId: 77 } } });
    const confirm = preview.actions.find((a) => a.data?.ft === "confirm")!.data;
    const undoneCard = J((await t.tap({ ...confirm })).value);
    expect(undoneCard).toContain("Done");
    expect(writesOf(s).length).toBe(before + 1);
    // Undo isn't offered on an undo.
    expect(undoneCard).not.toContain('"verb":"undo"');
    // A write this proposal didn't make is refused.
    expect(await s.a.undoWrite(Number(id), 999)).toMatchObject({ ok: false });
  });

  it("an expired card says so and offers Refresh; Refresh is a new preview that confirms; nothing acts on the old one", async () => {
    const s = world({ channel: "teams" });
    const seed = await s.seed();
    const t = teams(s);
    moveWed(s);
    await t.say(TEXT);
    const id = String(t.seen[0]!.proposals[0]!.id);
    s.setNow("2026-11-05T15:16:00Z");
    const expired = J((await t.tap({ ft: "confirm", proposalId: id })).value);
    expect(expired).toContain("Expired:");
    expect(expired).toContain('"verb":"refresh"');
    expect((await s.plan.getPick(seed.p1.id))!.date).toBe(WED);
    const fresh = J((await t.tap({ ft: "refresh", proposalId: id })).value);
    expect(fresh).toContain("fresh preview");
    expect(fresh).toContain('"verb":"confirm"');
    expect((await s.plan.getPick(seed.p1.id))!.date).toBe(WED);
    expect(J((await t.tap({ ft: "confirm", proposalId: id })).value)).toContain("Moved 3 to-dos");
  });

  it("a card whose target changed since shows the new preview, and that preview confirms (the same id)", async () => {
    const s = world({ channel: "teams" });
    const seed = await s.seed();
    const t = teams(s);
    s.action(["move_pick"], {}, call(["move_pick", { pickId: seed.p2.id, date: FRI, half: "AM" }]), say("Here's the move."));
    await t.say("Move Staleness banner to Friday morning");
    const id = String(t.seen[0]!.proposals[0]!.id);
    await s.plan.move(seed.p2.id, WED, "AM");
    const changed = J((await t.tap({ ft: "confirm", proposalId: id })).value);
    expect(changed).toContain("It changed since");
    expect(changed).toContain('"verb":"confirm"');
    expect(J((await t.tap({ ft: "confirm", proposalId: id })).value)).toContain("Done");
    expect((await s.plan.picksFor(FRI)).map((x) => x.title)).toContain("Staleness banner");
  });

  it("a proposal confirmed in the app says so in Teams and writes nothing more", async () => {
    const s = world({ channel: "teams" });
    await s.seed();
    const t = teams(s);
    moveWed(s);
    await t.say(TEXT);
    const p = t.seen[0]!.proposals[0]!;
    expect((await s.a.confirm(p.id)).ok).toBe(true);
    const n = writesOf(s).length;
    expect(J((await t.tap({ ft: "confirm", proposalId: String(p.id) })).value)).toContain("isn't waiting any more");
    expect(writesOf(s).length).toBe(n);
  });
});

describe("TB-3 choices and follow-ups", () => {
  const twoClients = (s: World) => {
    const orig = s.env.run;
    void orig;
    s.question({ topic: "general", period: "next_week" });
  };

  it("an unclear request shows buttons; a tap answers it; the same words as the panel", async () => {
    const s = world({ channel: "teams" });
    await s.seed();
    const t = teams(s);
    twoClients(s);
    await t.say("How is next week looking for the main feature?");
    const shown = J(t.cards());
    expect(shown).toContain("Which client is that about?");
    expect(shown).toContain('"verb":"answer"');
    const q = t.seen[0]!.cards.find((c) => c.kind === "question") as Extract<Card, { kind: "question" }>;
    s.question({ topic: "general", period: "next_week" }, {}, reply({ reply: "Wingtip looks fine.", itemIds: [] }));
    const tap = await t.tap({ ft: "answer", questionId: `q${t.seen[0]!.turnId}`, value: q.choices[1]!.value, label: q.choices[1]!.label, asked: q.asked });
    expect(J(tap.value)).toContain(`You chose: ${q.choices[1]!.label}`);
    expect(t.words()).toContain("Wingtip looks fine.");
  });

  it("an old card's tap never answers a newer question, and what's open stays open", async () => {
    const s = world({ channel: "teams" });
    await s.seed();
    const t = teams(s);
    twoClients(s);
    await t.say("How is next week looking for the main feature?");
    const first = t.seen[0]!.cards.find((c) => c.kind === "question") as Extract<Card, { kind: "question" }>;
    twoClients(s);
    await t.say("How is next week looking for the other feature?");
    const second = t.seen[1]!.cards.find((c) => c.kind === "question") as Extract<Card, { kind: "question" }>;
    expect(second.asked).not.toBe(first.asked);
    await t.tap({ ft: "answer", questionId: `q${t.seen[0]!.turnId}`, value: first.choices[0]!.value, label: first.choices[0]!.label, asked: first.asked });
    expect(t.words().at(-1)).toContain("isn't open any more");
    expect(t.seen[2]!.proposals).toEqual([]);
    // The newer question still takes its answer.
    s.question({ topic: "general", period: "next_week" }, {}, reply({ reply: "Tailspin looks fine.", itemIds: [] }));
    await t.tap({ ft: "answer", questionId: `q${t.seen[1]!.turnId}`, value: second.choices[0]!.value, label: second.choices[0]!.label, asked: second.asked });
    expect(t.words().at(-1)).toBe("Tailspin looks fine.");
  });

  it("a choice tapped after 10 minutes looks again instead of using the old choices", async () => {
    const s = world({ channel: "teams" });
    await s.seed();
    const t = teams(s);
    twoClients(s);
    await t.say("How is next week looking for the main feature?");
    const q = t.seen[0]!.cards.find((c) => c.kind === "question") as Extract<Card, { kind: "question" }>;
    s.setNow("2026-11-05T15:11:00Z");
    twoClients(s);
    const tap = await t.tap({ ft: "answer", questionId: `q${t.seen[0]!.turnId}`, value: q.choices[0]!.value, label: q.choices[0]!.label, asked: q.asked });
    expect(J(tap.value)).toContain("timed out");
    expect(t.seen[1]!.reply).toContain("That had timed out");
    expect(t.seen[1]!.cards.some((c) => c.kind === "question")).toBe(true);
  });

  it("a question asked in Teams can be followed up in the app, and the other way round (one 2-hour memory)", async () => {
    const s = world({ channel: "teams" });
    await s.seed();
    const t = teams(s);
    // Teams first, then the panel (a service on the same person's store, channel "panel").
    const panel = createPanel(s);
    s.question({ topic: "agenda", period: "day", date: WED });
    await t.say("What's on my Wednesday next week?");
    s.question({ topic: "items" }, { followUp: true });
    const r = await panel.handle("Can't you read that the Feature name they're under is data staleness?");
    expect(s.calls.filter((c) => c.schemaName === "assistant_intent").at(-1)!.input).toContain("Earlier in this conversation I asked: What's on my Wednesday next week?");
    expect(r.cards[0]).toMatchObject({ kind: "item", id: 8100 });
    // The app first, then Teams.
    s.question({ topic: "promises", lateOnly: true });
    await panel.handle("Which promises are late?");
    s.question({ topic: "promises" }, { followUp: true });
    await t.say("and the ones due next week?");
    expect(s.calls.filter((c) => c.schemaName === "assistant_intent").at(-1)!.input).toContain("Earlier in this conversation I asked: Which promises are late?");
    // Past two hours it's gone.
    s.setNow("2026-11-05T17:01:00Z");
    s.question({ topic: "promises" });
    await t.say("and those?");
    expect(s.calls.filter((c) => c.schemaName === "assistant_intent").at(-1)!.input).not.toContain("Earlier in this conversation");
  });

  it("history shows both channels' turns, with app addresses the panel can open", async () => {
    const s = world({ channel: "teams" });
    await s.seed();
    const t = teams(s);
    s.question({ topic: "promises", lateOnly: true });
    await t.say("Which promises are late?");
    const turns = await s.a.history(10);
    expect(turns.map((x) => x.channel)).toEqual(["teams", "teams"]);
    const section = turns[1]!.cards.find((c) => c.kind === "section") as Extract<Card, { kind: "section" }>;
    expect(section.lines[0]!.link!.href).toBe("#/inbox/item/chatPromise:41");
    // Open in FocusTime: an older turn comes back with the newest ones.
    const older = await s.a.history(1, t.seen[0]!.turnId);
    expect(older.map((x) => x.id)).toContain(t.seen[0]!.turnId);
  });
});

/** The panel's service on the same person's store and the same scripted model. */
function createPanel(s: World) {
  return { handle: (text: string) => s.panel.handle(text) };
}

describe("TB-3 limits and AI off", () => {
  it("an answer too big for a card shows the first part and Open in FocusTime, a link to the same answer", () => {
    const line = (i: number) => ({ text: `#${1000 + i} A fairly long title for a feature that needs a good many words to describe it properly`, link: { label: "Open", href: `#/ahead/item/${1000 + i}` } });
    const cards: Card[] = Array.from({ length: 12 }, (_, s) => ({ kind: "section", title: `Client ${s}`, lines: Array.from({ length: 12 }, (_x, i) => line(i)) }));
    const r = renderAnswer({ turnId: 321, reply: "A long one.", cards, links: [] }, URL_);
    expect(r.hidden).toBeGreaterThan(0);
    expect(J(r.cards).length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES + 400);
    expect(J(r.cards.at(-1))).toContain(`${URL_}/#/ask/321`);
    expect(J(r.cards.at(-1))).toContain("Open in FocusTime");
  });

  const big = { id: "9", title: "New description for #1", whoSees: "Everyone", expiresAt: NOW, turnId: 44 };
  it("a DevOps preview that can't be shown in full has no Confirm in Teams; it opens the same proposal in the app", () => {
    const c = J(proposalCard({ ...big, system: "DevOps", changes: [{ field: "Description", before: "x".repeat(9000), after: "y".repeat(9000) }] }, { publicUrl: URL_ }));
    expect(c).not.toContain('"verb":"confirm"');
    expect(c).toContain('"verb":"cancel"');
    expect(c).toContain(`${URL_}/#/ask/44`);
    expect(c).toContain("too long to show in full");
  });
  it("a long move list keeps Confirm and says how many more", () => {
    const n = MAX_PREVIEW_ROWS + 5;
    const c = J(proposalCard({ ...big, system: "FocusTime", changes: Array.from({ length: n }, (_, i) => ({ field: `To-do ${i}`, before: "Wed", after: "Fri" })) }, { publicUrl: URL_ }));
    expect(c).toContain('"verb":"confirm"');
    expect(c).toContain("And 5 more");
    expect(c).toContain(`${URL_}/#/ask/44`);
  });
  it("links go only to FocusTime, DevOps or the standards repo", () => {
    const drawn = J(renderCard({ kind: "section", title: "T", lines: [{ text: "a", link: { label: "x", href: "https://evil.example/" } }, { text: "b", link: { label: "y", href: "https://github.com/contoso/standards/blob/x/a.md" } }] }, URL_));
    expect(drawn).not.toContain("evil.example");
    expect(drawn).toContain("github.com");
  });

  it.each([{ name: "AI off", o: { rules: { on: false } } }, { name: "no provider", o: { noAi: true } }])("$name: the same answer in both, and only the no-AI phrases answer", async ({ o }) => {
    for (const text of ["What's next?", "today", "help", "open FocusTime", "I'm planning next week. What should I look out for?"]) {
      const web = world({ channel: "panel", ...o });
      await web.seed();
      const bot = world({ channel: "teams", ...o });
      await bot.seed();
      const t = teams(bot);
      const panel = await web.a.handle(text);
      await t.say(text);
      expect(t.seen[0]).toEqual(panel);
      if (text.startsWith("I'm")) {
        expect(panel.status === "off" || panel.status === "not_set_up").toBe(true);
        expect(t.words()[0]).toBe(panel.reply);
      } else expect(panel.status).toBe("ok");
    }
  });
});
