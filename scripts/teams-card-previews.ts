// TB-1: previews of the bot's Adaptive Cards (fictional data), rendered by Microsoft's own Adaptive Cards renderer
// (adaptivecards 3.0.6 from unpkg, loaded into the system Chromium for the screenshot only; nothing ships with it) in
// Teams' light and dark colors, about as wide as a 1:1 chat's card. The cards are the bot's real ones
// (server/teams/cards.ts), so a change there shows up here.
// TB-2 adds the rhythm's cards (brief, check-in, close out, nudges, capture), each before and after a tap.
// SR-1 adds the status report nudge. MC-1 adds client calls to review.
// AS-2 adds the question with choices (and after a tap), a move across clients with Undo, and a compound update.
// PK-1 adds Done's follow-up (Set #id to its done state) and Undo's (put it back), on the check-in and close out cards.
// TB-3 adds the Ask parity set from the real service on the fictional test world; pass "tb3" as the second argument for
// only those (docs/ux/tb3).
// FN-1 adds Wrap it up from Done (Finished) and Partly (Made progress); pass "fn1" for only those (docs/ux/fn1).
// Usage: node scripts/teams-card-previews.ts <outDir> [tb3|fn1]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { CHROMIUM } from "../e2e/harness.ts";
import { call, NEXT_FRI, NEXT_WED, say, setup, ZONE } from "../test/builders/assistant-world.ts";
import { teamsAssistant } from "../server/teams/assistant.ts";
import { renderAnswer } from "../server/teams/render.ts";
import { briefCard, captureCard, checkinCard, closeoutCard, meetingsCard, nudgeCard, statusCard, type InlineProposal, type PickRow } from "../server/teams/rhythm-cards.ts";
import { answeredCard, cancelledCard, doneCard, expiredCard, failedCard, proposalCard, questionCard, undoneCard, workingCard, type Card } from "../server/teams/cards.ts";

