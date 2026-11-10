// FN-1 (browser, demo mode, Monday Nov 2, 9:30 AM): a story's title opens its card in FocusTime (#/item/<client>/<id>),
// never DevOps; the card's parent opens its own card; Esc closes and focus goes back; the ⋯ menu copies the DevOps
// link. Ticking a story opens Wrap it up: Finished and Made progress each write only after one preview and Confirm;
// closing the sheet keeps the tick and writes nothing. A client with DevOps writes off says so once a session. The phone shows both as full-height sheets with no sideways
// scroll at 360 (iOS conditions: a larger root font, bypassCSP). Screenshots to docs/ux/fn1 when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

let h: Harness;
const T = 120_000;
const TODAY = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const writes = async (page: Page) => ((await call(page, "devops.log", {})).data.entries as { op: string; itemId: number; status: string }[]).filter((e) => e.status === "confirmed" && !e.op.startsWith("undo"));

async function planToday(page: Page) {
  const st = await call(page, "planday.start", { date: TODAY });
  expect(st.error ?? "ok").toBe("ok");
  for (const itemId of [4411, 4412]) expect((await call(page, "pick.add", { date: TODAY, half: "AM", clientKey: "Cooptimize", itemId })).ok).toBe(true);
  expect((await call(page, "planday.commit", { date: TODAY })).ok).toBe(true);
  await page.reload();
  await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).waitFor();
}

