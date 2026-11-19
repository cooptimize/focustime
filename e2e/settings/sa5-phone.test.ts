// SA-5: all of Settings on the phone, on the demo, at 390 by 844 with iPhone's 17 px root font (memory: phone checks
// need iOS conditions). Every Settings section at the Default and the largest Text size: no control under 44 px, no
// two closer than 8 px, no help over two lines, nothing wider than the screen, nothing clipped; Admin measured the same
// way, its misses listed (test 7). Most used changes its five things and each saves what its own page saves; Working
// hours, DevOps write access and the logs work there; Back goes from a setting to its section to the list (test 8).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devices, type BrowserContext, type Page } from "playwright-core";
import { CHROMIUM, startDemo, type Harness } from "../harness.ts";
import { measurePhonePage } from "../../scripts/settings-phone-audit.ts";
import { SECTIONS } from "../../ui/settings/registry.ts";

const T = 600_000;
const hash = (page: Page) => page.evaluate(() => location.hash);
const go = (page: Page, h: string) => page.evaluate((x) => (location.hash = x), h);

async function phone(h: Harness): Promise<{ ctx: BrowserContext; page: Page; base: string }> {
  const ctx = await h.browser.newContext({ ...devices["iPhone 15"], viewport: { width: 390, height: 844 }, reducedMotion: "reduce", bypassCSP: true });
  await ctx.addInitScript(() => {
    localStorage.setItem("focustime.hint.flow", "dismissed");
    localStorage.setItem("focustime.hint.picktime", "1");
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "html{font-size:17px}";
      document.head.append(st);
    });
  });
  const page = await ctx.newPage();
  await page.goto(h.url);
  await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
  await page.waitForSelector(".demo-tag", { timeout: 60_000 });
  return { ctx, page, base: h.url.split("#")[0]! };
}

/** The settings.save requests a page sends, by section. */
function saves(page: Page): { section: string; values: Record<string, unknown> }[] {
  const out: { section: string; values: Record<string, unknown> }[] = [];
  page.on("request", (r) => {
    const body = r.postData() ?? "";
    if (!r.url().includes("/api/action") || !body.includes('"settings.save"')) return;
    out.push((JSON.parse(body) as { input: { section: string; values: Record<string, unknown> } }).input);
  });
  return out;
}

