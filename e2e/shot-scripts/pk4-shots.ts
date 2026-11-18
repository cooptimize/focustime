// PK-4: the screenshots. Only when PK4_SHOTS names a folder; nothing runs otherwise. Demo data only, dark at 1440 by
// 900, the list at 390 by 844 and one in light. Clock: Thursday Nov 5, 2026 10:00 AM ET.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { DEMO_POCKET_KEYS, DEMO_POCKET_SOLO } from "../../sources/demo/pocket.ts";

const DIR = process.env.PK4_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean }>;

async function shot(page: Page, name: string, run: () => Promise<void>, full = false) {
  try {
    await run();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: full });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

const CLOCK = "2026-11-05T10:00:00-05:00";

describe.skipIf(!CHROMIUM || !DIR)("PK-4 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });
  const go = async (page: Page, hash: string) => {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.waitForTimeout(2200);
  };
  const setTheme = async (page: Page, t: string) => {
    await call(page, "ui.set_theme", { theme: t });
    await page.reload();
    await page.waitForSelector(".demo-tag", { timeout: 30_000 }).catch(() => undefined);
  };
  /** A fresh demo, my Pocket connected with `key`, Calls open on Open. */
  const start = async (key: string, w = 1440, hgt = 900, theme = "cooptimize-dark") => {
    const h = await startDemo("chromium", {}, CLOCK);
    started.push(h);
    const { page } = await freshPage(h, { width: w, height: hgt });
    await page.locator(".topbar").first().waitFor({ timeout: 30_000 });
    await setTheme(page, theme);
    await call(page, "pocket.connect", { key });
    await go(page, "#/calls");
    await page.locator("[data-pocket-line]").waitFor({ state: "attached", timeout: 30_000 });
    await page.waitForFunction(() => /Pocket checked at/.test(document.querySelector("[data-pocket-line]")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => undefined);
    return page;
  };

  it("Calls opened, marked by itself; Check Pocket again; a recording with no call", async () => {
    const page = await start("pk_demo_mine");
    await shot(page, "01-calls-opened-marked", async () => undefined);
    await shot(page, "05-check-pocket-again", async () => {
      await page.locator("[data-pocket-get]").click();
      await page.waitForTimeout(1200);
    });
    await shot(page, "06-recording-with-no-call", async () => {
      await page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: "Call with the carrier" }) }).first().scrollIntoViewIfNeeded();
    });
  }, T);

  it("left out, Set my Pocket address refused and accepted, the list after, Settings", async () => {
    const page = await start(DEMO_POCKET_KEYS.shared);
    await shot(page, "02-left-out-line", async () => undefined);
    const form = page.locator("[data-pocket-address]");
    await shot(page, "03-set-address-refused", async () => {
      await page.locator("[data-pocket-set-address]").click();
      await form.locator("input").fill("nobody@example.com");
      await form.getByRole("button", { name: "Use this address" }).click();
      await form.locator('[role="alert"]').waitFor({ timeout: 30_000 });
    });
    await shot(page, "04-set-address-accepted-list-after", async () => {
      await form.locator("input").fill(DEMO_POCKET_SOLO);
      await form.getByRole("button", { name: "Use this address" }).click();
      await page.waitForFunction(() => /address saved/.test(document.querySelector("[data-pocket-line]")?.textContent ?? ""), null, { timeout: 30_000 });
      await page.waitForTimeout(1500);
    });
    await shot(page, "07-settings-pocket", () => go(page, "#/settings/connections/pocket"), true);
  }, T);

  it("the quiet failure", async () => {
    const page = await start(DEMO_POCKET_KEYS.flaky);
    await shot(page, "08-quiet-failure", () => page.locator("[data-pocket-failed]").waitFor({ timeout: 30_000 }));
  }, T);

  it("Calls' layout: a Needs you state on one line, and a page that doesn't scroll (1280 by 720, Default and Larger)", async () => {
    for (const size of ["default", "larger"] as const) {
      const page = await start(DEMO_POCKET_KEYS.shared, 1280, 720);
      await call(page, "ui.set_text_size", { size });
      await page.reload();
      await page.locator("[data-pocket-line]").waitFor({ state: "attached", timeout: 30_000 });
      await page.waitForTimeout(2500);
      // The demo has no call waiting for an upload at this clock: the state is put in the real row, as the test does.
      await page.evaluate(() => {
        const el = document.querySelector(".calls-row.need-row .calls-row-two > .calls-left, .calls-row.need-row .calls-row-two > .calls-state");
        const s = document.createElement("span");
        s.className = "calls-state needs";
        s.textContent = "Upload the transcript";
        el?.replaceWith(s);
      });
      await shot(page, `12-needs-you-upload-1280-${size}`, async () => undefined);
      await shot(page, `13-list-scrolled-1280-${size}`, async () => {
        await page.evaluate(() => document.querySelector(".calls-scroll")?.scrollTo(0, 99_999));
        await page.mouse.move(200, 500);
        await page.mouse.wheel(0, 2000);
      });
    }
  }, T);

  it("the list at 390 by 844, and one in light", async () => {
    const phone = await start(DEMO_POCKET_KEYS.shared, 390, 844);
    await shot(phone, "09-phone-left-out", async () => undefined);
    await shot(phone, "10-phone-set-address", async () => {
      await phone.locator("[data-pocket-set-address]").click();
      await phone.locator("[data-pocket-address] input").fill(DEMO_POCKET_SOLO);
    });
    const light = await start(DEMO_POCKET_KEYS.shared, 1440, 900, "cooptimize-light");
    await shot(light, "11-light-left-out", async () => undefined);
  }, T);
});
