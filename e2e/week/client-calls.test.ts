// Was e2e/meetings.test.ts until BT-1.
// MC-1: meeting capture's main path in demo mode. MC-1e: the page made like the rest of the app. From the Week card's
// call mark: nothing ticked and no bar; the filter in the address; a new Epic that Northwind's process needs a target
// date on says so on its row and can't be sent until it has one; a story with no parent gets the parent picker; a
// row's Create opens the app's one DevOps preview and, confirmed, folds into "1 done"; a promise is kept at once with
// Undo; the older comment on a feature says it won't be sent and offers only Skip; ticking shows the bar with its
// count, Clear hides it; Back returns to Week. Clock: Thursday Nov 5, 2026 10:00 AM ET (the call was Monday).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

let h: Harness;
const T = 180_000;

describe.skipIf(!CHROMIUM)("meeting capture (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("each row its own way: needed fields first, the one preview, a promise with Undo, the bar only when ticked; Back to Week", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/week"));
    const mark = page.locator(".call-mark").first();
    await mark.waitFor({ timeout: 30_000 });
    await expect(mark.textContent()).resolves.toBe("Weekly status call· Review 11 proposals");
    await mark.click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    const id = Number((await page.evaluate(() => location.hash)).split("/")[2]);
    // Nothing ticked to start, and no bar.
    await expect(page.locator(".mtg-prop input[type=checkbox]:checked").count()).resolves.toBe(0);
    await expect(page.locator(".mtg-bulk").count()).resolves.toBe(0);
    // One count, the same on the Proposals switch and the page's line.
    await expect(page.locator(".mtg-count").textContent()).resolves.toMatch(/^11 to review/);
    await expect(page.locator(".mtg-switch").getByRole("button", { name: /Proposals/ }).textContent()).resolves.toContain("11");

    // The filter, in the address.
    await page.locator(".mtg-filter").getByRole("button", { name: /New in DevOps/ }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/meetings/${id}/new`);
    await expect.poll(() => page.locator(".mtg-group").count()).toBe(1);

    // The Epic: Northwind's process needs a target date. Said on the row; Create waits for it.
    const epic = page.locator(".mtg-prop").filter({ has: page.locator("input[value='Accountant reporting area']") });
    await expect(epic.locator(".mtg-need").textContent()).resolves.toContain("Target Date");
    const create = epic.getByRole("button", { name: "Create in DevOps" });
    await expect(create.isDisabled()).resolves.toBe(true);
    await epic.getByRole("button", { name: /^Target date for Accountant reporting area/ }).click();
    await page.locator(".dp-pop input.dp-box").fill("2026-12-18");
    await page.locator(".dp-pop input.dp-box").press("Enter");
    await page.locator(".dp-pop").waitFor({ state: "detached" });
    await expect.poll(() => epic.locator(".mtg-need").count()).toBe(0);
    await expect.poll(() => create.isDisabled()).toBe(false);

    // A story with no parent gets the parent picker on its row.
    const loose = page.locator(".mtg-prop").filter({ has: page.locator("input[value='Date range in the export file name']") });
    await expect(loose.getByRole("button", { name: /^Parent for Date range in the export file name/ }).count()).resolves.toBe(1);

    // A row's Create opens the one DevOps preview; confirmed, it folds into "1 done".
    const statement = page.locator(".mtg-prop").filter({ has: page.locator("input[value='Monthly statement as a PDF']") });
    await statement.getByRole("button", { name: "Create in DevOps" }).click();
    const dialog = page.locator(".write-dialog.devops");
    await dialog.waitFor({ timeout: 30_000 });
    await expect(dialog.textContent()).resolves.toContain("Monthly statement as a PDF");
    await dialog.getByRole("button", { name: "Create in DevOps" }).click();
    await dialog.waitFor({ state: "detached", timeout: 30_000 });
    await expect.poll(() => page.locator(".mtg-fold").first().textContent()).toContain("1 done");
    await expect(page.locator(".mtg-count").textContent()).resolves.toMatch(/^10 to review · 1 done/);

    // A promise is kept at once, with Undo.
    await page.locator(".mtg-filter").getByRole("button", { name: /Promises/ }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/meetings/${id}/promises`);
    const mine = page.locator(".mtg-prop:not(.confirmed)").filter({ has: page.locator("input[value='Send the date range filter for review']") });
    await mine.getByRole("button", { name: "Add to Promises" }).click();
    const toast = page.locator(".undo-toast");
    await expect.poll(() => toast.textContent()).toContain("Promises");
    await expect.poll(() => mine.count()).toBe(0);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => mine.count()).toBe(1);

    // Comments: the older one on a feature won't be sent and has only Skip; the rest tick into the bar.
    await page.locator(".mtg-filter").getByRole("button", { name: /Comments/ }).click();
    const onFeature = page.locator(".mtg-prop.stuck").filter({ hasText: "#1110" });
    await expect(onFeature.textContent()).resolves.toContain("won't be sent");
    await expect(onFeature.getByRole("button", { name: "Add comment" }).count()).resolves.toBe(0);
    await expect(onFeature.getByRole("checkbox").count()).resolves.toBe(0);
    await page.locator(".mtg-sec-head").getByRole("button", { name: "Select all" }).click();
    const bar = page.locator(".mtg-bulk");
    await bar.waitFor();
    await expect(bar.textContent()).resolves.toContain("3 selected");
    await expect(bar.getByRole("button", { name: "Send 3 to DevOps" }).count()).resolves.toBe(1);
    await bar.getByRole("button", { name: "Clear" }).click();
    await bar.waitFor({ state: "detached" });

    // Back returns to Week, where the call was opened from.
    await page.locator(".mtg-view").getByRole("button", { name: "Back to Week" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/week");
    expect(errors).toEqual([]);
  }, T);

  it("from Client calls: the same count there; filter after a reload; Bring back; a line's button opens a folded row; Back to Client calls", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/meetings"));
    const series = page.locator(".mtg-series").first();
    await series.waitFor({ timeout: 30_000 });
    const listed = Number(/Review (\d+) proposals/.exec((await series.textContent()) ?? "")?.[1]);
    await series.getByRole("button", { name: /Review|Open/ }).first().click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    const id = Number((await page.evaluate(() => location.hash)).split("/")[2]);
    await expect(page.locator(".mtg-count").textContent()).resolves.toMatch(new RegExp(`^${listed} to review`));
    // The filter survives a reload.
    await page.locator(".mtg-filter").getByRole("button", { name: /Promises/ }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/meetings/${id}/promises`);
    await page.reload();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    await expect(page.locator(".mtg-filter").getByRole("button", { name: /Promises/ }).getAttribute("aria-pressed")).resolves.toBe("true");
    await expect.poll(() => page.locator(".mtg-group").count()).toBe(1);
    // Skip one: it folds into "1 skipped" and the count drops; Bring back returns it.
    const row = page.locator(".mtg-prop.open").filter({ has: page.locator("input[value='Add the row limit warning before the export ships']") });
    await row.getByRole("button", { name: "Skip" }).click();
    await expect.poll(() => row.count()).toBe(0);
    const fold = page.locator(".mtg-fold").filter({ hasText: "1 skipped" });
    await expect(page.locator(".mtg-count").textContent()).resolves.toMatch(new RegExp(`^${listed - 1} to review · 1 skipped`));
    // From the transcript, the skipped row's line opens it, unfolded and focused.
    await page.locator(".mtg-switch").getByRole("button", { name: /Transcript/ }).click();
    await page.getByRole("searchbox", { name: "Filter the transcript" }).fill("row limit");
    await page.locator(".mtg-lines li.marked").first().getByRole("button", { name: /^Go to the proposal/ }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.querySelector(".mtg-main")?.textContent)).toBe("Add the row limit warning before the export ships");
    await expect(fold.getByRole("button", { name: /1 skipped/ }).getAttribute("aria-expanded")).resolves.toBe("true");
    await page.locator(".mtg-prop.skipped").getByRole("button", { name: "Bring back" }).click();
    await expect.poll(() => row.count()).toBe(1);
    await expect.poll(() => page.locator(".mtg-count").textContent()).toMatch(new RegExp(`^${listed} to review`));
    // Back to Client calls, where it was opened from.
    await page.locator(".mtg-view").getByRole("button", { name: "Back to client calls" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/meetings");
    expect(errors).toEqual([]);
  }, T);

  for (const [w, ht] of [[1440, 900], [390, 844]] as const)
    it(`while scrolling at ${w} by ${ht}, the title row, the filter row and the section's header stay in view`, async () => {
      const { page, errors } = await freshPage(h, { width: w, height: ht });
      await page.evaluate(() => (location.hash = "#/week"));
      const id = (await page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "meeting.mine", input: {} }) }).then((r) => r.json()))).data.occurrences[0].id as number;
      await page.evaluate((x) => (location.hash = x), `#/meetings/${id}`);
      await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
      const view = page.locator(".mtg-view");
      const top = await view.evaluate((el) => el.getBoundingClientRect().top);
      const barH = await page.evaluate(() => document.querySelector(".app.phone > .topbar")?.getBoundingClientRect().height ?? null);
      for (const steps of [1, 2]) {
        // The wheel scrolls whatever scrolls here: the page on a computer, the document on a phone.
        await page.mouse.move(Math.round(w / 2), Math.round(ht / 2));
        await page.mouse.wheel(0, 700 * steps);
        await page.waitForTimeout(400);
        const head = (await page.locator(".mtg-sticky").boundingBox())!;
        expect(Math.round(head.y)).toBe(Math.round(barH ?? top));
        await expect(page.getByRole("heading", { name: "Update Northwind's plan" }).isVisible()).resolves.toBe(true);
        await expect(page.locator(".mtg-filter").isVisible()).resolves.toBe(true);
        // The header of the section being read sits right under them.
        const stuck = await page.locator(".mtg-sec-head").evaluateAll((hs) => hs.map((x) => Math.round(x.getBoundingClientRect().top)));
        expect(stuck.some((t) => Math.abs(t - (head.y + head.height)) <= 2), JSON.stringify({ stuck, head })).toBe(true);
      }
      // The page never scrolls sideways.
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
      await expect(view.evaluate((el) => el.scrollWidth <= el.clientWidth)).resolves.toBe(true);
      expect(errors).toEqual([]);
      await page.close();
    }, T);
});