describe.skipIf(!CHROMIUM)("SA-5: all of Settings on the phone (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium");
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("every section fits at 390 by 844, at Default and at Larger; Admin is measured the same way", async () => {
    const { ctx, page, base } = await phone(h);
    const pages = [...SECTIONS.filter((s) => !s.parent && !s.demoOnly).map((s) => `settings/${s.id}`), "settings/client/Northwind"];
    const admin = ["admin/clients", "admin/people/people", "admin/defaults/ai", "admin/health", "admin/audit/changes"];
    const misses: string[] = [];
    const adminMisses: string[] = [];
    for (const size of ["default", "larger"] as const) {
      if (size === "larger") {
        await go(page, "#/settings/display");
        await page.locator('[data-setting="text-size"]').getByRole("radio", { name: "Larger" }).click();
      }
      for (const at of [...pages, ...admin]) {
        await page.goto(`${base}#/${at}`);
        await page.reload();
        await page.locator(".ps-body").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(900);
        const m = await measurePhonePage(page);
        const found = [...m.small.map((x) => `small ${x}`), ...m.close.map((x) => `close ${x}`), ...m.wide.map((x) => `wide ${x}`), ...m.clipped.map((x) => `clipped ${x}`), ...m.tablesWide.map((x) => `table ${x}`), ...m.helpOverTwo.map((x) => `help ${x}`)];
        if (m.readOnly) found.push("read-only");
        (at.startsWith("admin") ? adminMisses : misses).push(...found.map((f) => `${size} ${at}: ${f}`));
      }
    }
    expect(misses).toEqual([]);
    // Admin: the controls and the width are fixed; its long help lines are listed in docs/ux/sa5/after.md.
    expect(adminMisses.filter((m) => !/ help /.test(m))).toEqual([]);
    await ctx.close();
  }, T);

  it("Most used changes its five things, each saved as its own page saves it", async () => {
    const { ctx, page } = await phone(h);
    const sent = saves(page);
    await go(page, "#/settings");
    const most = page.locator(".ps-most");
    await most.getByRole("heading", { name: "Most used" }).waitFor();
    // Under it: the search, then every section.
    expect(await page.locator(".ps-most + .ps-rail .ps-search input").count()).toBe(1);
    for (const id of ["devices", "teams-messages", "theme", "text-size", "today-hours"]) await most.locator(`[data-setting="${id}"]`).waitFor();

    // Let FocusTime message me in Teams: the same save as Reminders and notices sends.
    const teams = most.locator('[data-setting="teams-messages"]').getByRole("switch");
    const was = await teams.isChecked();
    const answered = page.waitForResponse((r) => (r.request().postData() ?? "").includes('"settings.save"'));
    await teams.click();
    await answered;
    await expect.poll(() => sent.filter((s) => s.section === "notify").length).toBe(1);
    const fromMost = sent.find((s) => s.section === "notify")!.values;
    expect(fromMost.teamsMessages).toBe(!was);
    await go(page, "#/settings/notifications");
    const onPage = page.locator('.ps-body [data-setting="teams-messages"]').getByRole("switch");
    expect(await onPage.isChecked()).toBe(!was);
    await onPage.click();
    await expect.poll(() => sent.filter((s) => s.section === "notify").length).toBe(2);
    const fromPage = sent.filter((s) => s.section === "notify")[1]!.values;
    expect(Object.keys(fromPage).sort()).toEqual(Object.keys(fromMost).sort());
    expect(fromPage.teamsMessages).toBe(was);
    expect({ ...fromPage, teamsMessages: !was }).toEqual(fromMost);

    // Theme and Text size: as Display's own rows.
    await go(page, "#/settings");
    await most.locator('[data-setting="theme"]').getByRole("radio", { name: "Cooptimize Light" }).click();
    await go(page, "#/settings/display");
    expect(await page.locator('.ps-body [data-setting="theme"]').getByRole("radio", { name: "Cooptimize Light" }).getAttribute("aria-checked")).toBe("true");
    await go(page, "#/settings");
    await most.locator('[data-setting="text-size"]').getByRole("radio", { name: "Large", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-text-size"))).toBe("large");
    await most.locator('[data-setting="text-size"]').getByRole("radio", { name: "Default" }).click();

    // Today's hours: Week's one-day change for today, listed under Working hours › One-day changes, then taken back.
    const today = most.locator('[data-setting="today-hours"]');
    await today.getByRole("button", { name: "Save for today" }).click();
    await today.getByText(/^Saved for today: /).waitFor();
    await go(page, "#/settings/hours");
    const changes = page.locator('.ps-body [data-setting="one-day-changes"]');
    await changes.getByRole("button", { name: /Use usual hours on/ }).waitFor();
    await go(page, "#/settings");
    await today.getByRole("button", { name: "Use usual hours" }).click();
    await today.getByText("Back to your usual hours for today.").waitFor();

    // Notify this device: the same row as Reminders and notices' (push isn't part of the demo, so it says why).
    const here = await most.locator('[data-setting="devices"]').textContent();
    await go(page, "#/settings/notifications");
    await expect.poll(() => page.locator('.ps-body [data-setting="devices"]').textContent()).toBe(here);
    await ctx.close();
  }, T);

  it("Working hours, DevOps write access and the logs work on the phone; Back goes setting, section, list", async () => {
    const { ctx, page } = await phone(h);
    const sent = saves(page);
    // Working hours: changeable (no read-only bar), and saved.
    await go(page, "#/settings/hours");
    expect(await page.locator(".phone-ro").count()).toBe(0);
    const mon = page.locator('.ps-body [data-setting="hours-mon"] input');
    const before = await mon.inputValue();
    await mon.fill("08:00-16:00");
    await mon.blur();
    await expect.poll(() => sent.filter((s) => s.section === "hours").length).toBeGreaterThan(0);
    await mon.fill(before);
    await mon.blur();
    // A standing block: Add and Remove take the full width.
    const add = page.locator('.ps-body [data-setting="standing-blocks"]').getByRole("button", { name: "Add a standing block" });
    const box = (await add.boundingBox())!;
    const row = (await page.locator('.ps-body [data-setting="standing-blocks"]').boundingBox())!;
    expect(box.width).toBeGreaterThan(row.width * 0.9);

    // DevOps write access: a masked field per client, empty; what is saved is never shown again.
    await go(page, "#/settings/connections/devops-write");
    const pat = page.locator('.ps-body input[type="password"]').first();
    await pat.waitFor();
    expect(await pat.isEnabled()).toBe(true);
    expect(await pat.inputValue()).toBe("");

    // The logs: each tab opens and reads in full, nothing wider than the screen.
    for (const tab of ["write-log", "devops-log", "azure-log", "teams-log", "loop-log"]) {
      await go(page, `#/settings/data/${tab}`);
      await page.locator(`.ps-body [data-setting="${tab}"]`).first().waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tab).toBe(true);
    }

    // Back: from a setting to its section, then to the list; the address follows.
    await go(page, "#/settings/hours/time-zone");
    const back = page.locator(".ps-back");
    await expect.poll(() => back.textContent()).toContain("Working hours");
    await back.click();
    await expect.poll(() => hash(page)).toBe("#/settings/hours");
    await expect.poll(() => back.textContent()).toContain("Settings");
    await back.click();
    await expect.poll(() => hash(page)).toMatch(/^#\/settings\/?$/);
    await page.locator(".ps-most").waitFor();
    await ctx.close();
  }, T);
});