const out = process.argv[2] ?? "screenshots/teams";
mkdirSync(out, { recursive: true });
const URL_ = "https://focustime.example.com";
const proposal = { id: "p-1", title: "Move #4211 to Thursday", whoSees: "Everyone on Northwind's DevOps project", changes: [{ field: "Target date", before: "Nov 5", after: "Nov 6" }, { field: "Start date", before: "Nov 3", after: "Nov 4" }], note: "Its two open stories keep their dates.", expiresAt: "2026-11-05T15:15:00Z" };
// TB-2: the rhythm's cards, fictional.
const D = { date: "2026-11-05", dateLabel: "Thursday, Nov 5" };
const pk = (id: number, title: string, client: string, state: PickRow["state"] = "open", note: string | null = null): PickRow => ({ id, title, client, state, note });
const dests = [{ value: "next", label: "Its next block" }, { value: "2026-11-05:PM", label: "This afternoon" }, { value: "2026-11-09:AM", label: "Mon, Nov 9 morning" }];
const ip = (o: Partial<InlineProposal>): InlineProposal => ({ proposalId: "41", title: "Close out Thursday, Nov 5: 2 done, 1 moved on", whoSees: "Only you", changes: [{ field: "Fix the login timeout", before: "Not done", after: "Done" }, { field: "Review the export mapping", before: "Not done", after: "Done" }, { field: "Write the onboarding note", before: "Thu, Nov 5 afternoon", after: "Moves to Mon, Nov 9 morning" }, { field: "The day", before: "Open", after: "Closed out" }], note: null, expiresAt: "2026-11-05T22:15:00Z", state: "open", ...o });
const briefBlocks = [
  { label: "Morning 08:00–12:00", client: "Northwind", meetings: ["10:30 Standup (20 min)"], picks: [pk(1, "Fix the login timeout", "Northwind"), pk(2, "Review the export mapping", "Northwind")] },
  { label: "Afternoon 13:00–17:00", client: "Internal", meetings: [], picks: [pk(3, "Write the onboarding note", "Internal")] },
];
const brief = { kind: "brief" as const, occasion: "brief:2026-11-05", ...D, blocks: briefBlocks, promises: ["Send the March totals (Northwind)"], sends: ["Export spec (Northwind), from Sam"], committed: false, destinations: dests, more: 0 };
const checkPicks = [pk(1, "Fix the login timeout", "Northwind"), pk(2, "Review the export mapping", "Northwind"), pk(3, "Write the onboarding note", "Internal")];
const checkin = { kind: "checkin" as const, occasion: "checkin:2026-11-05", ...D, picks: checkPicks, destinations: dests };
const closeout = { kind: "closeout" as const, occasion: "closeout:2026-11-05", ...D, picks: checkPicks, closed: false };
const nudges = { kind: "nudges" as const, occasion: "nudges:2026-11-05T19", items: [
  { key: "promise:f1", kind: "promise_tonight" as const, title: "Send the March totals", clientName: "Northwind", line: "Due today, still open", route: "#/inbox/my-promises" },
  { key: "send:s1", kind: "send_waiting" as const, title: "Export spec", clientName: "Northwind", line: "From Sam, waiting for your answer", route: "#/week/commit" },
  { key: "taken:4417-9", kind: "taken_over" as const, title: "#4417 Login fix", clientName: "Northwind", line: "Sam assigned it to someone else", route: "#/ahead" },
] };
const sessionRows = [
  { pickId: 1, title: "Fix the login timeout", client: "Northwind", minutes: 60, state: "open" as const },
  { pickId: 2, title: "Review the export mapping", client: "Northwind", minutes: 30, state: "open" as const },
];
const rhythmCards: [string, Card][] = [
  ["brief", briefCard(brief, URL_)],
  ["brief-proposal", briefCard({ ...brief, proposal: ip({ title: "Confirm Thursday, Nov 5", changes: [{ field: "Plan", before: "Draft", after: "Confirmed, 3 to-dos" }] }) }, URL_)],
  ["brief-done", briefCard({ ...brief, committed: true, proposal: ip({ title: "Confirm Thursday, Nov 5", changes: [{ field: "Plan", before: "Draft", after: "Confirmed, 3 to-dos" }], state: "done", message: "Thursday is confirmed." }) }, URL_)],
  ["checkin", checkinCard(checkin, URL_)],
  ["checkin-ticked", checkinCard({ ...checkin, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), pk(2, "Review the export mapping", "Northwind", "not_yet"), checkPicks[2]!] }, URL_)],
  ["checkin-proposal", checkinCard({ ...checkin, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), checkPicks[1]!, checkPicks[2]!], proposal: ip({ title: "Move 2 to-dos", changes: [{ field: "Review the export mapping", before: "Thu, Nov 5 morning", after: "Thu, Nov 5 afternoon" }, { field: "Write the onboarding note", before: "Thu, Nov 5 afternoon", after: "Mon, Nov 9 morning" }] }) }, URL_)],
  ["checkin-moved", checkinCard({ ...checkin, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), pk(2, "Review the export mapping", "Northwind", "moved", "This afternoon"), pk(3, "Write the onboarding note", "Internal", "moved", "Mon, Nov 9 morning")], proposal: ip({ title: "Move 2 to-dos", state: "done", message: "Moved 2 to-dos." }) }, URL_)],
  // PK-1: Done on a to-do with a DevOps item offers its done state; Confirm writes it; Undo offers the write's undo.
  ["checkin-devops-offer", checkinCard({ ...checkin, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), checkPicks[1]!, checkPicks[2]!], proposal: ip({ title: "Set #4211 to Closed", whoSees: "Visible to everyone with access to the Portal project in DevOps. People following the item may get a notification from DevOps.", changes: [{ field: "State", before: "Active", after: "Closed" }], note: "Closes the follow-up once DevOps shows the change. Written only if the item is still at revision 12; if anyone changed it since, nothing is written. To set it to Resolved instead, do it in FocusTime." }) }, URL_)],
  ["checkin-devops-done", checkinCard({ ...checkin, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), checkPicks[1]!, checkPicks[2]!], proposal: ip({ title: "Set #4211 to Closed", changes: [{ field: "State", before: "Active", after: "Closed" }], state: "done", message: "#4211 is Closed in DevOps" }) }, URL_)],
  ["closeout-devops-undo", closeoutCard({ ...closeout, proposal: ip({ title: "Put #4211 back to Active", whoSees: "Visible to everyone with access to the Portal project in DevOps.", changes: [{ field: "State", before: "Closed", after: "Active" }] }) }, URL_)],
  ["closeout", closeoutCard(closeout, URL_)],
  // TX-1: timeboxes that ended, each with Done, Partly and Didn't get to it; Partly asking; the end of day offer.
  ["checkin-sessions", checkinCard({ ...checkin, picks: [checkPicks[2]!], sessions: sessionRows }, URL_)],
  ["checkin-sessions-asking", checkinCard({ ...checkin, picks: [], sessions: [{ ...sessionRows[0]!, state: "asking" }, { ...sessionRows[1]!, state: "done", note: "done", undoIds: [2] }] }, URL_)],
  ["closeout-sessions-offer", closeoutCard({ ...closeout, picks: [checkPicks[2]!], sessions: [{ ...sessionRows[0]!, state: "partly", note: "1h left", undoIds: [1] }, { ...sessionRows[1]!, state: "partly", note: "30m left", undoIds: [2] }], progressOffer: { remaining: 1, comment: 1 } }, URL_)],
  ["closeout-proposal", closeoutCard({ ...closeout, proposal: ip({}) }, URL_)],
  ["closeout-done", closeoutCard({ ...closeout, closed: true, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), pk(2, "Review the export mapping", "Northwind", "done"), pk(3, "Write the onboarding note", "Internal", "moved", "Mon, Nov 9 morning")], proposal: ip({ state: "done", message: "Day closed out." }) }, URL_)],
  ["nudges", nudgeCard(nudges, URL_)],
  // SR-1: Monday's status report, Friday afternoon.
  ["status", statusCard({ kind: "status", occasion: "status_report:2026-11-06", reportLabel: "for Monday, Nov 9", line: "3 features have no update yet for Monday's report", clients: [{ name: "Northwind", features: [{ title: "Supplier onboarding", url: "https://dev.azure.com/northwind-demo/Portal/_workitems/edit/1120" }] }, { name: "Atlas", features: [{ title: "Shipment tracking dashboard", url: "https://dev.azure.com/atlas-demo/Ops/_workitems/edit/3310" }] }, { name: "Cooptimize", features: [{ title: "Internal reporting refresh", url: null }] }], more: 0 }, URL_)],
  // MC-1: client calls to review (a new TB-2 kind, off by default): proposals ready, a transcript to upload.
  ["meetings", meetingsCard({ kind: "meetings", occasion: "meetings:1", items: [{ clientName: "Northwind", meeting: "Northwind weekly status call", dateLabel: "Wed, Nov 4", upload: false, route: "#/meetings/12" }, { clientName: "Harbor", meeting: "Harbor planning", dateLabel: "Tue, Nov 3", upload: true, route: "#/meetings/9" }] }, URL_)],
  ["capture", captureCard({ id: 7, text: "Call Dana about the March export" }, URL_)],
  ["capture-undone", captureCard({ id: 7, text: "Call Dana about the March export", undone: true }, URL_)],
  ["brief-test", briefCard({ ...brief, test: true }, URL_)],
];

