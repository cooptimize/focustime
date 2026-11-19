// MC-7: the before and after screenshots, one script for both so the pairs match. Only when MC7_SHOTS names a folder
// (screenshots/mc7/before or screenshots/mc7/after); nothing runs otherwise. Demo data only, dark but one. Before and
// after: Add a call's transcript choices, a call with no transcript, a call's menu, at 1440 by 900 and 390 by 844.
// After only: the box with a transcript and its line, with notes and its line, a call reviewed from notes with a
// proposal's note line, Your notes, the replace question, the box at 390 by 844, and one in light. A browser draws no
// native question in a screenshot, so the question's own words are shown in a box drawn by this script.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const DIR = process.env.MC7_SHOTS ?? null;
const T = 900_000;
const W = 30_000;
const missed: string[] = [];
const notes: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TRANSCRIPT = [
  "Alex Rivera  0:04",
  "Quick one before the weekly call.",
  "Dana Brooks  0:21",
  "Small one: the export file name should carry the date range, so files don't overwrite each other.",
  "Alex Rivera  0:48",
  "I'll book a session with your accountants next week to walk through the statements.",
  "Dana Brooks  1:10",
  "The CSV part of the export is on track from our side.",
  "Priya Shah  1:32",
  "I'll add the row limit warning before it ships.",
].join("\n");
const NOTES = [
  "Statements with Dana",
  "- Export: CSV only for now, Excel can wait until next quarter",
  "- Accountants need a monthly statement as a PDF from the same page",
  "- I'll send the date range filter for review by Thursday",
  "- Dana to share three sample statements from last year",
  "- Longer term: one reporting area for the accountants",
].join("\n");

