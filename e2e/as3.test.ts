// AS-3: the assistant answers a question in the demo (its scripted intent round, the real service composing the answer
// from the demo's own data; nothing leaves FocusTime): "I'm planning next week. What should I look out for?" gives
// sections by client and suggested steps; a tap on a step shows its proposal with Confirm, and nothing changes before.
// With FOCUSTIME_SHOTS set it also saves three answers in the panel (light and dark, 1920 and Larger text) and the
// same answers as the bot's own Teams cards (server/teams/cards.ts, Microsoft's Adaptive Cards renderer from unpkg).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import type { HandleResult } from "../assistant/types.ts";
import { asText } from "../assistant/answer.ts";
import { teamsAssistant } from "../server/teams/assistant.ts";
import { questionCard, resultCard } from "../server/teams/cards.ts";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;
const CLOCK = "2026-11-05T10:00:00-05:00";
const QUESTIONS = [
  { name: "plan-next-week", text: "I'm planning next week. What should I look out for?" },
  { name: "what-can-you-do", text: "What can you help me with here exactly?" },
  { name: "promises-late", text: "Which promises are late?" },
] as const;

async function ask(page: Page, text: string) {
  const panel = page.getByTestId("assistant-panel");
  const box = panel.getByRole("textbox", { name: "Ask the assistant" });
  const n = await panel.locator(".as-turn.assistant").count();
  await box.fill(text);
  await box.press("Enter");
  await expect.poll(() => panel.locator(".as-turn.assistant").count(), { timeout: 30_000 }).toBeGreaterThan(n);
  await page.waitForTimeout(300);
}

describe.skipIf(!CHROMIUM)("AS-3: the assistant answers a question", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, CLOCK);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("answers \"what should I look out for next week\" from my data, by client, with a step to confirm", async () => {
    const { page, errors } = await freshPage(h);
    const panel = page.getByTestId("assistant-panel");
    await page.keyboard.press("Control+j");
    await panel.waitFor();
    await ask(page, QUESTIONS[0].text);
    const last = panel.locator(".as-turn.assistant").last();
    await expect(last.locator(".as-text").textContent()).resolves.toMatch(/^(For next week|Nothing stands out for next week)/);
    await expect(last.textContent()).resolves.not.toMatch(/I can look things up/);
    const chips = last.getByTestId("assistant-suggest").locator(".as-chip");
    if ((await chips.count()) > 0) {
      await chips.first().click();
      const p = panel.getByTestId("assistant-proposal").last();
      await p.waitFor({ timeout: 30_000 });
      await expect(p.getByRole("button", { name: "Confirm" }).count()).resolves.toBe(1);
    }
    expect(errors).toEqual([]);
  }, T);

  it.skipIf(!SHOTS)("screenshots: three answers in the panel and as Teams cards", async () => {
    mkdirSync(SHOTS!, { recursive: true });
    const results: { name: string; r: HandleResult }[] = [];
    for (const scheme of ["light", "dark"] as const) {
      const { page } = await freshPage(h, { width: 1920, height: 1080 });
      const panel = page.getByTestId("assistant-panel");
      await page.keyboard.press("Control+j");
      await panel.waitFor();
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme === "light" ? "cooptimize-light" : "cooptimize-dark");
      for (const q of QUESTIONS) {
        const got = page.waitForResponse((r) => r.url().endsWith("/api/action") && (r.request().postDataJSON() as { action?: string; input?: { text?: string } })?.input?.text === q.text);
        await ask(page, q.text);
        if (scheme === "light") results.push({ name: q.name, r: ((await (await got).json()) as { data: HandleResult }).data });
        // Each answer on its own: the panel scrolled so its top shows.
        await panel.locator(".as-turn.me").last().scrollIntoViewIfNeeded();
        await shotBoth(page, `as3-${q.name}-${scheme}`);
      }
      await page.close();
    }
    // The answers as text, for the report (demo data only).
    writeFileSync(`${SHOTS}/answers.txt`, results.map(({ name, r }) => `## ${name}\n${asText({ reply: r.reply, sections: r.cards.flatMap((c) => (c.kind === "section" ? [c] : [])) })}\n${r.cards.filter((c) => c.kind === "suggest").flatMap((c) => (c.kind === "suggest" ? c.choices.map((x) => `( ${x.label} )`) : [])).join("\n")}`).join("\n\n"));

    // Teams: the same results through the bot's adapter and its real cards.
    const URL_ = "https://focustime.example.com";
    const abs = (r: HandleResult): HandleResult => JSON.parse(JSON.stringify(r).replace(/"href":"#\//g, `"href":"${URL_}/#/`)) as HandleResult;
    const page = await h.browser.newPage({ viewport: { width: 560, height: 900 }, deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><html><head><style>body{margin:0;padding:20px;background:#f5f5f5;font-family:"Segoe UI","Noto Sans",sans-serif}.c{width:460px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:12px}p.r{width:460px;font-size:14px;color:#242424;margin:0 0 12px}</style>
      <script src="https://unpkg.com/adaptivecards@3.0.6/dist/adaptivecards.min.js"></script></head><body><div id="all"></div></body></html>`);
    await page.waitForFunction(() => !!(window as unknown as { AdaptiveCards?: unknown }).AdaptiveCards, null, { timeout: 30_000 });
    for (const { name, r } of results) {
      const bot = teamsAssistant({ handle: async () => abs(r), confirm: async () => ({ ok: false, reason: "gone", message: "" }), cancel: async () => ({ ok: true }), propose: async () => ({ ok: false, message: "" }) }, URL_);
      const t = await bot.handle({ person: { userId: "demo" }, channel: "teams", text: "", context: { surface: "teams", conversation: "personal", locale: null, timeZone: null } });
      const cards = [...t.cards.slice(0, 7).map((c) => resultCard(c, URL_)), ...(t.question ? [questionCard(t.question, "q1")] : [])];
      await page.evaluate(
        ([reply, cards]) => {
          const AC = (window as unknown as { AdaptiveCards: any }).AdaptiveCards;
          const all = document.getElementById("all")!;
          all.innerHTML = "";
          const p = document.createElement("p");
          p.className = "r";
          p.textContent = reply;
          all.appendChild(p);
          AC.AdaptiveCard.onProcessMarkdown = (text: string, res: { outputHtml?: string; didProcess?: boolean }) => {
            res.outputHtml = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" style="color:#5b5fc7">$1</a>');
            res.didProcess = true;
          };
          for (const card of cards) {
            const ac = new AC.AdaptiveCard();
            ac.hostConfig = new AC.HostConfig({ fontFamily: '"Segoe UI","Noto Sans",sans-serif', fontSizes: { small: 12, default: 14, medium: 16, large: 18, extraLarge: 22 }, actions: { actionsOrientation: "horizontal", buttonSpacing: 8 } });
            ac.parse(card);
            const box = document.createElement("div");
            box.className = "c";
            box.appendChild(ac.render());
            for (const b of Array.from(box.querySelectorAll("button"))) Object.assign((b as HTMLElement).style, { padding: "6px 14px", borderRadius: "4px", border: "1px solid #e0e0e0", background: "#fff", color: "#242424", fontWeight: "600" });
            all.appendChild(box);
          }
        },
        [t.reply, cards] as const,
      );
      await page.locator("#all").screenshot({ path: `${SHOTS}/as3-teams-${name}.png` });
    }
    await page.close();
  }, T);
});
