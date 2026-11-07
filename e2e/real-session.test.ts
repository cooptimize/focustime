// no-demo-leak: a real (not demo) session, signed in as a fake person with fake live sources (Dataverse and DevOps
// answering from test fakes, no calendars set up). Every screen and picker is read for the demo's names and the old
// sample meetings: none may show. Then each source fails in turn: the screen says so with its fix, never stand-in data.
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatch } from "../actions/dispatch.ts";
import { DEMO_CLIENTS, DEMO_PEOPLE } from "../sources/demo/data.ts";
import { CHROMIUM, openCaptures } from "./harness.ts";
import { liveBrowser, liveContext as live, T, type LiveBrowser, type LiveOptions } from "./live.ts";

const liveContext = (o?: LiveOptions) => live(o);
let lb: LiveBrowser;
const start = async (ctx: Promise<Awaited<ReturnType<typeof live>>>) => lb.start(await ctx);

/** What only the demo (or the old sample week) has: its clients, its people, the sample meetings. */
const DEMO_WORDS = [
  ...DEMO_CLIENTS.filter((c) => c.key !== "Cooptimize").flatMap((c) => [c.key, c.name]),
  ...DEMO_PEOPLE.map((p) => p.name),
  "Proseware sprint planning",
  "Adatum Power BI walkthrough",
  "Preschool drop-off",
  "Sample meetings",
  "Demo data",
];

/** Every demo word on the page (its text and its titles), with a little context. */
async function demoWordsOn(page: Page): Promise<string[]> {
  const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  const titles = await page.locator("[title], [aria-label]").evaluateAll((els) => els.map((e) => `${e.getAttribute("title") ?? ""} ${e.getAttribute("aria-label") ?? ""}`));
  const all = [body, ...titles].join(" | ");
  return DEMO_WORDS.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(all)).map((w) => {
    const i = all.indexOf(w);
    return `${w}: …${all.slice(Math.max(0, i - 50), i + 50)}…`;
  });
}

const SCREENS: [string, string, string][] = [
  ["Today", "#/today", ".today-view"],
  ["Plan the day", "#/today/plan", ".pd2-status"],
  ["Check-in", "#/today/checkin", "main"],
  ["Close out", "#/today/closeout", "main"],
  ["Week", "#/week", ".week-head"],
  ["Plan the week", "#/week/plan/2026-11-02", ".pw-client, .pw-empty, .planweek"],
  ["Ahead › Grid", "#/ahead", ".ahead"],
  ["Ahead › Gantt", "#/ahead/gantt", ".ahead"],
  ["Inbox › Captures", "#/inbox/captures", "main"],
];