async function shot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("MC-7 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, [...notes, ...missed.map((m) => `missed: ${m}`)].join("\n"));
    for (const h of started) await h.stop();
  });

  it("before or after", async () => {
    const h = await startDemo();
    started.push(h);
    const themed = async (page: Page, theme = "cooptimize-dark") => {
      await call(page, "ui.set_theme", { theme });
      await page.reload();
      await page.waitForSelector(".topbar", { timeout: W });
      return page;
    };
    const open = async (width: number, height = 900, theme?: string) => themed((await freshPage(h, { width, height })).page, theme);
    const phone = async () => {
      const page = await phonePage(h, 390);
      await page.setViewportSize({ width: 390, height: 844 });
      return themed(page);
    };
    const go = async (page: Page, hash: string) => {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.locator("[data-calls-list] [data-call-row]").first().waitFor({ timeout: W }).catch(() => {});
      await page.waitForTimeout(800);
    };
    const addCall = async (page: Page) => {
      await go(page, "#/calls");
      await page.getByRole("button", { name: "Add a call" }).click();
      const add = page.getByRole("form", { name: "Add a call" });
      await add.waitFor({ timeout: W });
      return add;
    };
    const laterCall = async (page: Page, name: string) => {
      const add = await addCall(page);
      await add.locator("[data-choice='later']").click();
      await add.getByLabel("Name", { exact: true }).fill(name);
      await add.locator("#mtg-add-client").selectOption({ label: "Northwind" });
      await add.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("heading", { level: 2, name }).waitFor({ timeout: W });
      await page.waitForTimeout(800);
    };
    const weekly = async (page: Page) => {
      const m = (await call(page, "meeting.mine", {})).data as { meetings: { id: number; call: string | null }[]; occurrences: { id: number; seriesId: number }[] };
      const id = m.occurrences.find((o) => o.seriesId === m.meetings.find((s) => !s.call)!.id)!.id;
      await go(page, `#/calls/${id}`);
      await page.getByRole("heading", { level: 2, name: "Northwind weekly status call" }).waitFor({ timeout: W });
    };
    const after = !/before/.test(DIR!);

    // 1440 by 900: the choices in Add a call, on a call with no transcript, and the call's menu.
    {
      const page = await open(1440);
      await shot(page, "1-choices-add-1440", async () => void (await addCall(page)));
      await shot(page, "2-choices-call-1440", () => laterCall(page, "Huddle on pallet labels"));
      await shot(page, "3-menu-1440", async () => {
        await weekly(page);
        await page.locator("[data-call-menu] button").click();
        await page.getByRole("menuitem").first().waitFor({ timeout: W });
      });
      await page.close();
    }
    // 390 by 844: the same choices and the menu.
    {
      const page = await phone();
      await shot(page, "4-choices-add-390", async () => void (await addCall(page)));
      await shot(page, "5-menu-390", async () => {
        await page.reload();
        await page.waitForSelector(".topbar", { timeout: W });
        await laterCall(page, "Phone huddle");
        await page.locator("[data-call-menu] button").click();
        await page.getByRole("menuitem").first().waitFor({ timeout: W });
      });
      await page.close();
    }
    if (!after) return;

    {
      const page = await open(1440);
      // The box with a transcript and its line (Add a call).
      await shot(page, "6-paste-transcript-1440", async () => {
        const add = await addCall(page);
        await add.locator("[data-choice='paste']").click();
        await add.getByLabel("Paste a transcript or your notes").fill(TRANSCRIPT);
        await add.locator("[data-paste-took='transcript']").waitFor({ timeout: W });
        await add.getByLabel("Name", { exact: true }).fill("Export check with Dana");
        await add.locator("#mtg-add-client").selectOption({ label: "Northwind" });
        notes.push(`6: ${await add.locator("[data-paste-line]").textContent()}`);
      });
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("form", { name: "Add a call" }).getByRole("button", { name: "Cancel" }).click().catch(() => {});
      // The box with notes and its line, on a call with no transcript.
      await shot(page, "7-paste-notes-1440", async () => {
        await laterCall(page, "Statements chat with Dana");
        const choices = page.locator("[data-no-transcript]");
        await choices.locator("[data-choice='paste']").click();
        await choices.getByLabel("Paste a transcript or your notes").fill(NOTES);
        await choices.locator("[data-paste-took='notes']").waitFor({ timeout: W });
        notes.push(`7: ${await choices.locator("[data-paste-line]").textContent()}`);
      });
      // Reviewed from notes: a promise opened, its note line under it (no speaker, no time).
      await shot(page, "8-notes-review-1440", async () => {
        await page.locator("[data-no-transcript]").getByRole("button", { name: "Use this" }).click();
        await page.locator("[data-call-origin]", { hasText: "Pasted notes" }).waitFor({ timeout: W });
        await page.locator(".mtg-prop").first().waitFor({ timeout: W });
        await page.locator(".mtg-prop").filter({ hasText: "date range filter" }).locator(".mtg-p3").first().hover();
      });
      // Your notes, at the line that proposal rests on.
      await shot(page, "9-your-notes-1440", async () => {
        await page.locator(".mtg-prop").filter({ hasText: "date range filter" }).locator(".mtg-p3").first().click();
        await page.getByRole("region", { name: "Your notes" }).waitFor({ timeout: W });
      });
      // The replace question, on the call with the pasted notes.
      await shot(page, "10-replace-1440", async () => {
        await page.getByRole("button", { name: "Proposals" }).click();
        await page.locator("[data-call-menu] button").click();
        await page.getByRole("menuitem", { name: /Paste a transcript or notes/ }).click();
        const box = page.locator("[data-paste-replace]");
        await box.getByLabel("Paste a transcript or your notes").fill(TRANSCRIPT);
        let asked = "";
        page.once("dialog", (d) => void ((asked = d.message()), d.dismiss()));
        await box.getByRole("button", { name: "Use this" }).click();
        await page.waitForTimeout(500);
        notes.push(`10: ${asked}`);
        await page.evaluate((text) => {
          // The page's CSP refuses style attributes; styles set through the element's style object are allowed.
          const d = document.createElement("div");
          Object.assign(d.style, { position: "fixed", top: "120px", left: "50%", transform: "translateX(-50%)", maxWidth: "460px", padding: "16px 18px", background: "#2b2d31", color: "#f2f2f2", border: "1px solid #555", borderRadius: "10px", boxShadow: "0 8px 30px rgba(0,0,0,.5)", font: "14px system-ui", zIndex: "99999" });
          const q = document.createElement("p");
          Object.assign(q.style, { margin: "0 0 12px" });
          q.textContent = text;
          const row = document.createElement("div");
          Object.assign(row.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });
          for (const label of ["Cancel", "OK"]) {
            const b = document.createElement("button");
            b.textContent = label;
            Object.assign(b.style, { padding: "4px 14px" });
            row.append(b);
          }
          d.append(q, row);
          d.setAttribute("data-shot-question", "");
          document.body.append(d);
        }, asked);
        notes.push(`10 origin after no: ${await page.locator("[data-call-origin]").textContent()}`);
      });
      await page.close();
    }
    // The box at 390 by 844, with notes.
    {
      const page = await phone();
      await shot(page, "11-paste-390", async () => {
        await laterCall(page, "Phone notes");
        await page.locator("[data-call-menu] button").click();
        await page.getByRole("menuitem", { name: /Paste a transcript or notes/ }).click();
        const choices = page.locator("[data-no-transcript]");
        await choices.getByLabel("Paste a transcript or your notes").fill(NOTES);
        await choices.locator("[data-paste-took='notes']").waitFor({ timeout: W });
        await choices.locator("[data-paste-line]").scrollIntoViewIfNeeded();
      });
      await page.close();
    }
    // One in light: the box with a transcript.
    {
      const page = await open(1440, 900, "cooptimize-light");
      await shot(page, "12-paste-transcript-light-1440", async () => {
        const add = await addCall(page);
        await add.locator("[data-choice='paste']").click();
        await add.getByLabel("Paste a transcript or your notes").fill(TRANSCRIPT);
        await add.locator("[data-paste-took='transcript']").waitFor({ timeout: W });
      });
      await page.close();
    }
  }, T);
});
