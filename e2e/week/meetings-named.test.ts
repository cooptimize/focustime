// WK-6: the day in focus names its meetings, a call's state sits on its meeting's row, other days fold to one line,
// and call chips are gone. Demo mode (a fictional person, fictional meetings and calls), clock pinned to Wednesday
// Nov 4, 2026 3:00 PM ET. Each page's demo session is seeded with calls on Wednesday's meetings: the standup waits for
// its transcript, the requirements workshop has proposals, the lunch and learn is reviewed (nothing needs me); a call
// added by hand at 2:00 has no meeting; Tuesday's Atlas refinement waits for its transcript. Extra meetings (six in a
// block) and a moved meeting are made in that page's copy of the week only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page, Route } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { demoMeetingVtt } from "../../sources/demo/meetings.ts";

const T = 180_000;
const WED = "2026-11-04";
const TUE = "2026-11-03";
let h: Harness;

const call = (page: Page, action: string, input: unknown = {}) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ok = async (p: Promise<{ ok: boolean; data: any; error?: string }>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
};
const utc = (d: string, t: string) => new Date(`${d}T${t}:00-05:00`).toISOString();
const upload = (page: Page, series: number, date: string) =>
  page.evaluate(
    ([series, date, vtt]) => fetch(`/api/meetings/upload?series=${series}&date=${date}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "text/vtt", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: vtt }).then((r) => r.json()),
    [series, date, demoMeetingVtt()] as const,
  );

async function seed(page: Page) {
  const start = (id: string, d: string, a: string, b: string, clientKey: string) => ok(call(page, "meeting.call_start", { key: `demo-ical-demo-${id}-${d}`, startAt: utc(d, a), endAt: utc(d, b), clientKey }));
  await start("standup2", WED, "09:00", "09:15", "Cooptimize");
  const shop = await start("nwshop", WED, "09:30", "11:30", "Northwind");
  const lunch = await start("lunch", WED, "12:00", "12:45", "Cooptimize");
  await start("atref", TUE, "13:00", "14:00", "Atlas");
  await ok(call(page, "meeting.call_add", { name: "Harbor hallway chat", date: WED, start: "14:00", minutes: 20, clientKey: "Harbor" }));
  const mine = await ok(call(page, "meeting.mine"));
  const seriesOf = (occ: number) => mine.occurrences.find((o: { id: number }) => o.id === occ).seriesId as number;
  expect((await upload(page, seriesOf(shop.occurrenceId), WED)).ok).toBe(true);
  expect((await upload(page, seriesOf(lunch.occurrenceId), WED)).ok).toBe(true);
  const rv = await ok(call(page, "meeting.review", { occurrenceId: lunch.occurrenceId }));
  for (const p of rv.proposals) await ok(call(page, "meeting.edit", { proposalId: p.id, skip: true }));
  await ok(call(page, "ui.set_show_timelines", { show: false }));
}

/** This page's copy of the week: shift one meeting, or add meetings to a block. */
type Edit = { move?: { title: string; minutes: number }; add?: { date: string; half: "AM" | "PM"; items: [string, string, string][] } };
const editWeek = (edit: Edit) => (page: Page) =>
  page.route("**/api/action", async (route: Route) => {
    if (!(route.request().postData() ?? "").includes('"week.load"')) return route.fallback();
    const res = await route.fetch();
    const j = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const shift = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();
    for (const d of j?.data?.week?.days ?? [])
      for (const s of [d.am, d.pm].filter(Boolean)) {
        if (edit.move)
          for (const p of s.events)
            if (p.event.title === edit.move.title) {
              p.event = { ...p.event, start: shift(p.event.start, edit.move.minutes), end: shift(p.event.end, edit.move.minutes) };
              p.clipStart = shift(p.clipStart, edit.move.minutes);
              p.clipEnd = shift(p.clipEnd, edit.move.minutes);
            }
        if (edit.add && d.date === edit.add.date && s.half === edit.add.half)
          for (const [title, from, to] of edit.add.items) {
            const e = { id: `outlook:e2e-${title}`, source: "outlook", title, start: utc(d.date, from), end: utc(d.date, to), allDay: false, showAs: "busy", isPersonal: false, responseStatus: "accepted" };
            s.events.push({ event: e, clipStart: utc(d.date, from), clipEnd: utc(d.date, to), minutesInside: 30, continuesBefore: false, continuesAfter: false });
          }
      }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  });

async function week(page: Page) {
  await page.evaluate(() => (location.hash = "#/week"));
  await page.reload();
  await page.locator(".half.card").first().waitFor({ timeout: 30_000 });
}
const block = (page: Page, date: string, half: string) => page.locator(`.half[data-drop="${date}:${half}"]`).first();
const named = (page: Page, date: string, half: string) => block(page, date, half).locator(".card-meetings");
const rowTexts = (page: Page, date: string, half: string) => named(page, date, half).locator(".cm-row").evaluateAll((rs) => rs.map((r) => (r as HTMLElement).innerText.replace(/\s+/g, " ").trim()));

describe.skipIf(!CHROMIUM)("WK-6: meetings named on the day in focus (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-04T15:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("today names its meetings with each call's state; other days fold to one line; a past day keeps its quiet card; no call chip or mark on any card", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await seed(page);
    await week(page);
    // The day in focus: a Meetings heading with the meetings' time and the free time, then rows in time order.
    await expect(named(page, WED, "AM").locator(".cm-label").textContent()).resolves.toBe("Meetings");
    await expect(named(page, WED, "AM").locator(".cm-sum").textContent()).resolves.toMatch(/^2h 45m · 45m free$/);
    await expect.poll(() => rowTexts(page, WED, "AM")).toEqual([
      "9:00 Team standup Call · Upload the transcript",
      "9:30 Northwind requirements workshop Call · Review 10 proposals",
      "12:00 Lunch and learn: Power Automate",
    ]);
    // A call that needs nothing (reviewed) is a plain meeting; a call with no meeting is a row of its own.
    await expect.poll(() => rowTexts(page, WED, "PM")).toEqual(["12:00 Lunch and learn: Power Automate", "2:00 Harbor hallway chat Call · Upload the transcript"]);
    await expect(named(page, WED, "PM").locator(".cm-row.call-only .cm-icon").count()).resolves.toBe(1);
    // The standup repeats: its mark sits beside its name.
    await expect(named(page, WED, "AM").locator(".cm-row", { hasText: "Team standup" }).getByRole("img", { name: "Repeats" }).count()).resolves.toBe(1);
    // Another day (Thursday, Friday) has no named meetings.
    expect(await page.locator(`.half[data-drop^="2026-11-05:"] .card-meetings, .half[data-drop^="2026-11-06:"] .card-meetings`).count()).toBe(0);
    // A past day keeps the quiet card and still counts a call: Tuesday's Atlas refinement, in the link colour.
    const tue = block(page, TUE, "PM");
    expect(await tue.locator(".card-meetings").count()).toBe(0);
    await expect(tue.locator(".calls-need").textContent()).resolves.toBe("1 call needs you");
    // No call chip or mark anywhere on Week's cards, in any call state.
    expect(await page.locator(".half .call-mark, .half .card-calls, .half .ev-call").count()).toBe(0);
    // Another day in focus (the panel on Friday's catch-up): Wednesday folds to its one line and counts its calls.
    await page.getByText("Catch-up", { exact: true }).first().click();
    await expect.poll(() => named(page, WED, "AM").count()).toBe(0);
    const am = block(page, WED, "AM").locator(".card-agenda-fold");
    await expect(am.locator(".ml-words").textContent()).resolves.toBe("3 meetings · 2h 45m · 45m free");
    await expect(am.locator(".ml-needs").textContent()).resolves.toBe(" · 2 calls need you");
    await expect(block(page, WED, "PM").locator(".card-agenda-fold .ml-needs").textContent()).resolves.toBe(" · 1 call needs you");
    expect(await page.locator(".half .call-mark, .half .card-calls, .half .ev-call").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a row whose call needs me opens it in Calls and Back returns to Week; a plain row opens its menu; one call counted on a past day opens it; a folded line opens by hand", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await seed(page);
    await week(page);
    await named(page, WED, "AM").locator(".cm-row", { hasText: "requirements workshop" }).locator("a.cm-hit").click();
    await page.getByRole("heading", { level: 2, name: /^Northwind requirements workshop/ }).waitFor({ timeout: 30_000 });
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/calls\/\d+/);
    await page.goBack();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/week");
    await named(page, WED, "AM").waitFor();
    // A plain meeting row: its menu, never a call.
    await named(page, WED, "AM").locator(".cm-row", { hasText: "Lunch and learn" }).locator(".cm-hit").click();
    await page.locator(".popup-menu").waitFor();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => location.hash)).toBe("#/week");
    // Tuesday's one call: the count is a link to it.
    await block(page, TUE, "PM").locator("a.calls-need").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/calls\/\d+/);
    await page.goBack();
    await page.locator(".half.card").first().waitFor();
    // A folded line opens by hand to the named rows, with each call's state.
    await page.getByText("Catch-up", { exact: true }).first().click();
    await block(page, WED, "AM").locator(".card-agenda-fold .ml-needs").waitFor();
    await block(page, WED, "AM").locator(".card-agenda-fold").click();
    await expect.poll(() => rowTexts(page, WED, "AM")).toContain("9:30 Northwind requirements workshop Call · Review 10 proposals");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the block panel: its meetings line reads as the card's folded line with no mark; the agenda carries each call's state, a call with no meeting is a row, nothing runs past the edge", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await seed(page);
    await week(page);
    await block(page, WED, "AM").locator(".card-client").first().click();
    const panel = page.locator("aside.block-panel");
    const line = panel.locator(".bp-meet-line");
    await expect.poll(() => line.innerText().then((t) => t.replace(/\s+/g, " ").trim())).toBe("3 meetings · 2h 45m · 45m free · 2 calls need you");
    expect(await panel.locator(".call-mark, .ev-call").count()).toBe(0);
    await line.click();
    const agenda = panel.locator(".bp-meetings");
    await expect(agenda.locator("li", { hasText: "Team standup" }).locator(".ag-call").textContent()).resolves.toBe("Call · Upload the transcript");
    await expect(agenda.locator("li", { hasText: "requirements workshop" }).locator(".ag-call").textContent()).resolves.toBe("Call · Review 10 proposals");
    await expect(agenda.locator("li", { hasText: "Lunch and learn" }).locator(".ag-call").count()).resolves.toBe(0);
    expect(await panel.locator(".call-mark, .ev-call").count()).toBe(0);
    // Nothing in the agenda runs past the panel's edge.
    const over = await panel.evaluate((p) => {
      const edge = p.getBoundingClientRect().right;
      return [...p.querySelectorAll(".bp-meetings *")].filter((e) => e.getBoundingClientRect().right > edge + 1).length;
    });
    expect(over).toBe(0);
    // The afternoon: the call with no meeting is a row at its time, opening the call.
    await block(page, WED, "PM").locator(".card-client").first().click();
    await expect(panel.locator(".bp-title h2").innerText()).resolves.toMatch(/Wed PM$/);
    if ((await panel.locator(".bp-meetings li").count()) === 0) await panel.locator(".bp-meet-line").click();
    const only = panel.locator(".bp-meetings li.ag-call-only");
    await expect(only.innerText().then((t) => t.replace(/\s+/g, " ").trim())).resolves.toMatch(/Harbor hallway chat Call · Upload the transcript$/);
    await only.locator("a.ag-main").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/calls\/\d+/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("six meetings in a block show five, then 1 more, which opens the panel's agenda", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, { before: editWeek({ add: { date: WED, half: "AM", items: [["Harbor intake review", "10:00", "10:30"], ["Atlas data sync", "11:00", "11:30"], ["Expense report check-in", "11:45", "12:15"]] } }) });
    await seed(page);
    await week(page);
    const card = named(page, WED, "AM");
    await expect.poll(() => card.locator(".cm-row").count()).toBe(5);
    const more = card.locator(".cm-more");
    await expect(more.textContent()).resolves.toBe("1 more");
    await more.click();
    const agenda = page.locator("aside.block-panel .bp-meetings");
    await agenda.locator("li", { hasText: "Expense report check-in" }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a meeting moved on the calendar keeps its call (tied by the meeting itself, not its time)", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, { before: editWeek({ move: { title: "Northwind requirements workshop", minutes: 60 } }) });
    await seed(page);
    await week(page);
    await expect.poll(() => rowTexts(page, WED, "AM")).toContain("10:30 Northwind requirements workshop Call · Review 10 proposals");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the Meetings switch names every day's meetings, is a real switch read out, survives a reload as one word in storage and sends nothing", async () => {
    const sent: string[] = [];
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, { before: (p) => p.route("**/api/action", (r) => (sent.push(/"action":"([^"]+)"/.exec(r.request().postData() ?? "")?.[1] ?? ""), r.fallback())) });
    await seed(page);
    await week(page);
    // Friday's catch-up in focus, so Wednesday folds; Monday and Tuesday are past and keep their quiet cards.
    const focusFriday = async () => {
      await page.getByText("Catch-up", { exact: true }).first().click();
      await block(page, WED, "AM").locator(".card-agenda-fold").waitFor();
    };
    await focusFriday();
    const sw = page.getByRole("switch", { name: "Meetings" });
    await expect(sw.getAttribute("aria-checked")).resolves.toBe("false");
    expect(await named(page, WED, "AM").count()).toBe(0);
    await page.waitForTimeout(500);
    const before = sent.length;
    await sw.click();
    await expect(sw.getAttribute("aria-checked")).resolves.toBe("true");
    await expect.poll(() => named(page, WED, "AM").count()).toBe(1);
    await page.waitForTimeout(500);
    // Nothing is saved anywhere but this browser: no setting or UI action (background reads, such as Code's, may run).
    expect(sent.slice(before).filter((a) => /^(ui|settings|setup|admin)\./.test(a))).toEqual([]);
    // One word in this browser's storage, nothing of a call.
    const stored = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    expect(stored["focustime.week.meetings"]).toBe("all");
    expect(JSON.stringify(stored)).not.toMatch(/Northwind requirements|Harbor hallway|Upload the transcript|Review \d+ proposals/);
    await page.reload();
    await page.locator(".half.card").first().waitFor({ timeout: 30_000 });
    await page.getByText("Catch-up", { exact: true }).first().click();
    await expect(page.getByRole("switch", { name: "Meetings" }).getAttribute("aria-checked")).resolves.toBe("true");
    await expect.poll(() => named(page, WED, "AM").count()).toBe(1);
    await page.getByRole("switch", { name: "Meetings" }).click();
    await expect.poll(() => named(page, WED, "AM").count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("focustime.week.meetings"))).toBeNull();
    // Hidden in Timeline view.
    await ok(call(page, "ui.set_show_timelines", { show: true }));
    await page.reload();
    await page.locator(".half.card").first().waitFor({ timeout: 30_000 });
    expect(await page.locator(".meetings-switch").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  for (const vp of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }])
    it(`nothing cut at ${vp.width}: the header on one row, every named row inside its card, at each text size`, async () => {
      const { page, errors } = await freshPage(h, vp);
      await seed(page);
      for (const size of ["default", "large", "larger"]) {
        await ok(call(page, "ui.set_text_size", { size }));
        await week(page);
        await named(page, WED, "AM").waitFor();
        const head = await page.locator(".week-head").evaluate((el) => {
          const kids = [...el.children].filter((k) => (k as HTMLElement).offsetParent !== null).map((k) => k.getBoundingClientRect());
          return { tops: kids.map((r) => Math.round(r.top)), scroll: el.scrollWidth - el.clientWidth };
        });
        expect(new Set(head.tops).size, `${size}: header rows`).toBe(1);
        expect(head.scroll, `${size}: header overflow`).toBeLessThanOrEqual(0);
        await expect(page.locator(".meetings-switch").isVisible()).resolves.toBe(true);
        const out = await page.locator(".half.card").evaluateAll((cards) =>
          cards.flatMap((c) => {
            const r = c.getBoundingClientRect();
            return [...c.querySelectorAll(".card-meetings *, .calls-need, .card-agenda-fold *")].filter((e) => {
              const b = e.getBoundingClientRect();
              return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1);
            }).map((e) => e.className);
          }),
        );
        expect(out, `${size}: outside its card`).toEqual([]);
      }
      expect(errors).toEqual([]);
      await page.close();
    }, T);

  it("the phone is unchanged: no named meetings on Week's cards and no switch", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await seed(page);
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator(".pw-row").first().waitFor({ timeout: 30_000 });
    expect(await page.locator(".card-meetings, .meetings-switch, .calls-need").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
