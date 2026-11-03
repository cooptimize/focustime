// P1 phone screenshots: Playwright's iPhone 15 (WebKit) and Pixel 7 (Chromium) emulation, dark and light, on a
// throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port, the clock pinned to Monday
// Nov 2, 2026 9:30 AM). Each run plans the demo Monday (two stories per block, committed) so Today has picks, then
// shoots Today, Week, a card's detail panel, Capture, Plan the week read-only and Today with a running timer, then
// (Part B) the unread dot, ⋯ › Notifications, the iPhone install how-to, Settings › Notifications and a toast.
// Usage: node scripts/screenshot-phone.ts <outDir> [today,week,...]
import { mkdirSync } from "node:fs";
import { devices, type Page } from "playwright-core";
import { startDemo, WEBKIT } from "../e2e/harness.ts";

const out = process.argv[2] ?? "screenshots/phone";
const only = process.argv[3]?.split(",") ?? null;
mkdirSync(out, { recursive: true });

type Device = "iPhone 15" | "Pixel 7";
// iPhone 15 in WebKit where its build runs here (CI's Ubuntu); else Chromium with the same device (viewport, scale,
// touch, user agent), and the run says so.
const chromium = await startDemo("chromium");
const webkit = WEBKIT ? await startDemo("webkit").catch((e: Error) => (console.log(`WebKit unavailable (${e.message.split("\n")[0]}); iPhone 15 in Chromium`), null)) : null;
const runs: { device: Device; engine: "webkit" | "chromium"; tag: string }[] = [
  { device: "iPhone 15", engine: webkit ? "webkit" : "chromium", tag: "iphone15" },
  { device: "Pixel 7", engine: "chromium", tag: "pixel7" },
];

/** One action through the page's own session (cookie and CSRF), as the UI sends it. */
const act = (page: Page, action: string, input: Record<string, unknown> = {}) =>
  page.evaluate(
    async ([action, input]) => {
      const csrf = document.cookie.split(";").map((p) => p.trim().split("=")).find(([k]) => k === "__Host-focustime-csrf")?.slice(1).join("=") ?? "";
      const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action, input }) });
      const body = (await r.json()) as { ok: boolean; data?: unknown; error?: string };
      if (!body.ok) throw new Error(`${action}: ${body.error}`);
      return body.data;
    },
    [action, input] as const,
  );

type Load = { planDay: { date: string }; week: { days: { date: string; am: Slot; pm: Slot }[] }; devops: { clientKey: string; items: Item[]; children: Item[] }[] | null };
type Slot = { half: "AM" | "PM"; off: boolean; focus: { clientKey: string }[] };
type Item = { id: number; level: string; stateCategory: string };

/** Two open stories in each of today's blocks, then commit: the demo's Monday as a planned day. */
async function planToday(page: Page) {
  const d = (await act(page, "week.load", {})) as Load;
  const date = d.planDay.date;
  const day = d.week.days.find((x) => x.date === date)!;
  const used = new Set<number>();
  for (const slot of [day.am, day.pm]) {
    const client = slot.focus[0]?.clientKey;
    if (!client || slot.off) continue;
    const work = d.devops?.find((w) => w.clientKey === client);
    const stories = [...(work?.children ?? []), ...(work?.items ?? [])].filter((i) => i.level === "story" && i.stateCategory !== "Resolved" && !used.has(i.id)).slice(0, 2);
    for (const [k, s] of stories.entries()) {
      used.add(s.id);
      await act(page, "pick.add", { date, half: slot.half, clientKey: client, itemId: s.id, size: k === 0 ? "M" : "S" });
    }
  }
  await act(page, "planday.commit", { date });
}

// The app polls (presence, the timer), so the network is never idle; a short pause lets the last render land.
const settle = (page: Page) => page.waitForTimeout(900);

const h = { chromium, webkit };
const errors: string[] = [];
try {
  for (const run of runs) {
    const harness = run.engine === "webkit" ? h.webkit! : h.chromium;
    for (const scheme of ["dark", "light"] as const) {
      const { defaultBrowserType: _, ...device } = devices[run.device];
      const ctx = await harness.browser.newContext({ ...device, colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true });
      await ctx.addInitScript(() => {
        localStorage.setItem("focustime.hint.flow", "dismissed");
        localStorage.setItem("focustime.hint.picktime", "1");
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${run.tag} ${scheme}: ${e.message}`));
      await page.goto(harness.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await planToday(page);
      // The demo person's theme decides (not the browser's scheme): Cooptimize Dark or Light for the run.
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      const base = harness.url.split("#")[0]!;
      const shot = async (name: string) => {
        if (only && !only.includes(name)) return;
        await settle(page);
        await page.screenshot({ path: `${out}/p1-${name}-${run.tag}-${scheme}.png` });
      };
      const go = async (hash: string) => {
        await page.goto(`${base}${hash}`);
        await page.reload();
        await page.waitForSelector(".topbar", { timeout: 30_000 });
      };

      await go("#/today");
      await page.locator(".today-blocks .pick-row").first().waitFor({ timeout: 30_000 });
      await shot("today");
      await go("#/week");
      await shot("week");
      await page.locator(".grid.narrow .half .card-client").first().click();
      await page.waitForSelector(".detail-panel");
      await shot("detail");
      await page.locator(".dp-back").click();
      await page.locator(".bottom-bar .bb-tab", { hasText: "Capture" }).click();
      await page.waitForSelector(".cap-dialog");
      await page.locator(".cap-dialog input").first().fill("Send Harbor the release notes by Thursday");
      await shot("capture");
      await page.keyboard.press("Escape");
      await go("#/week/plan");
      await page.waitForSelector(".phone-ro");
      await shot("planweek-readonly");
      await go("#/today");
      await page.locator(".phone-now .primary", { hasText: "Start focus" }).click();
      await page.waitForTimeout(800);
      await go("#/today");
      await shot("today-timer");
      // Part B: ⋯ › Notifications (the demo's two from this morning), the unread dot first.
      await page.locator(".phone-now button", { hasText: "Done" }).click().catch(() => undefined);
      await go("#/today");
      await shot("unread-dot");
      await page.locator(".bottom-bar .bb-tab", { hasText: "⋯" }).click();
      await page.getByRole("menuitem", { name: /Notifications/ }).click();
      await page.waitForSelector(".notices-panel");
      await shot("notifications");
      await page.keyboard.press("Escape");
      // Install app: on iPhone the how-to (Safari has no install button).
      if (run.device === "iPhone 15") {
        await page.locator(".bottom-bar .bb-tab", { hasText: "⋯" }).click();
        await page.getByRole("menuitem", { name: /Install app/ }).click();
        await page.waitForSelector(".install-howto");
        await shot("install-howto");
        await page.keyboard.press("Escape");
      }
      // Settings › Notifications: push per device, Show details; a test lands as a toast and in the list.
      await go("#/settings/notifications");
      await page.waitForSelector(".set-push");
      await page.locator(".set-push").scrollIntoViewIfNeeded();
      await shot("settings-notifications");
      await page.getByRole("button", { name: "Send a test notification" }).click();
      await page.waitForSelector(".notice-toast", { timeout: 10_000 });
      await shot("toast");
      await ctx.close();
    }
  }
} finally {
  await h.chromium.stop();
  await h.webkit?.stop();
}
console.log(errors.length ? errors.join("\n") : "no page errors");
// The demo servers' pipes keep the loop alive after stop(); the run is over.
process.exit(0);
