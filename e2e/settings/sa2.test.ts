// SA-2: one way to draw a setting, one name per setting. On the demo: every section keeps main's order and groups
// (sa2-order-main.json, measured on main before SA-2); each kind of setting uses its one control; the label on the row
// is the registry's and search and the Undo message say the same; the saved mark moves nothing; the timebox switch is
// ticked when FocusTime asks; settings save the same values under the same keys; working hours read the three ways people
// type them and refuse others; on a phone the Undo sits above the bottom bar, controls are tap sized, help is at most two
// lines and nothing is clipped at the largest Text size. Edge cases are unit tests (ui/settings/*.test.ts).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { call, phonePage } from "../mb1-helpers.ts";
import { SECTIONS, SETTINGS, type SettingKind } from "../../ui/settings/registry.ts";

const T = 300_000;
const MAIN: Record<string, { id: string; group: string }[]> = JSON.parse(readFileSync(new URL("./sa2-order-main.json", import.meta.url), "utf8"));
const go = (page: Page, h: string) => page.evaluate((x) => (location.hash = x), h);
async function open(page: Page, section: string) {
  await go(page, `#/settings/${section}`);
  await page.locator(".ps-head h2").waitFor();
  await page.waitForTimeout(700);
}
const labelOf = (id: string) => SETTINGS.find((d) => d.id === id)!.label;
const settings = async (page: Page) => ((await call(page, "settings.load", {})) as unknown as { data: Record<string, Record<string, unknown>> }).data;

/** What each kind of setting is drawn with (the decision's "controls by kind"). */
const CONTROL: Partial<Record<SettingKind, string>> = {
  switch: '[role="switch"]',
  choice: '[role="radiogroup"]',
  select: "select",
  number: 'input[type="number"], input[type="range"]',
  time: ".time-field",
  list: ".sp-list-wrap",
  action: "button, a",
};

