// UC-1: the before and after screenshots, one script for both so the pairs match. Only when UC1_SHOTS names a folder
// (docs/ux/uc1/before or docs/ux/uc1/after); nothing runs otherwise. Dark and light, demo data only. A shot that
// can't be reached is named in the log and skipped.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const DIR = process.env.UC1_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("UC-1 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    if (missed.length) (await import("node:fs")).writeFileSync(`${DIR}/missed.txt`, missed.join("\n"));
    for (const h of started) await h.stop();
  });

  it("the Inbox's left edge and a deployment's title", async () => {
    for (const theme of ["dark", "light"] as const) {
      const h = await startDemo();
      started.push(h);
      const go = async (page: Page, hash: string) => {
        await page.evaluate((x) => (location.hash = x), hash);
        await page.waitForTimeout(1500);
      };
      const chips = (page: Page) => page.locator(".ib4-chips .ib4-chip");
      for (const w of [1440, 1920]) {
        const { page } = await freshPage(h, { width: w, height: 900 });
        // Each page is its own demo session: the theme and the chips are set in it.
        await call(page, "ui.set_theme", { theme: `cooptimize-${theme}` });
        await call(page, "ui.set_inbox", { clients: [] });
        await page.reload();
        await page.waitForSelector(".demo-tag", { timeout: 30_000 });
        for (const list of ["chats", "promises", "captures"]) {
          await shot(page, `inbox-${list}-all-${w}-${theme}`, async () => {
            await go(page, `#/inbox/${list}`);
            if ((await chips(page).first().getAttribute("aria-pressed")) !== "true") await chips(page).first().click();
          });
          await shot(page, `inbox-${list}-one-${w}-${theme}`, async () => {
            await chips(page).nth(1).click();
          });
          await chips(page).first().click().catch(() => undefined);
        }
        if (w === 1440) {
          await shot(page, `inbox-row-open-${theme}`, async () => {
            await go(page, "#/inbox/chats");
            await page.locator(".ib4-row-head").first().click();
          });
          await page.locator(".ib4-row-head").first().click().catch(() => undefined);
          // Day over the Inbox, the top of each, to show where each starts on the left.
          try {
            await go(page, "#/day");
            const day = await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 420 } });
            await go(page, "#/inbox/chats");
            const inbox = await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 420 } });
            const ctx = await h.browser.newContext({ viewport: { width: 1440, height: 844 } });
            const sheet = await ctx.newPage();
            await sheet.setContent(`<body style="margin:0;background:#888"><img style="display:block" src="data:image/png;base64,${day.toString("base64")}"><div style="height:4px"></div><img style="display:block" src="data:image/png;base64,${inbox.toString("base64")}"></body>`);
            await sheet.waitForTimeout(300);
            await sheet.screenshot({ path: `${DIR}/day-over-inbox-${theme}.png` });
            await ctx.close();
          } catch (e) {
            missed.push(`day-over-inbox-${theme}: ${String((e as Error).message).split("\n")[0]}`);
          }
          // The Inbox's own capture box, set to Deployment.
          const dep = (root: ReturnType<Page["locator"]>) => root.locator('.cap-box-kinds [data-kind="deployment"]');
          const choose = async (root: ReturnType<Page["locator"]>, name: string) => {
            await root.locator(".cap-client").click();
            await root.locator(".cap-choose").getByRole("button", { name, exact: true }).click();
          };
          await shot(page, `inbox-capture-deployment-${theme}`, async () => {
            await go(page, "#/inbox/captures");
            const box = page.locator(".ib4-capture");
            await choose(box, "Northwind");
            await dep(box).click();
          });
          // Quick capture set to Deployment: the box empty, then with text.
          await go(page, "#/week");
          await page.keyboard.press("n");
          const dlg = page.getByRole("dialog", { name: "Quick capture" });
          await shot(page, `quick-deployment-empty-${theme}`, async () => {
            await dlg.waitFor();
            await choose(dlg, "Northwind");
            await dep(dlg).click();
          });
          await shot(page, `quick-deployment-text-${theme}`, async () => {
            await dlg.getByRole("textbox", { name: "Quick capture" }).fill("Release 4.2 to production");
          });
          // Saved with the box empty (before this step it couldn't be from here: the same deployment through the action).
          await shot(page, `week-deployment-${theme}`, async () => {
            await dlg.getByRole("textbox", { name: "Quick capture" }).fill("");
            await dlg.getByRole("textbox", { name: "Quick capture" }).press("Enter");
            await page.waitForTimeout(800);
            const saved = await dlg.locator(".cap-toast").count();
            const plan = await call(page, "week.load", {});
            const has = JSON.stringify(plan.data ?? {}).includes('"todoKind":"deployment"');
            if (!saved && !has) await call(page, "deploy.add", { clientKey: "Northwind", date: "2026-11-07", start: "19:00", end: "21:00" });
            await page.keyboard.press("Escape");
            await page.reload();
            await go(page, "#/week");
          });
          // The same deployment on its day, where the title has room.
          await shot(page, `day-deployment-${theme}`, async () => {
            await go(page, "#/day/2026-11-07");
          });
        }
        await page.close();
      }
    }
  }, T);
});