describe.skipIf(!CHROMIUM)("FN-1 story card and Wrap it up (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a title opens the story card: fields, parent, comments, Copy DevOps link; the parent opens its own card; Esc closes", async () => {
    const { page, errors } = await freshPage(h);
    await planToday(page);
    const link = page.locator('main [data-card="Cooptimize:4411"]').first();
    await link.click();
    const card = page.getByRole("dialog", { name: /#4411/ });
    await card.waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/item/Cooptimize/4411");
    await card.locator(".sc-facts").waitFor();
    await expect(card.locator(".sc-state").textContent()).resolves.toBe("Active");
    await expect(card.getByRole("button", { name: "Copy DevOps link" }).count()).resolves.toBe(1);
    await expect(card.getByText("Open in DevOps").count()).resolves.toBe(0);
    await expect(card.getByRole("button", { name: "Wrap it up" }).count()).resolves.toBe(1);
    if (SHOTS) await shotBoth(page, "card", card);
    // The parent feature opens its own card; Back returns to the story's.
    await card.locator(".sc-parents .sc-link").last().click();
    await page.getByRole("dialog", { name: /#4410/ }).waitFor();
    await page.goBack();
    await page.getByRole("dialog", { name: /#4411/ }).waitFor();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    expect(await page.evaluate(() => location.hash)).not.toContain("#/item/");
    // A guessed address for a client I can't see reads nothing and says so.
    await page.evaluate(() => (location.hash = "#/item/Nobody/1"));
    await expect.poll(() => page.locator(".story-card .sc-note").textContent()).toContain("don't have access");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a to-do's ⋯ copies the DevOps link and has no Open in browser", async () => {
    const { page, errors } = await freshPage(h);
    await planToday(page);
    const row = page.locator("main .pick-row", { hasText: "Timesheet summary query" }).first();
    await row.hover();
    await row.getByRole("button", { name: /More|⋯|Actions/ }).first().click();
    const menu = page.locator("[data-menu]").last();
    await menu.waitFor();
    await expect(menu.getByText("Copy DevOps link").count()).resolves.toBe(1);
    await expect(menu.getByText(/Open in (browser|DevOps)/).count()).resolves.toBe(0);
    if (SHOTS) await shotBoth(page, "menu-copy-link", menu);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("ticking a story opens Wrap it up: Finished with a comment, one preview, Confirm writes; closing writes nothing", async () => {
    const { page, errors } = await freshPage(h);
    await planToday(page);
    const before = (await writes(page)).length;
    await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).check();
    const sheet = page.getByRole("dialog", { name: "Wrap it up" });
    await sheet.waitFor();
    await expect(sheet.getByRole("radio", { name: /Finished/ }).getAttribute("aria-checked")).resolves.toBe("true");
    await sheet.getByRole("textbox").first().fill("Query returns weekly totals per person");
    if (SHOTS) await shotBoth(page, "wrap-finished", sheet);
    expect((await writes(page)).length).toBe(before);
    await sheet.getByRole("button", { name: "Preview" }).click();
    await expect.poll(() => sheet.locator(".wrap-summary").textContent()).toContain("#4411: state Active → Closed · add comment");
    if (SHOTS) await shotBoth(page, "wrap-preview", sheet);
    expect((await writes(page)).length).toBe(before);
    await sheet.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => sheet.getByRole("status").textContent()).toMatch(/saved to DevOps/);
    expect((await writes(page)).length).toBeGreaterThan(before);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => page.getByRole("dialog", { name: "Wrap it up" }).count()).toBe(0);

    // Made progress on the New story: it moves to Active, with the time left and a comment; the tick stays.
    const n = (await writes(page)).length;
    await page.getByRole("checkbox", { name: "Done: Utilization chart" }).check();
    await sheet.waitFor();
    await sheet.getByRole("radio", { name: /Made progress/ }).click();
    await sheet.getByRole("button", { name: "1h", exact: true }).click();
    await sheet.getByRole("textbox").last().fill("Chart draws; legend next");
    if (SHOTS) await shotBoth(page, "wrap-progress", sheet);
    await sheet.getByRole("button", { name: "Preview" }).click();
    await expect.poll(() => sheet.locator(".wrap-summary").textContent()).toContain("#4412: state New → Active");
    await sheet.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => sheet.getByRole("status").textContent()).toMatch(/saved to DevOps/);
    expect((await writes(page)).length).toBeGreaterThan(n);
    await sheet.getByRole("button", { name: "Done" }).click();

    // Untick and tick again, then close the sheet: the tick stays and nothing more is written.
    await page.getByRole("checkbox", { name: "Done: Utilization chart" }).uncheck();
    const m = (await writes(page)).length;
    await page.getByRole("checkbox", { name: "Done: Utilization chart" }).check();
    const again = page.getByRole("dialog", { name: "Wrap it up" });
    if (await again.isVisible({ timeout: 5_000 }).catch(() => false)) await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("dialog", { name: "Wrap it up" }).count()).toBe(0);
    await expect(page.getByRole("checkbox", { name: "Done: Utilization chart" }).isChecked()).resolves.toBe(true);
    expect((await writes(page)).length).toBe(m);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a tick on a client with DevOps writes off says so once a session, linking to Settings › DevOps", async () => {
    const { page, errors } = await freshPage(h);
    // The demo has writes on for every client (and won't clear a PAT): the page is told Cooptimize's are off.
    await page.route("**/api/action", async (route) => {
      if ((route.request().postDataJSON() as { action?: string })?.action !== "week.load") return route.continue();
      const res = await route.fetch();
      const body = (await res.json()) as { ok: boolean; data?: { devopsWrite?: string[] } };
      if (body.data?.devopsWrite) body.data.devopsWrite = body.data.devopsWrite.filter((k) => k !== "Cooptimize");
      await route.fulfill({ response: res, json: body });
    });
    await planToday(page);
    const hint = page.getByRole("status").filter({ hasText: "DevOps updates are off for this client" });
    await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).check();
    await hint.waitFor();
    await expect(page.getByRole("dialog", { name: "Wrap it up" }).count()).resolves.toBe(0);
    if (SHOTS) await shotBoth(page, "writes-off-hint", hint);
    await hint.getByRole("button", { name: "Turn them on in Settings › DevOps" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toContain("#/settings/devops");
    await page.goBack();
    // Once a session: the next tick says nothing.
    await page.getByRole("checkbox", { name: "Done: Utilization chart" }).check();
    await page.waitForTimeout(1000);
    await expect(hint.count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("phone at 360: the card and the sheet are full-height sheets with no sideways scroll", async () => {
    const page = await h.browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, bypassCSP: true });
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      // iOS: a larger root font than Chromium's default.
      document.addEventListener("DOMContentLoaded", () => {
        const st = document.createElement("style");
        st.textContent = "html{font-size:17px}";
        document.head.append(st);
      });
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.locator("main.today-view").waitFor();
    await planToday(page);
    await page.evaluate(() => (location.hash = "#/item/Cooptimize/4411"));
    const card = page.getByRole("dialog", { name: /#4411/ });
    await card.locator(".sc-facts").waitFor();
    const wide = () => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, card: (document.querySelector(".story-card") ?? document.querySelector(".wrap-sheet"))!.scrollWidth, cw: (document.querySelector(".story-card") ?? document.querySelector(".wrap-sheet"))!.clientWidth }));
    let w = await wide();
    expect(w.doc).toBeLessThanOrEqual(w.win);
    expect(w.card).toBeLessThanOrEqual(w.cw);
    const box = await card.boundingBox();
    expect(box!.height).toBeGreaterThan(700);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/card-phone.png` });
    await card.getByRole("button", { name: "Wrap it up" }).click();
    const sheet = page.getByRole("dialog", { name: "Wrap it up" });
    await sheet.waitFor();
    w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, card: document.querySelector(".wrap-sheet")!.scrollWidth, cw: document.querySelector(".wrap-sheet")!.clientWidth }));
    expect(w.doc).toBeLessThanOrEqual(w.win);
    expect(w.card).toBeLessThanOrEqual(w.cw);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/wrap-phone.png` });
    await page.close();
  }, T);
});
