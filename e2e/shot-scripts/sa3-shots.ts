// SA-3: the screenshots for the pull request, only when SA3_SHOTS names a folder; nothing runs otherwise. Demo data only
// (a fictional person). Each Settings page is drawn at its full height (the window grown to the panel body's height, as
// SA-0 drew them): the rail and every section at 1440 by 900 dark, every section at 390 by 844 with the iPhone's 17 px
// root font, a fold closed, with a change inside and open, the one-time Teams note, a client's page as a lead and as
// someone else, one section in light and one at the largest Text size. The contact sheets and the before and after
// pairs are put together from these with ImageMagick by the person running it.
import { afterAll, beforeAll, describe, it } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";
import { SECTIONS } from "../../ui/settings/registry.ts";

const OUT = process.env.SA3_SHOTS ?? "";
const T = 600_000;
const RAIL = SECTIONS.filter((s) => !s.parent);
const go = (page: Page, h: string) => page.evaluate((x) => (location.hash = x), h);
const call = (page: Page, action: string, input: unknown = {}) =>
  page.evaluate(
    ([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": decodeURIComponent(document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "") }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()),
    [action, input] as const,
  );

async function open(page: Page, hash: string) {
  await go(page, "#/week");
  await page.locator(".panel-shell").waitFor({ state: "detached" }).catch(() => {});
  await go(page, hash);
  await page.locator(".ps-head h2").waitFor();
  await page.waitForTimeout(900);
}

/** The whole page: the window grown to the panel body's height, then back. */
async function full(page: Page, file: string, width: number, height: number) {
  const tall = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>(".ps-body");
    return b ? Math.ceil(b.getBoundingClientRect().top + b.scrollHeight + 24) : 0;
  });
  await page.setViewportSize({ width, height: Math.min(Math.max(height, tall), 16000) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, file) });
  await page.setViewportSize({ width, height });
}

describe.skipIf(!OUT || !CHROMIUM)("SA-3 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    for (const d of ["desk", "phone", "fold", "states"]) mkdirSync(join(OUT, d), { recursive: true });
    h = await startDemo("chromium", { FOCUSTIME_ENV: "dev" });
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("every section at 1440 by 900, the folds, the note, Connections, a client's page, What FocusTime keeps", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    let n = 0;
    for (const s of RAIL) {
      n++;
      await open(page, `#/settings/${s.id}`);
      await full(page, `desk/${String(n).padStart(2, "0")}-${s.id}.png`, 1440, 900);
    }
    // A fold closed, with a change inside, and open (Planning's Fine tuning).
    await open(page, "#/settings/planning");
    const fold = page.locator(".ps-body details.sp-fold", { has: page.locator("summary", { hasText: "Fine tuning" }) });
    await fold.scrollIntoViewIfNeeded();
    await fold.screenshot({ path: join(OUT, "fold/1-closed.png") });
    const carry = (await call(page, "settings.load")).data.planning.carryDays as number;
    await call(page, "settings.save", { section: "planning", values: { carryDays: carry + 2 } });
    await page.reload();
    await page.locator(".ps-head h2").waitFor();
    await page.waitForTimeout(900);
    await fold.scrollIntoViewIfNeeded();
    await fold.screenshot({ path: join(OUT, "fold/2-changed.png") });
    await fold.locator("summary").click();
    await page.waitForTimeout(300);
    await full(page, "fold/3-open.png", 1440, 900);
    await call(page, "settings.save", { section: "planning", values: { carryDays: carry } });
    // The one-time note: Teams' close out was 30 minutes before the day ends, the app's is 15.
    await call(page, "settings.save", { section: "notify", values: { teamsMessages: true, teams: { closeout: true } } });
    await page.reload();
    await open(page, "#/settings/notifications/notify-closeout");
    const row = page.locator('.ps-body [data-setting="notify-closeout"]').first();
    await row.getByText(/It now uses this time/).waitFor();
    await row.screenshot({ path: join(OUT, "states/teams-note.png") });
    await call(page, "settings.save", { section: "notify", values: { teamsMessages: false, teams: { closeout: false } } });
    // A client's page as a lead (the demo person leads), then as someone who can't change the data platform.
    await open(page, "#/settings/clients");
    await page.locator(".ps-body .sp-links a").first().click();
    await page.waitForFunction(() => location.hash.startsWith("#/settings/client/"));
    const client = await page.evaluate(() => location.hash);
    await page.waitForTimeout(900);
    await full(page, "states/client-lead.png", 1440, 900);
    await page.route("**/api/action", async (r) => {
      if (!(r.request().postData() ?? "").includes('"deploy.items"')) return r.continue();
      const res = await r.fetch();
      const j = (await res.json()) as { data?: { canEdit?: boolean } };
      if (j.data) j.data.canEdit = false;
      await r.fulfill({ response: res, json: j });
    });
    await page.reload();
    await open(page, client);
    await full(page, "states/client-not-lead.png", 1440, 900);
    await page.unroute("**/api/action");
    await page.close();
  }, T);

  it("light and the largest Text size", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await open(page, "#/settings/display");
    await page.locator('[data-setting="theme"]').getByRole("radio", { name: /Light/ }).first().click();
    await open(page, "#/settings/notifications");
    await full(page, "states/light-notifications.png", 1440, 900);
    await open(page, "#/settings/display");
    await page.locator('[data-setting="theme"]').getByRole("radio", { name: /Dark/ }).first().click();
    await page.locator('[data-setting="text-size"]').getByRole("radio", { name: "Larger" }).click();
    await open(page, "#/settings/planning");
    await full(page, "states/larger-planning.png", 1440, 900);
    await open(page, "#/settings/display");
    await page.locator('[data-setting="text-size"]').getByRole("radio", { name: "Default" }).click();
    await page.close();
  }, T);

  it("every section at 390 by 844", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, "#/settings");
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, "phone/00-rail.png") });
    let n = 0;
    for (const s of RAIL) {
      n++;
      await go(page, `#/settings/${s.id}`);
      await page.locator(".ps-head h2", { hasText: s.label }).waitFor();
      await page.waitForTimeout(900);
      await full(page, `phone/${String(n).padStart(2, "0")}-${s.id}.png`, 390, 844);
    }
    await page.close();
  }, T);
});
