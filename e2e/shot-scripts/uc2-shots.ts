// UC-2: the before and after screenshots, one script for both so the pairs match. Only when UC2_SHOTS names a folder
// (screenshots/uc2/before or screenshots/uc2/after); nothing runs otherwise. Dark only, demo data only. One shot per
// item that can be seen (1, 3, 4, 5, 6, 7, 8, 10, 11). A shot that can't be reached is named in the log and skipped.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { pickLevel } from "../backlog-helpers.ts";

const DIR = process.env.UC2_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const notes: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>, clip?: () => Promise<{ x: number; y: number; width: number; height: number } | null>) {
  try {
    await run();
    await page.waitForTimeout(400);
    const c = clip ? await clip() : null;
    await page.screenshot({ path: `${DIR}/${name}.png`, ...(c ? { clip: c } : {}) });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("UC-2 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    // The notes and misses go beside the folder, never in it (only images go on the shots branch).
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, [...notes, ...missed.map((m) => `missed: ${m}`)].join("\n"));
    for (const h of started) await h.stop();
  });

  it("the twelve, before or after", async () => {
    const h = await startDemo();
    started.push(h);
    const open = async (width: number, height = 900) => {
      const { page } = await freshPage(h, { width, height });
      await call(page, "ui.set_theme", { theme: "cooptimize-dark" });
      await page.reload();
      await page.waitForSelector(".demo-tag", { timeout: 30_000 });
      return page;
    };
    const go = async (page: Page, hash: string, wait = 1500) => {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.waitForTimeout(wait);
    };

    // 1 and 3: deployments. One planned as the day menu plans it (no What), one titled the way capture titles it, one
    // with typed words, on the weekend.
    {
      const page = await open(1280);
      const made = await call(page, "deploy.add", { clientKey: "Northwind", date: "2026-11-07", start: "09:00", end: "11:00" });
      notes.push(`1. Plan a deployment… with no What is titled: ${JSON.stringify(made.data?.pick?.title ?? made.error)}`);
      await call(page, "deploy.add", { clientKey: "Atlas", date: "2026-11-08", start: "10:00", end: "12:00", title: "Deployment - Atlas Freight - Sun, Nov 8" });
      await call(page, "deploy.add", { clientKey: "Harbor", date: "2026-11-08", start: "19:00", end: "21:00", title: "Release 4.2 to production" });
      await page.reload();
      // 1: Plan a deployment… from the command menu (the day menu's same form), What left empty, as a person plans one.
      await shot(page, "1-day-menu-deployment", async () => {
        await go(page, "#/day/2026-11-07");
        await page.keyboard.press("Control+k");
        await page.keyboard.type("Plan a deployment");
        await page.waitForTimeout(300);
        await page.keyboard.press("Enter");
        const form = page.getByRole("dialog").last();
        await form.waitFor();
        await form.locator("button.primary, button[type=submit]").last().click();
        await page.waitForTimeout(800);
        const shown = await page.locator(".pick-row .pr-title").allTextContents();
        notes.push(`1. Planned from the day menu with no What: ${JSON.stringify(shown)}`);
      });
      for (const w of [1280, 1920]) {
        await page.setViewportSize({ width: w, height: 900 });
        await shot(
          page,
          `3-week-weekend-${w}`,
          async () => {
            await go(page, "#/week");
            await page.locator(".day.weekend").first().waitFor({ timeout: 15_000 });
          },
          async () => {
            const b = await page.locator(".day.weekend").first().boundingBox();
            const c = await page.locator(".day.weekend").last().boundingBox();
            return b && c ? { x: Math.max(0, b.x - 380), y: Math.max(0, b.y - 10), width: Math.min(w - Math.max(0, b.x - 380), c.x + c.width - b.x + 390), height: Math.min(700, Math.max(b.height, c.height) + 20) } : null;
          },
        );
      }
      await page.close();
    }

    // 4: the Inbox's chips with a counted promise that has no client.
    {
      const page = await open(1440);
      await call(page, "ui.set_inbox", { clients: [] });
      await call(page, "followup.add", { what: "Send the cutover checklist", due: "2026-11-01" });
      await page.reload();
      await shot(page, "4-inbox-chips", async () => {
        await go(page, "#/inbox/promises");
        await page.locator(".ib4-chips").waitFor({ timeout: 15_000 });
        const tab = await page.locator('[data-tab="inbox"], .tab-inbox').first().textContent().catch(() => "");
        const chips = await page.locator(".ib4-chips .ib4-chip").allTextContents();
        notes.push(`4. Tab: ${JSON.stringify(tab)}; chips: ${JSON.stringify(chips)}`);
      });
      await page.close();
    }

    // 5 and 6: Code's database view, scrolled, and the kind filter.
    {
      const page = await open(1440);
      const tree = async () => {
        await go(page, "#/code/Northwind/kinds");
        await page.locator("[data-code-kinds]").waitFor({ timeout: 20_000 });
        const db = page.locator('[data-code-kind="database"]');
        if ((await db.locator(".cv-kind-head").getAttribute("aria-expanded")) !== "true") await db.locator(".cv-kind-head").click();
        await page.locator("[data-sql-expand]").first().click();
        await page.waitForTimeout(500);
      };
      await shot(page, "5-code-top", tree);
      await shot(page, "5-code-middle", async () => {
        await page.locator(".cv-side-scroll").first().evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) / 2));
      });
      await shot(page, "5-code-end", async () => {
        await page.locator(".cv-side-scroll").first().evaluate((el) => (el.scrollTop = el.scrollHeight));
      });
      await shot(page, "5-code-after-switch", async () => {
        await page.locator(".cv-side-scroll").first().evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) / 2));
        const btn = page.locator('[data-sql-group-btn="type"]').first();
        if (await btn.isVisible()) await btn.click();
        else notes.push("5. The switch was out of view at the middle; scrolled back to reach it");
        if (!(await btn.isVisible())) {
          await page.locator(".cv-side-scroll").first().evaluate((el) => (el.scrollTop = 0));
          await btn.click();
        }
      });
      await page.locator('[data-sql-group-btn="schema"]').first().click().catch(() => undefined);
      await shot(page, "6-code-kind-filter", async () => {
        await go(page, "#/code/Northwind/kinds");
        await page.locator("[data-code-search]").first().click();
        await page.locator("[data-code-search]").first().fill("store");
        await page.locator(".cv-search-kind").selectOption("database");
        await page.waitForTimeout(300);
      });
      await shot(page, "6-code-search-results", async () => {
        const t = page.locator(".cv-search-sqltype");
        if (await t.count()) await t.selectOption("table");
        await page.locator(".cv-search-go").click();
        await page.locator("[data-code-results]").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(800);
      });
      await page.close();
    }

    // 7 and 8: Backlog's row pointed at, at 1280, and bulk State… on a mixed selection.
    {
      const page = await open(1280);
      const goB = async () => {
        await go(page, "#/backlog", 500);
        await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
      };
      await goB();
      const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
      for (const b of await chips.getByRole("button").all()) if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
      await chips.getByRole("button", { name: "Atlas Freight", exact: true }).click();
      await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
      await pickLevel(page, "Features");
      const row = (title: string) => page.locator(".ah-row", { has: page.getByRole("link", { name: title, exact: true }) });
      for (const f of ["Shipment tracking dashboard", "Delivery time estimates"]) {
        const r = row(f);
        if ((await r.getAttribute("aria-expanded")) !== "true") await r.locator(".ah-chev").first().click();
      }
      await page.waitForTimeout(300);
      const target = row("Shipment tracking dashboard");
      await shot(
        page,
        "7-backlog-row-hover",
        async () => {
          await target.hover();
          const w = await target.locator("td.ah-col-item .ah-title, td.ah-col-item a").first().evaluate((el) => Math.round(el.getBoundingClientRect().width));
          const cell = await target.locator("td.ah-col-item").evaluate((el) => Math.round(el.getBoundingClientRect().width));
          notes.push(`7. At 1280, pointed at: the title is ${w} px wide in a ${cell} px Item cell`);
        },
        async () => {
          const b = await target.boundingBox();
          return b ? { x: 0, y: Math.max(0, b.y - 120), width: 1280, height: 260 } : null;
        },
      );
      await shot(page, "8-bulk-state", async () => {
        // A feature and a story under another feature: two types (as the grooming test ticks them).
        if ((await row("Carrier rate alerts").getAttribute("aria-expanded")) !== "true") await row("Carrier rate alerts").locator(".ah-chev").first().click();
        await row("Carrier rate alerts").getByRole("checkbox").check({ force: true });
        await row("Alert settings page").getByRole("checkbox").check({ force: true });
        await page.getByRole("toolbar", { name: "Selected items" }).getByRole("button", { name: "State…" }).click();
        await page.locator(".ah-pop-bulk-state").waitFor();
      });
      await shot(page, "8-bulk-state-result", async () => {
        const pop = page.locator(".ah-pop-bulk-state");
        const hold = pop.getByRole("option", { name: /On hold/ });
        if (await hold.count()) await hold.first().click();
        else notes.push("8. On hold can't be picked");
        await page.waitForTimeout(800);
        await page.keyboard.press("Escape");
        const sum = page.locator(".bl-result summary");
        if (await sum.count()) await sum.first().click();
      });
      await page.close();
    }

    // 10 and 11: Admin's words.
    {
      const page = await open(1440, 1100);
      await shot(page, "10-admin-clients-chats", async () => {
        await go(page, "#/settings/admin-clients");
        const f = page.locator('[aria-label^="Client chats for"], .dchat').first();
        await f.waitFor({ timeout: 15_000 });
        await f.scrollIntoViewIfNeeded();
      });
      await shot(page, "11-admin-conversations", async () => {
        await go(page, "#/settings/admin-conversations");
        await page.getByText("Reading client chats").waitFor({ timeout: 15_000 });
      });
      await page.close();
    }
  }, T);
});
