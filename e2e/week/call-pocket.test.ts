// PK-1: a Pocket export as a call's transcript, in demo mode. The upload area takes a dropped file as well as the picker
// (it shows itself while a file is dragged over the page; a drop anywhere else does nothing; several files say one at a
// time; a call that already has a transcript asks before replacing it); a recording dated another day asks first; and
// what came of it shows no time and names no speaker: the one note, numbered speakers, a promise Pocket didn't say whose.
// Clock: Thu Nov 5, 2026 10:00 AM ET (the demo's Northwind call was Monday Nov 2).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { dragOver, dropOn, pocketZip } from "../pk1-helpers.ts";

let h: Harness;
const T = 180_000;
const NOTE = "From a Pocket recording. Speakers aren't named, and Pocket can mix them up.";

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function openCall(page: Page): Promise<number> {
  await page.evaluate(() => (location.hash = "#/week"));
  const id = (await call(page, "meeting.mine", {})).data.occurrences[0].id as number;
  await page.evaluate((x) => (location.hash = x), `#/meetings/${id}`);
  await page.reload();
  await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
  return id;
}

describe.skipIf(!CHROMIUM)("a Pocket export on a call's page (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("drop: the area shows itself, a stray drop does nothing, one file at a time, replacing asked first, the date asked, then no names or times", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const id = await openCall(page);
    // The call has a transcript: "No transcript this week" brings back the upload area (it still has one to replace).
    await call(page, "meeting.no_transcript", { occurrenceId: id });
    await page.reload();
    const area = page.locator(".mtg-upload");
    await area.waitFor({ timeout: 30_000 });
    await expect(area.textContent()).resolves.toContain("FocusTime takes a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf).");
    const uploads: string[] = [];
    page.on("request", (r) => r.url().includes("/api/meetings/upload") && uploads.push(r.url()));

    // While a file is dragged over the page, the area shows it will take it.
    await dragOver(page, [{ name: "x.zip", bytes: pocketZip() }]);
    await expect.poll(() => area.evaluate((el) => el.classList.contains("dropping"))).toBe(true);
    await expect(area.textContent()).resolves.toContain("Drop the file here");
    // Dropped anywhere else: the page keeps the browser from opening it, and nothing is sent.
    expect(await dropOn(page, ".mtg-view h2", [{ name: "x.zip", bytes: pocketZip() }])).toBe(true);
    await expect.poll(() => area.evaluate((el) => el.classList.contains("dropping"))).toBe(false);
    expect(page.url()).toContain(`#/calls/${id}`);
    // Two files: one at a time.
    await dropOn(page, ".mtg-upload", [{ name: "a.zip", bytes: pocketZip() }, { name: "b.zip", bytes: pocketZip() }]);
    await expect.poll(() => area.textContent()).toContain("One file at a time");
    // After a drop on the area, it stops showing the dragging look (no dragleave comes after a drop).
    await expect.poll(() => area.evaluate((el) => el.classList.contains("dropping"))).toBe(false);
    expect(uploads).toEqual([]);

    // A drop onto a call with a transcript asks first, in the page's words for replacing; No leaves it as it was.
    const asked: string[] = [];
    page.once("dialog", (d) => (asked.push(d.message()), void d.dismiss()));
    await dropOn(page, ".mtg-upload", [{ name: "x.zip", bytes: pocketZip("Nov 1, 2026") }]);
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain("Replace this call's transcript? The open proposals are replaced");
    expect(uploads).toEqual([]);

    // Yes: a recording dated another day asks before anything is kept.
    page.once("dialog", (d) => void d.accept());
    await dropOn(page, ".mtg-upload", [{ name: "x.zip", bytes: pocketZip("Nov 1, 2026") }]);
    const question = page.getByRole("alertdialog", { name: "The recording's date" });
    await question.waitFor({ timeout: 30_000 });
    await expect(question.textContent()).resolves.toContain("This Pocket recording is from Sun, Nov 1, 27:02 long. This call is Mon, Nov 2. Use it for this call?");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("alertdialog");
    await question.getByRole("button", { name: "Use it for this call" }).click();

    // What came of it: the one note, numbered speakers, no times, a promise with no owner.
    await page.getByText(NOTE).waitFor({ timeout: 30_000 });
    expect(await page.getByText(NOTE).count()).toBe(1);
    const quotes = await page.locator(".mtg-quotes .mtg-who").allTextContents();
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((q) => /^Speaker \d+$/.test(q.trim()))).toBe(true);
    await expect(page.locator(".mtg-prop").filter({ hasText: "Share three sample statements" }).first().textContent()).resolves.toContain("Pocket didn't say who");
    // Alex names himself, so it's his; the words don't name who it's for, so no one is guessed.
    const alex = (await page.locator(".mtg-prop").filter({ hasText: "date range filter for review" }).first().textContent()) ?? "";
    expect(alex).toContain("in Alex's Promises");
    expect(alex).not.toContain("Dana");
    await page.locator(".mtg-switch").getByRole("button", { name: /Transcript/ }).click();
    const lines = page.locator(".mtg-lines li");
    await lines.first().waitFor({ timeout: 30_000 });
    expect(await page.getByText(NOTE).count()).toBe(1);
    expect(await page.locator(".mtg-line-at").count()).toBe(0);
    await expect(lines.first().textContent()).resolves.toMatch(/^Speaker 1\s*Morning everyone/);
    expect(errors).toEqual([]);
  }, T);

  it("the button and the keyboard work as before; a drop on a call with a transcript goes to its actions", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCall(page);
    const input = page.locator(".mtg-actions input[type=file]");
    // Keyboard: the file button is in the tab order and takes focus (the picker opens from it as before), and the
    // picker's file is read.
    await expect(input.evaluate((el: HTMLInputElement) => el.tabIndex >= 0 && !el.disabled)).resolves.toBe(true);
    await expect.poll(async () => (await input.focus(), page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type))).toBe("file");
    await expect(input.getAttribute("accept")).resolves.toContain(".zip");
    await input.setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: Buffer.from(pocketZip()) });
    await expect.poll(() => page.locator(".mtg-actions [role=status]").textContent(), { timeout: 30_000 }).toMatch(/^Read \d+ lines\./);
    await page.getByText(NOTE).waitFor();
    // With no upload area, the actions take the drop, and replacing is asked first.
    await dragOver(page, [{ name: "x.zip", bytes: pocketZip() }]);
    await expect.poll(() => page.locator(".mtg-actions.mtg-drop.dropping").count()).toBe(1);
    await expect(page.locator(".mtg-actions").textContent()).resolves.toContain("Drop the file here to replace the transcript");
    const asked: string[] = [];
    page.once("dialog", (d) => (asked.push(d.message()), void d.dismiss()));
    await dropOn(page, ".mtg-actions", [{ name: "x.zip", bytes: pocketZip() }]);
    await expect.poll(() => asked.length).toBe(1);
    expect(errors).toEqual([]);
  }, T);
});
