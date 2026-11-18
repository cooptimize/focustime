// PK-1: the before and after screenshots, one script for both (run on main for before, on the branch for after). Only
// when PK1_SHOTS names a folder; nothing runs otherwise. Demo data and an invented Pocket export only; dark at 1440×900
// and 390×844, plus the page in light. A scene a build doesn't have (the drag, the date question) is noted as missed,
// never faked. Clock: Thu Nov 5, 2026 10:00 AM ET (the demo's Northwind call was Monday Nov 2).
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { zipOf } from "../../test/docx.ts";
import { pocketPdf } from "../../test/pdf.ts";
import { dragOver, pocketZip, POCKET_TURNS } from "../pk1-helpers.ts";

const DIR = process.env.PK1_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>, o: { full?: boolean } = {}) {
  try {
    await run();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/${name}.png`, ...(o.full ? { fullPage: true } : {}) });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("PK-1 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });

  for (const [tag, w, ht, theme] of [["desk", 1440, 900, "cooptimize-dark"], ["phone", 390, 844, "cooptimize-dark"], ["light", 1440, 900, "cooptimize-light"]] as const) {
    it(`a call's upload area and a Pocket export (${tag})`, async () => {
      const h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
      started.push(h);
      const { page } = await freshPage(h, { width: w, height: ht });
      await call(page, "ui.set_theme", { theme });
      await page.evaluate(() => (location.hash = "#/week"));
      await page.reload();
      await page.waitForTimeout(1500);
      const id = (await call(page, "meeting.mine", {})).data.occurrences[0].id as number;
      const go = async (hash: string) => {
        await page.evaluate((x) => (location.hash = x), hash);
        await page.reload();
        await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1200);
      };
      const toArea = async () => {
        await page.locator(".mtg-upload").scrollIntoViewIfNeeded();
      };
      // Before anything: the Teams transcript's Transcript view, with its times.
      if (tag !== "light") await shot(page, `${tag}-0-teams-transcript`, () => go(`#/meetings/${id}/transcript`));
      await call(page, "meeting.no_transcript", { occurrenceId: id });
      await shot(page, `${tag}-1-upload-rest`, async () => {
        await go(`#/meetings/${id}`);
        await toArea();
      });
      if (tag === "light") {
        // Light: the area with a file dragged over it, then the proposals from a Pocket export.
        await shot(page, `${tag}-2-upload-drag`, async () => {
          await dragOver(page, [{ name: "x.zip", bytes: pocketZip() }]);
          await page.locator(".mtg-upload.dropping").waitFor({ timeout: 5000 });
        });
        await shot(page, `${tag}-5-proposals`, async () => {
          // The drag above never dropped: start from the page at rest.
          await page.reload();
          await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
          await page.locator(".mtg-upload input[type=file]").setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: Buffer.from(pocketZip()) });
          await page.getByText("From a Pocket recording.").waitFor({ timeout: 30_000 });
          await page.locator(".mtg-view").evaluate((el) => el.scrollTo(0, 0));
        });
        return;
      }
      await shot(page, `${tag}-2-upload-drag`, async () => {
        await dragOver(page, [{ name: "x.zip", bytes: pocketZip() }]);
        await page.locator(".mtg-upload.dropping").waitFor({ timeout: 5000 });
      });
      await page.reload();
      await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
      // A refusal: a zip with two PDFs in it (after); before, any Pocket file is refused.
      await shot(page, `${tag}-3-refusal`, async () => {
        const pdf = pocketPdf({ turns: POCKET_TURNS });
        await page.locator(".mtg-upload input[type=file]").setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: Buffer.from(zipOf({ "a.pdf": pdf, "b.pdf": pdf })) });
        await page.locator(".mtg-upload [role=status]").waitFor({ timeout: 30_000 });
        await toArea();
      });
      // The date question: a recording from Sunday for Monday's call.
      await shot(page, `${tag}-4-date-question`, async () => {
        await page.locator(".mtg-upload input[type=file]").setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: Buffer.from(pocketZip("Nov 1, 2026")) });
        await page.getByRole("alertdialog", { name: "The recording's date" }).waitFor({ timeout: 30_000 });
        await toArea();
      });
      await shot(page, `${tag}-5-proposals`, async () => {
        await page.getByRole("button", { name: "Use it for this call" }).click();
        await page.getByText("From a Pocket recording.").waitFor({ timeout: 30_000 });
        await page.locator(".mtg-view").evaluate((el) => (el.scrollTo(0, 0), window.scrollTo(0, 0)));
      });
      await shot(page, `${tag}-6-no-owner`, async () => {
        const row = page.locator(".mtg-prop").filter({ hasText: "Pocket didn't say who" }).first();
        await row.waitFor({ timeout: 10_000 });
        await row.scrollIntoViewIfNeeded();
      });
      await shot(page, `${tag}-7-transcript`, () => go(`#/meetings/${id}/transcript`));
    }, T);
  }
});
