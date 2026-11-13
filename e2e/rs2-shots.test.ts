// RS-2: the before and after screenshots, one script for both so the pairs match. Only when RS2_SHOTS names a folder
// (docs/ux/rs2/before or docs/ux/rs2/after); nothing runs otherwise. Demo data only: the demo person, with Friday
// Nov 6 given working hours 9:00 to 5:00 through the app's own action (hours.set_day), so the catch-up day is a
// working one; the PS-1 "ordinary" state on top (e2e/ps1-states.ts). Two clocks: Friday Nov 6 at 10:00 AM (every
// client block of the week is past) and Tuesday Nov 3 at 9:30 AM (midweek). Dark and light at 1440x900; the phone
// at 390x844. A screen that can't be reached is named in the log and skipped, so one missing control never loses the rest.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page, Route } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { call, phonePage } from "./mb1-helpers.ts";
import { buildState, PS_CLOCK } from "./ps1-states.ts";

const DIR = process.env.RS2_SHOTS ?? null;
const T = 900_000;
export const FRIDAY = "2026-11-06";
export const FRIDAY_CLOCK = "2026-11-06T10:00:00-05:00";
const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];
const missed: string[] = [];

async function themed(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
  await page.waitForTimeout(200);
}
async function shot(page: Page, name: string) {
  for (const theme of THEMES) {
    await themed(page, theme);
    await page.screenshot({ path: `${DIR}/${name}-${theme}.png` });
  }
  await themed(page, "dark");
}
const go = async (page: Page, hash: string, wait = 1200) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(wait);
};
const esc = async (page: Page, n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
};
const closePanel = async (page: Page) => {
  for (let i = 0; i < 2 && (await page.locator("aside.block-panel").count()); i++) await esc(page);
};
async function cardsOrTimeline(page: Page, which: "Cards" | "Timeline") {
  const b = page.locator(".day-switch button", { hasText: which }).first();
  if (await b.count()) await b.click();
  await page.waitForTimeout(700);
}
/** One screen: set it up, shoot it in both themes (unless the set-up took its own shot and says so), clean up. */
async function screen(page: Page, name: string, setUp: () => Promise<void | "taken">, cleanUp: () => Promise<void> = async () => {}) {
  try {
    if ((await setUp()) !== "taken") await shot(page, name);
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
  await cleanUp().catch(() => {});
}

/** The week read (week.load) held, or failed, until `release` is called. */
export async function holdWeekRead(page: Page, how: "slow" | "fail") {
  let open: (() => void) | null = null;
  const gate = new Promise<void>((r) => (open = r));
  const handler = async (route: Route) => {
    if (!(route.request().postData() ?? "").includes('"week.load"')) return route.fallback();
    if (how === "fail") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unavailable" }) });
    await gate;
    return route.fallback();
  };
  await page.route("**/api/action", handler);
  return async () => {
    open?.();
    await page.unroute("**/api/action", handler);
  };
}

/** The demo person's working catch-up day and its to-dos: Friday 9 to 5, two to-dos a half for the week's first client. */
export async function workingFriday(page: Page) {
  await call(page, "hours.set_day", { date: FRIDAY, segments: ["09:00-17:00"] });
  const w = ((await call(page, "week.load", { weekStart: "2026-11-02" })) as unknown as { data: unknown }).data as { planClients: { clientKey: string }[] };
  const [a, b] = w.planClients.map((c) => c.clientKey);
  for (const [half, client, titles] of [["AM", a, ["Finish the export mapping", "Reply to the release question"]], ["PM", b ?? a, ["Tidy the sprint board", "Write the week's handover"]]] as const)
    for (const t of titles) await call(page, "pick.add", { date: FRIDAY, half, clientKey: client, intention: t, size: "S" });
  await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
}

describe.skipIf(!CHROMIUM || !DIR)("RS-2 screenshots", () => {
  let fri: Harness;
  let tue: Harness;
  beforeAll(async () => {
    [fri, tue] = await Promise.all([startDemo("chromium", {}, FRIDAY_CLOCK), startDemo("chromium", {}, PS_CLOCK)]);
  }, T);
  afterAll(async () => {
    if (missed.length) console.log(`RS-2 shots not taken:\n${missed.join("\n")}`);
    await Promise.all([fri?.stop(), tue?.stop()]);
  });

  it("Friday: Week with every client block past, Day on the catch-up day, loading and a failed read", async () => {
    const { page } = await freshPage(fri, { width: 1440, height: 900 });
    await buildState(page, "ordinary");
    await workingFriday(page);

    await screen(page, "01-week-friday-past", async () => {
      await go(page, "#/week");
      await closePanel(page);
      await page.locator(".week-head").first().waitFor();
    });
    await screen(page, "03-day-catchup-cards", async () => {
      await go(page, `#/day/${FRIDAY}`);
      await cardsOrTimeline(page, "Cards");
    });
    await screen(page, "04-day-catchup-timeline", async () => {
      await cardsOrTimeline(page, "Timeline");
    }, async () => cardsOrTimeline(page, "Cards"));

    await screen(page, "07-week-loading", async () => {
      await go(page, "#/week");
      const release = await holdWeekRead(page, "slow");
      await page.getByRole("button", { name: "Next week" }).click();
      await page.waitForTimeout(400);
      await shot(page, "07-week-loading");
      await release();
      await page.waitForTimeout(1500);
      return "taken";
    });
    await screen(page, "08-week-failed", async () => {
      await go(page, "#/week", 1500);
      const release = await holdWeekRead(page, "fail");
      await page.getByRole("button", { name: "Next week" }).click();
      await page.waitForTimeout(1500);
      await shot(page, "08-week-failed");
      await release();
      return "taken";
    });
    await screen(page, "09-day-loading", async () => {
      await go(page, `#/day/${FRIDAY}`, 1500);
      const release = await holdWeekRead(page, "slow");
      await page.getByRole("button", { name: "Next day" }).click();
      await page.waitForTimeout(400);
      await shot(page, "09-day-loading");
      await release();
      await page.waitForTimeout(1500);
      return "taken";
    });
    await screen(page, "10-day-failed", async () => {
      await go(page, `#/day/${FRIDAY}`, 1500);
      const release = await holdWeekRead(page, "fail");
      await page.getByRole("button", { name: "Next day" }).click();
      await page.waitForTimeout(1500);
      await shot(page, "10-day-failed");
      await release();
      return "taken";
    });
    await page.close();

    const phone = await phonePage(fri, 390);
    await workingFriday(phone);
    await screen(phone, "06-phone-day-catchup", async () => {
      await go(phone, `#/day/${FRIDAY}`, 1500);
    });
    await phone.close();
  }, T);

  it("Tuesday: Week and Day midweek, Status, Backlog, the Gantt, the VM line, Admin › Clients, the command menu", async () => {
    const { page } = await freshPage(tue, { width: 1440, height: 900 });
    await buildState(page, "ordinary");

    await screen(page, "02-week-midweek", async () => {
      await go(page, "#/week");
      await closePanel(page);
    });
    await screen(page, "05-day-midweek", async () => {
      await go(page, "#/day");
      await cardsOrTimeline(page, "Cards");
    });
    await screen(page, "14-day-vm-line", async () => {
      await go(page, "#/day");
      await page.locator(".att-chip.vm").first().waitFor({ timeout: 10_000 });
      await page.locator(".att-chip.vm").first().scrollIntoViewIfNeeded();
    });
    await screen(page, "11-status", async () => {
      await go(page, "#/status", 2500);
    });
    await screen(page, "12-backlog-mixed", async () => {
      await go(page, "#/backlog", 2500);
      const chip = page.locator(".ah-tb-clients .rm-chip").first();
      await chip.click();
      await page.locator(".ah-tb-people button", { hasText: "Everyone" }).click();
      await chip.click();
      await page.waitForTimeout(800);
    });
    await screen(page, "13-gantt-early-week", async () => {
      await go(page, "#/backlog/gantt", 2500);
    });
    await screen(page, "15-admin-clients", async () => {
      await go(page, "#/settings/admin-clients", 1500);
      await page.locator(".ps-head").first().waitFor({ timeout: 15_000 });
      const reg = page.getByRole("button", { name: "Register a meeting" }).first();
      if (await reg.count()) await reg.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    }, async () => {
      await esc(page);
      await go(page, "#/day");
    });
    await screen(page, "16-command-menu", async () => {
      await page.keyboard.press("Control+k");
      await page.locator(".command-menu").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
    }, async () => esc(page));
    await page.close();
  }, T);
});