const cards: [string, Card][] = [
  ...rhythmCards,
  ["proposal", proposalCard(proposal)],
  ["changed", proposalCard({ ...proposal, id: "p-2", changes: [{ field: "Target date", before: "Nov 7", after: "Nov 6" }] }, { again: "Someone changed the target date since. Here's the new preview." })],
  ["done", doneCard({ title: proposal.title, message: "Target date is Nov 6 now.", undo: { label: "Undo", proposalId: "p-1", writeId: 77 }, links: [{ label: "Open in Ahead", url: `${URL_}/#/ahead` }] }, URL_)],
  ["failed", failedCard(proposal.title, "Only the feature's owner or a client lead can move its dates.")],
  ["expired", expiredCard(proposal.title)],
  ["cancelled", cancelledCard(proposal.title)],
  ["working", workingCard(proposal.title)],
  // AS-2.
  ["as2-question", questionCard({ text: "Which to-dos on Thu, Nov 5?", choices: [{ label: "Thu, Nov 5 AM · Northwind · 2 to-dos", value: "b1" }, { label: "Thu, Nov 5 PM · Harbor · 1 to-do", value: "b2" }, { label: "All 3", value: "all" }], expiresAt: "2026-11-05T15:10:00Z" }, "q41")],
  ["as2-answered", answeredCard("Which to-dos on Thu, Nov 5?", "All 3")],
  ["as2-move", proposalCard({ id: "12", title: "Move 3 to-dos to Fri, Nov 6", whoSees: "Only you", changes: [{ field: "Harbor · Validate date of birth", before: "Thu, Nov 5 afternoon", after: "Fri, Nov 6 morning" }, { field: "Northwind · Fix the login timeout", before: "Thu, Nov 5 morning", after: "Fri, Nov 6 morning" }, { field: "Northwind · Review the export mapping", before: "Thu, Nov 5 morning", after: "Fri, Nov 6 morning" }], note: "Friday is your catch-up day", expiresAt: "2026-11-05T15:15:00Z" })],
  ["as2-move-done", doneCard({ title: "Move 3 to-dos to Fri, Nov 6", message: "Moved 3 to-dos.", undo: { label: "Undo", proposalId: "12" }, links: [{ label: "Open Week", url: `${URL_}/#/week` }] }, URL_)],
  ["as2-move-undone", undoneCard("Move 3 to-dos to Fri, Nov 6", "Put 3 to-dos back.")],
  ["as2-compound", proposalCard({ id: "13", title: "Update #4211: done and a comment", whoSees: "Visible to everyone with access to the Portal project in DevOps. People following the item may get a notification from DevOps.", changes: [{ field: "State", before: "Active", after: "Closed" }, { field: "Comment", before: "", after: "The stored procedure has the requested fields." }], expiresAt: "2026-11-05T15:15:00Z" })],
  ["as2-compound-done", doneCard({ title: "Update #4211: done and a comment", message: "Done: state and comment", undo: { label: "Undo", proposalId: "p-1", writeId: 77 }, parts: [{ label: "State", ok: true, message: "#4211 is Closed in DevOps" }, { label: "Comment", ok: true, message: "Comment added in DevOps" }] }, URL_)],
  ["as2-compound-partly", doneCard({ title: "Update #4211: done and a comment", message: "State done. Comment didn't go", undo: { label: "Undo", proposalId: "p-1", writeId: 77 }, parts: [{ label: "State", ok: true, message: "#4211 is Closed in DevOps" }, { label: "Comment", ok: false, message: "Someone changed the item since. Ask again for a fresh preview." }] }, URL_)],
];

