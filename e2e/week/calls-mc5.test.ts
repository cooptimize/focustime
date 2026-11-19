// MC-5: Calls made scannable, a call's page with less to read, Add a call from Pocket. In demo mode (a fictional person,
// fictional calls and invented recordings on a pretend Pocket). The list: the header's menu, the Client row, a Needs you
// row's one button or "N left" (never both), a click anywhere or Enter opens a row and the buttons inside it don't, Skip
// all on focus with Undo and no DevOps write, X with the app's own message, Select calls draws the boxes. The call's
// page: the count once, the Show row apart from the view switch, proposals folded to start, opened by the chevron, by
// line 2 and by themselves when a field is needed or DevOps refuses, what Create, Keep, Skip and Add comment send, a
// quote opening the Transcript. Add a call: a recording from the list already held (Pocket asked nothing more), its
// name and time, the client to choose, Review that call; A file's one drop area and Starts; a hand-added call taking
// any of my recordings' time. The sizes at 1440 by 900 and 390 by 844, light and dark, and the largest Text size.
// Clock: Thursday Nov 5, 2026 4:30 PM ET.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const T = 240_000;
const W = 30_000;
let h: Harness;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hash = (page: Page) => page.evaluate(() => location.hash);
const go = (page: Page, x: string) => page.evaluate((v) => (location.hash = v), x);
const item = (page: Page, name: string) => page.locator("[data-calls-list] li[data-row]").filter({ has: page.locator(".calls-name", { hasText: name }) }).first();
const needs = (page: Page) => page.locator("[data-section='needs'] li[data-row]");

type Sent = { action: string; input: Record<string, unknown> };
/** Every action the page sends, with its input, from the moment the page opens. */
async function open(width = 1440, height = 900, opts: { refuse?: string } = {}) {
  const sent: Sent[] = [];
  const { page, errors } = await freshPage(h, { width, height }, {
    before: (p) =>
      p.route("**/api/action", (r) => {
        const body = JSON.parse(r.request().postData() ?? "{}") as { action?: string; input?: Record<string, unknown> };
        sent.push({ action: body.action ?? "", input: body.input ?? {} });
        if (opts.refuse && body.action === opts.refuse) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, status: 409, error: "DevOps refused this one: the area path is closed." }) });
        return r.continue();
      }),
  });
  await go(page, "#/week");
  await page.locator(".topbar").first().waitFor({ timeout: W });
  expect((await call(page, "pocket.connect", { key: "pk_demo_fine" })).ok).toBe(true);
  return { page, errors, sent };
}
async function calls(page: Page, show = "open") {
  await go(page, `#/calls?show=${show}`);
  await page.locator("[data-calls-list] [data-call-row]").first().waitFor({ timeout: W });
}
async function weeklyCall(page: Page) {
  const id = (await call(page, "meeting.mine", {})).data.occurrences[0].id as number;
  await go(page, `#/calls/${id}`);
  await page.getByRole("heading", { level: 2, name: "Northwind weekly status call" }).waitFor({ timeout: W });
  return id;
}
const writes = (sent: Sent[]) => sent.filter((s) => /^devops\.|_create$|_comment$|meeting\.(keep|confirm)/.test(s.action));