describe.skipIf(!CHROMIUM)("a real session never shows demo data (no-demo-leak)", () => {
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  });

  it("the fake live sources answer as a real person's (the check below has something to look at)", async () => {
    const ctx = await liveContext();
    const r = await dispatch(ctx, { action: "settings.load", input: {} });
    expect(r.ok).toBe(true);
    const keys = (r.ok ? (r.data as { clients: { key: string }[] }).clients : []).map((c) => c.key);
    expect(keys.length).toBeGreaterThan(0);
    // Only Dataverse's clients: none from the settings' colors alone (the fixture's T&W, Proseware, Adatum colors).
    expect(keys).not.toContain("Proseware");
  });

  it("every screen, the client panel, Settings > Clients and the capture client picker: no demo client, person or sample meeting", async () => {
    const app = await start(liveContext());
    try {
      const page = await app.page();
      await page.goto(app.url);
      await page.waitForSelector(".topbar", { timeout: 60_000 });
      const found: string[] = [];
      for (const [name, hash, ready] of SCREENS) {
        await page.evaluate((h) => (location.hash = h), hash);
        await page.locator(ready).first().waitFor({ timeout: 20_000 });
        await page.waitForTimeout(800);
        for (const w of await demoWordsOn(page)) found.push(`${name}: ${w}`);
        // Positive control: this is the fake person's live data (Dataverse's focus blocks), not an empty page.
        if (name === "Week") await expect(page.evaluate(() => document.body.innerText)).resolves.toMatch(/Adatum/);
      }
      // Plan the week's client panel (the detail panel) when there is a client line.
      await page.evaluate(() => (location.hash = "#/week/plan/2026-11-02"));
      const nameBtn = page.locator(".pw-name").first();
      if (await nameBtn.count()) {
        await nameBtn.click();
        await page.waitForTimeout(500);
        for (const w of await demoWordsOn(page)) found.push(`Client panel: ${w}`);
        await page.keyboard.press("Escape");
      }
      // Settings > Clients.
      // HK-5: by its address. The old tab or button named Clients wasn't there, the swallowed click went on after 10 s,
      // and this scanned whatever Settings showed, never Settings > Clients.
      await page.evaluate(() => (location.hash = "#/settings/clients"));
      await page.locator(".ps-body .set-client-list").first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
      for (const w of await demoWordsOn(page)) found.push(`Settings > Clients: ${w}`);
      await page.keyboard.press("Escape");
      // The capture box's client picker.
      await page.evaluate(() => (location.hash = "#/today"));
      await openCaptures(page);
      await page.waitForTimeout(800);
      for (const w of await demoWordsOn(page)) found.push(`Capture: ${w}`);
      expect(found).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);

  it("calendars that aren't set up say so with where to set them up; no stand-in meetings", async () => {
    const r = await dispatch(await liveContext(), { action: "week.load", input: { weekStart: "2026-11-02" } });
    expect(r.ok).toBe(true);
    const sources = r.ok ? (r.data as { sources: { source: string; status: string; message?: string; fixAction?: string; itemCount: number; sample?: boolean }[] }).sources : [];
    for (const s of sources.filter((x) => x.source === "outlook" || x.source === "google")) {
      expect(s).toMatchObject({ status: "misconfigured", fixAction: "open_settings", itemCount: 0 });
      expect(s.message).toMatch(/isn't set up yet\. Set it up in Settings > Connections/);
      expect(s.sample).toBeFalsy();
    }
  });

  it("Dataverse down: the week says so with the fix, and shows no stand-in clients", async () => {
    const app = await start(liveContext({ dataverse: "network_down" }));
    try {
      const page = await app.page();
      await page.goto(app.url);
      await page.waitForSelector(".topbar", { timeout: 60_000 });
      await page.evaluate(() => (location.hash = "#/week"));
      await page.waitForTimeout(1500);
      const body = await page.evaluate(() => document.body.innerText);
      expect(body).toMatch(/Dataverse/);
      expect(body).toMatch(/Retry|Refresh|Settings|reach/i);
      expect(await demoWordsOn(page)).toEqual([]);
      // Settings > Clients explains instead of listing guesses.
      const s = await dispatch(await liveContext({ dataverse: "network_down" }), { action: "settings.load", input: {} });
      const d = s.ok ? (s.data as { clients: { key: string }[]; dataverseProblem: string | null }) : null;
      // Only the internal client (always followed); nothing guessed for the rest.
      expect(d?.clients.map((c) => c.key)).toEqual(["Cooptimize"]);
      expect(d?.dataverseProblem).toBe("Couldn't reach Dataverse. Try again, or tell the FocusTime team.");
    } finally {
      await app.close();
    }
  }, T);

  it("DevOps down: Plan the week says so per client, and offers no stand-in items", async () => {
    const app = await start(liveContext({ devopsDown: true }));
    try {
      const page = await app.page();
      await page.goto(app.url);
      await page.waitForSelector(".topbar", { timeout: 60_000 });
      await page.evaluate(() => (location.hash = "#/week/plan/2026-11-02"));
      await page.waitForTimeout(2000);
      const body = await page.evaluate(() => document.body.innerText);
      expect(body).toMatch(/DevOps/);
      expect(await demoWordsOn(page)).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