// TB-3: the same Assistant answers, drawn for Teams.
const world = setup({ channel: "teams" });
await world.seed();
const person = { userId: "u1" };
const bot = teamsAssistant({ handle: (i) => world.a.handle(i.text, i.context ?? {}, i.answer, i.asked), confirm: (i) => world.a.confirm(i.proposalId, i.edits ?? {}), cancel: (i) => world.a.cancel(i.proposalId), propose: (i) => world.a.propose(i.tool, i.args) }, URL_);
const ask = async (text: string) => bot.handle({ person, channel: "teams", text, context: { surface: "teams", conversation: "personal", locale: "en-US", timeZone: ZONE } });
const words = (text: string): Card => ({ type: "AdaptiveCard", version: "1.5", body: [{ type: "TextBlock", text, wrap: true }] }) as unknown as Card;
const answer = async (text: string): Promise<Card[]> => {
  const a = await ask(text);
  const r = renderAnswer({ turnId: Number(a.turnId), reply: a.reply, cards: [...a.cards], links: [...a.links] }, URL_);
  return [...(r.text && r.text !== r.question?.text ? [words(r.text)] : []), ...r.cards, ...(r.question ? [questionCard(r.question, "q1")] : [])];
};
world.question({ topic: "plan_check", period: "next_week" });
const planning = await answer("I'm planning next week. What should I look out for?");
world.question({ topic: "capabilities" });
const can = await answer("What can you help me with here exactly?");
world.question({ topic: "general", period: "next_week" });
const choices = await answer("How is next week looking for the main feature?");
world.action(["move_plan"], {}, call(["move_plan", { fromDate: NEXT_WED, fromHalf: "PM", toDate: NEXT_FRI, toHalf: "AM", which: "all" }]), say("Here's the move."));
const move = await ask("Move all the items I have on my Wednesday PM block to Friday AM");
const moved = move.proposals[0]!;
const done = await bot.confirm({ person, proposalId: moved.id });
if (done.status !== "ok") throw new Error(done.message);
// FN-1: Wrap it up on a Teams card: Done proposes Finished, Partly proposes Made progress with the time left.
const fn1Who = "Visible to everyone with access to the Portal project in DevOps. People following the item may get a notification from DevOps.";
const fn1Note = "Suggest or the feature's status line: Wrap it up in FocusTime. Written only if the item is still at revision 12; if anyone changed it since, nothing is written.";
const fn1Cards: [string, Card | Card[]][] = [
  ["teams-wrap-finished", checkinCard({ ...checkin, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), checkPicks[1]!, checkPicks[2]!], proposal: ip({ title: "Wrap up #4211: finished", whoSees: fn1Who, changes: [{ field: "State", before: "Active", after: "Closed" }, { field: "Remaining Work", before: "2", after: "0" }], note: fn1Note , comment: "" }) }, URL_)],
  ["teams-wrap-progress", checkinCard({ ...checkin, picks: [], sessions: [{ ...sessionRows[0]!, state: "partly", note: "1h left", undoIds: [1] }], proposal: ip({ title: "Wrap up #4212: made progress", whoSees: fn1Who, changes: [{ field: "State", before: "New", after: "Active" }, { field: "Remaining Work", before: "4", after: "1" }], note: fn1Note , comment: "Chart draws; legend next", message: "With your comment. Confirm to write it." }) }, URL_)],
  ["teams-wrap-done", checkinCard({ ...checkin, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), checkPicks[1]!, checkPicks[2]!], proposal: ip({ title: "Wrap up #4211: finished", changes: [{ field: "State", before: "Active", after: "Closed" }, { field: "Remaining Work", before: "2", after: "0" }], state: "done", message: "2 changes saved to DevOps" }) }, URL_)],
];
const tb3Cards: [string, Card | Card[]][] = [
  ["planning-answer", planning],
  ["move-proposal", [words(move.reply), proposalCard(moved, { publicUrl: URL_ })]],
  ["move-result", doneCard({ title: moved.title, message: done.message, undo: done.undo ?? null, links: done.links ?? [] }, URL_)],
  ["choices", choices],
  ["what-can-you-do", can],
];