describe.skipIf(!CHROMIUM)("SA-2: one way to draw a setting (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("every section keeps main's order and groups; each kind uses its control; labels are the registry's", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const moved: string[] = [];
    const wrong: string[] = [];
    const named: string[] = [];
    for (const [section, before] of Object.entries(MAIN)) {
      await open(page, section);
      const now = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".ps-body [data-setting]")].map((el) => ({ id: el.dataset.setting!, group: el.parentElement?.closest("section[aria-label]")?.getAttribute("aria-label") ?? "" })),
      );
      // The settings main had, in main's order and group (rows SA-2 added, like a weekday of its own, are extra).
      const kept = now.filter((x) => before.some((b) => b.id === x.id)).filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i);
      if (JSON.stringify(kept) !== JSON.stringify(before)) moved.push(`${section}: ${JSON.stringify(before.filter((b, i) => JSON.stringify(kept[i]) !== JSON.stringify(b)))}`);
      for (const d of SETTINGS.filter((x) => x.section === section)) {
        // A header row (its parts are the rows under it, like the three risk numbers) has no control of its own.
        const row = page.locator(`.ps-body .sp-row[data-setting="${d.id}"]:not(.sp-bare)`).first();
        if (!(await row.count())) continue;
        const label = await row.locator(".sp-label").first().textContent();
        if (label !== d.label) named.push(`${d.id}: "${label}" is not "${d.label}"`);
        const want = d.kind ? CONTROL[d.kind] : undefined;
        if (want && !(await row.locator(want).count())) wrong.push(`${d.id} (${d.kind}) has no ${want}`);
      }
    }
    expect(moved).toEqual([]);
    expect(named).toEqual([]);
    expect(wrong).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("search and the Undo message use the row's name; the saved mark moves nothing", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await open(page, "focus");
    // Search finds it by the same name the row shows.
    await page.getByLabel("Search settings").fill("Focus length");
    await page.locator(".ps-rail").getByText(labelOf("focus-length"), { exact: true }).first().waitFor();
    await page.getByLabel("Search settings").fill("");
    // Positions inside the page, so the body's own scrolling doesn't count as a move.
    const nextTop = (id: string) => page.locator(`[data-setting="${id}"]`).first().evaluate((el) => { const t = (x: Element) => x.getBoundingClientRect().top - document.querySelector(".ps-body .sp-page")!.getBoundingClientRect().top; const n = el.nextElementSibling ?? el.parentElement!.nextElementSibling; return n ? t(n) : 0; });
    const helpTop = (id: string) => page.locator(`[data-setting="${id}"] .sp-help`).first().evaluate((el) => el.getBoundingClientRect().top - document.querySelector(".ps-body .sp-page")!.getBoundingClientRect().top);
    // A number: Saved shows, nothing below moves; the Undo names the label.
    const num = page.locator('[data-setting="focus-length"] input');
    const [h0, n0] = [await helpTop("focus-length"), await nextTop("focus-length")];
    await num.fill(String(Number(await num.inputValue()) + 5));
    await num.press("Enter");
    await page.locator('[data-setting="focus-length"] .sp-saved').waitFor();
    expect([await helpTop("focus-length"), await nextTop("focus-length")]).toEqual([h0, n0]);
    await page.locator(".set-undo").getByText(`${labelOf("focus-length")} saved.`).waitFor();
    // A switch.
    const [h1, n1] = [await helpTop("end-sound"), await nextTop("end-sound")];
    await page.locator('[data-setting="end-sound"]').getByRole("switch").click();
    await page.locator('[data-setting="end-sound"] .sp-saved').waitFor();
    expect([await helpTop("end-sound"), await nextTop("end-sound")]).toEqual([h1, n1]);
    await page.locator(".set-undo").getByText(`${labelOf("end-sound")} saved.`).waitFor();
    // A list: Add a playlist adds a row, and the saved mark on the row's label moves nothing above it.
    const pl = await page.locator('[data-setting="playlists"]').evaluate((el) => el.getBoundingClientRect().top - document.querySelector(".ps-body .sp-page")!.getBoundingClientRect().top);
    await page.getByRole("button", { name: "Add a playlist" }).click();
    expect(await page.locator('[data-setting="playlists"]').evaluate((el) => el.getBoundingClientRect().top - document.querySelector(".ps-body .sp-page")!.getBoundingClientRect().top)).toBe(pl);
    // Display: the same mark.
    await open(page, "display");
    const [h2, n2] = [await helpTop("theme"), await nextTop("theme")];
    const theme = page.locator('[data-setting="theme"]');
    await theme.getByRole("radio", { name: "Light" }).click();
    await theme.locator(".sp-saved").waitFor();
    expect([await helpTop("theme"), await nextTop("theme")]).toEqual([h2, n2]);
    await theme.getByRole("radio", { name: "Dark" }).click();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the timebox switch is ticked when FocusTime asks; settings save the same values under the same keys", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await open(page, "planning");
    const ask = page.getByRole("switch", { name: "Ask before changing my own timebox events" });
    await expect(ask.isChecked()).resolves.toBe(((await settings(page)).timebox as { confirmOwn: boolean }).confirmOwn);
    await ask.click();
    await expect.poll(async () => ((await settings(page)).timebox as { confirmOwn: boolean }).confirmOwn).toBe(await ask.isChecked());
    await ask.click();
    // A sample of keys: the row's control changes the stored value it always did.
    const cases: [section: string, id: string, read: (d: Record<string, Record<string, unknown>>) => unknown][] = [
      ["planning", "suggest-empty-blocks", (d) => d.planning!.suggest],
      ["focus", "end-sound", (d) => d.planning!.endSound],
      ["focus", "pause-media", (d) => d.focus!.pauseMedia],
      ["notifications", "urgent-during-focus", (d) => (d.notify as { asksThroughFocus: boolean }).asksThroughFocus],
      ["notifications", "quiet-pto", (d) => (d.notify as { quietPto: boolean }).quietPto],
    ];
    for (const [section, id, read] of cases) {
      await open(page, section);
      const sw = page.locator(`[data-setting="${id}"]`).getByRole("switch").first();
      if (await sw.isDisabled()) continue;
      const was = read(await settings(page));
      expect(await sw.isChecked(), id).toBe(was);
      await sw.click();
      await expect.poll(async () => read(await settings(page)), { message: id }).toBe(!was);
      await sw.click();
      await expect.poll(async () => read(await settings(page)), { message: id }).toBe(was);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("working hours read 9:00 to 13:00, 9:00-13:00 and 09:00–13:00; anything else and a zero lunch are refused", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await open(page, "hours");
    const fri = page.locator('[data-setting="hours-fri"] input');
    const hours = async () => ((await settings(page)).hours as { weekdays: Record<string, { start: string; end: string }[]> }).weekdays.fri ?? [];
    const was = await fri.inputValue();
    for (const typed of ["9:00 to 13:00", "9:00-12:00", "09:00–13:30"]) {
      await fri.fill(typed);
      await fri.press("Enter");
      const want = typed.replace(/^9/, "09").replace(/\s*(to|–)\s*/, "-");
      await expect.poll(() => fri.inputValue()).toBe(want);
      await expect.poll(async () => (await hours()).map((s) => `${s.start}-${s.end}`).join(", ")).toBe(want);
    }
    await fri.fill("9-5");
    await fri.press("Enter");
    await page.locator('[data-setting="hours-fri"] .sp-error').getByText(/Like 9:00-17:00/).waitFor();
    await expect(fri.getAttribute("aria-invalid")).resolves.toBe("true");
    await expect.poll(async () => (await hours()).map((s) => `${s.start}-${s.end}`).join(", ")).toBe("09:00-13:30");
    await fri.fill(was);
    await fri.press("Enter");
    const lunch = page.locator('[data-setting="lunch"] input');
    const lunchWas = await lunch.inputValue();
    await lunch.fill(lunchWas === "12:00-12:00" ? "12:00 to 12:00 " : "12:00-12:00");
    if (lunchWas !== "12:00-12:00") {
      await lunch.press("Enter");
      await page.locator('[data-setting="lunch"] .sp-error').getByText(/A lunch needs a length/).waitFor();
    }
    await lunch.fill(lunchWas);
    await lunch.press("Enter");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on a phone: Undo above the bottom bar, controls tap sized, help at most two lines, nothing clipped at Larger", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    const small: string[] = [];
    const long: string[] = [];
    const clipped: string[] = [];
    // Help is measured at the default Text size (two lines at most); tap size and clipping at Larger.
    for (const size of ["Default", "Larger"] as const) {
      await go(page, "#/settings/display");
      await page.locator('[data-setting="text-size"]').getByRole("radio", { name: size }).click();
      await page.waitForTimeout(400);
      for (const s of SECTIONS.filter((x) => !x.parent)) {
        await go(page, `#/settings/${s.id}`);
        await page.waitForTimeout(700);
        const r = await page.evaluate(() => {
          const out = { small: [] as string[], long: [] as string[], clipped: [] as string[] };
          for (const c of document.querySelectorAll<HTMLElement>(".sp-control :is(button, input:not(.sp-switch), select, .sp-switch-box, [role=radio]), .sp-below :is(button, select, .sp-switch-box)")) {
            const b = c.getBoundingClientRect();
            if (b.width && b.height && b.height < 43.5) out.small.push(`${c.closest("[data-setting]")?.getAttribute("data-setting")}: ${c.textContent?.trim() || c.getAttribute("aria-label") || c.tagName} ${Math.round(b.height)}px`);
          }
          for (const p of document.querySelectorAll<HTMLElement>(".sp-row > .sp-text > .sp-help:not([data-status])")) {
            const lh = parseFloat(getComputedStyle(p).lineHeight) || 16;
            if (p.getBoundingClientRect().height > lh * 2 + 2) out.long.push(`${p.closest("[data-setting]")?.getAttribute("data-setting") ?? "?"}: ${p.textContent?.slice(0, 50)}`);
          }
          for (const el of document.querySelectorAll<HTMLElement>(".ps-body .sp-row *:not(input)")) {
            const b = el.getBoundingClientRect();
            if (b.width && (b.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2) && getComputedStyle(el).overflowX === "visible" && !el.closest(".sp-table-wrap")) out.clipped.push(`${el.closest("[data-setting]")?.getAttribute("data-setting")}: ${el.tagName}.${el.className}`);
          }
          return out;
        });
        if (size === "Default") long.push(...r.long.map((x) => `${s.id}/${x}`));
        else {
          small.push(...r.small.map((x) => `${s.id}/${x}`));
          clipped.push(...r.clipped.map((x) => `${s.id}/${x}`));
        }
      }
    }
    expect(clipped).toEqual([]);
    expect(small).toEqual([]);
    expect(long).toEqual([]);
    // Undo: above the bottom bar and the Capture button, and its button reachable.
    await go(page, "#/settings/focus");
    await page.locator('[data-setting="end-sound"]').getByRole("switch").click();
    const undo = page.locator(".set-undo").getByRole("button", { name: "Undo" });
    await undo.waitFor();
    const place = await page.evaluate(() => {
      const u = document.querySelector(".set-undo-box")!.getBoundingClientRect();
      const bar = document.querySelector(".bottom-bar")?.getBoundingClientRect();
      const cap = document.querySelector(".bb-capture")?.getBoundingClientRect();
      return { bottom: u.bottom, barTop: bar?.top ?? innerHeight, capTop: cap?.top ?? innerHeight, left: u.left, right: u.right, width: innerWidth };
    });
    expect(place.bottom).toBeLessThanOrEqual(place.barTop);
    expect(place.bottom).toBeLessThanOrEqual(place.capTop);
    expect(place.left).toBeGreaterThanOrEqual(16);
    expect(place.right).toBeLessThanOrEqual(place.width - 16);
    await undo.click();
    await go(page, "#/settings/display");
    await page.locator('[data-setting="text-size"]').getByRole("radio", { name: "Default" }).click();
    await page.close();
  }, T);
});
