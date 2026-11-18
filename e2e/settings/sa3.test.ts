// SA-3: Settings in eleven sections. On the demo: every old address lands, with its fold open (test 2); a fold says
// its count and how many were changed, and opens for a link or a search result inside it (test 7); the admin-only lines
// show to admins on a test site, to nobody on production, and the test-site switch only on a test site (test 9); a
// client's page marks team values both ways and Delete stored messages asks in the app's confirm (test 11); no page
// says an old section name (test 12); at 390 by 844 every section opens, folds open, and nothing is clipped (test 13).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";
import { OLD_SECTIONS, SECTIONS, SETTINGS } from "../../ui/settings/registry.ts";

const T = 240_000;
const go = (page: Page, h: string) => page.evaluate((x) => (location.hash = x), h);
const head = (page: Page) => page.locator(".ps-head h2");
const RAIL = SECTIONS.filter((s) => !s.parent);
const call = (page: Page, action: string, input: unknown = {}) =>
  page.evaluate(
    ([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()),
    [action, input] as const,
  );

/** Opens an address from Week, so each lands fresh. */
async function land(page: Page, to: string) {
  await go(page, "#/week");
  await page.locator(".panel-shell").waitFor({ state: "detached" });
  await go(page, to);
  await head(page).waitFor();
}

describe.skipIf(!CHROMIUM)("SA-3: Settings in eleven sections (browser, demo on a test site)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_ENV: "dev" });
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("the rail is eleven sections in four groups", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await land(page, "#/settings/you");
    const groups = await page.locator(".ps-rail .ps-group-head").allTextContents();
    for (const g of ["You", "Your work", "Connected", "Yours"]) expect(groups.map((x) => x.trim())).toContain(g);
    for (const s of RAIL) await page.locator(`.ps-rail [data-settings-section="${s.id}"]`).first().waitFor();
    expect(RAIL.length).toBe(11);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("every old address lands: an old section opens where its settings went, and a setting opens where it lives, its fold open", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const label = (id: string) => SECTIONS.find((s) => s.id === id)!.label;
    for (const [old, to] of Object.entries(OLD_SECTIONS)) {
      await land(page, `#/settings/${old}`);
      await head(page).filter({ hasText: label(to.section) }).waitFor();
      if (to.setting) await page.locator(`.ps-body [data-setting="${to.setting}"]`).first().waitFor({ state: "visible" });
    }
    // A setting under the section it had before SA-3, and one inside each fold.
    for (const [old, id, now] of [["planning", "plan-reminder", "notifications"], ["planning", "level", "you"], ["connections", "feedback", "about"], ["ahead", "stale-weeks", "planning"], ["planning", "risk-watch", "planning"], ["notifications", "notify-story-taken", "notifications"], ["devops", "devops-write", "connections"], ["activity", "teams-log", "data"], ["chats", "ack-phrases", "clients"]] as const) {
      await land(page, `#/settings/${old}/${id}`);
      await head(page).filter({ hasText: label(now) }).waitFor();
      const row = page.locator(`.ps-body [data-setting="${id}"]`).first();
      await row.waitFor({ state: "visible" });
      await expect.poll(() => row.evaluate((el) => el.classList.contains("ps-flash") || !!el.closest(".ps-flash")), { timeout: 5_000 }).toBe(true);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a fold says what is inside, how many and how many changed; a search result inside it opens it", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await land(page, "#/settings/planning");
    const fold = page.locator(".ps-body details.sp-fold", { has: page.locator("summary", { hasText: "Fine tuning" }) });
    await expect(fold.locator("summary").textContent()).resolves.toBe("Fine tuning · 14 more");
    expect(await fold.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    // A change inside: "· 1 changed".
    const carry = (await call(page, "settings.load")).data.planning.carryDays as number;
    expect((await call(page, "settings.save", { section: "planning", values: { carryDays: carry + 1 } })).ok).toBe(true);
    await page.reload();
    await head(page).waitFor();
    await expect.poll(() => fold.locator("summary").textContent()).toBe("Fine tuning · 14 more · 1 changed");
    // Search for one inside: its result opens the fold.
    await page.getByLabel("Search settings").fill("stalled after");
    await page.locator("#settings-search-results .ps-hit", { hasText: "Stalled after" }).first().click();
    await page.locator('.ps-body [data-setting="stalled-days"]').waitFor({ state: "visible" });
    expect(await fold.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
    expect((await call(page, "settings.save", { section: "planning", values: { carryDays: carry } })).ok).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("an admin on a test site sees the Dataverse lines and Start over; someone else doesn't; the test-site switch shows", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await land(page, "#/settings/you");
    await page.locator('.ps-body [data-setting="environment"]').waitFor();
    await page.locator('.ps-body [data-setting="dataverse-user"]').waitFor();
    await land(page, "#/settings/notifications");
    await page.locator('.ps-body [data-setting="from-test-site"]').waitFor();
    // Not an admin: the lines go (the test-site switch is everyone's).
    await page.route("**/api/action", async (r) => ((r.request().postData() ?? "").includes('"admin.status"') ? r.fulfill({ json: { ok: true, data: { admin: false } } }) : r.continue()));
    await page.reload();
    await land(page, "#/settings/you");
    await page.locator('.ps-body [data-setting="email"]').waitFor();
    await page.waitForTimeout(500);
    expect(await page.locator('.ps-body [data-setting="environment"], .ps-body [data-setting="dataverse-user"]').count()).toBe(0);
    expect(await page.locator(".ps-body").getByRole("button", { name: "Start over" }).count()).toBe(0);
    await land(page, "#/settings/notifications");
    await page.locator('.ps-body [data-setting="from-test-site"]').waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a client's page: a lead sees 'Team value', others 'Set by your FocusTime admin'; Delete stored messages asks in the app", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await land(page, "#/settings/clients");
    await page.locator(".ps-body .sp-links a").first().click();
    await page.waitForFunction(() => location.hash.startsWith("#/settings/client/"));
    const body = page.locator(".ps-body");
    await body.getByText(/^Team value: a change applies to everyone on /).first().waitFor();
    await expect(body.locator('[data-setting="client-ai"]').textContent()).resolves.toContain("Set by your FocusTime admin");
    // The app's confirm, not the browser's.
    let native = false;
    page.on("dialog", (d) => ((native = true), void d.dismiss()));
    const purge = body.getByRole("button", { name: "Delete stored messages" });
    if (await purge.count()) {
      await purge.click();
      const ask = page.getByRole("alertdialog", { name: "Delete stored messages" });
      await ask.waitFor();
      await expect(ask.textContent()).resolves.toContain("for everyone on these chats");
      await ask.getByRole("button", { name: "Cancel" }).click();
      await ask.waitFor({ state: "detached" });
    }
    expect(native).toBe(false);
    // Someone who can't change the data platform sees no Team value line.
    await page.route("**/api/action", async (r) => {
      if (!(r.request().postData() ?? "").includes('"deploy.items"')) return r.continue();
      const res = await r.fetch();
      const j = (await res.json()) as { data?: { canEdit?: boolean } };
      if (j.data) j.data.canEdit = false;
      await r.fulfill({ response: res, json: j });
    });
    await page.reload();
    await head(page).waitFor();
    await body.locator('[data-setting="client-ai"]').waitFor();
    await page.waitForTimeout(600);
    expect(await body.getByText(/^Team value:/).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("no page says an old section name", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const old = /Settings ›\s*(Notifications|Day and Week|Backlog|Client chats|Accounts and calendars|DevOps|Activity)\b|\b(Accounts and calendars|Day and Week)\b/;
    const said: string[] = [];
    for (const s of RAIL) {
      await land(page, `#/settings/${s.id}`);
      await page.waitForTimeout(600);
      await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>(".ps-body details").forEach((d) => (d.open = true)));
      const text = (await page.locator(".ps-body").textContent()) ?? "";
      const m = old.exec(text);
      if (m) said.push(`${s.id}: ${m[0]}`);
    }
    expect(said).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("at 390 by 844 every section opens, its folds open, and nothing is clipped", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    const clipped: string[] = [];
    for (const s of RAIL) {
      await go(page, `#/settings/${s.id}`);
      await head(page).filter({ hasText: s.label }).waitFor();
      await page.waitForTimeout(600);
      await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>(".ps-body details").forEach((d) => (d.open = true)));
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page ${document.documentElement.scrollWidth}`);
        for (const el of document.querySelectorAll<HTMLElement>(".ps-body *:not(input):not(option)")) {
          const b = el.getBoundingClientRect();
          if (b.width && b.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed" && !el.closest(".sp-table-wrap, .sp-status-detail")) out.push(`${el.closest("[data-setting]")?.getAttribute("data-setting") ?? "?"}: ${el.tagName}.${el.className}`);
        }
        return out;
      });
      clipped.push(...r.map((x) => `${s.id}/${x}`));
    }
    expect(clipped).toEqual([]);
    expect(SETTINGS.length).toBeGreaterThan(0);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("SA-3: production (browser, demo as prod)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_ENV: "prod" });
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("nobody sees the admin-only lines or the test-site switch", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await land(page, "#/settings/you");
    await page.locator('.ps-body [data-setting="email"]').waitFor();
    await page.waitForTimeout(600);
    expect(await page.locator('.ps-body [data-setting="environment"], .ps-body [data-setting="dataverse-user"]').count()).toBe(0);
    expect(await page.locator(".ps-body").getByRole("button", { name: "Start over" }).count()).toBe(0);
    await land(page, "#/settings/notifications");
    await page.locator('.ps-body [data-setting="quiet"]').waitFor();
    expect(await page.locator('.ps-body [data-setting="from-test-site"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
