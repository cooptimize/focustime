// MC-2b: the screenshots of my Pocket recordings in Calls. Only when MC2B_SHOTS names a folder; nothing runs otherwise.
// Demo data only (the demo's fictional person and the pretend Pocket's invented recordings). Dark at 1440 by 900 and
// 390 by 844, plus the list in light.
//   MC2B_SHOTS=/path/to/folder npm run shots -- e2e/shot-scripts/mc2b-shots.ts
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.MC2B_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;
const row = (page: Page, name: string) => page.locator("[data-calls-list] [data-call-row]").filter({ has: page.locator(".calls-name", { hasText: name }) }).first();

async function shot(page: Page, name: string, run: () => Promise<unknown>) {
  try {
    await run();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("MC-2b screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });

  it("Calls with my Pocket recordings", async () => {
    for (const [w, hgt, tag, theme] of [[1440, 900, "1440", "cooptimize-dark"], [390, 844, "390", "cooptimize-dark"], [1440, 900, "1440-light", "cooptimize-light"]] as const) {
      // A demo of its own for each size, so every shot starts from the same calls.
      const h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
      started.push(h);
      const { page } = await freshPage(h, { width: w, height: hgt });
      await page.locator(".topbar").first().waitFor({ timeout: 30_000 });
      await call(page, "ui.set_theme", { theme });
      await page.reload();
      await page.locator(".topbar").first().waitFor({ timeout: 30_000 });
      const phone = w < 900;
      const calls = async () => {
        await page.evaluate(() => (location.hash = "#/calls"));
        await page.locator("[data-call-row]").first().waitFor({ timeout: 30_000 });
      };
      const getList = async () => {
        await page.locator("[data-pocket-get]").click();
        await page.locator("[data-calls-pocket] [role=status]", { hasText: "Got" }).waitFor({ timeout: 30_000 });
      };
      if (tag === "1440-light") {
        await call(page, "pocket.connect", { key: "pk_demo_fine" });
        await calls();
        await shot(page, "7-1440-light-list-after-get", getList);
        continue;
      }
      await calls();
      await shot(page, `1-${tag}-not-connected`, async () => page.locator("[data-calls-pocket] a").waitFor({ timeout: 30_000 }));
      await call(page, "pocket.connect", { key: "pk_demo_fine" });
      await page.reload();
      await calls();
      await shot(page, `2-${tag}-list-after-get`, async () => (await getList(), phone ? page.locator("[data-calls-pocket]").scrollIntoViewIfNeeded() : null));
      await shot(page, `3-${tag}-setup-use-my-pocket`, async () => {
        await row(page, "Proposal review with Jordan").click();
        await page.locator('[data-source="pocket"]').waitFor({ timeout: 30_000 });
        if (phone) await page.locator("[data-pocket-who]").scrollIntoViewIfNeeded();
      });
      await shot(page, `4-${tag}-setup-longer-recording`, async () => {
        if (phone) await calls(), await getList();
        await row(page, "Harbor sprint planning").click();
        await page.locator("[data-pocket-part]").waitFor({ timeout: 30_000 });
        if (phone) await page.locator("[data-pocket-who]").scrollIntoViewIfNeeded();
      });
      await shot(page, `5-${tag}-recording-own-call`, async () => {
        if (phone) await calls(), await getList();
        await row(page, "Call with the carrier").click();
        await page.locator("[data-pocket-add]").waitFor({ timeout: 30_000 });
      });
      await shot(page, `6-${tag}-call-from-my-pocket`, async () => {
        if (phone) await calls(), await getList();
        await row(page, "Proposal review with Jordan").click();
        await page.locator(".mtg-setup select").first().selectOption({ index: 1 });
        await page.locator(".mtg-setup").getByRole("button", { name: "Continue" }).click();
        await page.locator(".mtg-pocket-note").waitFor({ timeout: 60_000 });
      });
      if (!phone)
        await shot(page, `8-${tag}-client-call-offer`, async () => {
          await calls();
          await getList();
          await page.locator("[data-calls-list] [data-call-row]").filter({ hasText: "Pocket recording found" }).filter({ hasText: "Northwind" }).first().click();
          await page.locator("[data-pocket-bring]").waitFor({ timeout: 30_000 });
        });
    }
  }, T);
});
