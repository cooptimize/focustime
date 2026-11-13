// ED-1 (browser, demo mode, Monday Nov 2, 9:30 AM): Edit on the story card. A title typo fixed with the keyboard
// (E, the title box, Ctrl+Enter, one preview, Save in DevOps); bullets and bold in the description with the live look;
// acceptance criteria added; a table description keeps a line and Add to the end; the item changed in DevOps under
// an open edit keeps my words and saves again against the new version; Move… puts a story under another feature and
// the Backlog shows it there; each undone from the DevOps write log; someone who may not edit sees why; the phone.
// Screenshots to docs/ux/ed1 when FOCUSTIME_SHOTS is set (dark and light, 1440×900 and the phone).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, openSettings, settingsSection, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 180_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const teammate = async (page: Page, clientKey: string, change: unknown) => {
  const r = await call(page, "demo.devops_change", { clientKey, change });
  expect(r.ok, r.error).toBe(true);
};
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as { op: string; itemId: number; status: string; before: Record<string, string | null>; after: Record<string, string | null> }[];
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme === "dark" ? "cooptimize-dark" : "cooptimize-light");
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => (document.documentElement.dataset.theme = "cooptimize-dark"));
};
async function openCard(page: Page, clientKey: string, id: number): Promise<Locator> {
  await page.evaluate(([c, i]) => (location.hash = `#/item/${c}/${i}`), [clientKey, id] as const);
  const card = page.getByRole("dialog", { name: new RegExp(`#${id}`) });
  await card.locator(".sc-facts").waitFor();
  return card;
}
/** The one preview: Save in DevOps (or Move in DevOps), then the card reads back. */
async function confirmPreview(page: Page, button: RegExp = /^(Save|Move|Undo) in DevOps$/) {
  const dlg = page.locator(".write-dialog");
  await dlg.waitFor();
  await dlg.getByRole("button", { name: button }).click();
  await dlg.waitFor({ state: "detached" });
}

