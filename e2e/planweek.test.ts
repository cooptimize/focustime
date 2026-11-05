// U6: Plan the week one client at a time, on the planning layout shared with Plan the day (browser, demo mode, clock
// pinned to Mon Nov 2, 9:30 AM). Behavior only: exactly one client open and the right pane follows it; the line, the
// card and the grid update on add, demote and remove; the pane never offers what is listed or a story under a listed
// feature; Enter types a draft feature as a must, Shift+Enter a nice to have; "N of M clients planned" counts a must
// or Nothing this week; it opens on the first client with trouble; a grid cell opens its client and takes only its
// client's musts; J, K, / and Enter; both screens share the header, units, rows and the pane, and nothing paints
// outside them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, weekClient, weekClientNames, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const MON = "2026-11-02";
const NEXT = "2026-11-09";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string, wait = ".pw-client") => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.locator(wait).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
};
const openName = (page: Page) => page.locator(".pw-client").getAttribute("aria-label");
const paneName = (page: Page) => page.locator(".pw-addpane .pl-add-client").textContent();
const summary = (page: Page) => page.locator(".pl-head .pl-summary").textContent();
const offered = (page: Page) => page.locator(".pw-addpane .pw-addrow").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-item"))));
const state = async (page: Page) => (await call(page, "weekplan.load", { weekStart: NEXT })).data as { plan: { features: { id: number; itemId: number; tier: string; slots: { date: string; half: string }[] }[] }; weekDrafts: { draftId: number }[]; quiet: string[] };
/** Takes next week's list back to empty (each test starts from the demo's next week). */
async function reset(page: Page) {
  const s = await state(page);
  for (const f of s.plan.features) await call(page, "weekplan.remove", { id: f.id });
  for (const d of s.weekDrafts) await call(page, "weekplan.draft_tier", { weekStart: NEXT, draftId: d.draftId, tier: "off" });
  for (const k of s.quiet) await call(page, "weekplan.nothing", { weekStart: NEXT, clientKey: k, on: false });
}
const press = async (page: Page, key: string) => {
  await page.locator(".pl-head .pl-heading").focus();
  await page.keyboard.press(key);
};

/** Text inside a box whose painted area (clipped by overflow ancestors) reaches outside it. */
const paintsOutside = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const out: string[] = [];
    for (const c of document.querySelectorAll(s)) {
      const box = c.getBoundingClientRect();
      for (const e of c.querySelectorAll("*")) {
        if (![...e.childNodes].some((x) => x.nodeType === 3 && (x.textContent ?? "").trim())) continue;
        const b0 = e.getBoundingClientRect();
        if (!(b0.width > 0 && b0.height > 0)) continue;
        let r = { l: b0.left, t: b0.top, r: b0.right, b: b0.bottom };
        for (let a = e.parentElement; a && a !== c.parentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
          const ab = a.getBoundingClientRect();
          r = { l: Math.max(r.l, ab.left), t: Math.max(r.t, ab.top), r: Math.min(r.r, ab.right), b: Math.min(r.b, ab.bottom) };
        }
        if (r.r <= r.l || r.b <= r.t) continue;
        if (r.l < box.left - 1 || r.r > box.right + 1 || r.t < box.top - 1 || r.b > box.bottom + 1) out.push(`${e.className} "${(e.textContent ?? "").trim().slice(0, 30)}"`);
      }
    }
    return out;
  }, sel);

