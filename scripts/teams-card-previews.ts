// TB-1: previews of the bot's Adaptive Cards (fictional data), rendered by Microsoft's own Adaptive Cards renderer
// (adaptivecards 3.0.6 from unpkg, loaded into the system Chromium for the screenshot only; nothing ships with it) in
// Teams' light and dark colors, about as wide as a 1:1 chat's card. The cards are the bot's real ones
// (server/teams/cards.ts), so a change there shows up here.
// Usage: node scripts/teams-card-previews.ts <outDir>
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { CHROMIUM } from "../e2e/harness.ts";
import { cancelledCard, doneCard, expiredCard, failedCard, helpCard, proposalCard, resultCard, workingCard, type Card } from "../server/teams/cards.ts";

const out = process.argv[2] ?? "screenshots/teams";
mkdirSync(out, { recursive: true });
const URL_ = "https://focustime.example.com";
const proposal = { id: "p-1", title: "Move #4211 to Thursday", whoSees: "Everyone on Northwind's DevOps project", changes: [{ field: "Target date", before: "Nov 5", after: "Nov 6" }, { field: "Start date", before: "Nov 3", after: "Nov 4" }], note: "Its two open stories keep their dates.", expiresAt: "2026-11-05T15:15:00Z" };
const cards: [string, Card][] = [
  ["proposal", proposalCard(proposal)],
  ["changed", proposalCard({ ...proposal, id: "p-2", changes: [{ field: "Target date", before: "Nov 7", after: "Nov 6" }] }, { again: "Someone changed the target date since. Here's the new preview." })],
  ["done", doneCard({ title: proposal.title, message: "Target date is Nov 6 now.", undo: { label: "Undo in FocusTime", url: `${URL_}/#/settings/data` }, links: [{ label: "Open in Ahead", url: `${URL_}/#/ahead` }] }, URL_)],
  ["failed", failedCard(proposal.title, "Only the feature's owner or a client lead can move its dates.")],
  ["expired", expiredCard(proposal.title)],
  ["cancelled", cancelledCard(proposal.title)],
  ["working", workingCard(proposal.title)],
  ["today", resultCard({ title: "Today", lines: ["Morning 08:00–12:00: Northwind", "  • Fix the login timeout", "  ✓ Review the export", "Afternoon 13:00–17:00: Internal", "  • Write the onboarding note"], links: [{ label: "Open Today", url: `${URL_}/#/today` }] }, URL_)],
  ["next", resultCard({ title: "Northwind until 12:00", lines: ["Next pick: Fix the login timeout", "Next meeting: Standup at 10:30", "1 of 3 picks done"], links: [{ label: "Open Today", url: `${URL_}/#/today` }] }, URL_)],
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