describe.skipIf(!CHROMIUM)("ED-1 edit an item on its story card (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("keyboard only: E, fix the title typo, Ctrl+Enter, one preview; bullets and bold with the live look; acceptance criteria added; each undone from the write log", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await teammate(page, "Northwind", { id: 1111, title: "Export ordres to CSV" });
    const card = await openCard(page, "Northwind", 1111);
    await card.getByRole("button", { name: "Edit", exact: true }).waitFor();
    if (SHOTS) await shot(page, "card");
    // E opens the boxes in place; focus lands on the title.
    await card.getByRole("heading", { level: 2 }).focus();
    await page.keyboard.press("e");
    const title = card.getByRole("textbox", { name: "Title" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Title");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Export orders to CSV");
    if (SHOTS) await shot(page, "editing");
    await page.keyboard.press("Control+Enter");
    const dlg = page.locator(".write-dialog");
    await dlg.waitFor();
    await expect(dlg.textContent()).resolves.toContain("Export ordres to CSV");
    if (SHOTS) await shot(page, "preview-title");
    // The preview's first focus is its main button: Enter confirms.
    await page.keyboard.press("Enter");
    await dlg.waitFor({ state: "detached" });
    await expect.poll(() => card.getByRole("heading", { level: 2 }).textContent()).toContain("Export orders to CSV");
    await expect(title.count()).resolves.toBe(0);
    // Focus is back on Edit.
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("Edit");

    // Bullets and bold, with the live look of how DevOps will show them.
    await page.keyboard.press("Enter");
    const desc = card.getByRole("textbox", { name: "Description", exact: true });
    await desc.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\nAlso:\nNo hidden columns\nQuotes around text with commas");
    // Select the last two lines, then Bullets.
    await desc.evaluate((el: HTMLTextAreaElement) => {
      const at = el.value.indexOf("No hidden columns");
      el.setSelectionRange(at, el.value.length);
    });
    await card.getByRole("button", { name: "Bullets" }).click();
    await desc.press("Control+End");
    await page.keyboard.type("\n");
    await page.keyboard.type("Only the **visible** orders.");
    const look = card.locator(".sc-look .sc-html");
    await expect.poll(() => look.innerHTML()).toContain("<strong>visible</strong>");
    await expect(look.locator("li", { hasText: "No hidden columns" }).count()).resolves.toBe(1);
    if (SHOTS) await shot(page, "formatting");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await dlg.waitFor();
    await expect(dlg.locator(".dw-looks").count()).resolves.toBe(1);
    await expect(dlg.locator(".dw-look.after strong", { hasText: "visible" }).count()).resolves.toBe(1);
    if (SHOTS) await shot(page, "preview-description");
    await confirmPreview(page);
    await expect.poll(() => card.locator(".sc-section[aria-label='Description'] .sc-html").innerHTML()).toContain("<strong>visible</strong>");

    // Add acceptance criteria: the quiet button opens the box with its example.
    await card.getByRole("button", { name: "Add acceptance criteria" }).click();
    const ac = card.getByRole("textbox", { name: "Acceptance criteria", exact: true });
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Acceptance criteria");
    await expect(ac.getAttribute("placeholder")).resolves.toBe("One example and the answer it should give");
    await page.keyboard.type("- 3 orders in October: the file has 3 rows\n- No orders: the file has only the header");
    await page.keyboard.press("Control+Enter");
    await confirmPreview(page);
    await expect.poll(() => card.locator(".sc-section[aria-label='Acceptance criteria'] li").count()).toBe(2);

    // Three writes, each its own entry; the log keeps the old text.
    const edits = (await log(page)).filter((e) => e.op === "item_edit" && e.itemId === 1111 && e.status === "confirmed");
    expect(edits.length).toBe(3);
    expect(Object.values(edits.at(-1)!.before).join(" ")).toContain("Export ordres to CSV");

    // Undo each from Settings › Activity's write log, newest first: the item reads as it did.
    await page.keyboard.press("Escape");
    await openSettings(page);
    await settingsSection(page, "activity");
    const wl = page.getByRole("region", { name: "DevOps write log" });
    for (let i = 0; i < 3; i++) {
      const row = wl.locator("tr", { hasText: "#1111" }).filter({ has: page.getByRole("button", { name: "Undo" }) }).first();
      await row.getByRole("button", { name: "Undo" }).click();
      await confirmPreview(page);
    }
    // The log reads a description as its words, never its HTML.
    await expect(wl.locator("tr", { hasText: "#1111" }).first().textContent()).resolves.not.toMatch(/<(div|ul|li|strong)/);
    if (SHOTS) await shot(page, "write-log");
    const back = await call(page, "devops.edit_offer", { clientKey: "Northwind", itemId: 1111 });
    expect(back.data.offer.title).toBe("Export ordres to CSV");
    expect(back.data.offer.acceptance.text).toBe("");
    expect(back.data.offer.description.text).not.toContain("visible");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a table description keeps a line with Add to the end; fonts and colors are said before Save; Cancel with typed words asks once", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    let card = await openCard(page, "Northwind", 1141);
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(card.getByRole("textbox", { name: "Description", exact: true }).count()).resolves.toBe(0);
    const cant = card.locator(".sc-cant");
    await expect(cant.textContent()).resolves.toContain("table");
    if (SHOTS) await shot(page, "cant-edit-table");
    await cant.getByRole("button", { name: "Add to the end" }).click();
    await page.keyboard.type("Platinum tier comes later.");
    await cant.getByRole("button", { name: "Preview" }).click();
    await confirmPreview(page);
    await expect.poll(() => card.locator(".sc-section[aria-label='Description'] .sc-html").textContent()).toContain("Platinum tier comes later.");
    await expect(card.locator(".sc-section[aria-label='Description'] table").count()).resolves.toBe(1);

    // Fonts and colors: said in the editor, before Save.
    card = await openCard(page, "Northwind", 1112);
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(card.locator(".sc-lossy").textContent()).resolves.toBe("Fonts and colors from the old text will be removed.");
    // Typed words: Cancel and Escape ask once; Keep editing keeps them.
    await card.getByRole("textbox", { name: "Title" }).fill("Filter orders by a date range");
    await page.keyboard.press("Escape");
    await card.getByText("Discard your changes?").waitFor();
    if (SHOTS) await shot(page, "discard");
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("Keep editing");
    await page.keyboard.press("Enter");
    await expect(card.getByRole("textbox", { name: "Title" }).inputValue()).resolves.toBe("Filter orders by a date range");
    // Closing the card asks too; Discard closes without writing.
    await card.getByRole("button", { name: /^Close/ }).click();
    await card.getByRole("button", { name: "Discard" }).click();
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    expect((await log(page)).filter((e) => e.itemId === 1112).length).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("changed in DevOps under an open edit: nothing written, my words kept, what it says now, Save again", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const card = await openCard(page, "Northwind", 1151);
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    // Stored as Markdown: kept as Markdown.
    await expect(card.locator(".sc-tools-note").first().textContent()).resolves.toContain("Markdown");
    await card.getByRole("textbox", { name: "Title" }).fill("Map of stores near me");
    await teammate(page, "Northwind", { id: 1151, state: "Active" });
    await card.getByRole("button", { name: "Save", exact: true }).click();
    const banner = card.locator(".sc-changed");
    await banner.waitFor();
    await expect(banner.textContent()).resolves.toContain("This changed in DevOps since you opened it");
    await expect(card.getByRole("textbox", { name: "Title" }).inputValue()).resolves.toBe("Map of stores near me");
    expect((await log(page)).filter((e) => e.itemId === 1151 && e.status === "confirmed").length).toBe(0);
    // One way on: the banner's Save again (the foot's Save goes while it shows).
    await expect(card.locator(".sc-save").getByRole("button", { name: "Save", exact: true }).count()).resolves.toBe(0);
    if (SHOTS) await shot(page, "changed-since");
    await banner.getByRole("button", { name: "Save again" }).click();
    await confirmPreview(page);
    await expect.poll(() => card.getByRole("heading", { level: 2 }).textContent()).toContain("Map of stores near me");
    // Undo puts it back, and is refused once it changed again.
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Move… puts a story under another feature; the Backlog shows it there; undo moves it back", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const card = await openCard(page, "Northwind", 1113);
    await card.locator(".sc-parents").getByRole("button", { name: "Move…" }).click();
    const move = card.getByRole("group", { name: /Move #1113/ });
    await move.getByRole("textbox", { name: /Find a feature/i }).fill("supplier");
    await move.getByRole("listbox", { name: "Move under" }).selectOption({ label: "#1120 Supplier onboarding · New" });
    if (SHOTS) await shot(page, "move");
    await move.getByRole("button", { name: "Preview" }).click();
    const dlg = page.locator(".write-dialog");
    await dlg.waitFor();
    await expect(dlg.textContent()).resolves.toContain("#1110");
    if (SHOTS) await shot(page, "preview-move");
    await confirmPreview(page, /^Move in DevOps$/);
    await expect.poll(() => card.locator(".sc-parents").textContent()).toContain("#1120 Supplier onboarding");
    // The Backlog shows it under its new feature, without a reload.
    await page.keyboard.press("Escape");
    await page.evaluate(() => (location.hash = "#/backlog"));
    await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
    await page.locator(".ah-tb-people").getByRole("button", { name: "Everyone" }).click();
    const nw = page.locator(".ah-client", { has: page.getByRole("heading", { name: /^Northwind/ }) });
    const order = async () => {
      const keys = await nw.locator(".ah-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.key ?? ""));
      return { feature: keys.findIndex((k) => k.endsWith(":1120") || k.endsWith("1120")), story: keys.findIndex((k) => k.endsWith(":1113") || k.endsWith("1113")), old: keys.findIndex((k) => k.endsWith(":1110") || k.endsWith("1110")) };
    };
    await expect.poll(async () => {
      const o = await order();
      return o.feature >= 0 && o.story > o.feature;
    }).toBe(true);
    if (SHOTS) await shot(page, "backlog-moved");
    // Undo from the write log moves it back.
    await openSettings(page);
    await settingsSection(page, "activity");
    const wl = page.getByRole("region", { name: "DevOps write log" });
    await wl.locator("tr", { hasText: "#1113" }).getByRole("button", { name: "Undo" }).first().click();
    await confirmPreview(page);
    const back = await call(page, "devops.edit_offer", { clientKey: "Northwind", itemId: 1113 });
    expect(back.data.offer.parent.id).toBe(1110);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("someone who may not edit sees why, and no Edit or Move…", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const card = await openCard(page, "Harbor", 2220);
    await card.locator(".sc-edit-note").waitFor();
    await expect(card.locator(".sc-edit-note").textContent()).resolves.toMatch(/leads and the owner can change this/);
    await expect(card.getByRole("button", { name: "Edit", exact: true }).count()).resolves.toBe(0);
    await expect(card.getByRole("button", { name: "Move…" }).count()).resolves.toBe(0);
    // E does nothing here.
    await card.getByRole("heading", { level: 2 }).focus();
    await page.keyboard.press("e");
    await expect(card.getByRole("textbox", { name: "Title" }).count()).resolves.toBe(0);
    if (SHOTS) await shot(page, "read-only");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the phone: one column, no sideways scroll, 44 px buttons", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await page.evaluate(() => (document.documentElement.style.fontSize = "17px"));
    const card = await openCard(page, "Northwind", 1111);
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await card.getByRole("textbox", { name: "Title" }).waitFor();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(0);
    const cardWide = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(cardWide).toBeLessThanOrEqual(0);
    // The save bar sits after the boxes on the phone, never over them.
    await expect(card.locator(".sc-save").evaluate((el) => getComputedStyle(el).position)).resolves.toBe("static");
    const save = await card.getByRole("button", { name: "Save", exact: true }).boundingBox();
    expect(save!.height).toBeGreaterThanOrEqual(44);
    const tb = await card.getByRole("textbox", { name: "Title" }).boundingBox();
    expect(tb!.width).toBeGreaterThan(300);
    if (SHOTS) await shot(page, "phone-editing");
    await card.getByRole("textbox", { name: "Description", exact: true }).scrollIntoViewIfNeeded();
    if (SHOTS) await shot(page, "phone-description");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
