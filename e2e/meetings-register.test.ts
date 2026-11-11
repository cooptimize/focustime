// MC-1c: registering a client call in demo mode, Admin › Clients › <client> › Meetings. The demo's calendar
// (sources/demo/meetings-graph.ts) holds a weekly call Priya organizes at Cooptimize; a pasted link finds one Jordan
// organizes; one link stands for Microsoft not answering. Both teammate-organized calls register as Automatic; the
// failure shows its plain words beside the link and keeps what was typed; each registered call shows its last-read line.
// With FOCUSTIME_SHOTS set, screenshots at 1440×900, light and dark.
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";
import { GRAPH_WORDS } from "../actions/meeting-actions.ts";

let h: Harness;
const T = 120_000;
const UNREACHABLE = "https://teams.microsoft.com/l/meetup-join/19%3ademo-unreachable%40thread.v2/0";
const TEAMMATE = "https://teams.microsoft.com/l/meetup-join/19%3ademo-atlas-planning%40thread.v2/0";

async function shots(page: Page, name: string, keep: ReturnType<Page["locator"]>) {
  if (!SHOTS) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((light) => (light ? document.documentElement.setAttribute("data-theme", "cooptimize-light") : document.documentElement.removeAttribute("data-theme")), scheme === "light");
    await page.waitForTimeout(200);
    await keep.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
}

const meetingsOf = (page: Page, client: string) => page.locator(".adm-client", { hasText: client }).first().locator(".mtg-admin");

describe.skipIf(!CHROMIUM)("registering a client call (browser, demo mode, MC-1c)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("registers a teammate's call from my calendar and by pasted link; a failure says why beside the link and keeps the form", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/settings/admin-clients"));

    // From my calendar, for Harbor (a client the demo person keeps no meeting of): Priya organizes it at Cooptimize.
    const harbor = meetingsOf(page, "Harbor");
    await harbor.waitFor({ timeout: 60_000 });
    await harbor.getByRole("button", { name: "Register a meeting" }).click();
    const cand = harbor.locator(".mtg-cand", { hasText: "Harbor Health weekly sync" });
    await cand.waitFor({ timeout: 30_000 });
    await expect(cand.textContent()).resolves.toContain("Priya Shah organizes it at Cooptimize");
    await cand.locator("input").check();
    await shots(page, "mc1c-organizer", harbor);
    await harbor.getByRole("button", { name: "Register", exact: true }).click();
    const card = harbor.locator(".mtg-card", { hasText: "Harbor Health weekly sync" });
    await card.waitFor({ timeout: 30_000 });
    await expect(card.locator("select").nth(1).inputValue()).resolves.toBe("automatic");
    await expect(card.locator(".mtg-last-read").textContent()).resolves.toBe("Not read yet: the first call is Tue, Nov 10");

    // By pasted link, for Atlas: Microsoft isn't answering. The words show under the link; the link and name stay.
    const atlas = meetingsOf(page, "Atlas");
    await atlas.getByRole("button", { name: "Register a meeting" }).click();
    await atlas.getByRole("button", { name: "Paste a Teams link" }).click();
    await atlas.getByLabel("Teams join link").fill(UNREACHABLE);
    await atlas.getByLabel("Name").fill("Atlas planning");
    await atlas.getByRole("button", { name: "Register", exact: true }).click();
    const problem = atlas.locator(".mtg-link .mtg-problem");
    await problem.waitFor({ timeout: 30_000 });
    await expect(problem.textContent()).resolves.toMatch(/^Microsoft isn't answering right now\. Try again in a minute\. Or give its weekday, start time and length below/);
    await expect(page.locator("text=bad request").count()).resolves.toBe(0);
    await expect(atlas.getByLabel("Teams join link").inputValue()).resolves.toBe(UNREACHABLE);
    await expect(atlas.getByLabel("Name").inputValue()).resolves.toBe("Atlas planning");
    await expect(atlas.getByLabel("Weekday").count()).resolves.toBe(1);
    await shots(page, "mc1c-failure-busy", atlas);

    // The teammate's link: found on my calendar, registered as Automatic; the problem is gone.
    await atlas.getByLabel("Teams join link").fill(TEAMMATE);
    await atlas.getByRole("button", { name: "Register", exact: true }).click();
    const acard = atlas.locator(".mtg-card", { hasText: "Atlas planning" });
    await acard.waitFor({ timeout: 30_000 });
    await expect(acard.locator("select").nth(1).inputValue()).resolves.toBe("automatic");
    await expect(atlas.locator(".mtg-problem").count()).resolves.toBe(0);

    // The demo's seeded Northwind call (Upload) shows its last read: when its transcript was uploaded.
    const north = meetingsOf(page, "Northwind").locator(".mtg-card").first();
    await expect.poll(() => north.locator(".mtg-last-read").textContent()).toMatch(/^Transcript uploaded Nov 5, /);
    await shots(page, "mc1c-meetings", meetingsOf(page, "Northwind"));
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  // Screenshots only: each failure's words beside the calendar list, as the server words them (GRAPH_WORDS).
  it.skipIf(!SHOTS)("each failure's message beside the calendar list", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    for (const code of ["signin", "consent", "graph_refused", "setup"] as const) {
      const w = GRAPH_WORDS[code === "graph_refused" ? "refused" : code];
      await page.unroute("**/api/action");
      await page.route("**/api/action", async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string };
        if (body.action === "meeting.candidates") return route.fulfill({ status: w.status, contentType: "application/json", body: JSON.stringify({ ok: false, status: w.status, error: w.error, code }) });
        return route.continue();
      });
      await page.evaluate(() => (location.hash = "#/settings/admin-clients"));
      await page.reload();
      const harbor = meetingsOf(page, "Harbor");
      await harbor.waitFor({ timeout: 60_000 });
      await harbor.getByRole("button", { name: "Register a meeting" }).click();
      await harbor.locator(".mtg-cands .mtg-problem").waitFor({ timeout: 30_000 });
      await shots(page, `mc1c-failure-${code}`, harbor);
    }
    await page.close();
  }, T);
});