describe.skipIf(!CHROMIUM)("MC-5: Calls made scannable (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T16:30:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("the list: the header's menu, the Client row, one button or what is left, a row opens by click and Enter, Skip all on focus with Undo, X, Select calls", async () => {
    const { page, errors, sent } = await open();
    await calls(page);
    // The header: Calls, Add a call and the menu; no subtitle.
    await expect(page.locator(".calls-head").textContent()).resolves.toBe("CallsAdd a call");
    await page.getByRole("button", { name: "More for Calls" }).click();
    for (const name of ["Refresh", "Check Pocket", "Select calls"]) await expect.poll(() => page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).count(), { message: name, timeout: W }).toBe(1);
    await page.keyboard.press("Escape");
    // The Client row: All first and pressed, a chip a client, and No client because a call here has none.
    const chips = page.locator(".calls-chips .ib4-chip");
    await expect(chips.first().textContent()).resolves.toBe("All");
    await expect(chips.first().getAttribute("aria-pressed")).resolves.toBe("true");
    await expect.poll(() => chips.filter({ hasText: "No client" }).count(), { timeout: W }).toBe(1);
    await expect(page.locator(".calls-chips-label").textContent()).resolves.toBe("Client");
    // Hidden has none: no count drawn.
    await expect(page.locator('[data-calls-filter="hidden"] .seg-count').count()).resolves.toBe(0);
    // Needs you: two lines each; line 1 ends with what is left or one button, never both, and no state text beside it.
    const n = await needs(page).count();
    expect(n).toBeGreaterThan(0);
    for (const row of await needs(page).all()) {
      const left = await row.locator("[data-call-left]").count();
      const acts = await row.locator(".calls-row-end:not(.two) button").count();
      expect(left + acts, (await row.textContent()) ?? "").toBe(1);
      await expect(row.locator("[data-call-state]").count()).resolves.toBe(0);
    }
    // No tick boxes until Select calls.
    await expect(page.locator("[data-calls-list] input[type=checkbox]").count()).resolves.toBe(0);

    // A click anywhere on a row opens it; the selected row carries its client's color on its edge.
    const status = item(page, "Northwind weekly status call");
    await status.click({ position: { x: 300, y: 30 } });
    await expect.poll(() => hash(page)).toMatch(/^#\/calls\/\d+/);
    await expect(status.locator("[data-call-row]").getAttribute("aria-current")).resolves.toBe("true");
    await expect(status.evaluate((el) => getComputedStyle(el).borderLeftWidth)).resolves.not.toBe("0px");
    // Enter on another row opens that one (a week row with a client and Teams' transcript: straight to its review).
    const model = item(page, "Northwind data model review");
    await expect.poll(() => model.locator("[data-call-mark]").textContent(), { timeout: W }).toBe("Teams");
    await model.locator("[data-call-row]").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".calls-beside h2").first().textContent(), { timeout: W }).toBe("Northwind data model review");
    // A button inside a row does its own thing: Hide on a week row hides it and opens nothing.
    const before = await hash(page);
    const harbor = item(page, "Harbor sprint planning");
    await harbor.hover();
    await harbor.locator("[data-call-act='hide']").click();
    await expect.poll(() => page.locator('[data-calls-filter="hidden"] .seg-count').textContent(), { timeout: W }).toBe("1");
    expect(await hash(page)).toBe(before);
    await page.getByRole("button", { name: "Undo" }).first().click();
    await expect.poll(() => page.locator('[data-calls-filter="hidden"] .seg-count').count(), { timeout: W }).toBe(0);

    // Skip all shows on a row with focus, skips with Undo, and writes nothing to DevOps.
    const row = needs(page).filter({ has: page.locator("[data-call-left]") }).first();
    const skipAll = row.locator("[data-call-act='skip-all']");
    await page.mouse.move(5, 890);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const rowClass = await row.getAttribute("class");
    if (!/\bopen\b/.test(rowClass ?? "")) await expect(skipAll.isVisible(), rowClass ?? "").resolves.toBe(false);
    await row.locator("[data-call-row]").focus();
    await expect.poll(() => skipAll.isVisible()).toBe(true);
    sent.length = 0;
    await skipAll.click();
    await expect.poll(() => page.locator(".undo-toast").textContent(), { timeout: W }).toMatch(/^Skipped \d+, call closed/);
    expect(sent.map((s) => s.action)).toContain("meeting.skip_all");
    expect(writes(sent)).toEqual([]);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => needs(page).count(), { timeout: W }).toBe(n);
    // X on a row: the app's own message with Undo, never the browser's dialog.
    let dialogs = 0;
    page.on("dialog", (d) => (dialogs++, void d.dismiss()));
    await needs(page).filter({ has: page.locator("[data-call-left]") }).first().locator("[data-call-row]").focus();
    await page.keyboard.press("x");
    await expect.poll(() => page.locator(".undo-toast").textContent(), { timeout: W }).toMatch(/^Skipped \d+, call closed/);
    expect(dialogs).toBe(0);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => needs(page).count(), { timeout: W }).toBe(n);

    // Select calls: the boxes and the bar; Done selecting takes them away.
    await page.getByRole("button", { name: "More for Calls" }).click();
    await page.getByText("Select calls", { exact: true }).click();
    await expect.poll(() => page.locator("[data-calls-list] input[type=checkbox]").count()).toBeGreaterThan(0);
    await page.locator("[data-calls-list] input[type=checkbox]").first().check();
    await expect(page.locator("[data-calls-tickbar]").textContent()).resolves.toMatch(/^1 chosen/);
    await page.locator("[data-calls-tickbar]").getByRole("button", { name: "Done selecting" }).click();
    await expect.poll(() => page.locator("[data-calls-list] input[type=checkbox]").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a week row: the client can be changed on it; with a client and Teams' transcript a click goes straight to the review", async () => {
    const { page, errors } = await open();
    await calls(page);
    const model = item(page, "Northwind data model review");
    await expect.poll(() => model.locator("[data-call-mark]").textContent(), { timeout: W }).toBe("Teams");
    await model.locator("[data-call-about]").selectOption({ label: "Atlas" });
    await expect(model.locator("[data-call-about] option:checked").textContent()).resolves.toBe("Atlas");
    await model.locator("[data-call-row]").click();
    await page.getByRole("heading", { level: 2, name: "Northwind data model review" }).waitFor({ timeout: W });
    await expect(page.locator("[data-call-meta]").textContent()).resolves.toMatch(/^Atlas/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the call's page: the count once, the Show row apart from the switch, folded proposals that open three ways, a quote to the Transcript, what each button sends", async () => {
    const { page, errors, sent } = await open();
    const id = await weeklyCall(page);
    // The count: once, in the Show row. The switch is Proposals and Transcript with no counts; each Show chip has a kind with some.
    await expect(page.getByText(/\d+ of \d+ decided/).count()).resolves.toBe(1);
    await expect(page.locator(".mtg-switch").textContent()).resolves.toBe("ProposalsTranscript");
    const shows = await page.locator("[data-show]").evaluateAll((bs) => bs.map((b) => [b.getAttribute("data-show"), Number(b.querySelector(".seg-count")?.textContent)] as const));
    expect(shows.map(([k]) => k)).toEqual(["all", "gap", "commitment", "comment"]);
    // All has no number: the decided line's "of N" is the call's one count.
    for (const [k, c] of shows) if (k === "all") expect(c, k).toBeNaN(); else expect(c, k ?? "").toBeGreaterThan(0);
    await expect(page.locator(".mtg-show .mtg-switch").count()).resolves.toBe(0);
    // Folded to start, three lines; the one Northwind's process needs a date on opens by itself, its field marked.
    const statement = page.locator(".mtg-prop[aria-label='Monthly statement as a PDF']");
    await expect(statement.getAttribute("class")).resolves.not.toMatch(/is-open/);
    for (const l of [".mtg-p1", ".mtg-p2", ".mtg-p3"]) await expect(statement.locator(l).count(), l).resolves.toBe(1);
    const epic = page.locator(".mtg-prop[aria-label='Accountant reporting area']");
    await expect(epic.getAttribute("class")).resolves.toMatch(/is-open/);
    await expect(epic.locator(".mtg-cell.needed .set-label").textContent()).resolves.toBe("Target dateneeded");
    // Opens by the chevron, closes by it; opens by line 2 and stays open.
    await statement.locator("[data-prop-open]").click();
    await expect(statement.getAttribute("class")).resolves.toMatch(/is-open/);
    await expect(statement.locator("input.mtg-title-box").inputValue()).resolves.toBe("Monthly statement as a PDF");
    await statement.locator("[data-prop-open]").click();
    await expect(statement.getAttribute("class")).resolves.not.toMatch(/is-open/);
    await statement.locator(".mtg-p2").click();
    await expect(statement.getAttribute("class")).resolves.toMatch(/is-open/);
    await page.locator(".mtg-switch").getByRole("button", { name: "Transcript" }).click();
    await page.locator(".mtg-switch").getByRole("button", { name: "Proposals" }).click();
    await expect.poll(() => statement.getAttribute("class")).toMatch(/is-open/);

    // What each button sends is what it sends on main: Create opens the one DevOps preview for this proposal.
    const pid = Number(await statement.getAttribute("data-prop"));
    sent.length = 0;
    await statement.locator(".mtg-p1").getByRole("button", { name: "Create", exact: true }).click();
    const preview = page.locator(".write-dialog.devops");
    await preview.waitFor({ timeout: W });
    expect(JSON.stringify(sent)).toContain(`"kind":"meeting_create","proposalId":${pid}`);
    await preview.getByRole("button", { name: /Not now|Cancel/ }).first().click();
    await preview.waitFor({ state: "detached" });
    // Keep: meeting.keep with the proposal, at once, with Undo.
    const promise = page.locator(".mtg-prop.open[aria-label='Send the date range filter for review']");
    const promiseId = Number(await promise.getAttribute("data-prop"));
    sent.length = 0;
    await promise.getByRole("button", { name: "Keep", exact: true }).click();
    await expect.poll(() => sent.find((s) => s.action === "meeting.keep")?.input).toEqual({ proposalId: promiseId });
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => sent.some((s) => s.action === "meeting.unkeep")).toBe(true);
    // Skip: meeting.edit with skip.
    const skipOne = page.locator(".mtg-prop.open[aria-label='Add the row limit warning before the export ships']");
    const skipId = Number(await skipOne.getAttribute("data-prop"));
    sent.length = 0;
    await skipOne.getByRole("button", { name: "Skip", exact: true }).click();
    await expect.poll(() => sent.find((s) => s.action === "meeting.edit")?.input).toEqual({ proposalId: skipId, skip: true });
    // Add comment: the one preview for a comment on its story.
    const comment = page.locator(".mtg-prop.open").filter({ has: page.getByRole("button", { name: "Add comment", exact: true }) }).first();
    const commentId = Number(await comment.getAttribute("data-prop"));
    sent.length = 0;
    await comment.getByRole("button", { name: "Add comment", exact: true }).click();
    await preview.waitFor({ timeout: W });
    expect(JSON.stringify(sent)).toContain(`"kind":"meeting_comment","proposalId":${commentId}`);
    await preview.getByRole("button", { name: /Not now|Cancel/ }).first().click();
    await preview.waitFor({ state: "detached" });
    expect(writes(sent).filter((s) => !/meeting\.keep/.test(s.action) && /create|comment/.test(JSON.stringify(s.input)) && /confirm|apply|run/.test(s.action))).toEqual([]);

    // A click on a quote opens the Transcript at that line.
    const quote = statement.locator("button.mtg-p3");
    await quote.click();
    await expect.poll(() => hash(page)).toMatch(new RegExp(`^#/calls/${id}/transcript/\\d+$`));
    const n = Number((await hash(page)).split("/").pop());
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(`mtg-line-${n}`);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("DevOps refusing a write opens the proposal by itself with what it said", async () => {
    const { page } = await open(1440, 900, { refuse: "devops.preview" });
    await weeklyCall(page);
    const statement = page.locator(".mtg-prop[aria-label='Monthly statement as a PDF']");
    await expect(statement.getAttribute("class")).resolves.not.toMatch(/is-open/);
    await statement.locator(".mtg-p1").getByRole("button", { name: "Create", exact: true }).click();
    await expect.poll(() => statement.getAttribute("class"), { timeout: W }).toMatch(/is-open/);
    await expect(statement.locator("[role=alert]").first().textContent()).resolves.toMatch(/refused/);
    await page.close();
  }, T);

  it("Add a call from a Pocket recording: the list already held, its name and time, the client to choose, one transcript on the press; a fitting one offers its call", async () => {
    const { page, errors, sent } = await open();
    await calls(page);
    const lists = () => sent.filter((s) => /pocket_list|pocket\.list/.test(s.action)).length;
    await expect.poll(lists, { timeout: W }).toBeGreaterThan(0);
    // Settled as Calls opened (the server asks Pocket at most once in 5 minutes); Add a call adds no request.
    await page.waitForTimeout(2000);
    const listedBefore = lists();
    await page.getByRole("button", { name: "Add a call" }).click();
    const add = page.getByRole("form", { name: "Add a call" });
    await expect(add.locator("[data-choice='pocket']").getAttribute("aria-pressed")).resolves.toBe("true");
    const recs = add.locator("[data-rec-pick] label");
    await expect.poll(() => recs.count()).toBeGreaterThan(1);
    // Newest first; each line its title, when and length.
    await expect(recs.first().textContent()).resolves.toMatch(/^Call with the carrier.*Nov 3.*25 min/);
    // One that fits a listed call says which.
    await expect(recs.filter({ hasText: "Sprint planning" }).locator(".mtg-rec-fits").textContent()).resolves.toBe("Goes with Harbor sprint planning Review that call");
    // Choosing one fills the name and the time (not typed); the client is mine to choose and marked until chosen.
    await recs.first().click();
    await expect(add.getByLabel("Name", { exact: true }).inputValue()).resolves.toBe("Call with the carrier");
    await expect(add.locator("[data-add-when]").textContent()).resolves.toMatch(/Nov 3/);
    await expect(add.locator("input[type=date], input[type=time]").count()).resolves.toBe(0);
    await expect(add.locator(".mtg-add-field.needed").count()).resolves.toBe(1);
    const press = add.getByRole("button", { name: "Add and review" });
    await expect(press.isDisabled()).resolves.toBe(true);
    await add.locator("#mtg-add-client").selectOption({ index: 1 });
    await expect(add.locator(".mtg-add-field.needed").count()).resolves.toBe(0);
    expect(lists()).toBe(listedBefore);
    sent.length = 0;
    await press.click();
    await page.getByRole("heading", { level: 2, name: "Call with the carrier" }).waitFor({ timeout: W });
    expect(sent.map((s) => s.action).filter((a) => /pocket/.test(a))).toEqual(["meeting.pocket_add", "meeting.pocket_bring"]);
    await expect.poll(() => page.locator("[data-call-origin]").textContent(), { timeout: W }).toBe("Pocket");

    // Review that call: its setup opens with that recording chosen.
    await page.getByRole("button", { name: "Add a call" }).click();
    await page.getByRole("form", { name: "Add a call" }).locator("[data-rec-pick] label").filter({ hasText: "Sprint planning" }).locator("[data-review-that]").click();
    const setup = page.getByRole("region", { name: /^Review Harbor sprint planning/ });
    await setup.waitFor({ timeout: W });
    await expect(setup.locator('[data-source="pocket"]').isChecked()).resolves.toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("A file: one drop area and Starts at the last half hour; Later adds a call that takes any of my recordings' time, said before I confirm", async () => {
    const { page, errors, sent } = await open();
    await calls(page);
    await page.getByRole("button", { name: "Add a call" }).click();
    const add = page.getByRole("form", { name: "Add a call" });
    await add.locator("[data-choice='file']").click();
    await expect(add.locator(".mtg-dropzone").count()).resolves.toBe(1);
    await expect(add.locator(".mtg-drop-words").textContent()).resolves.toBe("Drop a Teams transcript or a Pocket export, or choose a file");
    await expect(add.locator("[data-add-start]").inputValue()).resolves.toBe("16:30");
    await expect(add.getByRole("button", { name: "Add and review" }).count()).resolves.toBe(1);
    // Later: Add; it lands on its page with the choices, and in Needs you with Add transcript.
    await add.locator("[data-choice='later']").click();
    await add.getByLabel("Name", { exact: true }).fill("Huddle on pallet labels");
    await add.locator("#mtg-add-client").selectOption({ index: 1 });
    await add.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("heading", { level: 2, name: "Huddle on pallet labels" }).waitFor({ timeout: W });
    await expect(item(page, "Huddle on pallet labels").locator("[data-call-act='upload']").textContent()).resolves.toBe("Add transcript");
    // Any of my recordings: one that doesn't fit says the call takes its time, then the call moves to it.
    const choices = page.locator("[data-no-transcript]");
    await expect(choices.locator("[data-choice='pocket']").getAttribute("aria-pressed")).resolves.toBe("true");
    await choices.locator("[data-rec-pick] label").filter({ hasText: "Call with the carrier" }).click();
    await expect(choices.locator("[data-takes-time]").textContent()).resolves.toMatch(/^The call takes the recording's time: Tue, Nov 3 · 4:30 PM · 25 min\.$/);
    sent.length = 0;
    await choices.getByRole("button", { name: "Use this recording" }).click();
    await expect.poll(() => page.locator("[data-call-meta]").textContent(), { timeout: W }).toMatch(/Nov 3/);
    expect(sent.find((s) => s.action === "meeting.pocket_bring")?.input).toMatchObject({ move: true });
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a closed call with a recording that fits stays in Closed with the mark", async () => {
    const { page, errors } = await open();
    await calls(page, "closed");
    const nw = item(page, "Northwind weekly status call");
    await expect.poll(() => nw.locator("[data-call-mark]").textContent(), { timeout: W }).toBe("Pocket");
    const closedKey = await nw.locator("[data-call-row]").getAttribute("data-call-row");
    await calls(page, "open");
    await expect(page.locator(`[data-calls-list] [data-call-row="${closedKey}"]`).count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("sizes at 1440 by 900: twice the calls the list showed, three proposals folded, the stuck header smaller; light and the largest Text size", async () => {
    const { page, errors } = await open();
    await calls(page);
    // Twice MC-4's four rows: the rows a list this tall holds (the demo has seven).
    const fits = await page.evaluate(() => {
      const s = document.querySelector<HTMLElement>("[data-calls-list] .calls-scroll")!;
      const row = document.querySelector<HTMLElement>("[data-section^='week'] li[data-row]")!;
      const top = s.querySelector<HTMLElement>("[data-section='needs']")!.getBoundingClientRect().top;
      return Math.floor((s.getBoundingClientRect().bottom - top) / row.getBoundingClientRect().height);
    });
    expect(fits).toBeGreaterThanOrEqual(8);
    await weeklyCall(page);
    const view = (await page.locator(".calls-beside").boundingBox())!;
    const shown = await page.locator(".mtg-prop").evaluateAll((ps, bottom) => ps.filter((p) => p.getBoundingClientRect().bottom <= bottom).length, view.y + view.height);
    expect(shown).toBeGreaterThanOrEqual(3);
    // The stuck header and a group's head take less than MC-4's (72 px header and a 50 px group head).
    const stuck = await page.evaluate(() => document.querySelector(".mtg-sticky")!.getBoundingClientRect().height + document.querySelector(".mtg-sec-head")!.getBoundingClientRect().height);
    expect(stuck).toBeLessThan(122);
    // Light and the largest Text size: no line runs under another on a Needs you row or a proposal.
    expect((await call(page, "ui.set_text_size", { size: "larger" })).ok).toBe(true);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.reload();
    await page.locator(".mtg-prop").first().waitFor({ timeout: W });
    const overlaps = await page.evaluate(() => {
      const bad: string[] = [];
      for (const r of document.querySelectorAll<HTMLElement>(".calls-row.need-row")) {
        const a = r.querySelector(".calls-name")!.getBoundingClientRect();
        const b = r.querySelector(".calls-meta")!.getBoundingClientRect();
        if (a.bottom > b.top + 1) bad.push(`row ${r.textContent}`);
      }
      for (const p of document.querySelectorAll<HTMLElement>(".mtg-prop:not(.is-open)")) {
        const ls = [".mtg-p1", ".mtg-p2", ".mtg-p3"].map((s) => p.querySelector(s)?.getBoundingClientRect()).filter(Boolean) as DOMRect[];
        for (let i = 1; i < ls.length; i++) if (ls[i - 1]!.bottom > ls[i]!.top + 1) bad.push(`proposal ${p.getAttribute("aria-label")}`);
      }
      return bad;
    });
    expect(overlaps).toEqual([]);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect((await call(page, "ui.set_text_size", { size: "default" })).ok).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("sizes at 390 by 844: rows keep two lines, the Show row scrolls sideways in one line, every control 44 px, the stuck header smaller", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await call(page, "pocket.connect", { key: "pk_demo_fine" })).ok).toBe(true);
    await calls(page);
    const lines = await needs(page).evaluateAll((rs) => rs.map((r) => {
      const a = r.querySelector(".calls-name")!.getBoundingClientRect();
      const b = r.querySelector(".calls-meta")!.getBoundingClientRect();
      return Math.abs(a.top - b.top) > 4 && a.bottom <= b.top + 1;
    }));
    expect(lines.every(Boolean)).toBe(true);
    for (const b of await page.locator("[data-calls-list] li[data-row], [data-calls-list] .calls-row-end button, [data-calls-list] .calls-row-end select, [data-calls-list] .calls-filters .seg-btn, [data-calls-list] .calls-chips .ib4-chip, [data-calls-list] .calls-head button").all()) {
      if (!(await b.isVisible())) continue;
      expect((await b.boundingBox())!.height, (await b.textContent()) ?? "").toBeGreaterThanOrEqual(44);
    }
    await needs(page).filter({ hasText: "Northwind weekly status call" }).locator("[data-call-row]").click();
    await page.getByRole("heading", { level: 2, name: "Northwind weekly status call" }).waitFor({ timeout: W });
    const show = await page.locator(".mtg-show").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height, chip: el.querySelector(".ib4-chip")!.getBoundingClientRect().height, x: getComputedStyle(el).overflowX }));
    expect(show.x).toBe("auto");
    expect(show.h).toBeLessThan(show.chip * 2);
    for (const b of await page.locator("[data-call-head] button, .mtg-show button, .mtg-prop:not(.is-open) .mtg-p1 button, .mtg-prop:not(.is-open) .mtg-tick").all()) {
      if (!(await b.isVisible())) continue;
      expect((await b.boundingBox())!.height, (await b.getAttribute("aria-label")) ?? (await b.textContent()) ?? "").toBeGreaterThanOrEqual(44);
    }
    // MC-4's stuck header was 255 px here.
    const stuck = await page.locator(".mtg-sticky").evaluate((el) => el.getBoundingClientRect().height);
    expect(stuck).toBeLessThan(255);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.close();
  }, T);
});
