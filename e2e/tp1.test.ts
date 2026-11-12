// TP-1 Work templates, the main paths in demo mode (the demo's own fake DevOps, no AI): a title-only create writes what
// it always did; a request type brings its hints and, on focus by mouse or keyboard, its examples; the full example
// opens and closes without touching the form; choices and two lines reach the preview as the description, the
// acceptance text and the one tag, and the card shows the block, the type and "Missing: …", or Ready with all four;
// Save as draft keeps the lines; Harbor (which refuses new tags) offers the create without it; an admin's edit to a
// hint, an example and a choice list shows in the form; someone who isn't an admin can't save or open the admin page;
// the phone puts the lines under More. Edge cases are unit tests (plan/work-templates.test.ts, actions/*).
// FOCUSTIME_SHOTS: screenshots at 1440 × 900 and the phone, light and dark (docs/ux/tp1/ for the PR).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";
import { phonePage } from "./mb1-helpers.ts";
import { appReady, liveBrowser, liveContext, liveTeam, type LiveBrowser } from "./live.ts";

let h: Harness;
const T = 240_000;
const VIEW = { width: 1440, height: 900 };
const call = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: R; error?: string; status?: number }>;

/** <name>-light.png and <name>-dark.png at the page's size. */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const was = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
    await page.evaluate((w) => (w ? document.documentElement.setAttribute("data-theme", w) : document.documentElement.removeAttribute("data-theme")), was);
  }
  await page.emulateMedia({ colorScheme: "light" });
}
const form = (page: Page) => page.getByRole("dialog", { name: /^New (in .*DevOps|work item)$/ });
const preview = (page: Page) => page.getByRole("dialog", { name: "Create a DevOps item" });
const created = async (page: Page) => (await call<{ entries: { op: string; status: string; title: string; itemId: number | null }[] }>(page, "devops.log", {})).data.entries.filter((e) => e.op === "create" && e.status === "confirmed");
async function choose(page: Page, scope: Locator, label: string, option: string | RegExp, nth = 0) {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const pop = page.locator(".cell-pop");
  const box = pop.getByRole("combobox");
  if (typeof option === "string" && (await box.count())) await box.fill(option);
  await pop.getByRole("option", { name: option }).nth(nth).click();
}
const line = (f: Locator, k: "where" | "change" | "check" | "done") => f.locator(`.fl-line[data-line="${k}"]`);
const box = (f: Locator, k: "where" | "change" | "check" | "done") => line(f, k).locator("textarea");
async function failShot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    if (process.env.TP1_DEBUG) await page.screenshot({ path: `${process.env.TP1_DEBUG}/${name}.png` }).catch(() => undefined);
    throw e;
  }
}
async function openNew(page: Page, client: string) {
  await page.evaluate(() => (location.hash = "#/ahead"));
  const newBtn = page.locator(".ah-new");
  await newBtn.waitFor({ timeout: 30_000 });
  await newBtn.click();
  const f = form(page);
  await f.waitFor();
  await choose(page, f, "Client", client);
  await expect.poll(() => f.getByRole("radio", { checked: true }).count(), { timeout: 30_000 }).toBe(1);
  return f;
}
/** Confirms the open preview and waits for the create; the new item's id. */
async function confirmCreate(page: Page, title: string): Promise<number> {
  const before = (await created(page)).length;
  await preview(page).getByRole("button", { name: "Create in DevOps" }).click();
  await expect.poll(async () => (await created(page)).length, { timeout: 30_000 }).toBe(before + 1);
  return (await created(page)).find((e) => e.title === title)!.itemId!;
}

