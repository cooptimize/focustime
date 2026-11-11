// A2 regression: a session whose Microsoft identity can't be read yet (signed in to FocusTime, Outlook needing sign-in
// again) once rendered the Outlook chip as a tall block down the page, pushed the status bar to the middle, and left
// the top bar an empty tab strip. Here the demo's answers are changed in flight to that state, and the bars measured.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const NEEDS = "Outlook needs you to sign in again";

/** Answers as the live app gave them: auth.status signed out with a renewal message, Outlook auth_required. */
async function needsSignIn(page: Page) {
  await page.route("**/api/action", async (route) => {
    const req = route.request();
    const action = (() => {
      try {
        return (JSON.parse(req.postData() ?? "{}") as { action?: string }).action;
      } catch {
        return undefined;
      }
    })();
    if (action === "auth.status")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { configured: true, state: "signed_out", person: null, message: "Your Microsoft sign-in needs renewing. Sign in again" } }) });
    const res = await route.fetch();
    if (action !== "week.load") return route.fulfill({ response: res });
    const body = (await res.json()) as unknown;
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      if (o.source === "outlook" && "status" in o) Object.assign(o, { status: "auth_required", message: NEEDS, fixAction: "connect_microsoft", fromCache: true, sample: false });
      Object.values(o).forEach(walk);
    };
    walk(body);
    return route.fulfill({ response: res, body: JSON.stringify(body) });
  });
}

describe.skipIf(!CHROMIUM)("Outlook needs sign-in and no Microsoft identity yet (A2)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("keeps the status bar one line at the bottom and the top bar whole, with a Sign in button", async () => {
    const page = await h.browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".topbar", { timeout: 30_000 });
    // A session now; from here on the answers are the live app's state.
    await needsSignIn(page);
    await page.reload();
    await page.waitForSelector(".topbar, .statusbar", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.keyboard.press("2");
    await page.waitForTimeout(1500);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const top = await box(".topbar");
    const bar = await box(".statusbar");
    const chip = await box(".statusbar .source.signin");
    // The top bar is one row; the status bar is its row of chips plus the one cause line, at the bottom of the
    // viewport; the Outlook chip is one line (it once grew to the page's height).
    expect(top.height).toBeLessThan(80);
    expect(bar.height).toBeLessThan(100);
    expect(bar.y + bar.height).toBeGreaterThan(1080 - 4);
    expect(chip.height).toBeLessThan(32);
    const row = await box(".statusbar .source:not(.signin)");
    expect(Math.abs(chip.y + chip.height / 2 - (row.y + row.height / 2))).toBeLessThan(4);
    // "needs sign-in" is an inline link in the chip.
    await expect(page.locator(".statusbar").getByRole("button", { name: /needs sign-in/ }).count()).resolves.toBeGreaterThan(0);
    // The top bar: the mark, the tabs and a Sign in button (no account yet).
    await expect(page.locator(".topbar .brand, .topbar .lockup, .topbar svg").first().isVisible()).resolves.toBe(true);
    for (const tab of ["Day", "Week", "Ahead", "Inbox", "Status"]) await expect(page.locator(".topbar").getByRole("tab", { name: new RegExp(tab) }).or(page.locator(".topbar").getByRole("button", { name: new RegExp(`^${tab}`) })).count()).resolves.toBeGreaterThan(0);
    await expect(page.locator(".topbar").getByRole("button", { name: "Sign in", exact: true }).isVisible()).resolves.toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
