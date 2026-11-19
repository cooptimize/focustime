// OP-1 A2: Week › Status's Push (ST-1: Push to DevOps, on the foot bar) and Undo through the app's one preview. More than 10 lines go 10 at a time and the
// screen says so first; Not now on the first preview sends nothing and opens no other; a comment delete shows the
// comment going and is undone through the same preview; a line naming another client is flagged, and Replace writes
// "another client" in what reaches DevOps and in "Pushed just now"; on the phone the preview fits.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { confirmPreviews, onePreview } from "../one-preview.ts";

const T = 300_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Entry = { op: string; itemId: number; clientKey: string; ops: { text?: string } | null; status: string };
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as Entry[];
async function openStatus(page: Page) {
  await page.evaluate(() => (location.hash = "#/status"));
  await page.reload();
  await page.locator("[data-updated]").waitFor({ timeout: 30_000 });
  await page.locator("[data-show=all]").click();
}
const article = (page: Page, name: string) => page.getByRole("article", { name });
async function addLine(page: Page, feature: string, text: string) {
  const a = article(page, feature);
  await a.getByRole("button", { name: "Write a line" }).click();
  await a.getByRole("textbox").last().fill(text);
  await a.getByRole("textbox").last().press("Escape");
}

describe.skipIf(!CHROMIUM)("OP-1: Status through the one preview", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("11 lines on one client: said first, then 10 and 1; Not now on the first sends nothing", async () => {
    const { page, errors } = await freshPage(h);
    await openStatus(page);
    for (let i = 1; i <= 11; i++) await addLine(page, "Order history export", `Step ${i} of the export work is done.`);
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("11 lines ready to push");
    await expect.poll(() => page.locator(".st-parts").textContent()).toBe("11 lines go in 2 previews, 10 at most in each.");
    const before = (await log(page)).length;
    await page.locator("[data-foot-bar]").getByRole("button", { name: "Push to DevOps" }).click();
    const d = onePreview(page);
    await d.locator(".dw-step", { hasText: "Preview 1 of 2" }).waitFor();
    expect(await d.locator(".dw-row").count()).toBe(10);
    await d.getByRole("button", { name: "Not now" }).click();
    await d.waitFor({ state: "detached" });
    await page.waitForTimeout(800);
    expect(await onePreview(page).count()).toBe(0);
    expect((await log(page)).length).toBe(before);
    expect(await page.locator(".st-pending-count").textContent()).toBe("11 lines ready to push");
    await page.locator("[data-foot-bar]").getByRole("button", { name: "Push to DevOps" }).click();
    const seen = await confirmPreviews(page, 2);
    expect(seen.map((x) => x.rows)).toEqual([10, 1]);
    await expect.poll(async () => (await log(page)).length - before, { timeout: 30_000 }).toBe(11);
    expect((await log(page)).slice(0, 11).map((e) => e.ops?.text).reverse()).toEqual(Array.from({ length: 11 }, (_, i) => `Step ${i + 1} of the export work is done.`));
    await expect.poll(() => page.locator(".st-pushed li.ok").count()).toBe(11);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a comment delete shows it going, and Undo puts it back through the same preview", async () => {
    const { page } = await freshPage(h);
    await openStatus(page);
    const a = article(page, "Order history export");
    const mine = a.locator(".st-comment", { hasText: "CSV export is merged" }).first();
    await mine.getByRole("button", { name: "Delete" }).click();
    await page.locator("[data-foot-bar]").getByRole("button", { name: "Push to DevOps" }).click();
    const d = onePreview(page);
    await d.waitFor();
    await expect.poll(() => d.locator(".wd-fields").textContent()).toContain("CSV export is merged");
    await d.getByRole("button", { name: "Delete comment in DevOps" }).click();
    await d.waitFor({ state: "detached", timeout: 30_000 });
    expect((await log(page))[0]!.op).toBe("comment_delete");
    await page.locator(".st-pushed").getByRole("button", { name: "Undo" }).first().click();
    const u = onePreview(page);
    await u.waitFor();
    await u.locator("button.commit").click();
    await u.waitFor({ state: "detached", timeout: 30_000 });
    expect((await log(page))[0]!.op).toBe("undo_comment_delete");
    await expect.poll(() => page.locator(".st-pushed li").first().textContent()).toContain("Undone");
    await page.close();
  }, T);

  it("a line naming another client: flagged with where it goes, Replace writes another client", async () => {
    const { page } = await freshPage(h);
    await openStatus(page);
    await addLine(page, "Order history export", "Same filter as the one we built for Harbor Health last month.");
    await page.locator("[data-foot-bar]").getByRole("button", { name: "Push to DevOps" }).click();
    const d = onePreview(page);
    await d.locator(".mention-flag").waitFor();
    await expect.poll(() => d.locator(".mention-flag").textContent()).toMatch(/This mentions Harbor.*Northwind's DevOps and Monday's report/);
    await d.getByRole("button", { name: /Replace with/ }).click();
    await expect.poll(() => onePreview(page).locator(".wd-fields").textContent()).toContain("another client");
    expect(await onePreview(page).locator(".mention-flag").count()).toBe(0);
    await onePreview(page).locator("button.commit").click();
    await onePreview(page).waitFor({ state: "detached", timeout: 30_000 });
    const e = (await log(page))[0]!;
    expect(e.ops?.text).toContain("another client");
    expect(e.ops?.text).not.toContain("Harbor");
    await expect.poll(() => page.locator(".st-pushed li").first().textContent()).toContain("another client");
    await page.close();
  }, T);

  it("on the phone at 390 the preview fits and confirms", async () => {
    const { page } = await freshPage(h, { width: 390, height: 844 });
    await openStatus(page);
    await addLine(page, "Order history export", "Export filter in test; finance checks it Monday.");
    await addLine(page, "Internal reporting refresh", "Sign-up form designed; review with purchasing on Friday.");
    await page.locator("[data-foot-bar]").getByRole("button", { name: "Push to DevOps" }).click();
    const d = onePreview(page);
    await d.locator(".dw-step").waitFor();
    const fits = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"][data-overlay="modal"]')!;
      const r = el.getBoundingClientRect();
      // Nothing inside sticks out past the dialog's right edge (the head, the ×, the table).
      const inside = [...el.querySelectorAll("*")].every((c) => c.getBoundingClientRect().right <= r.right + 0.5);
      return inside && r.left >= 0 && r.right <= window.innerWidth + 0.5 && el.scrollWidth <= el.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth;
    });
    expect(fits).toBe(true);
    const go = d.locator("button.commit");
    expect((await go.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await go.click();
    await onePreview(page).locator(".dw-step", { hasText: "Preview 2 of 2" }).waitFor({ timeout: 30_000 });
    await onePreview(page).locator("button.commit").click();
    await onePreview(page).waitFor({ state: "detached", timeout: 30_000 });
    await page.close();
  }, T);
});
