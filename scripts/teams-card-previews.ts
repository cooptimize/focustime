// TB-1: previews of the bot's Adaptive Cards (fictional data), rendered by Microsoft's own Adaptive Cards renderer
// (adaptivecards 3.0.6 from unpkg, loaded into the system Chromium for the screenshot only; nothing ships with it) in
// Teams' light and dark colors, about as wide as a 1:1 chat's card. The cards are the bot's real ones
// (server/teams/cards.ts), so a change there shows up here.
// TB-2 adds the rhythm's cards (brief, check-in, close out, nudges, capture), each before and after a tap.
// SR-1 adds the status report nudge.
// PK-1 adds Done's follow-up (Set #id to its done state) and Undo's (put it back), on the check-in and close out cards.
// Usage: node scripts/teams-card-previews.ts <outDir>
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { CHROMIUM } from "../e2e/harness.ts";
import { briefCard, captureCard, checkinCard, closeoutCard, nudgeCard, statusCard, type InlineProposal, type PickRow } from "../server/teams/rhythm-cards.ts";
import { cancelledCard, doneCard, expiredCard, failedCard, helpCard, proposalCard, resultCard, workingCard, type Card } from "../server/teams/cards.ts";

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
  ["closeout-proposal", closeoutCard({ ...closeout, proposal: ip({}) }, URL_)],
  ["closeout-done", closeoutCard({ ...closeout, closed: true, picks: [pk(1, "Fix the login timeout", "Northwind", "done"), pk(2, "Review the export mapping", "Northwind", "done"), pk(3, "Write the onboarding note", "Internal", "moved", "Mon, Nov 9 morning")], proposal: ip({ state: "done", message: "Day closed out." }) }, URL_)],
  ["nudges", nudgeCard(nudges, URL_)],
  // SR-1: Monday's status report, Friday afternoon.
  ["status", statusCard({ kind: "status", occasion: "status_report:2026-11-06", reportLabel: "for Monday, Nov 9", line: "3 features have no update yet for Monday's report", clients: [{ name: "Northwind", features: [{ title: "Supplier onboarding", url: "https://dev.azure.com/northwind-demo/Portal/_workitems/edit/1120" }] }, { name: "Atlas", features: [{ title: "Shipment tracking dashboard", url: "https://dev.azure.com/atlas-demo/Ops/_workitems/edit/3310" }] }, { name: "Cooptimize", features: [{ title: "Internal reporting refresh", url: null }] }], more: 0 }, URL_)],
  ["capture", captureCard({ id: 7, text: "Call Dana about the March export" }, URL_)],
  ["capture-undone", captureCard({ id: 7, text: "Call Dana about the March export", undone: true }, URL_)],
  ["brief-test", briefCard({ ...brief, test: true }, URL_)],
];

const cards: [string, Card][] = [
  ...rhythmCards,
  ["proposal", proposalCard(proposal)],
  ["changed", proposalCard({ ...proposal, id: "p-2", changes: [{ field: "Target date", before: "Nov 7", after: "Nov 6" }] }, { again: "Someone changed the target date since. Here's the new preview." })],
  ["done", doneCard({ title: proposal.title, message: "Target date is Nov 6 now.", undo: { label: "Undo in FocusTime", url: `${URL_}/#/settings/data` }, links: [{ label: "Open in Ahead", url: `${URL_}/#/ahead` }] }, URL_)],
  ["failed", failedCard(proposal.title, "Only the feature's owner or a client lead can move its dates.")],
  ["expired", expiredCard(proposal.title)],
  ["cancelled", cancelledCard(proposal.title)],
  ["working", workingCard(proposal.title)],
  ["today", resultCard({ title: "Today", lines: ["Morning 08:00–12:00: Northwind", "  • Fix the login timeout", "  ✓ Review the export", "Afternoon 13:00–17:00: Internal", "  • Write the onboarding note"], links: [{ label: "Open Today", url: `${URL_}/#/today` }] }, URL_)],
  ["next", resultCard({ title: "Northwind until 12:00", lines: ["Next to-do: Fix the login timeout", "Next meeting: Standup at 10:30", "1 of 3 to-dos done"], links: [{ label: "Open Today", url: `${URL_}/#/today` }] }, URL_)],
  ["help", helpCard(URL_)],
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
  for (const [name, card] of cards) {
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
        ac.parse(card);
        const el = document.getElementById("c")!;
        el.innerHTML = "";
        el.appendChild(ac.render());
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
