// SA-5: Settings' search in the browser, on the demo. Every registry setting is found by its own label and opens at its
// place, scrolled to, with its fold open; a client's page asks which client (test 3). Admin's results show to an admin,
// marked, and to nobody else, not even among the nearest (test 4). The command menu lists the same results in the same
// order (test 5). What is typed never leaves the browser (test 6). Nothing found answers (test 1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SETTINGS } from "../../ui/settings/registry.ts";

const T = 420_000;
const go = (page: Page, h: string) => page.evaluate((x) => (location.hash = x), h);
const box = (page: Page) => page.getByLabel("Search settings");
const results = (page: Page) => page.locator("#settings-search-results");

/** Answers admin.status with "not an admin", the way the server does for someone who isn't one. */
async function notAdmin(page: Page) {
  await page.route("**/api/action", async (route) => {
    if (!/"admin\.status"/.test(route.request().postData() ?? "")) return route.continue();
    const r = await route.fetch();
    const j = (await r.json()) as { ok: boolean; data?: { admin?: boolean } };
    if (j.data) j.data.admin = false;
    await route.fulfill({ response: r, json: j });
  });
}

describe.skipIf(!CHROMIUM)("SA-5: Settings search (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium");
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("every setting is found by its own label and opens at its place with its fold open", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/settings/you");
    await box(page).waitFor();
    const rows = SETTINGS.filter((d) => !d.devOnly && !d.phoneOnly && !d.demoOnly);
    const missed: string[] = [];
    for (const d of rows) {
      await go(page, "#/settings/you");
      await box(page).fill(d.label);
      const id = `${d.section === "client" ? "client" : "setting"}:${d.id}`;
      const hit = results(page).locator(`[data-result="${id}"]`);
      // Wait for the hit rather than read once: the page before (a client's Code tab, RB-7) may still be loading.
      try {
        await hit.first().waitFor({ state: "attached", timeout: 5_000 });
      } catch {
        missed.push(`${d.id}: not in the results`);
        continue;
      }
      await hit.first().click();
      // A client's page asks which client (the demo has several): the first.
      if (d.section === "client") await results(page).locator(".ps-which-item").first().click();
      const el = page.locator(`.ps-body [data-setting="${d.id}"]`).first();
      try {
        await el.waitFor({ state: "visible", timeout: 10_000 });
      } catch {
        missed.push(`${d.id}: didn't open at its place`);
        continue;
      }
      // The jump runs once the section's data is in: give it a moment.
      let shown = false;
      for (let i = 0; i < 30 && !shown; i++) {
        shown = await el.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return !e.closest("details:not([open])") && r.bottom > 0 && r.top < innerHeight;
        });
        if (!shown) await page.waitForTimeout(100);
      }
      if (!shown) missed.push(`${d.id}: not scrolled to, or its fold is closed`);
    }
    expect(missed).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Admin's results show to an admin, marked Admin, and to nobody else", async () => {
    const admin = await freshPage(h, { width: 1440, height: 900 });
    await go(admin.page, "#/settings/you");
    await box(admin.page).fill("model");
    const marked = results(admin.page).locator(".ps-hit", { has: admin.page.locator(".ps-admin-mark") });
    await marked.first().waitFor();
    expect(await marked.first().textContent()).toMatch(/Model.*Admin/);
    await marked.first().click();
    await expect.poll(() => admin.page.evaluate(() => location.hash)).toMatch(/^#\/admin/);
    await admin.page.close();

    const person = await freshPage(h, { width: 1440, height: 900 }, { before: notAdmin });
    await go(person.page, "#/settings/you");
    for (const q of ["model", "audit", "admin", "positions to levels", "modle"]) {
      await box(person.page).fill(q);
      await results(person.page).locator(".ps-hit, .ps-none").first().waitFor();
      expect(await results(person.page).locator(".ps-admin-mark").count(), q).toBe(0);
      expect(await results(person.page).textContent(), q).not.toMatch(/\bAdmin\b/);
    }
    // Nothing found says so, then the Guide.
    await box(person.page).fill("positions to levels");
    await results(person.page).getByText("Nothing in Settings called “positions to levels”").waitFor();
    await results(person.page).getByRole("button", { name: /Look in the Guide/ }).waitFor();
    await person.page.close();
  }, T);

  it("the command menu lists the same Settings results in the same order", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    for (const q of ["dark mode", "vacation", "close out"]) {
      await go(page, "#/settings/you");
      await box(page).fill(q);
      await results(page).locator(".ps-hit").first().waitFor();
      const inBox = await results(page).locator("[data-result]").evaluateAll((es) => es.map((e) => `settings.${e.getAttribute("data-result")}`));
      await go(page, "#/week");
      await page.locator(".panel-shell").waitFor({ state: "detached" });
      await page.keyboard.press("Control+k");
      await page.keyboard.type(q);
      const group = page.locator('.menu-item[data-group="Settings"]');
      await expect.poll(() => group.count(), { timeout: 10_000 }).toBe(inBox.length);
      const inMenu = await group.evaluateAll((es) => es.map((e) => e.getAttribute("data-id")));
      expect(inMenu, q).toEqual(inBox);
      await page.keyboard.press("Escape");
    }
    await page.close();
  }, T);

  it("no request carries the words typed", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    const sent: string[] = [];
    page.on("request", (r) => sent.push(`${r.url()} ${r.postData() ?? ""}`));
    await go(page, "#/settings/you");
    const words = "zebrawobble vacation";
    await box(page).fill(words);
    await results(page).locator(".ps-hit, .ps-none").first().waitFor();
    await box(page).press("Enter");
    await go(page, "#/week");
    await page.keyboard.press("Control+k");
    await page.keyboard.type(words);
    await page.waitForTimeout(800);
    expect(sent.filter((s) => /zebrawobble/.test(s))).toEqual([]);
    await page.close();
  }, T);
});
