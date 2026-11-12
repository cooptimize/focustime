// ST-1: Settings' panel shell on the demo. Every setting in the registry (ui/settings/registry.ts) is where the registry
// says, and a deep link to it lands on it; each section with a switch still saves; × and Esc close from every section
// back to where I was, Back from the client sub-page; there is no bottom-left Back; search finds settings by their new and
// old labels; old section ids still land; no secret value is in Settings' pages or what the server sends them; on a phone
// the rail is a list page and each section a page that fits the width; the keyboard alone gets around, and focus returns.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SECTIONS, SETTINGS } from "../ui/settings/registry.ts";

const T = 240_000;
const RAIL = SECTIONS.filter((s) => !s.parent).map((s) => s.id);
const hash = (page: Page) => page.evaluate(() => location.hash);
const go = (page: Page, h: string) => page.evaluate((x) => (location.hash = x), h);
const head = (page: Page) => page.locator(".ps-head h2");

/** Opens a section from somewhere else and waits for its header. */
async function openAt(page: Page, from: string, to: string) {
  await go(page, from);
  await page.locator(".panel-shell").waitFor({ state: "detached" });
  await go(page, to);
  await head(page).waitFor();
}

describe.skipIf(!CHROMIUM)("Settings shell (ST-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("every registry setting is in its section; its deep link lands on it with a brief highlight", async () => {
    const { page, errors } = await freshPage(h);
    const missing: string[] = [];
    for (const s of SECTIONS.filter((x) => !x.parent)) {
      const defs = SETTINGS.filter((d) => d.section === s.id);
      await go(page, `#/settings/${s.id}`);
      await head(page).waitFor();
      await page.waitForTimeout(600);
      for (const d of defs) {
        const n = await page.locator(`.ps-body [data-setting="${d.id}"]`).count();
        if (!n) missing.push(`${s.id}/${d.id}`);
      }
    }
    expect(missing).toEqual([]);
    // A deep link: its row is highlighted and in view.
    for (const [sec, id] of [["hours", "time-zone"], ["devops", "devops-write"], ["data", "diagnostics"], ["notifications", "quiet"]] as const) {
      await openAt(page, "#/week", `#/settings/${sec}/${id}`);
      const row = page.locator(`.ps-body [data-setting="${id}"]`).first();
      await row.waitFor();
      await expect.poll(() => row.evaluate((el) => el.classList.contains("ps-flash")), { timeout: 5_000 }).toBe(true);
      expect(await row.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })).toBe(true);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("each section's first switch still saves, and stays saved after a reload", async () => {
    const { page, errors } = await freshPage(h);
    const saved: string[] = [];
    for (const id of RAIL) {
      await go(page, `#/settings/${id}`);
      await head(page).waitFor();
      await page.waitForTimeout(600);
      // An autosaved field (it has a save mark), not a button-run switch like Teams or a push subscription.
      const sw = page.locator('.ps-body [data-setting]:has(.set-mark) input[type="checkbox"]:not([disabled])').first();
      if (!(await sw.count())) continue;
      const setting = await sw.evaluate((el) => el.closest("[data-setting]")!.getAttribute("data-setting"));
      const before = await sw.isChecked();
      await sw.click();
      await page.locator(`.ps-body [data-setting="${setting}"] .set-saved`).first().waitFor({ timeout: 10_000 });
      await page.reload();
      await head(page).waitFor();
      const again = page.locator(`.ps-body [data-setting="${setting}"] input[type="checkbox"]`).first();
      await again.waitFor();
      await expect.poll(() => again.isChecked(), { timeout: 10_000 }).toBe(!before);
      await again.click();
      await page.locator(`.ps-body [data-setting="${setting}"] .set-saved`).first().waitFor({ timeout: 10_000 });
      saved.push(`${id}/${setting}`);
    }
    // Every section with switches saved one (a check the list didn't quietly shrink).
    expect(saved.map((x) => x.split("/")[0])).toEqual(["notifications", "planning", "focus", "connections"]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("× and Esc close every section back to where I was; Back leaves the client page; no bottom-left Back", async () => {
    const { page, errors } = await freshPage(h);
    for (const [i, id] of RAIL.entries()) {
      const from = i % 2 ? "#/inbox/promises" : "#/week";
      await openAt(page, from, `#/settings/${id}`);
      expect(await page.locator(".ps-main > :not(.ps-head) button", { hasText: /^‹?\s*Back$/ }).count(), id).toBe(0);
      expect(await page.locator(".ps-head .ps-back").count(), id).toBe(0);
      if (i % 2) await page.locator(".ps-head").getByRole("button", { name: "Close" }).click();
      else await page.keyboard.press("Escape");
      await expect.poll(() => hash(page), { message: id }).toBe(from);
    }
    // The client sub-page: Back to Clients, then × back to Week.
    await openAt(page, "#/week", "#/settings/clients");
    await page.locator(".set-client-row").first().click();
    await page.waitForFunction(() => location.hash.startsWith("#/settings/client/"));
    await page.locator(".ps-head").getByRole("button", { name: "Clients" }).click();
    await expect.poll(() => hash(page)).toBe("#/settings/clients");
    await page.locator(".set-client-row").first().click();
    await page.waitForFunction(() => location.hash.startsWith("#/settings/client/"));
    await page.keyboard.press("Escape");
    await expect.poll(() => hash(page)).toBe("#/week");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("search finds settings by new and old labels and jumps there; old section ids still land", async () => {
    const { page, errors } = await freshPage(h);
    await openAt(page, "#/week", "#/settings/you");
    const box = page.getByLabel("Search settings");
    const results = page.locator("#settings-search-results");
    await box.fill("roadmap");
    await results.locator(".ps-hit", { hasText: "Backlog" }).filter({ hasText: "was “Roadmap”" }).waitFor();
    await box.press("Enter");
    await expect.poll(() => hash(page)).toBe("#/settings/ahead");
    await box.fill("time zone");
    await results.locator(".ps-hit", { hasText: "Time zone" }).first().click();
    await expect.poll(() => hash(page)).toBe("#/settings/hours/time-zone");
    await box.fill("write log");
    // The results render after the keystroke: wait for one before moving into them (CI raced here, DOC-1).
    await results.locator(".ps-hit").first().waitFor();
    await box.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.closest("#settings-search-results") !== null)).toBe(true);
    await box.fill("app secrets");
    await results.getByText(/^Nothing called/).waitFor();
    // The first Esc clears the box, the next closes Settings.
    await box.press("Escape");
    expect(await box.inputValue()).toBe("");
    await expect.poll(() => hash(page)).toMatch(/^#\/settings\//);
    await page.keyboard.press("Escape");
    await expect.poll(() => hash(page)).toBe("#/week");
    // Old ids from before ST-1 open their new place (bookmarks, notifications, the Guide).
    for (const [old, title, setting] of [["risk", "Today and Week", "risk-rules"], ["standing", "Working hours", "standing-blocks"], ["roadmap", "Backlog", null], ["setup", "Profile", "setup"], ["demo", "Your data", "demo-reset"]] as const) {
      await openAt(page, "#/week", `#/settings/${old}`);
      await head(page).filter({ hasText: title }).waitFor();
      if (setting) await page.locator(`.ps-body [data-setting="${setting}"]`).first().waitFor();
    }
    // An address that isn't a section (a stale bookmark): Profile.
    await openAt(page, "#/week", "#/settings/nosuch");
    await head(page).filter({ hasText: "Profile" }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a jump to a setting that lands late doesn't take focus from a new search (TX-1b: the flake on main)", async () => {
    const { page, errors } = await freshPage(h);
    await openAt(page, "#/week", "#/settings/you");
    // The section's data comes back after the person has moved on, as it did on a slow CI machine.
    await page.route("**/api/action", async (r) => {
      if ((r.request().postData() ?? "").includes('"settings.load"')) await new Promise((x) => setTimeout(x, 700));
      await r.continue();
    });
    const box = page.getByLabel("Search settings");
    const results = page.locator("#settings-search-results");
    await box.fill("time zone");
    await results.locator(".ps-hit", { hasText: "Time zone" }).first().click();
    await expect.poll(() => hash(page)).toBe("#/settings/hours/time-zone");
    await box.fill("write log");
    await results.locator(".ps-hit").first().waitFor();
    await box.press("ArrowDown");
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => document.activeElement?.closest("#settings-search-results") != null)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  // Main's CI failures (#306, #308): the jump's focus landed after the person, or Playwright, had gone to the search box.
  const jumpTo = async (page: Page, slow: boolean) => {
    await openAt(page, "#/week", "#/settings/you");
    let landed: Promise<unknown> = Promise.resolve();
    if (slow) {
      await page.route("**/api/action", async (r) => {
        if ((r.request().postData() ?? "").includes('"settings.load"')) await new Promise((x) => setTimeout(x, 700));
        await r.continue();
      });
      landed = page.waitForResponse((r) => r.url().includes("/api/action") && (r.request().postData() ?? "").includes('"settings.load"'));
    }
    const box = page.getByLabel("Search settings");
    await box.fill("time zone");
    await page.locator("#settings-search-results .ps-hit", { hasText: "Time zone" }).first().waitFor();
    return { box, landed };
  };
  const inBox = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label"));
  /** Long enough for the jump's 60 ms timer; this only proves nothing more happens, nothing waits on it to pass. */
  const settled = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 250)));

  it("going to the search box right after a jump keeps the focus there", async () => {
    const { page, errors } = await freshPage(h);
    const { box } = await jumpTo(page, false);
    // In the page, so nothing can land between the jump and the focus: what a fast machine or a fast person does.
    await page.evaluate(async () => {
      const before = location.hash;
      document.querySelector<HTMLElement>("#settings-search-results .ps-hit")!.click();
      while (location.hash === before) await new Promise((r) => setTimeout(r, 1));
      document.querySelector<HTMLElement>('[aria-label="Search settings"]')!.focus();
    });
    await settled(page);
    expect(await inBox(page)).toBe("Search settings");
    await page.keyboard.insertText("write log");
    expect(await box.inputValue()).toBe("write log");
    await page.locator("#settings-search-results .ps-hit").first().waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the section's data landing late doesn't pull the focus out of an empty search box", async () => {
    const { page, errors } = await freshPage(h);
    const { box, landed } = await jumpTo(page, true);
    await page.locator("#settings-search-results .ps-hit", { hasText: "Time zone" }).first().click();
    await expect.poll(() => hash(page)).toBe("#/settings/hours/time-zone");
    await box.focus();
    await landed;
    await settled(page);
    expect(await inBox(page)).toBe("Search settings");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("left alone, a jump puts the focus on the setting, and the late data leaves it there", async () => {
    const { page, errors } = await freshPage(h);
    const { landed } = await jumpTo(page, true);
    await page.locator("#settings-search-results .ps-hit", { hasText: "Time zone" }).first().click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-setting="time-zone"]') != null)).toBe(true);
    await landed;
    await settled(page);
    expect(await page.evaluate(() => document.activeElement?.closest('[data-setting="time-zone"]') != null)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("no secret value appears in Settings or in what the server sends it", async () => {
    const { page, errors } = await freshPage(h);
    const fake = "fakepat" + "x".repeat(45);
    const bodies: string[] = [];
    page.on("response", (r) => void (r.url().includes("/api/") ? r.text().then((t) => bodies.push(t), () => {}) : undefined));
    await openAt(page, "#/week", "#/settings/devops");
    const form = page.locator("form.devops-write").first();
    await form.waitFor({ timeout: 20_000 });
    await form.locator('input[type="password"]').fill(fake);
    await form.getByRole("button", { name: "Check and save" }).click();
    await page.waitForTimeout(1500);
    for (const id of [...RAIL, "devops"]) {
      await go(page, `#/settings/${id}`);
      await head(page).waitFor();
      await page.waitForTimeout(500);
      const html = await page.content();
      expect(html.includes(fake), id).toBe(false);
      expect(await page.locator('.ps-body input[type="password"]').evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).value !== "").length), id).toBe(0);
      expect(html, id).not.toMatch(/App secrets/);
    }
    expect(bodies.some((b) => b.includes(fake))).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on a phone the rail is a list page and each section a page with Back and × that fits the width", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await page.evaluate(() => (document.documentElement.style.fontSize = "17px"));
    await openAt(page, "#/week", "#/settings");
    expect(await page.locator(".ps-rail").count()).toBe(1);
    expect(await page.locator(".ps-body").count()).toBe(0);
    for (const id of RAIL) {
      await page.locator(`.ps-rail [data-settings-section="${id}"]`).click();
      await expect.poll(() => hash(page)).toBe(`#/settings/${id}`);
      await head(page).waitFor();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]), id).toEqual([390, 390]);
      expect(await page.locator(".ps-rail").count(), id).toBe(0);
      await page.locator(".ps-head .ps-back").click();
      await expect.poll(() => hash(page)).toBe("#/settings");
    }
    await page.locator(".ps-head").getByRole("button", { name: "Close" }).click();
    await expect.poll(() => hash(page)).toBe("#/week");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the keyboard alone opens, moves and closes Settings; focus goes back to what opened it", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, "#/week");
    const chip = page.locator(".person-chip");
    await chip.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: /^Settings/ }).waitFor();
    await page.keyboard.press("Enter").catch(() => {});
    if (!(await page.locator(".panel-shell").count())) await page.getByRole("menuitem", { name: /^Settings/ }).press("Enter");
    await head(page).waitFor();
    // The title takes focus; Tab reaches the search box and the rail.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("H2");
    const display = page.locator('.ps-rail [data-settings-section="display"]');
    for (let i = 0; i < 40 && !(await display.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect.poll(() => hash(page)).toBe("#/settings/display");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Display");
    await page.keyboard.press("Escape");
    await expect.poll(() => hash(page)).toBe("#/week");
    await expect.poll(() => chip.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))).toBe(true);
    // "," opens Settings' own page; Esc closes it again.
    await page.locator(".week, main").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press(",");
    await head(page).waitFor();
    await page.keyboard.press("Escape");
    await expect.poll(() => hash(page)).toBe("#/week");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
