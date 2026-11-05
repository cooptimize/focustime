// DM-1: no real name on any main view of the demo. Each view's visible text, plus its titles, labels and placeholders,
// is checked against the names guard's own list (scripts/guards.ts `realRe`: real clients, projects, people and company
// addresses), so a name added there is checked here too. Limitation: the list names what it names; a colleague's name
// it doesn't have is caught only by eye (the dry-run checklist in docs/demo/script.md).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { realRe } from "../scripts/guards.ts";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 300_000;
const VIEWS = [
  "#/today", "#/today/checkin", "#/today/closeout", "#/week", "#/week/day/2026-11-02", "#/week/commit/2026-11-02", "#/week/team",
  "#/ahead", "#/ahead/gantt", "#/ahead/fix", "#/inbox/conversations", "#/inbox/my-promises", "#/inbox/captures",
  "#/settings/you", "#/settings/clients", "#/settings/connections", "#/settings/data", "#/settings/demo",
  "#/settings/admin-clients", "#/settings/admin-people", "#/settings/admin-ai", "#/settings/admin-status", "#/guide",
];

/** Everything a person can read on the page: text, and the words in titles, labels, placeholders and alt text. */
const readable = (page: Page) =>
  page.evaluate(() => {
    const attrs = [...document.querySelectorAll("[title],[aria-label],[placeholder],[alt]")].flatMap((e) => ["title", "aria-label", "placeholder", "alt"].map((a) => e.getAttribute(a) ?? ""));
    return `${document.body.innerText}\n${attrs.join("\n")}`;
  });

describe.skipIf(!CHROMIUM)("no real names in the demo (DM-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop(), T);

  it("every main view, and the assistant's answers, use only fictional names", async () => {
    const { page, errors } = await freshPage(h);
    const hits: string[] = [];
    for (const v of VIEWS) {
      await page.evaluate((x) => (location.hash = x), v);
      await page.waitForTimeout(1200);
      const text = await readable(page);
      expect(text.length, v).toBeGreaterThan(50);
      const m = realRe.exec(text);
      if (m) hits.push(`${v}: a real name (${m[0].length} letters)`); // the match itself is never printed
    }
    // The assistant: a lookup and what's next.
    await page.evaluate(() => (location.hash = "#/today"));
    await page.locator(".topbar").getByRole("button", { name: "Ask", exact: true }).click();
    const box = page.getByTestId("assistant-panel").getByRole("textbox", { name: "Ask the assistant" });
    for (const q of ["What's #1110?", "What's next?"]) {
      await box.fill(q);
      await box.press("Enter");
      await page.waitForTimeout(1500);
    }
    if (realRe.test(await readable(page))) hits.push("the assistant panel: a real name");
    expect(hits).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
