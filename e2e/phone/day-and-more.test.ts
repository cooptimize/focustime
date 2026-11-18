// PH-1: the phone's new bar, Day, More and the Desktop version, in the browser on the demo (a fictional person, Mon
// Nov 2 2026), at phone size with the iPhone's 17 px root font. The bar's five items at 390 by 844 and 360 by 640 at
// each Text size; the Now card in each state the demo can reach today (the demo never makes today PTO or a holiday,
// WK-5); tick, Start focus, Done, Stop and Add from Now; the one thing that needs you; every place of STEP 0.3's list
// from More, by tap and by keyboard; the Desktop version on, kept, back, and with storage refused; nothing of the
// phone at 1280 and 768. Pictures for the pull request when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page, Request } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { call, phonePage, planMonday } from "../mb1-helpers.ts";
import { SHOTS } from "../shots.ts";

const T = 240_000;
const MON = "2026-11-02";
const at = (hm: string, date = MON) => `${date}T${hm}:00-05:00`;

/** Opens the app at an instant (the page's clock) and an address, and waits for the loader to go. */
async function open(page: Page, h: Harness, hash: string, now?: string) {
  const base = h.url.split("?")[0]!;
  const q = now ? `?now=${encodeURIComponent(now)}` : `?${h.url.split("?")[1] ?? ""}`;
  // A fresh page each time: going to the same address with another # alone wouldn't reload it.
  const to = `${base}${q}${hash}`;
  const same = page.url().split("#")[0] === to.split("#")[0];
  await page.goto(to);
  if (same) await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
}
async function shot(page: Page, name: string, light = false) {
  if (!SHOTS) return;
  if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-light"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}${light ? "-light" : "-dark"}.png` });
  if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-dark"));
}
const bar = (page: Page) => page.getByRole("navigation", { name: "Tabs" });
const card = (page: Page) => page.locator(".pn-card");
const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
  return errors;
};

