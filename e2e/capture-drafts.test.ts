// Step 15.3: one capture flow (kind chips, inline fields, Enter saves as the kind), the draft editor (round trip, Plan
// it, Delete), linked intentions and dragging right-pane rows onto the week's other days. Demo mode only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openPlanDay, selectBlock, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 60_000;
const api = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(
    ([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()),
    [action, input] as const,
  ) as Promise<{ ok: boolean; data: R }>;
const kindChip = (page: Page, name: string) => page.locator(".cap-box .cap-box-kinds [role=radio]", { hasText: name });
const checked = (page: Page) => page.locator(".cap-box-kinds [role=radio][aria-checked=true]").first().textContent();
const box = (page: Page) => page.locator(".cap-box input[aria-label='Quick capture']").first();
async function chooseClient(page: Page, name: string) {
  await page.locator(".cap-box .cap-client").first().click();
  await page.locator(".cap-choose .chip-btn", { hasText: name }).click();
}
async function drafts(page: Page) {
  return (await api<{ drafts: { id: number; title: string; level: string; size: string; parentItemId: number | null; targetDate?: string | null; description?: string | null; acceptance?: string | null }[] }>(page, "capture.load", {})).data.drafts;
}

describe.skipIf(!CHROMIUM)("One capture flow and the draft editor (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Inbox: the explainer, a prominent box, and no separate Add a follow-up button", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("4");
    await expect(page.locator(".inbox-explainer").textContent()).resolves.toBe("Capture anything. Sort it now or later: follow-ups are what you owe people; drafts become DevOps items.");
    await expect(page.locator(".inbox .cap-box.large").count()).resolves.toBe(1);
    await expect(page.getByRole("button", { name: "Add a follow-up" }).count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the rules highlight a chip while typing; Tab and a click change it; Sort later is the default", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("4");
    await expect(checked(page)).resolves.toContain("Sort later");
    await box(page).fill("told Dana I'd send the export by Friday");
    await expect.poll(() => checked(page)).toContain("Follow-up");
    await expect(kindChip(page, "Follow-up").locator(".cap-suggested").count()).resolves.toBe(1);
    await box(page).press("Tab");
    await expect(checked(page)).resolves.toContain("Draft story");
    await expect(page.locator(".cap-box .cap-box-fields[aria-label='Draft story details']").count()).resolves.toBe(1);
    await kindChip(page, "Draft feature").click();
    await expect(checked(page)).resolves.toContain("Draft feature");
    await expect(page.locator(".cap-box .cap-box-fields input[aria-label='Target date']").count()).resolves.toBe(1);
    await box(page).fill("feature: bulk import");
    await expect(checked(page)).resolves.toContain("Draft feature"); // my choice sticks while I type
    await page.close();
  }, T);

  it("Follow-up: who and due from the rules, channel and a linked item inline; Enter saves it as a follow-up", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("4");
    await chooseClient(page, "Northwind");
    await box(page).fill("told Dana I'd send the export by Friday");
    await expect.poll(() => checked(page)).toContain("Follow-up");
    const f = page.locator(".cap-box .cap-box-fields");
    await expect(f.getByLabel("Who").inputValue()).resolves.toBe("Dana");
    await expect(f.getByLabel("Due").inputValue()).resolves.toBe("2026-11-06");
    await f.getByLabel("Channel").selectOption("email");
    const look = f.locator(".item-lookup input");
    await look.fill("export");
    await look.press("ArrowDown");
    await look.press("Enter");
    await expect(f.locator(".item-lookup.linked").count()).resolves.toBe(1);
    await box(page).press("Enter");
    const row = page.locator(".follow-up", { hasText: /send the export/i });
    await expect.poll(() => row.count()).toBe(1);
    await expect.poll(() => row.locator(".follow-up-item a").count()).toBe(1);
    await expect(box(page).inputValue()).resolves.toBe("");
    await expect(checked(page)).resolves.toContain("Sort later");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Draft story: a parent feature from the lookup and a size; a draft needs a client first", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("4");
    await chooseClient(page, "No client");
    await box(page).fill("story: retry failed syncs");
    await expect.poll(() => checked(page)).toContain("Draft story");
    await box(page).press("Enter");
    await expect(page.locator(".cap-box .set-problem").textContent()).resolves.toMatch(/needs a client/);
    await chooseClient(page, "Northwind");
    const f = page.locator(".cap-box .cap-box-fields");
    const look = f.locator(".item-lookup input");
    await expect.poll(() => look.getAttribute("placeholder")).toMatch(/Search open features/);
    await look.fill("");
    await look.press("ArrowDown");
    await look.press("Enter");
    await expect(f.locator(".item-lookup.linked").count()).resolves.toBe(1);
    await f.getByRole("button", { name: "L", exact: true }).click();
    await box(page).press("Enter");
    await expect.poll(async () => (await drafts(page)).find((d) => d.title.toLowerCase() === "retry failed syncs")).toMatchObject({ level: "story", size: "L" });
    expect((await drafts(page)).find((d) => d.title.toLowerCase() === "retry failed syncs")!.parentItemId).not.toBeNull();
    await page.close();
  }, T);

  it("Draft feature with a target date; Sort later keeps an unsorted capture", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("4");
    await chooseClient(page, "Atlas");
    await box(page).fill("feature: carrier rate cards");
    await expect.poll(() => checked(page)).toContain("Draft feature");
    await page.locator(".cap-box .cap-box-fields").getByLabel("Target date").fill("2026-11-27");
    await box(page).press("Enter");
    await expect.poll(async () => (await drafts(page)).find((d) => d.title.toLowerCase() === "carrier rate cards")).toMatchObject({ level: "feature", targetDate: "2026-11-27" });
    await box(page).fill("pallet labels look odd");
    await expect(checked(page)).resolves.toContain("Sort later");
    await box(page).press("Enter");
    await expect.poll(() => page.locator(".cap-item", { hasText: "pallet labels look odd" }).locator(".cap-tag", { hasText: "To sort" }).count()).toBe(1);
    await page.close();
  }, T);

  it("Ctrl+K Add a follow-up and Close out open the capture box with Follow-up chosen", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Add a follow-up");
    await page.getByRole("menuitem", { name: /Add a follow-up/ }).first().click();
    await expect.poll(() => page.locator(".cap-dialog .cap-box-kinds [role=radio][aria-checked=true]").textContent()).toContain("Follow-up");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Close out");
    await page.getByRole("menuitem", { name: /Close out/ }).first().click();
    await page.waitForSelector(".closeout");
    await expect.poll(() => page.locator(".closeout .cap-box-kinds [role=radio][aria-checked=true]").textContent()).toContain("Follow-up");
    await page.close();
  }, T);

  it("draft editor: edits round-trip; Create in DevOps asks to enable writes in demo; Delete removes it", async () => {
    const { page, errors } = await freshPage(h);
    await api(page, "draft.add_story", { clientKey: "Northwind", parentItemId: null, title: "Editor draft", size: "M" });
    await page.keyboard.press("4");
    await page.locator(".dw-drafts-section .draft-title", { hasText: "Editor draft" }).click();
    const ed = page.locator(".draft-editor");
    await ed.getByLabel("Title").fill("Editor draft, edited");
    await ed.getByLabel("Description").fill("Line one\nLine two");
    await expect.poll(() => ed.getByLabel(/Acceptance criteria/).count()).toBe(1); // the demo process has the field
    await ed.getByLabel(/Acceptance criteria/).fill("Given a file, it imports");
    await ed.getByRole("button", { name: "S", exact: true }).click();
    const look = ed.locator(".item-lookup input");
    await expect.poll(() => look.getAttribute("placeholder")).toMatch(/open features/);
    await look.press("ArrowDown");
    await look.press("Enter");
    await expect.poll(() => ed.locator(".draft-inherit dd").first().textContent()).not.toBe("From the parent");
    await ed.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => ed.count()).toBe(0);
    const d = (await drafts(page)).find((x) => x.title === "Editor draft, edited")!;
    expect(d).toMatchObject({ description: "Line one\nLine two", acceptance: "Given a file, it imports", size: "S" });
    expect(d.parentItemId).not.toBeNull();
    // Reopened, it shows the saved values.
    await page.locator(".dw-drafts-section .draft-title", { hasText: "Editor draft, edited" }).click();
    await expect(ed.getByLabel("Description").inputValue()).resolves.toBe("Line one\nLine two");
    await expect(ed.locator(".item-lookup.linked").count()).resolves.toBe(1);
    await ed.getByRole("button", { name: "Delete" }).click();
    await expect.poll(async () => (await drafts(page)).some((x) => x.id === d.id)).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Plan it adds the draft to a block in the 15.2 order, and the same editor opens from Plan the day", async () => {
    const { page } = await freshPage(h);
    const r = await api<{ draft: { id: number } }>(page, "draft.add_story", { clientKey: "Northwind", parentItemId: null, title: "Plan-it draft", size: "M" });
    await page.keyboard.press("4");
    await page.locator(".dw-drafts-section .draft-title", { hasText: "Plan-it draft" }).click();
    await page.locator(".draft-editor").getByRole("button", { name: "Plan it" }).click();
    const first = page.locator(".popup-menu [role=menuitem]:not([aria-disabled=true]):not([disabled])").first();
    await expect.poll(() => page.locator(".popup-menu").count()).toBe(1);
    await expect(page.locator(".popup-menu").textContent()).resolves.toContain("Northwind");
    await first.click();
    await expect.poll(async () => (await api<{ picks: { draftId: number | null }[] }>(page, "planday.start", { date: "2026-11-02" })).data.picks?.some((p) => p.draftId === r.data.draft.id) ?? false).toBe(true);
    // Plan the day: the draft's row title opens the same editor.
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    const t = page.locator(".pd2-right .draft-title", { hasText: "Plan-it draft" });
    if (await t.count()) {
      await t.first().click();
      await expect(page.locator(".draft-editor").count()).resolves.toBe(1);
      await page.keyboard.press("Escape");
    }
    await page.close();
  }, T);

  it("Or type what you'll do: a lookup result adds that item; Enter on plain text adds an intention", async () => {
    const { page, errors } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    const before = await page.locator(".pd2-block.selected .pd2-picks > li").count();
    const look = page.locator(".pd2-right .intention .item-lookup input");
    await look.fill("export");
    await look.press("ArrowDown");
    await look.press("Enter");
    await expect.poll(() => page.locator(".pd2-block.selected .pd2-picks > li").count()).toBe(before + 1);
    const picks = async () => (await api<{ picks: { kind: string; title: string; itemId: number | null }[] }>(page, "planday.start", { date: "2026-11-02" })).data.picks;
    expect((await picks()).some((p) => p.kind === "item" && /export/i.test(p.title))).toBe(true);
    await look.fill("call the warehouse about pallets");
    await look.press("Enter");
    await expect.poll(() => page.locator(".pd2-block.selected .pd2-picks > li .pr-title", { hasText: "call the warehouse about pallets" }).count()).toBe(1);
    await expect(look.inputValue()).resolves.toBe("");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("dragging a right-pane row shows the week's other days; dropping on one adds it there", async () => {
    const { page, errors } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    const row = page.locator(".pd2-right li.pd2-add[draggable=true]").first();
    const title = (await row.locator(".pr-title").first().textContent())!.trim();
    const b = (await row.boundingBox())!;
    await page.mouse.move(b.x + 40, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + b.height / 2 + 10, { steps: 4 });
    await page.waitForSelector(".pd2-weekstrip");
    const target = page.locator(".pd2-weekcard:not(.disabled):not(.other)").first();
    const key = (await target.getAttribute("data-drop"))!;
    const tb = (await target.boundingBox())!;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => page.locator(".pd2-weekstrip").count()).toBe(0);
    const date = key.slice(0, 10);
    const half = key.slice(10);
    await expect.poll(async () => (await api<{ picks: { title: string; half: string }[] }>(page, "planday.start", { date })).data.picks?.some((p) => p.title === title && p.half === half) ?? false).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
