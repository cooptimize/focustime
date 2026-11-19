// UC-3: the before and after screenshots, one script for both so the pairs match. Only when UC3_SHOTS names a folder
// (screenshots/uc3/before or screenshots/uc3/after); nothing runs otherwise. Dark only, demo data only. Four pairs:
// the Inbox's chips and headings on the computer and on the phone, Backlog's bulk State with its preview, and a tab's
// tooltip. A browser draws no native tooltip in a screenshot, so the tooltip's own text (the tab's title) is shown in a
// box beside the tab, drawn by this script. What each screen says goes in the notes beside the folder.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { pickLevel } from "../backlog-helpers.ts";

const DIR = process.env.UC3_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const notes: string[] = [];
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
const inboxText = (page: Page) =>
  page.evaluate(() => ({
    chips: [...document.querySelectorAll<HTMLElement>(".ib4-chips .ib4-chip")].map((c) => c.textContent?.trim()),
    heads: [...document.querySelectorAll<HTMLElement>(".ib4-group-head")].map((c) => c.textContent?.trim()),
  }));

describe.skipIf(!CHROMIUM || !DIR)("UC-3 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, [...notes, ...missed.map((m) => `missed: ${m}`)].join("\n"));
    for (const h of started) await h.stop();
  });

  it("before or after", async () => {
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

    // A promise with no client, so the No client chip has a reason to show (items 4 and 5).
    {
      const page = await open(1440);
      await call(page, "ui.set_inbox", { clients: [] });
      await call(page, "followup.add", { what: "Send the cutover checklist", due: "2026-11-01" });
      await page.reload();
      await page.waitForSelector(".demo-tag", { timeout: 30_000 });
      // 4: the computer's chips over the headings, on Promises.
      await shot(page, "1-inbox-computer", async () => {
        await go(page, "#/inbox/promises");
        await page.locator(".ib4-chips .ib4-chip").first().waitFor({ timeout: 30_000 });
      });
      notes.push(`4. computer, Promises: ${JSON.stringify(await inboxText(page))}`);
      await go(page, "#/inbox/chats");
      notes.push(`4. computer, From chats: ${JSON.stringify(await inboxText(page))}`);
      notes.push(`4. the tab: ${await page.locator(".view-tab", { hasText: "Inbox" }).first().textContent()}`);

      // 7: a tab's tooltip, its title drawn beside it.
      await shot(page, "4-tab-tooltip", async () => {
        await go(page, "#/inbox/chats");
        const title = await page.evaluate(() => {
          const tabs = [...document.querySelectorAll<HTMLElement>(".view-tab")];
          const t = tabs.find((x) => /Calls/.test(x.title)) ?? tabs.at(-1)!;
          const r = t.getBoundingClientRect();
          const box = document.createElement("div");
          box.textContent = t.title;
          box.setAttribute("style", `position:fixed;left:${Math.max(8, r.left - 80)}px;top:${r.bottom + 6}px;z-index:99999;background:#f4f4f4;color:#111;font:12px system-ui;padding:3px 6px;border:1px solid #999;box-shadow:0 2px 6px rgba(0,0,0,.4)`);
          document.body.appendChild(box);
          return tabs.map((x) => x.title).join(" | ");
        });
        notes.push(`7. tab titles: ${title}`);
      });
      await page.close();
    }

    // 4 and 5: the phone's Inbox.
    {
      const page = await open(390, 844);
      // Each page is its own demo session: the phone's gets its own promise with no client.
      await call(page, "followup.add", { what: "Send the cutover checklist", due: "2026-11-01" });
      await page.reload();
      await page.waitForSelector(".demo-tag", { timeout: 30_000 });
      await shot(page, "2-inbox-phone", async () => {
        await go(page, "#/inbox/promises");
        await page.locator(".ib4-chips .ib4-chip").first().waitFor({ timeout: 30_000 });
      });
      notes.push(`4 and 5. phone, Promises: ${JSON.stringify(await inboxText(page))}`);
      await page.close();
    }

    // 6: Backlog's bulk State on a feature and a story, a state only the feature takes, then Review's preview.
    {
      const page = await open(1440);
      await call(page, "ahead.discard", { confirm: true });
      await go(page, "#/backlog");
      await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
      const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
      for (const b of await chips.getByRole("button").all()) if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
      await chips.getByRole("button", { name: "Atlas Freight", exact: true }).click();
      await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
      await pickLevel(page, "Features");
      const row = (t: string) => page.locator(".ah-row", { has: page.getByRole("link", { name: t, exact: true }) });
      const r = row("Carrier rate alerts");
      if ((await r.getAttribute("aria-expanded")) !== "true") await r.locator(".ah-chev").first().click();
      await row("Carrier rate alerts").getByRole("checkbox").check({ force: true });
      await row("Alert settings page").getByRole("checkbox").check({ force: true });
      await page.getByRole("toolbar", { name: "Selected items" }).getByRole("button", { name: "State…" }).click();
      await page.locator(".ah-pop-bulk-state").waitFor();
      await page.locator(".ah-pop-bulk-state").getByRole("option", { name: /On hold/ }).click();
      await page.waitForTimeout(800);
      notes.push(`6. result line: ${await page.locator(".bl-result").first().textContent().catch(() => "none")}`);
      await shot(page, "3-backlog-state-preview", async () => {
        await page.getByRole("button", { name: "Review" }).click();
        await page.getByRole("dialog", { name: "Review changes" }).waitFor();
      });
      notes.push(`6. Review: ${await page.getByRole("dialog", { name: "Review changes" }).textContent().catch(() => "none")}`);
      await page.close();
    }
  }, T);
});