describe.skipIf(!CHROMIUM)("PH-1: the phone's bar, Day and More (Monday)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(() => h?.stop());

  it("the bar's five items and the top bar, at 390 by 844 and 360 by 640, at each Text size", async () => {
    const page = await phonePage(h, 390);
    const errors = errorsOf(page);
    for (const [w, ht] of [[390, 844], [360, 640]] as const) {
      await page.setViewportSize({ width: w, height: ht });
      for (const size of [null, "large", "larger"]) {
        await page.evaluate((s) => (s ? document.documentElement.setAttribute("data-text-size", s) : document.documentElement.removeAttribute("data-text-size")), size);
        await page.waitForTimeout(150);
        const items = await bar(page).evaluate((nav) =>
          [...nav.querySelectorAll("button")].map((b) => {
            const r = b.getBoundingClientRect();
            const label = b.querySelector(".pb-label");
            const lr = label?.getBoundingClientRect();
            return { name: b.getAttribute("aria-label") ?? b.textContent?.replace(/\d+/g, "").trim(), w: r.width, h: r.height, bottom: r.bottom, clipped: !!label && (label.scrollWidth > label.clientWidth + 1 || lr!.left < r.left - 1 || lr!.right > r.right + 1 || lr!.bottom > r.bottom + 1) };
          }),
        );
        const where = `${w} px, ${size ?? "default"}`;
        expect(items.map((i) => i.name.replace(/, \d+$|: .*$/, "")), where).toEqual(["Day", "Week", "Capture", "Inbox", "More"]);
        for (const i of items) {
          expect(Math.min(i.w, i.h), `${i.name} at ${where}`).toBeGreaterThanOrEqual(44);
          expect(i.clipped, `${i.name}'s label at ${where}`).toBe(false);
          expect(i.bottom, `${i.name} above the bottom at ${where}`).toBeLessThanOrEqual(ht + 0.5);
        }
        // The top bar on one line: its date, Demo, the VM and Ask share one row, nothing past the edge.
        const top = await page.locator(".topbar").evaluate((t) => {
          const kids = [...t.querySelectorAll(".ph1-date, .demo-tag, .vm-chip, .ph-ask")].map((e) => e.getBoundingClientRect());
          return { rows: new Set(kids.map((r) => Math.round(r.top + r.height / 2))).size <= 1 || Math.max(...kids.map((r) => r.top)) - Math.min(...kids.map((r) => r.top)) < 24, over: t.scrollWidth - t.clientWidth, demo: (t.querySelector(".demo-tag") as HTMLElement | null)?.scrollWidth ?? 0, demoW: (t.querySelector(".demo-tag") as HTMLElement | null)?.clientWidth ?? 0 };
        });
        expect(top.rows, `the top bar on one line at ${where}`).toBe(true);
        expect(top.over, where).toBeLessThanOrEqual(0);
        expect(top.demo, `Demo whole at ${where}`).toBeLessThanOrEqual(top.demoW + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), where).toBeLessThanOrEqual(0);
      }
    }
    await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));
    // The current place is marked for screen readers, not by color alone (weight and the mark above it).
    expect(await bar(page).locator('[aria-current="page"]').getAttribute("data-tab")).toBe("day");
    expect(await bar(page).locator('[aria-current="page"]').evaluate((b) => getComputedStyle(b).fontWeight)).toBe("600");
    // The bar's Needs you count is the Inbox's.
    expect(await page.locator(".pb-count").textContent()).toBe("5");
    // No status dot, no ⋯ in the top bar any more; Ask is there.
    expect(await page.locator(".topbar .status-dot-btn, .topbar .top-more").count()).toBe(0);
    await page.locator(".topbar").getByRole("button", { name: "Ask the assistant" }).click();
    await page.getByTestId("assistant-panel").waitFor();
    await page.keyboard.press("Escape");
    await shot(page, "ph1-bar");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the Now card: in a block with nothing planned (Add), in a block, in a meeting, focusing (Done, Stop), before the day and after it", async () => {
    const page = await phonePage(h, 390);
    const errors = errorsOf(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, h, "#/day", at("09:30"));
    // Nothing planned yet: says so, with Add (the block's add sheet).
    await expect.poll(() => card(page).textContent(), { timeout: 15_000 }).toMatch(/^Now\s*until 12:30Cooptimize3h left · a 45 min meeting at 11:00Nothing planned for this block\. Add$/);
    expect(await card(page).locator(".pn-bar").getAttribute("aria-label")).toBe("14% of the block has gone");
    await card(page).getByRole("button", { name: "Add to Cooptimize" }).click();
    await page.locator(".ph-sheet, .block-panel").first().waitFor();
    await page.keyboard.press("Escape");
    await planMonday(page);
    await open(page, h, "#/day", at("09:30"));
    await expect.poll(() => card(page).locator(".pn-title").textContent(), { timeout: 15_000 }).toBe("Write the migration notes for the customer export and share them with the delivery team");
    expect(await card(page).locator(".pn-sub").textContent()).toBe("M 2h");
    await shot(page, "ph1-now-block");
    // Next: the next meeting and the next block, with its risk, in time order.
    expect(await page.locator(".pn-next-row").allTextContents()).toEqual(["11:00 AMProposal review with Jordan45 min", "12:30 PMNorthwindAt risk · Dentist 12:00"]);
    // Today, under its own heading, by block.
    expect(await page.locator(".ph-todos .section-label").textContent()).toBe("Today");
    // Off Now: the day's arrows, Cards or Timeline, the Day menu, the suggestions line, the moment card, the urgent strip.
    expect(await page.locator(".day-bar, .day-switch, .pd-step, .sug-day-head, .moment-card, .urgent-strip, .day-chips, .ph-next").count()).toBe(0);

    // Start focus: the running session's time left, Done and Stop; Stop ends it, the to-do still open.
    await card(page).getByRole("button", { name: "Start focus" }).click();
    // Start focus opens the focus screen, as before; back on Now the card shows the session.
    await page.getByRole("button", { name: /^Back to Day/ }).click({ timeout: 15_000 });
    await card(page).getByRole("button", { name: "Stop" }).waitFor({ timeout: 15_000 });
    expect(await card(page).locator(".pn-now").textContent()).toBe("Focusing");
    await shot(page, "ph1-now-focusing");
    await card(page).getByRole("button", { name: "Stop" }).click();
    await card(page).getByRole("button", { name: "Start focus" }).waitFor({ timeout: 15_000 });
    // Start again, then Done: the session ends and the to-do is done.
    await card(page).getByRole("button", { name: "Start focus" }).click();
    await page.getByRole("button", { name: /^Back to Day/ }).click({ timeout: 15_000 });
    await card(page).getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(async () => (await call(page, "week.load", {}) as unknown as { data: { plan: Record<string, { picks: { title: string; status: string }[] }> } }).data.plan[MON]!.picks.find((p) => p.title.startsWith("Write the migration"))?.status, { timeout: 15_000 }).toBe("done");

    await open(page, h, "#/day", at("11:05"));
    await expect.poll(() => card(page).locator(".pn-line").textContent(), { timeout: 15_000 }).toBe("In Proposal review with Jordan until 11:45");
    await shot(page, "ph1-now-meeting");

    // Tick the next one with the Done box: done at once, with Undo.
    const next = (await card(page).locator(".pn-title").textContent())!;
    expect(next).toBe("Review open pull requests");
    // Done at once: the card moves on to the next to-do, so the box itself is never left ticked.
    await card(page).getByRole("checkbox", { name: `Done: ${next}` }).click();
    const undo = page.locator(".undo-toast").getByRole("button", { name: /Undo/ });
    await undo.waitFor({ timeout: 15_000 });
    await undo.click();
    await expect.poll(async () => (await call(page, "week.load", {}) as unknown as { data: { plan: Record<string, { picks: { title: string; status: string }[] }> } }).data.plan[MON]!.picks.find((p) => p.title === next)?.status, { timeout: 15_000 }).toBe("planned");

    await open(page, h, "#/day", at("08:30"));
    await expect.poll(() => card(page).locator(".pn-tag").textContent(), { timeout: 15_000 }).toBe("Your day starts");
    expect(await card(page).locator(".pn-name").textContent()).toBe("9:00 · Cooptimize");
    await open(page, h, "#/day", at("18:30"));
    await expect.poll(() => card(page).textContent(), { timeout: 15_000 }).toBe("TodayDay doneNothing else is scheduled today.Close out");
    await shot(page, "ph1-now-after");
    // After the day, Close out is on the card (it left the moment card, which isn't on the phone's Day).
    await card(page).getByRole("button", { name: "Close out" }).click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/day\/closeout/);
    // Now in light.
    await open(page, h, "#/day", at("09:30"));
    await card(page).waitFor();
    await shot(page, "ph1-now-block", true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("between blocks (a day split for lunch): Free until, then the next block", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await call(page, "hours.set_day", { date: MON, segments: ["09:00-12:00", "13:00-17:00"] })).ok).toBe(true);
    await open(page, h, "#/day", at("12:20"));
    // The day's own hours make the afternoon an Open half-day in the demo, so the words name it as such.
    await expect.poll(() => card(page).textContent(), { timeout: 15_000 }).toBe("Between blocksFree until 1:00Then an open block, 1:00–5:00");
    await shot(page, "ph1-now-between");
    expect((await call(page, "hours.clear_day", { date: MON })).ok).toBe(true);
    await page.close();
  }, T);

  it("the one thing that needs you: the most pressing, 1 of the Inbox's count, opening in the Inbox", async () => {
    const page = await phonePage(h, 390);
    await open(page, h, "#/day", at("09:30"));
    const one = page.locator(".pn-one-row");
    await one.waitFor();
    const count = await page.locator(".pb-count").textContent();
    expect(await one.locator(".pn-one-of").textContent()).toBe(`1 of ${count}`);
    // The demo's late promise comes first.
    expect(await one.locator(".pn-one-why").textContent()).toBe("Late");
    await one.click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/inbox\/item\//);
    expect(await bar(page).locator('[aria-current="page"]').getAttribute("data-tab")).toBe("inbox");
    await page.close();
  }, T);

  it("More: each row opens its place, by tap; the state lines; the dot for new notifications", async () => {
    const page = await phonePage(h, 390);
    const errors = errorsOf(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, h, "#/day", at("09:30"));
    const more = () => bar(page).getByRole("button", { name: /^More/ });
    // The demo's notifications from this morning are new: More's dot says so (no source needs attention).
    expect(await more().getAttribute("aria-label")).toBe("More: new notifications");
    expect(await page.locator(".pb-dot").count()).toBe(1);
    await more().click();
    const screen = page.getByRole("main", { name: "More" });
    await screen.waitFor();
    expect(await bar(page).locator('[aria-current="page"]').getAttribute("data-tab")).toBe("more");
    const rows = await screen.locator(".mr-row").evaluateAll((els) => els.map((e) => [e.querySelector(".mr-name")?.textContent, e.querySelector(".mr-line")?.textContent ?? null, Math.round(e.getBoundingClientRect().height)] as const));
    expect(rows.map((r) => r[0])).toEqual(["Calls", "Backlog", "Status", "Code", "My VM", "Settings", "Guide", "Everything else", "Desktop version"]);
    for (const r of rows) expect(r[2], r[0]!).toBeGreaterThanOrEqual(56);
    expect(Object.fromEntries(rows.map((r) => [r[0], r[1]]))).toMatchObject({ Status: "2 features need your update", Calls: "1 call to review", "My VM": "Stopped (deallocated)" });
    await shot(page, "ph1-more");
    await screen.getByRole("button", { name: /Everything else/ }).click();
    const inner = page.getByRole("main", { name: "Everything else" });
    await inner.waitFor();
    expect(await inner.locator(".mr-name").allTextContents()).toEqual(["Notifications", "Sources", "Focus", "Midday check-in", "Close out", "Alex Rivera", "Technical docs", "About", "Admin"]);
    expect(await inner.locator(".mr-row", { hasText: "Sources" }).locator(".mr-line").textContent()).toBe("All sources live");
    await shot(page, "ph1-everything-else");
    // Esc: back to More, then out of More.
    await page.keyboard.press("Escape");
    await screen.waitFor();
    await page.keyboard.press("Escape");
    await screen.waitFor({ state: "detached" });

    /** Opens More (and Everything else when asked), taps a row and checks where it went. */
    const go = async (name: string, inside: boolean, landed: () => Promise<unknown>) => {
      try {
        await open(page, h, "#/day", at("09:30"));
        await more().click();
        if (inside) await page.getByRole("main", { name: "More" }).getByRole("button", { name: /Everything else/ }).click({ timeout: 10_000 });
        await page.locator(`.mr-row[data-row="${name}"]`).click({ timeout: 10_000 });
        await landed();
      } catch (e) {
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/failed-${name}.png` });
        throw e;
      }
    };
    await go("backlog", false, () => page.getByRole("heading", { name: "Backlog is made for a bigger screen" }).waitFor());
    await go("status", false, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/status/));
    await go("calls", false, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/calls/));
    await go("code", false, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/code/));
    await go("vm", false, () => page.getByRole("menu").waitFor());
    await go("settings", false, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/settings/));
    await go("guide", false, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/guide/));
    await go("notifications", true, () => page.getByRole("dialog", { name: /Notifications/ }).waitFor());
    await go("sources", true, () => page.getByRole("dialog", { name: "Sources" }).waitFor());
    await go("focus", true, () => page.getByRole("menu").waitFor());
    await go("checkin", true, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toBe("#/day/checkin"));
    await go("closeout", true, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/day\/closeout/));
    await go("account", true, () => page.getByRole("menuitem", { name: /Sign out|Settings/ }).first().waitFor());
    await go("docs", true, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/docs/));
    await go("about", true, () => page.getByRole("dialog", { name: /About/ }).waitFor());
    await go("admin", true, () => expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/settings\/admin/));
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("More closes when the place changes under it: the browser's Back, a tab", async () => {
    const page = await phonePage(h, 390);
    await open(page, h, "#/week", at("09:30"));
    await open(page, h, "#/day", at("09:30"));
    await bar(page).getByRole("button", { name: /^More/ }).click();
    const more = page.getByRole("main", { name: "More" });
    await more.waitFor();
    await page.goBack();
    await more.waitFor({ state: "detached", timeout: 15_000 });
    await bar(page).getByRole("button", { name: /^More/ }).click();
    await more.waitFor();
    await bar(page).getByRole("button", { name: /^Week/ }).click();
    await more.waitFor({ state: "detached", timeout: 15_000 });
    await page.close();
  }, T);

  it("a computer window narrowed to a phone's width draws at once, keeping what was open, and the phone's bar joins", async () => {
    const { page } = await freshPage(h, { width: 1280, height: 900 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelector("main")?.setAttribute("data-kept", "1"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".phone-bar").waitFor({ timeout: 30_000 });
    // Nothing was unmounted: the page drawn before is the same page.
    expect(await page.locator("[data-kept]").count()).toBeGreaterThan(0);
    await page.close();
  }, T);

  it("by keyboard: Tab to More, Enter, the rows in order, Enter opens one", async () => {
    const page = await phonePage(h, 390);
    await open(page, h, "#/day", at("09:30"));
    await bar(page).getByRole("button", { name: /^More/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("main", { name: "More" }).waitFor();
    // Focus starts on More's heading; Tab walks the rows.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("H1");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-row"))).toBe("calls");
    for (let i = 0; i < 7; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-row"))).toBe("else");
    await page.keyboard.press("Enter");
    await page.getByRole("main", { name: "Everything else" }).waitFor();
    // Its heading has focus; Back to More comes before it, so Tab goes on to the first row.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("H1");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-row"))).toBe("notifications");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Sources" }).waitFor();
    await page.close();
  }, T);

  it("Desktop version: laid out at 1280 with only the way back; a reload keeps it; Phone version returns; nothing reaches the server", async () => {
    const page = await phonePage(h, 390);
    const errors = errorsOf(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, h, "#/day", at("09:30"));
    const sent: string[] = [];
    const watch = (r: Request) => {
      if (r.method() === "POST") sent.push(`${r.url()} ${r.postData() ?? ""}`);
    };
    page.on("request", watch);
    await bar(page).getByRole("button", { name: /^More/ }).click();
    await page.getByRole("button", { name: /Desktop version/ }).click();
    await page.waitForSelector(".topbar nav.views", { timeout: 60_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    const desk = () => page.evaluate(() => ({ w: innerWidth, phone: !!document.querySelector(".phone-bar, .ph1-top, .more-screen, .pn-card, .status-dot-btn"), back: !!document.querySelector(".phone-version"), stored: localStorage.getItem("focustime.desktopVersion") }));
    expect(await desk()).toEqual({ w: 1280, phone: false, back: true, stored: "1" });
    await shot(page, "ph1-desktop");
    await page.reload();
    await page.waitForSelector(".topbar nav.views", { timeout: 60_000 });
    expect(await desk()).toEqual({ w: 1280, phone: false, back: true, stored: "1" });
    await page.getByRole("button", { name: "Back to the phone version" }).click();
    await page.waitForSelector(".phone-bar", { timeout: 60_000 });
    expect(await page.evaluate(() => ({ w: innerWidth, back: !!document.querySelector(".phone-version"), stored: localStorage.getItem("focustime.desktopVersion") }))).toEqual({ w: 390, back: false, stored: null });
    // Nothing about it was sent: no action names the Desktop version, and none was posted for it.
    expect(sent.filter((s) => /desktop/i.test(s))).toEqual([]);
    page.off("request", watch);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Desktop version with storage refused: both versions still work, and nothing is remembered", async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, bypassCSP: true });
    await page.addInitScript(() => {
      const no = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", { get: no });
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".phone-bar", { timeout: 60_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await bar(page).getByRole("button", { name: /^More/ }).click();
    await page.getByRole("button", { name: /Desktop version/ }).click();
    await expect.poll(() => page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute("content")), { timeout: 15_000 }).toMatch(/^width=1280, initial-scale=/);
    await page.getByRole("button", { name: "Back to the phone version" }).waitFor({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => innerWidth), { timeout: 15_000 }).toBe(1280);
    expect(await page.locator(".phone-bar").count()).toBe(0);
    await page.getByRole("button", { name: "Back to the phone version" }).click();
    await page.waitForSelector(".phone-bar", { timeout: 30_000 });
    // A reload shows the phone's version: nothing was remembered.
    await page.reload();
    await page.waitForSelector(".phone-bar", { timeout: 60_000 });
    await page.close();
  }, T);

  it("at 1280 and 768: nothing of the phone, and its file isn't downloaded", async () => {
    for (const width of [1280, 768]) {
      const asked: string[] = [];
      const { page } = await freshPage(h, { width, height: 900 }, { before: async (p) => p.on("request", (r) => asked.push(r.url())) });
      await page.waitForTimeout(3000);
      expect(await page.locator(".phone-bar, .ph1-top, .more-screen, .pn-card, .phone-version").count()).toBe(0);
      expect(asked.filter((u) => /PhoneScreens|\/phone\//.test(u)), `${width}`).toEqual([]);
      await page.close();
    }
  }, T);
});

describe.skipIf(!CHROMIUM)("PH-1: Day on a weekend and on the catch-up day", () => {
  it("a Saturday: Day says it the way the phone did, with no Now card", async () => {
    const h = await startDemo("chromium", {}, "2026-11-07T10:00:00-05:00");
    try {
      const page = await phonePage(h, 390);
      await page.locator(".today-view").waitFor();
      expect(await page.locator(".pn-card").count()).toBe(0);
      await page.locator(".today-weekend, .today-off").first().waitFor({ timeout: 15_000 });
      expect(await page.locator(".day-bar").count()).toBe(0);
      await page.close();
    } finally {
      await h.stop();
    }
  }, T);
  it("the catch-up day with working hours: Day names its block Catch-up", async () => {
    const h = await startDemo("chromium", {}, "2026-11-06T10:00:00-05:00");
    try {
      const page = await phonePage(h, 390);
      expect((await call(page, "hours.set_day", { date: "2026-11-06", segments: ["09:00-17:00"] })).ok).toBe(true);
      await page.reload();
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await page.locator(".today-view").waitFor();
      await page.waitForTimeout(1000);
      const text = (await page.locator(".today-view").textContent()) ?? "";
      expect(text).toMatch(/Catch-up/);
      await page.close();
    } finally {
      await h.stop();
    }
  }, T);
});
