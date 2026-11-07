// fix/settings-autosave: Settings saves itself (browser, demo mode). A changed field saves on blur and says Saved; an
// unchanged blur sends nothing; a value the server refuses shows its message under the field and keeps what was typed;
// a network error offers Retry; Undo puts the old value back; a DevOps write PAT still needs "Check and save".
// Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openSettings, settingsSection, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

const T = 90_000;
let h: Harness;

const load = (page: Page) =>
  page.evaluate(() =>
    fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "settings.load", input: {} }) })
      .then((r) => r.json())
      .then((b: { data: { planning: { focusMinutes: number }; risk: { meetingAtRiskMinutes: number }; roadmap: { stalledDays: number } } }) => b.data),
  );

/** Counts settings.save calls from the page. */
function saves(page: Page) {
  const seen = { n: 0 };
  page.on("request", (r) => {
    if (r.url().endsWith("/api/action") && r.method() === "POST" && (r.postData() ?? "").includes('"settings.save"')) seen.n++;
  });
  return seen;
}

describe.skipIf(!CHROMIUM)("Settings saves itself", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a change saves on blur with Saved; an unchanged blur saves nothing; Undo restores it; no Save buttons", async () => {
    const { page, errors } = await freshPage(h);
    const sent = saves(page);
    await openSettings(page);
    await settingsSection(page, "focus");
    const field = page.locator(".set-field", { hasText: "Focus length (minutes)" });
    const input = field.locator("input");
    await input.waitFor();
    await expect(page.locator(".ps-body").getByRole("button", { name: /^Save$/ }).count()).resolves.toBe(0);
    const before = (await load(page)).planning.focusMinutes;

    // Focus in and out without a change: nothing is sent.
    await input.focus();
    await input.blur();
    await page.waitForTimeout(600);
    expect(sent.n).toBe(0);

    // A change, then Tab away: saved once, "Saved" by the field.
    await input.fill(String(before + 5));
    await page.keyboard.press("Tab");
    await field.getByText("Saved").waitFor({ timeout: 5000 });
    await expect(field.locator(".set-mark").getAttribute("aria-live")).resolves.toBe("polite");
    expect(sent.n).toBe(1);
    expect((await load(page)).planning.focusMinutes).toBe(before + 5);
    await shotBoth(page, "settings-planning-saved", field);

    // Undo: the old value back on the server and in the field.
    await page.locator(".set-undo").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await load(page)).planning.focusMinutes).toBe(before);
    await expect(input.inputValue()).resolves.toBe(String(before));
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a refused value: the message under the field, the typed value stays, nothing saved; a network error offers Retry", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    await settingsSection(page, "planning");
    const atRisk = page.locator(".set-field", { hasText: "At risk at" });
    const input = atRisk.locator("input");
    await input.waitFor();
    const before = (await load(page)).risk.meetingAtRiskMinutes;
    // At risk must be at least the Watch value.
    await input.fill("5");
    await input.press("Enter");
    await atRisk.locator(".field-problem").waitFor({ timeout: 5000 });
    // Plain words: no config key names.
    await expect(atRisk.locator(".field-problem").textContent()).resolves.not.toMatch(/_|\(/);
    await expect(input.inputValue()).resolves.toBe("5");
    await expect(input.getAttribute("aria-invalid")).resolves.toBe("true");
    expect((await load(page)).risk.meetingAtRiskMinutes).toBe(before);
    await shotBoth(page, "settings-risk-error", atRisk);

    // Leaving with that field still wrong doesn't drop it silently: Settings stays and the field is focused.
    await settingsSection(page, "focus").catch(() => undefined);
    await page.waitForTimeout(400);
    await expect(page.locator(".ps-head h2").textContent()).resolves.toBe("Today and Week");

    // A network error: "Couldn't save. Retry", and Retry saves once the network is back.
    await page.route("**/api/action", async (route) => ((route.request().postData() ?? "").includes('"settings.save"') ? route.abort() : route.continue()));
    await input.fill(String(before + 10));
    await input.press("Enter");
    await atRisk.getByText("Couldn't save.").waitFor({ timeout: 5000 });
    await page.unroute("**/api/action");
    await atRisk.getByRole("button", { name: "Retry" }).click();
    await atRisk.getByText("Saved").waitFor({ timeout: 5000 });
    expect((await load(page)).risk.meetingAtRiskMinutes).toBe(before + 10);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("an edited field saves when Settings closes with it focused", async () => {
    const { page } = await freshPage(h);
    await openSettings(page);
    await settingsSection(page, "ahead");
    const input = page.locator(".set-field", { hasText: "Stalled after" }).locator("input");
    await input.waitFor();
    const before = (await load(page)).roadmap.stalledDays;
    await input.fill(String(before + 1));
    // × with the field still focused (ST-1: the one way out at the top right; Esc does the same).
    await page.locator(".ps-head").getByRole("button", { name: "Close" }).click();
    await page.locator(".settings").waitFor({ state: "detached" });
    await expect.poll(async () => (await load(page)).roadmap.stalledDays).toBe(before + 1);
    await page.close();
  }, T);

  it("the body scrolls on its own beside the rail; the rail stays in view and marks the section shown (ADM-2, ST-1)", async () => {
    const { page } = await freshPage(h);
    await openSettings(page);
    await settingsSection(page, "planning");
    await page.locator(".set-field", { hasText: "Carry-over" }).waitFor();
    const layout = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>(".ps-body")!;
      body.scrollTo({ top: body.scrollHeight });
      const nav = document.querySelector<HTMLElement>(".ps-side")!.getBoundingClientRect();
      return { inner: getComputedStyle(body).overflowY, scrolled: body.scrollTop > 0, page: document.querySelector<HTMLElement>(".settings")!.scrollTop, navTop: nav.top, width: body.querySelector(".set-section")!.getBoundingClientRect().width };
    });
    expect(layout).toMatchObject({ inner: "auto", scrolled: true, page: 0 });
    expect(layout.navTop).toBeGreaterThanOrEqual(0);
    expect(layout.width).toBeLessThanOrEqual(1100);
    await expect(page.locator('.ps-rail [aria-current="page"] span').first().textContent()).resolves.toBe("Today and Week");
    await page.close();
  }, T);

  it("a DevOps write PAT keeps its one explicit button, Check and save", async () => {
    const { page } = await freshPage(h);
    await openSettings(page);
    await settingsSection(page, "devops");
    const pat = page.locator("form.devops-write").first();
    await pat.waitFor({ timeout: 20_000 });
    await expect(pat.getByRole("button", { name: "Check and save" }).count()).resolves.toBe(1);
    await expect(page.locator(".ps-body").getByRole("button", { name: /^Save$/ }).count()).resolves.toBe(0);
    await shotBoth(page, "settings-clients-pat", pat);
    await page.close();
  }, T);
});
