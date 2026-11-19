// MC-6: Calls polish after the redesign, and a chat call keeps its chat's client. In demo mode (a fictional person,
// fictional calls and invented recordings on a pretend Pocket). One test per item where the browser shows it: a chat
// call's row offers its chat's client and Internal only; no week row title is cut at 1440 or 1280; at 390 no line under
// a call's title starts with a separator and "N of M decided" is in the window; group heads are section labels with no
// stripe; each count and each Skip all is on screen once for a call open beside the list; and the rest of the items.
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
const go = (page: Page, x: string) => page.evaluate((v) => (location.hash = v), x);

async function open(width = 1440, height = 900) {
  const { page, errors } = await freshPage(h, { width, height });
  await go(page, "#/week");
  await page.locator(".topbar").first().waitFor({ timeout: W });
  expect((await call(page, "pocket.connect", { key: "pk_demo_fine" })).ok).toBe(true);
  return { page, errors };
}
async function phone() {
  const page = await phonePage(h, 390);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await call(page, "pocket.connect", { key: "pk_demo_fine" })).ok).toBe(true);
  return page;
}
async function calls(page: Page, show = "open") {
  await go(page, `#/calls?show=${show}`);
  await page.locator("[data-calls-list] [data-call-row]").first().waitFor({ timeout: W });
  await page.waitForTimeout(800);
}
async function weeklyCall(page: Page) {
  const id = (await call(page, "meeting.mine", {})).data.occurrences[0].id as number;
  await go(page, `#/calls/${id}`);
  await page.getByRole("heading", { level: 2, name: "Northwind weekly status call" }).waitFor({ timeout: W });
  return id;
}
const chatRows = (page: Page) => page.locator("[data-calls-list] li").filter({ has: page.locator("[data-call-row^='cchat:']") });
/** Week row titles cut (wider than their box) in the list. */
const cutTitles = (page: Page) => page.locator("[data-calls-list] .calls-name").evaluateAll((es) => es.filter((e) => (e as HTMLElement).offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
/** How often `text` is on screen (visible, in the window) inside `sel`. */
const onScreen = (page: Page, sel: string, re: RegExp) =>
  page.evaluate(([s, src]) => {
    const root = document.querySelector(s) ?? document.body;
    const re = new RegExp(src);
    return [...root.querySelectorAll<HTMLElement>("*")].filter((e) => {
      if (!e.offsetParent || e.closest(".sr-only") || getComputedStyle(e).visibility === "hidden") return false;
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("");
      const b = e.getBoundingClientRect();
      return re.test(own) && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth;
    }).length;
  }, [sel, re.source] as const);

describe.skipIf(!CHROMIUM)("MC-6: Calls polish (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T16:30:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("1: a chat call's row offers its chat's client and Internal, nothing else; a calendar call offers every client", async () => {
    const { page, errors } = await open();
    await calls(page);
    await expect.poll(() => chatRows(page).count(), { timeout: W }).toBeGreaterThan(0);
    for (const r of await chatRows(page).all()) await expect(r.locator("select option").allTextContents()).resolves.toEqual(["Northwind", "Cooptimize"]);
    const calendar = page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: "Harbor sprint planning" }) }).first();
    await expect(calendar.locator("select option").allTextContents()).resolves.toEqual(expect.arrayContaining(["Atlas", "Cooptimize", "Harbor", "Northwind"]));
    // The server says the same: another client for a chat call is refused.
    const key = await chatRows(page).first().locator("[data-call-row]").getAttribute("data-call-row");
    const listed = (await call(page, "meeting.calls", {})).data.calls.find((c: { key: string }) => `c${c.key}` === key || c.key === key?.slice(1));
    expect(listed).toBeTruthy();
    expect(await call(page, "meeting.call_start", { key: listed.key, startAt: listed.startAt, endAt: listed.endAt, clientKey: "Harbor" })).toMatchObject({ ok: false, code: "chat_other_client" });
    expect(errors).toEqual([]);
  }, T);

  it("2: no week row title is cut at 1440 or 1280; a long one goes to a second line", async () => {
    for (const [w, ht] of [[1440, 900], [1280, 800]] as const) {
      const { page } = await open(w, ht);
      await calls(page);
      await expect(cutTitles(page), `${w}`).resolves.toEqual([]);
      // A chat call's long name takes the whole row; its picker and mark go under it, at their own size.
      const r = chatRows(page).first();
      await expect(r.getAttribute("class"), `${w}`).resolves.toMatch(/\blong\b/);
      const name = (await r.locator(".calls-name").boundingBox())!;
      const end = (await r.locator(".calls-row-end").boundingBox())!;
      expect(end.y, `${w}`).toBeGreaterThanOrEqual(name.y + name.height - 1);
      // A short name stays on one line with its picker beside it (at 1440; at 1280 the list is narrower).
      const short = page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: "Harbor sprint planning" }) }).first();
      if (w === 1440) await expect(short.getAttribute("class")).resolves.not.toMatch(/\blong\b/);
      await page.close();
    }
  }, T);

  it("3, 4: at 390 no line under a call's title starts with a separator; N of M decided is in the window", async () => {
    const page = await phone();
    await weeklyCall(page);
    const starts = await page.locator(".mtg-meta").evaluate((meta) => {
      const title = meta.parentElement!.querySelector("h2")!.getBoundingClientRect().left;
      let lastTop = -1;
      const out: { text: string; sepShown: boolean }[] = [];
      for (const k of [...meta.children] as HTMLElement[]) {
        if (!k.offsetParent) continue;
        const r = k.getBoundingClientRect();
        if (Math.abs(r.top - lastTop) <= 4) continue;
        lastTop = r.top;
        const sep = /·/.test(getComputedStyle(k, "::before").content);
        // A separator shows only when its piece starts right of the title's left edge (the clipped strip is left of it).
        out.push({ text: (k.textContent ?? "").trim(), sepShown: sep && r.left >= title - 1 });
      }
      return out;
    });
    expect(starts.length).toBeGreaterThan(1);
    expect(starts.filter((s) => s.sepShown)).toEqual([]);
    const dec = await page.getByText(/^\d+ of \d+ decided$/).boundingBox();
    expect(dec).not.toBeNull();
    expect(dec!.x).toBeGreaterThanOrEqual(0);
    expect(dec!.x + dec!.width).toBeLessThanOrEqual(390);
    expect(dec!.y + dec!.height).toBeLessThanOrEqual(844);
  }, T);

  it("5: group heads are the size of the page's section labels; a group's card has no colored stripe", async () => {
    const { page } = await open();
    await weeklyCall(page);
    const sizes = await page.evaluate(() => {
      const fs = (s: string) => getComputedStyle(document.querySelector(s)!).fontSize;
      const g = document.querySelector<HTMLElement>(".mtg-group")!;
      const cs = getComputedStyle(g);
      return { head: fs(".mtg-sec-head"), label: fs(".mtg-summary h3"), left: cs.borderLeftWidth, leftColor: cs.borderLeftColor, top: cs.borderTopColor };
    });
    expect(sizes.head).toBe(sizes.label);
    expect(sizes.left).toBe("1px");
    expect(sizes.leftColor).toBe(sizes.top);
  }, T);

  it("6: the counts are on the Show chips once; group heads carry their name only, the same as their chip's", async () => {
    const { page } = await open();
    await weeklyCall(page);
    const chips = await page.locator("[data-show]").evaluateAll((bs) => bs.map((b) => ({ key: b.getAttribute("data-show"), label: (b.firstChild?.textContent ?? "").trim(), n: b.querySelector(".seg-count")?.textContent ?? null })));
    const heads = await page.locator(".mtg-sec-head").evaluateAll((hs) => hs.map((x) => ({ group: x.closest("[data-group]")?.getAttribute("data-group"), text: (x.firstElementChild?.textContent ?? "").trim() })));
    for (const h of heads) {
      expect(h.text, h.group ?? "").not.toMatch(/\d/);
      expect(chips.find((c) => c.key === h.group)?.label, h.group ?? "").toBe(h.text);
    }
    expect(heads.map((x) => x.text)).toContain("Comments");
    // Each kind's count is on screen once, on its chip (two kinds with the same number: twice, once on each chip).
    for (const c of chips.filter((x) => x.n)) await expect(onScreen(page, ".calls-beside", new RegExp(`^\\s*${c.n}\\s*$`)), c.key ?? "").resolves.toBe(chips.filter((x) => x.n === c.n).length);
  }, T);

  it("7: with a call open beside the list, Skip all is in its header only; a row under the pointer that isn't open shows its own", async () => {
    const { page } = await open();
    await weeklyCall(page);
    await expect(onScreen(page, "body", /^Skip (all|last \d+)( and close)?$/)).resolves.toBe(1);
    await expect(page.locator(".calls-beside [data-call-act='skip-all']").isVisible()).resolves.toBe(true);
    // The open call's row keeps it hidden even under the pointer.
    const openRow = page.locator("[data-section='needs'] li.open").first();
    await openRow.hover();
    await expect(openRow.locator(".calls-skip").isVisible()).resolves.toBe(false);
  }, T);

  it("9: in Select calls the bar shows only once something is ticked; the menu says Done selecting", async () => {
    const { page } = await open();
    await calls(page);
    await expect.poll(async () => (await page.getByRole("menuitem").count()) > 0 || (await page.getByRole("button", { name: "More for Calls" }).click(), false), { timeout: W }).toBe(true);
    await page.getByRole("menuitem", { name: /^Select calls/ }).click();
    await expect(page.locator("[data-calls-tickbar]").count()).resolves.toBe(0);
    await page.getByRole("button", { name: "More for Calls" }).click();
    await expect(page.getByRole("menuitem", { name: /^Done selecting/ }).count()).resolves.toBe(1);
    await page.keyboard.press("Escape");
    await page.locator("[data-calls-list] .calls-tick input").first().check();
    await expect(page.locator("[data-calls-tickbar]").count()).resolves.toBe(1);
    await expect(page.locator("[data-calls-tickbar] [data-tickbar='done']").count()).resolves.toBe(1);
  }, T);

  it("8: in Add a call a chosen recording's time is on screen once, on its line", async () => {
    const { page } = await open();
    await calls(page);
    await page.getByRole("button", { name: "Add a call" }).first().click();
    const add = page.locator("[data-add-call]");
    const rec = add.locator("[data-rec-pick]").first();
    await rec.click();
    const when = (await rec.textContent())!.match(/[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+ · \d+:\d\d [AP]M/)![0];
    await expect(onScreen(page, "[data-add-call]", new RegExp(when.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).resolves.toBe(1);
  }, T);

  it("10: one Undo message at a time, each saying what it undoes", async () => {
    const { page } = await open();
    await weeklyCall(page);
    const toast = page.locator(".undo-toast");
    const promise = page.locator("[data-group='commitment'] [data-prop]").first();
    const what = (await promise.getAttribute("aria-label"))!;
    await promise.getByRole("button", { name: "Keep" }).click();
    await expect.poll(() => toast.textContent(), { timeout: W }).toContain(`Kept: ${what}`);
    const gap = page.locator("[data-group='gap'] [data-prop]").first();
    const title = (await gap.getAttribute("aria-label"))!;
    await gap.getByRole("button", { name: "Skip" }).click();
    await expect.poll(() => toast.textContent(), { timeout: W }).toContain(`Skipped: ${title}`);
    await expect(toast.count()).resolves.toBe(1);
  }, T);

  it("11: a quote and its Transcript line show the same time, into the call, with the clock time on hover (Teams and Pocket)", async () => {
    const { page } = await open();
    /** Each quote's time and hover beside its line's, opened from the quote. */
    const compare = async () => {
      await expect.poll(() => page.locator("button.mtg-p3 .mtg-at").count(), { timeout: W }).toBeGreaterThan(0);
      const q = page.locator("button.mtg-p3").filter({ has: page.locator(".mtg-at") }).first();
      const at = { text: await q.locator(".mtg-at").textContent(), title: await q.locator(".mtg-at").getAttribute("title") };
      await q.click();
      const line = page.locator(".mtg-lines li.at .mtg-line-at");
      await line.waitFor({ timeout: W });
      expect({ text: await line.textContent(), title: await line.getAttribute("title") }).toEqual(at);
      expect(at.text).toMatch(/^\d+:\d\d$/);
      expect(at.title).toMatch(/^\d+:\d\d [AP]M on the clock$/);
    };
    await weeklyCall(page);
    await compare();
    // A Pocket recording, added and reviewed.
    await calls(page);
    await page.getByRole("button", { name: "Add a call" }).first().click();
    const add = page.locator("[data-add-call]");
    await add.locator("[data-rec-pick]").first().click();
    await add.locator("#mtg-add-client").selectOption({ index: 1 });
    const name = await add.getByLabel("Name", { exact: true }).inputValue();
    await add.getByRole("button", { name: "Add and review" }).click();
    await page.getByRole("heading", { level: 2, name }).waitFor({ timeout: W });
    await compare();
  }, T);

  it("12: lengths use the app's words", async () => {
    const { page } = await open();
    await calls(page);
    await page.getByRole("button", { name: "Add a call" }).first().click();
    const recs = page.locator("[data-add-call] [data-rec-pick]");
    await expect.poll(() => recs.count(), { timeout: W }).toBeGreaterThan(0);
    for (const t of await recs.allTextContents()) {
      expect(t).not.toMatch(/\d (min|h)\b/);
      expect(t).toMatch(/· \d+(h|m)( \d+m)?\b/);
    }
  }, T);
});