describe.skipIf(!CHROMIUM)("Plan the week one client at a time (U6)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("exactly one client is open and the right pane follows it: J and K, a line's name, a grid cell", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, `#/week/plan/${NEXT}`);
    // Nothing is in trouble next week: the first client (first block Mon AM) opens.
    await expect(page.locator(".pw-client").count()).resolves.toBe(1);
    expect(await openName(page)).toBe("Cooptimize");
    expect(await paneName(page)).toBe("Cooptimize");
    await expect(page.locator(".pw-lines > li").count()).resolves.toBe(4);
    await press(page, "j");
    await expect.poll(() => openName(page)).toBe("Northwind");
    expect(await paneName(page)).toBe("Northwind");
    await expect(page.locator(".pw-client").count()).resolves.toBe(1);
    await press(page, "k");
    await expect.poll(() => openName(page)).toBe("Cooptimize");
    await page.locator('.pw-line[aria-label="Harbor"] .pl-line-name').click();
    await expect.poll(() => paneName(page)).toBe("Harbor");
    // The open client's cells read Planning; a click on another client's cell opens that client.
    await expect(page.locator(".pw-cell.on .pw-cell-right").first().textContent()).resolves.toBe("Planning");
    await page.locator('.pw-cell[aria-label^="Tue, Nov 10 afternoon: Atlas"]').click();
    await expect.poll(() => openName(page)).toBe("Atlas");
    await expect(page.locator(".pw-client").count()).resolves.toBe(1);
    // Next client steps on; the last client has Done instead.
    await expect(page.locator(".pw-client .pw-next").textContent()).resolves.toBe("Done");
    await page.locator('.pw-line[aria-label="Cooptimize"] .pl-line-name').click();
    await page.locator(".pw-client .pw-next").click();
    await expect.poll(() => openName(page)).toBe("Northwind");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("opens on the first client with trouble: this week Northwind is over, though Cooptimize comes first", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, `#/week/plan/${MON}`);
    await expect(page.locator(".pw-lines > li").first().getAttribute("aria-label")).resolves.toBe("Cooptimize");
    expect(await openName(page)).toBe("Northwind");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("+ Must updates the line, the card and the grid; stories under a listed feature leave the pane; demote and remove too", async () => {
    const { page, errors } = await freshPage(h);
    await reset(page);
    await go(page, `#/week/plan/${NEXT}`);
    await weekClient(page, "Cooptimize");
    expect(await summary(page)).toBe("next week · 0 of 4 clients planned");
    // D437: the feature and the orphan story are rows; the feature's stories nest under it, never rows of their own.
    expect(await offered(page)).toEqual(expect.arrayContaining([4410, 4420]));
    expect(await offered(page)).not.toContain(4411);
    // WT-1: the type is an icon named for the process's type, not a word.
    const kids = page.locator('.pw-addpane .pw-addrow[data-item="4410"] .pw-add-kid');
    expect((await kids.allInnerTexts()).map((t) => t.trim())).toEqual(["#4411 Timesheet summary query", "#4412 Utilization chart"]);
    expect(await kids.locator(".type-icon").evaluateAll((els) => els.map((e) => e.getAttribute("title")))).toEqual(["User Story", "User Story"]);
    await page.getByRole("button", { name: "Add #4410 as a must" }).click();
    const row = page.locator(".pw-client .pw-row", { hasText: "Internal reporting refresh" });
    await row.waitFor();
    // The feature is listed, its stories (4411, 4412) are no longer offered on their own.
    await expect.poll(() => offered(page)).not.toContain(4410);
    expect(await offered(page)).not.toContain(4411);
    expect(await offered(page)).not.toContain(4412);
    expect(await offered(page)).toContain(4420);
    await expect.poll(() => summary(page)).toBe("next week · 1 of 4 clients planned");
    await expect(page.locator(".pw-client .pl-unit-detail").textContent()).resolves.toBe("1 must");
    // Pinned on Mon AM: the title shows on the grid cell.
    await row.locator(".pl-handle").dragTo(page.locator('.pw-cell[aria-label^="Mon, Nov 9 morning: Cooptimize"]'));
    await expect.poll(() => page.locator('.pw-cell[aria-label^="Mon, Nov 9 morning"] .pw-cell-right').textContent()).toBe("Internal reporting refresh");
    // Demote: the card says No musts yet, the summary goes back, Nice to have counts it, the pin stays.
    await row.hover();
    await row.getByRole("button", { name: "More for Internal reporting refresh" }).click();
    await page.getByRole("menuitem", { name: "Make it a nice to have" }).click();
    await expect.poll(() => page.locator(".pw-client .pl-unit-detail").textContent()).toBe("No musts yet");
    await expect.poll(() => summary(page)).toBe("next week · 0 of 4 clients planned");
    await expect(page.locator(".pw-client .pw-nice .pl-fold").textContent()).resolves.toMatch(/Nice to have · 1$/);
    // Remove: the pane offers it again, and the grid cell no longer has the title.
    await page.locator(".pw-client .pw-nice .pl-fold").click();
    await row.hover();
    await row.getByRole("button", { name: "More for Internal reporting refresh" }).click();
    await page.getByRole("menuitem", { name: "Take off the week" }).click();
    await expect.poll(() => offered(page)).toContain(4410);
    await expect(page.locator('.pw-cell[aria-label^="Mon, Nov 9 morning"] .pw-cell-right').textContent()).resolves.toBe("Planning");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the type box: Enter makes a draft feature as a must, Shift+Enter a nice to have; a draft opens the draft editor", async () => {
    const { page, errors } = await freshPage(h);
    await reset(page);
    await go(page, `#/week/plan/${NEXT}`);
    await weekClient(page, "Harbor");
    const box = page.locator(".pw-addpane .pw-type-input");
    await expect(box.getAttribute("placeholder")).resolves.toBe("Type a feature for Harbor, then Enter");
    await box.fill("Self-service export");
    await box.press("Enter");
    const must = page.locator(".pw-client .pw-tier:not(.pw-nice) .pw-draft-row", { hasText: "Self-service export" });
    await must.waitFor();
    await expect(must.locator(".pw-draft-tag").textContent()).resolves.toBe("Draft");
    await expect.poll(() => box.inputValue()).toBe("");
    await expect.poll(() => summary(page)).toBe("next week · 1 of 4 clients planned");
    await box.fill("Audit trail");
    await box.press("Shift+Enter");
    await expect.poll(() => page.locator(".pw-client .pw-nice .pl-fold").textContent()).toMatch(/Nice to have · 1$/);
    await page.locator(".pw-client .pw-nice .pl-fold").click();
    await expect(page.locator(".pw-client .pw-nice .pw-draft-row", { hasText: "Audit trail" }).count()).resolves.toBe(1);
    // Locally only: a draft, not a DevOps item on the list.
    const s = await state(page);
    expect(s.weekDrafts.length).toBe(2);
    expect(s.plan.features).toEqual([]);
    await must.locator(".draft-title").click();
    await page.locator(".draft-editor").waitFor();
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("each row shows its type as an icon named for the type (WT-1), a feature with its target date; no epics; an epic with no features is a line on the card that opens the draft editor", async () => {
    const { page, errors } = await freshPage(h);
    await reset(page);
    await go(page, `#/week/plan/${NEXT}`);
    const names = await weekClientNames(page);
    let rows = 0;
    for (const name of names) {
      await weekClient(page, name);
      await expect.poll(() => paneName(page)).toBe(name);
      // WT-1: each row's type is an icon with the process's type name as its accessible name; no type words.
      const types = await page.locator(".pw-addpane .pw-addrow > .pw-title > .type-icon svg").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      expect(types.length, name).toBe(await page.locator(".pw-addpane .pw-addrow").count());
      for (const t of types) expect(["Feature", "User Story", "Bug"], name).toContain(t);
      rows += types.length;
      const pane = await page.locator(".pw-addpane").innerText();
      expect(pane, name).not.toMatch(/\b(User Story|Story|Feature)\b(?! for)/);
      expect(pane, name).not.toMatch(/\bEpics?\b/);
    }
    expect(rows).toBeGreaterThan(0);
    // A feature with a target date says it after its type word.
    await weekClient(page, "Cooptimize");
    await expect(page.locator('.pw-addpane .pw-addrow[data-item="4410"] > .pw-title').innerText()).resolves.toMatch(/Internal reporting refresh · target Nov 20/);
    // The type box saves a draft feature, never a story.
    await expect(page.locator(".pw-addpane .pw-type").innerText()).resolves.toContain("Enter saves a draft feature as a must");
    // Atlas's epic with no features: once, at the top of its card; Draft feature opens the draft editor under it.
    expect(names).toContain("Atlas");
    {
      await weekClient(page, "Atlas");
      const line = page.locator(".pw-client .pw-epic-line");
      await expect(line.count()).resolves.toBe(1);
      await expect(line.innerText()).resolves.toMatch(/^Epic needs features\s+#3320 Carrier integrations · Draft feature$/);
      await line.getByRole("button", { name: "Draft feature" }).click();
      const ed = page.locator(".draft-editor");
      await ed.waitFor();
      const drafts = (await call(page, "weekplan.load", { weekStart: NEXT })).data.drafts as { level: string; parentItemId: number | null; id: number }[];
      const made = drafts.find((d) => d.parentItemId === 3320);
      expect(made?.level).toBe("feature");
      await page.keyboard.press("Escape");
      if (made) await call(page, "draft.remove", { id: made.id });
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("N of M clients planned counts a client with a must or one marked Nothing this week", async () => {
    const { page, errors } = await freshPage(h);
    await reset(page);
    await go(page, `#/week/plan/${NEXT}`);
    expect(await summary(page)).toBe("next week · 0 of 4 clients planned");
    const atlas = await weekClient(page, "Atlas");
    await atlas.getByRole("button", { name: "Nothing this week" }).click();
    await expect.poll(() => summary(page)).toBe("next week · 1 of 4 clients planned");
    await call(page, "weekplan.add", { weekStart: NEXT, clientKey: "Cooptimize", itemId: 4420, tier: "must" });
    await page.reload();
    await go(page, `#/week/plan/${NEXT}`);
    await expect.poll(() => summary(page)).toBe("next week · 2 of 4 clients planned");
    await expect(page.locator('.pw-line[aria-label="Atlas"] .pl-line-detail').textContent()).resolves.toBe("Nothing this week");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the grid takes a must only on its client's cells: another client's cell and PTO refuse the drop; the pin records as before", async () => {
    const { page, errors } = await freshPage(h);
    await reset(page);
    await call(page, "weekplan.add", { weekStart: NEXT, clientKey: "Cooptimize", itemId: 4410, tier: "must" });
    await go(page, `#/week/plan/${NEXT}`);
    const row = (await weekClient(page, "Cooptimize")).locator(".pw-row", { hasText: "Internal reporting refresh" });
    const slots = async () => (await state(page)).plan.features.find((f) => f.itemId === 4410)?.slots ?? [];
    await row.locator(".pl-handle").dragTo(page.locator('.pw-cell[aria-label^="Tue, Nov 10 morning: Harbor"]'));
    await row.locator(".pl-handle").dragTo(page.locator('.pw-cell.pto[aria-label^="Thu, Nov 12"]'));
    await page.waitForTimeout(500);
    expect(await slots()).toEqual([]);
    await row.locator(".pl-handle").dragTo(page.locator('.pw-cell[aria-label^="Mon, Nov 9 morning: Cooptimize"]'));
    await expect.poll(slots).toEqual([{ date: NEXT, half: "AM" }]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("/ goes to Search; Enter adds the first match as a must; Esc clears the search", async () => {
    const { page, errors } = await freshPage(h);
    await reset(page);
    await go(page, `#/week/plan/${NEXT}`);
    await weekClient(page, "Cooptimize");
    await press(page, "/");
    const search = page.locator(".pw-addpane .pw-search");
    await expect.poll(() => search.evaluate((e) => e === document.activeElement)).toBe(true);
    await page.keyboard.type("Onboarding");
    await expect.poll(() => offered(page)).toEqual([4420]);
    await page.keyboard.press("Enter");
    await page.locator(".pw-client .pw-row", { hasText: "Onboarding guide for new hires" }).waitFor();
    expect((await state(page)).plan.features.map((f) => [f.itemId, f.tier])).toEqual([[4420, "must"]]);
    await search.fill("chart");
    await search.press("Escape");
    await expect.poll(() => search.inputValue()).toBe("");
    // Esc in the search box doesn't leave Plan the week.
    await expect(page.locator(".planweek").count()).resolves.toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Plan the day: J and K move between blocks, / opens the list's search", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, `#/today/plan/${MON}/AM`, ".pd2-block");
    const selected = () => page.locator(".pd2-block.selected .pd2-client").textContent();
    expect(await selected()).toBe("Cooptimize");
    await page.locator(".pl-head .pl-heading").focus();
    await page.keyboard.press("j");
    await expect.poll(selected).toBe("Northwind");
    await page.keyboard.press("k");
    await expect.poll(selected).toBe("Cooptimize");
    await page.keyboard.press("/");
    await expect.poll(() => page.locator(".pd2-right .pd2-search").evaluate((e) => e === document.activeElement)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("both screens share the header, units, rows and the pane: same styles, 420 px at 1920, 520 px at 3840, one column under 1200", async () => {
    const look = async (page: Page) =>
      page.evaluate(() => {
        const st = (sel: string, props: string[]) => {
          const e = document.querySelector(sel);
          if (!e) return null;
          const cs = getComputedStyle(e);
          return props.map((p) => cs.getPropertyValue(p)).join(" ");
        };
        const add = document.querySelector("[data-plan=add]")!.getBoundingClientRect();
        const left = document.querySelector(".pl-left")!.getBoundingClientRect();
        return {
          header: st("[data-plan=header]", ["padding-left", "gap"]),
          heading: st(".pl-heading", ["font-size", "font-weight"]),
          unit: st("[data-plan=unit]", ["border-left-width", "border-top-left-radius", "padding-left", "padding-top", "background-color"]),
          row: st("[data-plan=row]", ["min-height", "font-size", "padding-left", "border-top-left-radius"]),
          // Every section label on the screen, in the card and the pane alike.
          label: [...new Set([...document.querySelectorAll(".pl-label")].map((e) => { const cs = getComputedStyle(e); return `${cs.fontSize} ${cs.fontWeight} ${cs.textTransform}`; }))].join(" | "),
          addBox: st("[data-plan=add]", ["border-top-left-radius", "padding-left", "background-color"]),
          addWidth: Math.round(add.width),
          below: add.top >= left.bottom - 1,
        };
      });
    for (const [vp, width] of [[{ width: 1920, height: 1080 }, 420], [{ width: 3840, height: 1600 }, 520]] as const) {
      const { page, errors } = await freshPage(h, vp);
      await call(page, "weekplan.add", { weekStart: NEXT, clientKey: "Cooptimize", itemId: 4420, tier: "must" });
      await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "M" });
      await go(page, `#/week/plan/${NEXT}`);
      await weekClient(page, "Cooptimize");
      const week = await look(page);
      await go(page, `#/today/plan/${MON}/AM`, ".pd2-block");
      const day = await look(page);
      expect(week.addWidth).toBe(width);
      expect(day.addWidth).toBe(width);
      for (const k of ["header", "heading", "unit", "row", "label", "addBox"] as const) expect(week[k], k).toBe(day[k]);
      expect(week.below || day.below).toBe(false);
      expect(errors).toEqual([]);
      await page.close();
    }
    const { page } = await freshPage(h, { width: 1100, height: 900 });
    await go(page, `#/week/plan/${NEXT}`);
    expect((await look(page)).below).toBe(true);
    await go(page, `#/today/plan/${MON}/AM`, ".pd2-block");
    expect((await look(page)).below).toBe(true);
    await page.close();
  }, 2 * T);

  it("nothing paints outside the card, the lines, the grid cells or the pane on either screen, with long titles", async () => {
    const { page, errors } = await freshPage(h, { width: 1280, height: 900 });
    await reset(page);
    const LONG = "Reconcile every partner invoice export with the finance warehouse and the quarterly close checklist";
    await call(page, "weekplan.add_draft", { weekStart: NEXT, clientKey: "Cooptimize", title: LONG, tier: "must" });
    await call(page, "weekplan.add", { weekStart: NEXT, clientKey: "Cooptimize", itemId: 4410, tier: "must" });
    await call(page, "weekplan.place", { weekStart: NEXT, clientKey: "Cooptimize", itemId: 4410, date: NEXT, half: "AM", on: true });
    await go(page, `#/week/plan/${NEXT}`);
    await weekClient(page, "Cooptimize");
    for (const sel of [".pw-client", ".pw-line", ".pw-cell", ".pw-addpane"]) expect(await paintsOutside(page, sel), sel).toEqual([]);
    await go(page, `#/today/plan/${MON}/AM`, ".pd2-block");
    for (const sel of [".pd2-block", ".pd2-right"]) expect(await paintsOutside(page, sel), sel).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
