// MC-2: the before and after screenshots, one script for both (before: run it on main's build, where the new parts
// are simply missed). Only when MC2_SHOTS names a folder; nothing runs otherwise. Demo data only, dark, with Calls once
// in light; the computer at 1440x900 and the phone at 390x844. Clock: Thursday Nov 5, 2026 10:00 AM ET.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.MC2_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("MC-2 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });

  for (const [size, w, hgt] of [["1440", 1440, 900], ["390", 390, 844]] as const) {
    it(`Calls at ${size}`, async () => {
      const h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
      started.push(h);
      const { page } = await freshPage(h, { width: w, height: hgt });
      const theme = async (t: string) => {
        await call(page, "ui.set_theme", { theme: t });
        await page.reload();
        await page.waitForSelector(".demo-tag", { timeout: 30_000 }).catch(() => undefined);
      };
      const go = async (hash: string) => {
        await page.evaluate((x) => (location.hash = x), hash);
        await page.waitForTimeout(1500);
      };
      const other = (name: string) => page.locator(".mtg-other").filter({ hasText: name }).first();
      const review = async (name: string, pick?: number) => {
        await go("#/meetings");
        await other(name).getByRole("button", { name: /^Review/ }).click({ timeout: 10_000 });
        if (pick !== undefined) await page.getByLabel("Which client is this call about?").selectOption({ index: pick });
      };
      await theme("cooptimize-light");
      await shot(page, `${size}-01-calls-light`, () => go("#/meetings"));
      await theme("cooptimize-dark");
      await shot(page, `${size}-02-calls`, () => go("#/meetings"));
      await shot(page, `${size}-03-add-a-call`, async () => {
        await go("#/meetings");
        await page.getByRole("button", { name: "Add a call" }).click({ timeout: 10_000 });
        await page.getByLabel("Name", { exact: true }).fill("Teammates' huddle on the export");
      });
      await shot(page, `${size}-04-setup-suggested`, () => review("Northwind data model review"));
      // Each Teams refusal the demo has: transcripts off (403), organized outside Cooptimize (the setup, then the page), no transcript.
      const refuse = async (name: string, n: string, pick?: number) =>
        shot(page, `${size}-${n}`, async () => {
          await review(name, pick);
          await page.getByRole("button", { name: "Continue" }).click();
          await page.waitForTimeout(2500);
        });
      await refuse("Proposal review with Jordan", "05-refused-not-allowed", 1);
      await shot(page, `${size}-06-refused-outside`, async () => {
        await go("#/meetings");
        const row = page.locator(".mtg-other").filter({ hasText: /Northwind/ }).filter({ hasNotText: "data model" }).first();
        await row.getByRole("button", { name: /^Review/ }).click({ timeout: 10_000 });
      });
      await refuse("Lunch and learn", "07-refused-no-transcript", 1);
      await refuse("Atlas backlog refinement", "08-refused-outside-continue");
      await shot(page, `${size}-09-reviewed-call-summary`, async () => {
        await review("Northwind data model review");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/^Got the transcript from Teams/).waitFor({ timeout: 30_000 });
      });
      const id = (await call(page, "meeting.mine", {})).data?.meetings?.find((m: { call?: string | null }) => !m.call)?.id;
      const occ = (await call(page, "meeting.mine", {})).data?.occurrences?.find((o: { seriesId: number }) => o.seriesId === id)?.id ?? 0;
      await shot(page, `${size}-10-client-call-summary`, () => go(`#/meetings/${occ}`));
      await shot(page, `${size}-11-meeting-menu`, async () => {
        await go("#/week");
        await call(page, "ui.set_today_timeline", { show: true });
        await go("#/today/2026-11-03");
        const ev = page.locator(".event", { hasText: "Atlas" }).first();
        await ev.locator(".ev-time").click({ timeout: 10_000 });
        await page.locator(".popup-menu").waitFor({ timeout: 5000 });
      });
      await page.close();
    }, T);
  }
});