const THEMES = {
  light: { bg: "#f5f5f5", card: "#ffffff", fg: "#242424", subtle: "#616161", accent: "#5b5fc7", good: "#0e700e", warn: "#8a3707", attention: "#c50f1f", border: "#e0e0e0" },
  dark: { bg: "#1f1f1f", card: "#292929", fg: "#ffffff", subtle: "#adadad", accent: "#7f85f5", good: "#54b054", warn: "#f7a14b", attention: "#f1707b", border: "#3d3d3d" },
} as const;

const browser = await chromium.launch({ ...(CHROMIUM ? { executablePath: CHROMIUM } : {}), args: ["--disable-gpu"] });
for (const [theme, c] of Object.entries(THEMES)) {
  const page = await browser.newPage({ viewport: { width: 560, height: 800 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><style>body{margin:0;padding:20px;background:${c.bg};font-family:"Segoe UI","Noto Sans",sans-serif}#c{width:460px;background:${c.card};border:1px solid ${c.border};border-radius:8px;padding:16px}</style>
    <script src="https://unpkg.com/adaptivecards@3.0.6/dist/adaptivecards.min.js"></script></head><body><div id="c"></div></body></html>`);
  await page.waitForFunction(() => !!(window as unknown as { AdaptiveCards?: unknown }).AdaptiveCards, null, { timeout: 30_000 });
  for (const [name, card] of (process.argv[3] === "tb3" ? tb3Cards : process.argv[3] === "fn1" ? fn1Cards : cards) as [string, Card | Card[]][]) {
    await page.evaluate(
      ([card, c]) => {
        const AC = (window as unknown as { AdaptiveCards: any }).AdaptiveCards;
        const colors = (d: string) => ({ default: { default: d, subtle: c.subtle }, accent: { default: c.accent, subtle: c.accent }, good: { default: c.good, subtle: c.good }, warning: { default: c.warn, subtle: c.warn }, attention: { default: c.attention, subtle: c.attention }, light: { default: d, subtle: c.subtle }, dark: { default: d, subtle: c.subtle } });
        const ac = new AC.AdaptiveCard();
        ac.hostConfig = new AC.HostConfig({
          fontFamily: '"Segoe UI","Noto Sans",sans-serif',
          fontSizes: { small: 12, default: 14, medium: 16, large: 18, extraLarge: 22 },
          containerStyles: { default: { backgroundColor: c.card, foregroundColors: colors(c.fg) }, emphasis: { backgroundColor: c.bg, foregroundColors: colors(c.fg) } },
          actions: { actionsOrientation: "horizontal", buttonSpacing: 8, showCard: { actionMode: "inline" } },
          factSet: { title: { weight: "Bolder", color: "default", wrap: true, maxWidth: 140 }, value: { wrap: true, color: "default" }, spacing: 10 },
        });
        // Teams renders markdown links in a TextBlock; the bare renderer needs telling.
        AC.AdaptiveCard.onProcessMarkdown = (text: string, result: { outputHtml?: string; didProcess?: boolean }) => {
          const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
          result.outputHtml = esc.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, `<a href="$2" style="color:${c.accent}">$1</a>`);
          result.didProcess = true;
        };
        const el = document.getElementById("c")!;
        el.innerHTML = "";
        for (const one of Array.isArray(card) ? card : [card]) {
          ac.parse(one);
          const drawn = ac.render() as HTMLElement;
          drawn.style.marginBottom = "12px";
          el.appendChild(drawn);
        }
        for (const b of Array.from(el.querySelectorAll("button"))) Object.assign((b as HTMLElement).style, { padding: "6px 14px", borderRadius: "4px", border: `1px solid ${c.border}`, background: b.textContent === "Confirm" ? c.accent : c.card, color: b.textContent === "Confirm" ? "#fff" : c.fg, fontWeight: "600", cursor: "pointer" });
      },
      [card, c] as const,
    );
    await page.locator("#c").screenshot({ path: `${out}/card-${name}-${theme}.png` });
    console.log(`${out}/card-${name}-${theme}.png`);
  }
  await page.close();
}
await browser.close();