describe.skipIf(!CHROMIUM)("TP-1: work templates in the New form (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("title only writes what it always did; a type's hints, examples on focus, the full example, the preview, the card", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t0", async () => {
      // Title only: no four lines, no tag, the same preview as before.
      let f = await openNew(page, "Northwind");
      await expect(f.getByRole("button", { name: /^Request type:/ }).textContent()).resolves.toContain("No type");
      await expect(f.locator(".fl-lines").count()).resolves.toBe(0);
      await shot(page, "tp1-form-no-type");
      await f.locator("#nf-title").fill("Plain title only");
      await f.locator("#nf-title").press("Enter");
      const p0 = preview(page);
      await p0.waitFor();
      const text0 = (await p0.textContent()) ?? "";
      expect(text0).not.toMatch(/Tags|What and where|How we'll check|type:/);
      await confirmCreate(page, "Plain title only");

      // A type: its hints in the boxes; an example only while I'm in that line, by keyboard and by mouse.
      f = await openNew(page, "Northwind");
      await choose(page, f, "Request type", "New measure");
      await expect(box(f, "where").getAttribute("placeholder")).resolves.toBe("Which model, and where the measure should appear.");
      await expect(line(f, "where").locator(".fl-example").isVisible()).resolves.toBe(false);
      await shot(page, "tp1-form-type");
      await f.locator("#nf-title").fill("Gross margin percent on the finance report");
      await f.locator("#nf-title").focus();
      // Keyboard: Tab from the title reaches Request type, then its link, then the first line.
      // Keyboard: Tab from the title reaches Request type, its link, the first line's ?, then the first line's box.
      for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
      await expect.poll(() => page.evaluate(() => (document.activeElement?.tagName === "TEXTAREA" ? document.activeElement.closest(".fl-line")?.getAttribute("data-line") : null))).toBe("where");
      await expect(line(f, "where").locator(".fl-example").isVisible()).resolves.toBe(true);
      await expect(line(f, "where").locator(".fl-example").textContent()).resolves.toContain("The Sales model.");
      await shot(page, "tp1-form-example-focus");
      // Mouse: clicking into What changes shows its example, and the first one goes away.
      await box(f, "change").click();
      await expect.poll(() => line(f, "change").locator(".fl-example").isVisible()).toBe(true);
      await expect.poll(() => line(f, "where").locator(".fl-example").isVisible()).toBe(false);
      // The help mark's one sentence on hover.
      await line(f, "check").locator(".fl-help-btn").hover();
      await expect(line(f, "check").locator(".fl-why").isVisible()).resolves.toBe(true);
      await shot(page, "tp1-form-help");

      // The full example opens beside the form and changes nothing in it.
      await f.getByRole("button", { name: "See a full example" }).click();
      const ex = f.getByRole("complementary", { name: "A full example" });
      await ex.waitFor();
      await expect(ex.textContent()).resolves.toContain("Gross margin percent");
      await expect(box(f, "where").inputValue()).resolves.toBe("");
      await shot(page, "tp1-form-full-example");
      await ex.getByRole("button", { name: "Close" }).click();
      await expect(ex.count()).resolves.toBe(0);
      await expect(f.locator("#nf-title").inputValue()).resolves.toBe("Gross margin percent on the finance report");

      // Choices for environment, done when and a person; two lines typed. It fits 1440 × 900 without scrolling.
      await choose(page, f, "Environment", "Test");
      await box(f, "where").fill("The Sales model. On the margin page of the finance report.");
      await box(f, "check").fill("October, East region: 31.2%, from the finance ledger.");
      await choose(page, f, "Done when it is", /./, 2);
      await choose(page, f, "Signed off by", /./, 2);
      const fits = await f.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { bottom: r.bottom, scroll: el.scrollHeight - el.clientHeight };
      });
      expect(fits.bottom).toBeLessThanOrEqual(900);
      expect(fits.scroll).toBeLessThanOrEqual(1);
      // A user story, whose process has the acceptance field.
      await f.getByRole("radio", { name: "User Story" }).click();
      await f.getByRole("button", { name: "Data", exact: true }).click();
      await page.mouse.move(1, 1);
      await f.locator("#nf-title").focus();
      await shot(page, "tp1-form-filled");
      // Ctrl+Enter from a line opens the preview: the description under its headings, the acceptance and the tag.
      await box(f, "check").press("Control+Enter");
      const p = preview(page);
      await p.waitFor();
      const text = (await p.textContent()) ?? "";
      expect(text).toContain("What and where");
      expect(text).toContain("Environment: Test.");
      expect(text).toContain("Touches: Data.");
      expect(text).toContain("How we'll check");
      expect(text).toContain("Acceptance criteria");
      expect(text).toContain("type:new-measure");
      await shot(page, "tp1-preview");
      const id = await confirmCreate(page, "Gross margin percent on the finance report");

      // The card: the four lines as one block, the type, and what is missing, quietly.
      await page.evaluate((i) => (location.hash = `#/item/Northwind/${i}`), id);
      const card = page.locator(".sc-lines");
      await card.waitFor({ timeout: 30_000 });
      await expect(page.locator(".sc-reqtype").textContent()).resolves.toBe("New measure");
      await expect(page.locator(".sc-ready").textContent()).resolves.toBe("Missing: What changes");
      await expect(card.textContent()).resolves.toContain("Not written yet");
      await shot(page, "tp1-card-missing");
      await page.keyboard.press("Escape");

      // All four: Ready.
      f = await openNew(page, "Northwind");
      await choose(page, f, "Request type", "Small change");
      await f.locator("#nf-title").fill("Created date on the orders table");
      for (const [k, v] of [["where", "Orders report, the orders table."], ["change", "Add the created date as a column."], ["check", "An order from Nov 3 shows Nov 3."], ["done", "In test, the operations lead confirms."]] as const) await box(f, k).fill(v);
      // "How far" counts once "Done when it is" is chosen: built is not published is not approved.
      await choose(page, f, "Done when it is", "In test");
      await box(f, "done").press("Control+Enter");
      await preview(page).waitFor();
      const id2 = await confirmCreate(page, "Created date on the orders table");
      await page.evaluate((i) => (location.hash = `#/item/Northwind/${i}`), id2);
      await expect.poll(() => page.locator(".sc-ready").textContent(), { timeout: 30_000 }).toBe("Ready");
      await shot(page, "tp1-card-ready");
      await page.keyboard.press("Escape");
    });
    expect(errors).toEqual([]);
  }, T);

  it("Save as draft keeps the lines; Harbor refuses the tag and the create goes through without it", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t1", async () => {
      let f = await openNew(page, "Northwind");
      await choose(page, f, "Request type", "New report");
      await f.locator("#nf-title").fill("Timesheet comments report");
      await box(f, "where").fill("For project managers. Reads the Projects model.");
      await f.getByRole("button", { name: "Save as draft" }).click();
      await expect.poll(() => f.count(), { timeout: 30_000 }).toBe(0);
      const drafts = (await call<{ drafts: { id: number; title: string; brief?: { type: string; where: string } }[] }>(page, "capture.load", {})).data.drafts;
      const d = drafts.find((x) => x.title === "Timesheet comments report")!;
      expect(d.brief).toMatchObject({ type: "new-report", where: "For project managers. Reads the Projects model." });
      // Reopened from the Inbox, its Create in DevOps previews the same type and words.
      await page.evaluate((i) => (location.hash = `#/inbox/item/d${i}`), d.id);
      await page.getByRole("button", { name: "Create in DevOps" }).first().click({ timeout: 30_000 });
      const pd = preview(page);
      await pd.waitFor({ timeout: 30_000 });
      await expect(pd.textContent()).resolves.toContain("What and where\nFor project managers. Reads the Projects model.");
      await expect(pd.textContent()).resolves.toContain("type:new-report");
      await pd.getByRole("button", { name: "Not now" }).click();

      // Harbor's project lets no one add a new tag: nothing is created, and one click creates it without the tag.
      f = await openNew(page, "Harbor");
      await choose(page, f, "Request type", "Exploration");
      await f.locator("#nf-title").fill("Can returns match their orders");
      await box(f, "where").fill("The returns and orders tables.");
      await f.locator("#nf-title").press("Control+Enter");
      const p = preview(page);
      await p.waitFor();
      const before = (await created(page)).length;
      await p.getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(() => p.textContent(), { timeout: 30_000 }).toContain("didn't let you add the tag");
      expect((await created(page)).length).toBe(before);
      await shot(page, "tp1-tag-refused");
      await p.getByRole("button", { name: "Create it without the tag" }).click();
      await expect.poll(() => preview(page).textContent()).not.toContain("type:exploration");
      await confirmCreate(page, "Can returns match their orders");
    });
    expect(errors).toEqual([]);
  }, T);

  it("an admin edits a hint, an example and a choice list; the form shows them", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t2", async () => {
      await page.evaluate(() => (location.hash = "#/settings/admin-templates"));
      const admin = page.locator(".wt-admin");
      await admin.waitFor({ timeout: 30_000 });
      await admin.getByRole("button", { name: /^New measure/ }).click();
      await admin.getByRole("textbox", { name: "New measure: What and where hint" }).fill("Which model, and on which page.");
      await admin.getByRole("textbox", { name: "New measure: What and where example" }).fill("The Sales model, on the margin page.");
      // The preview beside the editor shows the edit before it is saved.
      await expect(admin.locator(".wt-preview .fl-line[data-line=where] textarea").getAttribute("placeholder")).resolves.toBe("Which model, and on which page.");
      await shot(page, "tp1-admin-type");
      await admin.getByRole("button", { name: /^Choice lists/ }).click();
      const env = admin.getByRole("textbox", { name: "Environment choices" });
      await env.fill(`${await env.inputValue()}\nStaging`);
      await admin.getByRole("textbox", { name: "Why, for the audit" }).fill("Shorter hint for measures, and Staging");
      await admin.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => admin.getByRole("status").textContent()).toContain("Saved");
      await shot(page, "tp1-admin-saved");
      const audit = (await call<{ rows: { area: string; note: string }[] }>(page, "admin.load", { section: "audit" })).data;
      expect(JSON.stringify(audit)).toContain("Shorter hint for measures, and Staging");

      const f = await openNew(page, "Northwind");
      await choose(page, f, "Request type", "New measure");
      await expect(box(f, "where").getAttribute("placeholder")).resolves.toBe("Which model, and on which page.");
      await box(f, "where").focus();
      await expect(line(f, "where").locator(".fl-example").textContent()).resolves.toContain("The Sales model, on the margin page.");
      await f.getByRole("button", { name: /^Environment:/ }).click();
      await expect(page.locator(".cell-pop").getByRole("option", { name: "Staging" }).count()).resolves.toBe(1);
      await page.keyboard.press("Escape");
    });
    expect(errors).toEqual([]);
  }, T);

  it("the phone: the four lines under More, one per row", async () => {
    const page = await phonePage(h, 390);
    await failShot(page, "t3", async () => {
      await page.evaluate(() => (location.hash = "#/ahead"));
      await page.keyboard.press("Shift+N");
      const f = form(page);
      await f.waitFor({ timeout: 30_000 });
      await choose(page, f, "Client", "Northwind");
      await choose(page, f, "Request type", "Small change");
      await expect(f.locator(".fl-lines.fl-stack").isVisible()).resolves.toBe(true);
      await expect(f.getByRole("button", { name: /More: the four lines/ }).getAttribute("aria-expanded")).resolves.toBe("true");
      // One line per row: each line's box spans the form's width.
      const widths = await f.locator(".fl-line textarea").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      expect(widths).toHaveLength(4);
      for (const w of widths) expect(w).toBeGreaterThan(280);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await box(f, "where").scrollIntoViewIfNeeded();
      await box(f, "where").focus();
      await shot(page, "tp1-phone");
    });
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("TP-1: someone who isn't an admin (browser, real session)", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);
  it("can't save the templates or open Admin › Work templates; Settings shows them read-only", async () => {
    const app = await lb.start(await liveContext({ team: liveTeam() }));
    try {
      const page = await app.page();
      await page.setViewportSize(VIEW);
      await page.goto(app.url);
      await appReady(page);
      const load = await call<{ doc: { types: unknown[] }; version: number; admin: boolean }>(page, "templates.load", {});
      expect(load.ok).toBe(true);
      expect(load.data.admin).toBe(false);
      const save = await call(page, "templates.save", { doc: load.data.doc, version: load.data.version, why: "try" });
      expect(save.ok).toBe(false);
      await page.evaluate(() => (location.hash = "#/settings/admin-templates"));
      await expect.poll(() => page.locator("main, .settings").first().textContent(), { timeout: 30_000 }).toContain("Admin is only for FocusTime admins");
      await expect(page.locator(".wt-admin").count()).resolves.toBe(0);
      await page.evaluate(() => (location.hash = "#/settings/planning/work-templates"));
      const ro = page.locator('[data-setting="work-templates"]');
      await ro.waitFor({ timeout: 30_000 });
      await expect(ro.textContent()).resolves.toContain("Set by your FocusTime admin");
      // The first launch's welcome waits for a key.
      if (await page.locator(".brand-stage").count()) await page.keyboard.press("Shift");
      await page.locator(".brand-stage").waitFor({ state: "detached", timeout: 30_000 });
      await ro.getByRole("button", { name: /New measure/ }).click();
      await shot(page, "tp1-settings-readonly");
    } finally {
      await app.close();
    }
  }, T);
});
