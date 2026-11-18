// MC-2c: the screenshots. Only when MC2C_SHOTS names a folder; nothing runs otherwise. Demo data only. Dark at 1440 by
// 900 and 390 by 844 (the iPhone's 17 px root font), one in light. MC2C_BEFORE=1 takes only the two "before" pictures
// (Calls opened), so the same script runs on main for them. Clock: Thursday Nov 5, 2026 10:00 AM ET.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.MC2C_SHOTS ?? null;
const BEFORE = process.env.MC2C_BEFORE === "1";
const T = 900_000;
const CLOCK = "2026-11-05T10:00:00-05:00";
const CHAT = "Call in Northwind Delivery Team (Cooptimize)";
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

describe.skipIf(!CHROMIUM || !DIR)("MC-2c screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}${BEFORE ? ".before" : ""}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });
  const go = async (page: Page, hash: string) => {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.waitForTimeout(2500);
  };
  const start = async (w: number, hgt: number, theme = "cooptimize-dark", phone = false) => {
    const h = await startDemo("chromium", {}, CLOCK);
    started.push(h);
    let page: Page;
    if (phone) {
      page = await h.browser.newPage({ viewport: { width: w, height: hgt }, isMobile: true, hasTouch: true, bypassCSP: true });
      await page.addInitScript(() => {
        localStorage.setItem("focustime.hint.flow", "dismissed");
        document.addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style");
          st.textContent = "html{font-size:17px}";
          document.head.append(st);
        });
      });
      await page.goto(h.url);
      await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    } else page = (await freshPage(h, { width: w, height: hgt })).page;
    await page.locator(".topbar").first().waitFor({ timeout: 60_000 });
    await call(page, "ui.set_theme", { theme });
    await page.reload();
    await page.locator(".topbar").first().waitFor({ timeout: 60_000 });
    await go(page, "#/calls");
    await page.getByRole("heading", { name: "Calls", exact: true }).waitFor({ timeout: 30_000 });
    await page.locator("[data-calls-list] [data-call-row]").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    return page;
  };
  const chatRow = (page: Page) => page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: CHAT }) }).filter({ has: page.locator("[data-call-act='review']") });
  const pre = BEFORE ? "before" : "after";

  it("Calls opened at 1440 by 900 and 390 by 844", async () => {
    const wide = await start(1440, 900);
    await shot(wide, `01-${pre}-calls-1440`, async () => undefined);
    const phone = await start(390, 844, "cooptimize-dark", true);
    await shot(phone, `02-${pre}-calls-390`, async () => {
      if (!BEFORE) await chatRow(phone).first().scrollIntoViewIfNeeded();
    });
  }, T);

  it.skipIf(BEFORE)("a chat call's setup, the review, no speaker names, a refusal, light, Settings", async () => {
    const page = await start(1440, 900);
    await shot(page, "03-after-chat-call-setup", async () => {
      await chatRow(page).first().locator("[data-call-row]").click();
      await page.getByRole("region", { name: /^Review Call in Northwind/ }).waitFor({ timeout: 30_000 });
    });
    await shot(page, "04-after-reviewed-from-teams", async () => {
      await page.getByRole("region", { name: /^Review Call in Northwind/ }).getByRole("button", { name: "Continue" }).click();
      await page.getByText(/^Got the transcript from Teams/).waitFor({ timeout: 30_000 });
    });
    await shot(page, "05-after-no-speaker-names", async () => {
      await go(page, "#/calls");
      await chatRow(page).first().locator("[data-call-row]").click();
      await page.getByRole("region", { name: /^Review Call in Northwind/ }).getByRole("button", { name: "Continue" }).click();
      await page.locator("[data-no-speakers]").waitFor({ timeout: 30_000 });
    });
    await shot(page, "06-after-refused-with-the-way-on", async () => {
      await go(page, "#/calls");
      await chatRow(page).first().locator("[data-call-row]").click();
      await page.getByRole("region", { name: /^Review Call in Northwind/ }).getByRole("button", { name: "Continue" }).click();
      await page.getByText(/Teams lets the people who were on a call read it/).first().waitFor({ timeout: 30_000 });
    });
    await shot(page, "08-after-settings-connections", async () => {
      await go(page, "#/settings/connections");
      await page.waitForTimeout(1500);
      await page.getByText("More", { exact: true }).first().click();
      const row = page.getByText(/^Calls started in a client's chat/).first();
      await row.waitFor({ timeout: 30_000 });
      await row.evaluate((e) => e.scrollIntoView({ block: "center" }));
    });
    const light = await start(1440, 900, "cooptimize-light");
    await shot(light, "07-after-calls-light", async () => {
      await chatRow(light).first().locator("[data-call-row]").click();
      await light.getByRole("region", { name: /^Review Call in Northwind/ }).waitFor({ timeout: 30_000 });
    });
  }, T);
});
