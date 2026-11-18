// MC-3: Calls is a tab, one list by day, the call beside it. In demo mode (a fictional person and fictional calls):
// the seventh tab between the Inbox and Code with the count of calls that need me (never the Inbox's), keys 6 and 7;
// every #/meetings address lands on Calls and Back returns; the top bar fits seven tabs on one row at 1280, 1366 and
// 1440 at every text size, with and without the Dev mark, and six for a person without Code; one list by day,
// newest first, a state on every row, filters whose counts add up, client chips, both kept in the address and
// remembered; a call that needs me past 14 days stays listed; a row opens its call or its setup beside the list
// (nothing read until Continue); the list folds and stays folded, with nothing of a call in the browser's storage;
// two steps when narrow and on the phone; loading, failed with Try again, no calls and an empty filter; J, K and Enter,
// never while typing. Clock: Thursday Nov 5, 2026 10:00 AM ET unless a test says otherwise.
import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const T = 240_000;
const NOW = "2026-11-05T10:00:00-05:00";
const started: Harness[] = [];
const demo = async (env: Record<string, string> = {}, clock = NOW) => {
  const h = await startDemo("chromium", env, clock);
  started.push(h);
  return h;
};
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hash = (page: Page) => page.evaluate(() => location.hash);
const go = (page: Page, h: string) => page.evaluate((x) => (location.hash = x), h);
const rows = (page: Page) => page.locator("[data-calls-list] .calls-scroll > .calls-day [data-call-row]");
const tabNames = (page: Page) => page.locator(".topbar .view-tab").evaluateAll((ts) => ts.map((t) => [...t.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join("")));
const callsTab = (page: Page) => page.locator(".topbar .view-tab").filter({ hasText: /^Calls/ });

describe.skipIf(!CHROMIUM)("Calls is a tab (MC-3, browser, demo mode)", () => {
  afterAll(async () => {
    for (const h of started) await h.stop();
  });

  it("the tab between the Inbox and Code with what needs me; keys 6 and 7; every old address lands and Back returns; the command menu", async () => {
    const h = await demo();
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/week");
    await page.locator(".topbar .view-tab").first().waitFor({ timeout: 30_000 });
    await expect(tabNames(page)).resolves.toEqual(["Day", "Week", "Backlog", "Status", "Inbox", "Calls", "Code"]);
    await expect(callsTab(page).getAttribute("title")).resolves.toMatch(/\(6\)$/);
    // The count: the calls that need me (MC-2's count), the same as To review; never the Inbox's.
    const inboxBefore = await page.locator(".topbar .view-tab").filter({ hasText: /^Inbox/ }).locator(".count").textContent();
    await expect.poll(() => callsTab(page).locator(".count").textContent(), { timeout: 30_000 }).toBe("1");
    await expect(callsTab(page).locator(".count").getAttribute("aria-label")).resolves.toBe("1 needs you");
    // Keys: 6 is Calls, 7 is Code.
    await page.locator("body").click({ position: { x: 700, y: 600 } }).catch(() => undefined);
    await go(page, "#/week");
    await page.keyboard.press("6");
    await expect.poll(() => hash(page)).toMatch(/^#\/calls/);
    await expect(callsTab(page).getAttribute("aria-current")).resolves.toBe("page");
    await page.locator("[data-call-row]").first().waitFor({ timeout: 30_000 });
    // MC-4: Needs you is first, and its count is the tab's.
    const needing = page.locator("[data-calls-list] [data-section='needs'] [data-call-row]");
    await expect(needing.count()).resolves.toBe(1);
    await expect(page.locator("#calls-needs .calls-head-count").textContent()).resolves.toBe("1");
    // No call named: the newest call that needs me opens beside the list (the address says which).
    await expect.poll(() => hash(page)).toMatch(/^#\/calls\/\d+$/);
    const id = Number((await hash(page)).split("/")[2]);
    await expect(needing.getAttribute("aria-current")).resolves.toBe("true");
    await page.locator(".calls-beside h2").first().focus().catch(() => undefined);
    await page.locator("body").press("7");
    await expect.poll(() => hash(page)).toMatch(/^#\/code/);

    // A call nobody has read, its setup opened: neither count moves.
    await go(page, "#/calls");
    await rows(page).filter({ hasText: "Northwind data model review" }).first().click();
    await page.getByRole("region", { name: /^Review Northwind data model review/ }).waitFor();
    await expect(callsTab(page).locator(".count").textContent()).resolves.toBe("1");
    await expect(page.locator(".topbar .view-tab").filter({ hasText: /^Inbox/ }).locator(".count").textContent()).resolves.toBe(inboxBefore);

    // Every address before Calls was a tab lands on the same place, and the browser's Back returns.
    const prop = (await call(page, "meeting.review", { occurrenceId: id })).data?.proposals?.[0]?.id as number | undefined;
    const forms: [string, RegExp][] = [
      ["#/meetings", /^#\/calls(\/\d+)?$/],
      [`#/meetings/${id}`, new RegExp(`^#/calls/${id}$`)],
      [`#/meetings/${id}/transcript`, new RegExp(`^#/calls/${id}/transcript$`)],
      [`#/meetings/${id}/transcript/3`, new RegExp(`^#/calls/${id}/transcript/3$`)],
      [`#/meetings/${id}/upload`, new RegExp(`^#/calls/${id}/upload$`)],
      [`#/meetings/${id}/new`, new RegExp(`^#/calls/${id}/new$`)],
      [`#/meetings/${id}/promises`, new RegExp(`^#/calls/${id}/promises$`)],
      [`#/meetings/${id}/comments`, new RegExp(`^#/calls/${id}/comments$`)],
      ...(prop ? ([[`#/meetings/${id}/proposal/${prop}`, new RegExp(`^#/calls/${id}/proposal/${prop}$`)]] as [string, RegExp][]) : []),
    ];
    for (const [old, now] of forms) {
      await go(page, "#/week");
      await expect.poll(() => hash(page)).toBe("#/week");
      await go(page, old);
      await expect.poll(() => hash(page), { message: old }).toMatch(now);
      await expect(callsTab(page).getAttribute("aria-current")).resolves.toBe("page");
      await page.goBack();
      await expect.poll(() => hash(page), { message: `${old} then Back` }).toBe("#/week");
    }

    // The command menu keeps it.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Calls");
    await page.locator(".command-menu [role='menuitem']").filter({ hasText: /^Calls/ }).first().click();
    await expect.poll(() => hash(page)).toMatch(/^#\/calls/);
    // Desktop More doesn't list it any more.
    await page.locator(".topbar").getByRole("button", { name: /^More/ }).click();
    await expect(page.locator(".popup-menu [role=menuitem]").filter({ hasText: /^Calls/ }).count()).resolves.toBe(0);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  // The top bar: one row, nothing cut, every tab's name shown, at each width and text size, with and without the Dev
  // mark; seven tabs, and six for a person without Code (Code's tab taken out of the page, the bar's class with it).
  for (const env of ["dev", "prod"] as const)
    it(`the top bar fits at 1280, 1366 and 1440 at each text size ${env === "dev" ? "with" : "without"} the Dev mark`, async () => {
      const h = await demo({ FOCUSTIME_ENV: env });
      for (const width of [1280, 1366, 1440]) {
        const { page, errors } = await freshPage(h, { width, height: 900 });
        await go(page, "#/week");
        await page.locator(".topbar .view-tab").first().waitFor({ timeout: 30_000 });
        await expect.poll(() => callsTab(page).locator(".count").count(), { timeout: 30_000 }).toBe(1);
        for (const size of [null, "large", "larger"] as const) {
          for (const tabs of [7, 6] as const) {
            if (tabs === 6) await page.evaluate(() => (document.querySelector(".topbar .view-tab:last-of-type")?.remove(), document.querySelector(".topbar")!.classList.remove("seven-tabs")));
            await page.evaluate((s) => (s ? document.documentElement.setAttribute("data-text-size", s) : document.documentElement.removeAttribute("data-text-size")), size);
            await page.waitForTimeout(150);
            const m = await page.evaluate(() => {
              const bar = document.querySelector<HTMLElement>(".app > .topbar")!;
              const kids = [...bar.children].filter((e) => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().width > 0);
              const mids = kids.map((e) => e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2);
              const r = bar.getBoundingClientRect();
              const right = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
              const tabs = [...bar.querySelectorAll<HTMLElement>(".view-tab")];
              return {
                over: Math.round(Math.max(0, bar.scrollWidth - bar.clientWidth, right - (r.right - parseFloat(getComputedStyle(bar).paddingRight)))),
                wraps: Math.max(...mids) - Math.min(...mids) > 4,
                cut: [...bar.querySelectorAll<HTMLElement>(".view-tab, .top-btn, .vm-chip, .brand")].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
                names: tabs.map((t) => [...t.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join("")),
                hidden: tabs.filter((t) => { const s = getComputedStyle(t); return s.display === "none" || s.visibility === "hidden" || t.getBoundingClientRect().width < 20; }).length,
                count: tabs.length,
              };
            });
            const at = `${env} ${width} ${size ?? "default"} ${tabs} tabs`;
            expect(m.count, at).toBe(tabs);
            expect(m.over, at).toBe(0);
            expect(m.wraps, at).toBe(false);
            expect(m.cut, at).toBe(0);
            expect(m.hidden, at).toBe(0);
            expect(m.names.slice(0, 6), at).toEqual(["Day", "Week", "Backlog", "Status", "Inbox", "Calls"]);
          }
          await page.reload();
          await page.locator(".topbar .view-tab").first().waitFor({ timeout: 30_000 });
          await expect.poll(() => callsTab(page).locator(".count").count(), { timeout: 30_000 }).toBe(1);
        }
        expect(errors).toEqual([]);
        await page.close();
      }
    }, T);

  it("MC-4: Needs you, then the weeks; Open, Closed and Hidden with counts; client chips; both in the address, kept on reload and remembered; MC-2's details findable", async () => {
    const h = await demo();
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/calls");
    await rows(page).first().waitFor({ timeout: 30_000 });
    // Needs you first, then This week and Last week (a past week says how many closed).
    const sections = await page.locator("[data-calls-list] .calls-scroll > .calls-day").evaluateAll((ds) => ds.map((d) => d.getAttribute("data-section")));
    expect(sections.slice(0, 2)).toEqual(["needs", "week-this"]);
    expect(sections).toContain("week-last");
    await expect(page.locator("#calls-week-last").textContent()).resolves.toMatch(/1 closed/);
    const keys = await rows(page).evaluateAll((rs) => rs.map((r) => r.getAttribute("data-call-row")));
    expect(new Set(keys).size).toBe(keys.length);
    // The calls with no transcript are folded at the end, with their count.
    await expect.poll(() => page.locator("[data-calls-fold='no-transcript'] > .link-btn").textContent(), { timeout: 30_000 }).toMatch(/^\s*\d+ calls with no transcript$/);
    // Closed shows one line each with what came of it; it's in the address.
    const count = async (f: string) => Number(await page.locator(`[data-calls-filter="${f}"] .seg-count`).textContent());
    await page.locator('[data-calls-filter="closed"]').click();
    await expect.poll(() => hash(page)).toMatch(/[?&]show=closed/);
    const closed = page.locator("[data-section='closed'] [data-call-row]");
    await expect.poll(() => closed.count()).toBe(await count("closed"));
    await expect(page.locator("[data-closed-line]").first().textContent()).resolves.toMatch(/created|promise|skipped|Nothing taken|No transcript/);
    // A client chip narrows to that client; the counts follow it.
    await page.locator('[data-calls-filter="open"]').click();
    const chips = page.locator(".calls-chips .ib4-chip");
    const allOpen = await count("open");
    await chips.filter({ hasText: "Northwind" }).click();
    await expect.poll(() => hash(page)).toMatch(/[?&]client=northwind/i);
    await expect.poll(() => count("open")).toBeLessThan(allOpen);
    // Both kept on a reload, and remembered when Calls opens again from the tab.
    await page.locator('[data-calls-filter="hidden"]').click();
    const kept = await hash(page);
    expect(kept).toMatch(/show=hidden/);
    // An empty filter says so.
    await expect(page.locator(".calls-note").filter({ hasText: "No calls here." }).count()).resolves.toBe(1);
    await page.reload();
    await page.locator('[data-calls-filter="hidden"]').waitFor({ timeout: 30_000 });
    await expect(page.locator('[data-calls-filter="hidden"]').getAttribute("aria-pressed")).resolves.toBe("true");
    await expect(chips.filter({ hasText: "Northwind" }).getAttribute("aria-pressed")).resolves.toBe("true");
    await go(page, "#/week");
    await callsTab(page).click();
    await expect.poll(() => hash(page)).toMatch(/show=hidden/);
    await page.locator('[data-calls-filter="open"]').click();
    await page.locator(".calls-chips .ib4-chip").first().click();
    // MC-2's details, still findable: Add a call, the registered client calls with when and how the transcript
    // arrives, and the line about who sees the list.
    await expect(page.getByRole("button", { name: "Add a call" }).count()).resolves.toBe(1);
    const fold = page.locator('[data-calls-fold="client-calls"]');
    await fold.getByRole("button").click();
    await expect(fold.locator("[data-series]").first().textContent()).resolves.toMatch(/Northwind weekly status call.*Northwind · Weekly status call · .* · (Read from Teams after the call|Uploaded by a reviewer)Reviewed by /);
    await expect(page.getByText(/Only you see the calls from your calendar/).count()).resolves.toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a row opens beside the list and keeps its place; a call nobody has read opens its setup and nothing is read until Continue; J, K and Enter, never while typing", async () => {
    const h = await demo();
    const actions: string[] = [];
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, { before: (p) => p.route("**/api/action", (r) => (actions.push(/"action":"([^"]+)"/.exec(r.request().postData() ?? "")?.[1] ?? ""), r.continue())) });
    await go(page, "#/calls");
    await rows(page).first().waitFor({ timeout: 30_000 });
    await expect.poll(() => hash(page)).toMatch(/^#\/calls\/\d+$/);
    // Scroll the list a little, then choose a call further down: the list keeps its place and filter.
    const scroll = page.locator("[data-calls-list] .calls-scroll");
    await scroll.evaluate((el) => (el.scrollTop = 120));
    const before = await scroll.evaluate((el) => el.scrollTop);
    const model = rows(page).filter({ hasText: "Northwind data model review" }).first();
    actions.length = 0;
    await model.click();
    const setup = page.getByRole("region", { name: /^Review Northwind data model review/ });
    await setup.waitFor();
    await expect(model.getAttribute("aria-current")).resolves.toBe("true");
    expect(Math.abs((await scroll.evaluate((el) => el.scrollTop)) - before)).toBeLessThan(400);
    // Nothing read, kept or sent about the call yet; nothing of it in the address.
    expect(actions.filter((a) => /^meeting\.(call_start|call_fetch|call_add|transcript|review)$/.test(a))).toEqual([]);
    expect(await hash(page)).toBe("#/calls");
    // The setup's Cancel goes back to the row; nothing else opens in its place.
    await setup.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-call-row"))).toBe(await model.getAttribute("data-call-row"));
    await expect(page.locator(".calls-beside .mtg-setup, .calls-beside .mtg-sticky").count()).resolves.toBe(0);
    // J and K move through the rows; Enter opens the focused one.
    const keyOf = () => page.evaluate(() => document.activeElement?.getAttribute("data-call-row") ?? null);
    const start = await keyOf();
    await page.keyboard.press("j");
    const next = await keyOf();
    expect(next).not.toBe(start);
    await page.keyboard.press("k");
    await expect.poll(keyOf).toBe(start);
    await page.keyboard.press("Enter");
    await setup.waitFor();
    // Never while typing: J in the setup's own fields doesn't move.
    await page.getByRole("button", { name: "Add a call" }).click();
    const name = page.getByRole("form", { name: "Add a call" }).getByLabel("Name", { exact: true });
    await name.fill("");
    await name.press("j");
    await expect(name.inputValue()).resolves.toBe("j");
    await expect(page.evaluate(() => document.activeElement?.tagName)).resolves.toBe("INPUT");
    // A registered call opens its page beside the list, with the list's filter left as it was.
    await page.locator('[data-calls-filter="closed"]').click();
    await page.locator("[data-section='closed'] [data-call-row]").first().click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    await expect.poll(() => hash(page)).toMatch(/^#\/calls\/\d+\?show=closed$/);
    await expect(page.locator('[data-calls-filter="closed"]').getAttribute("aria-pressed")).resolves.toBe("true");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the list folds to give the call the whole width, stays folded, and nothing of a call is in the browser's storage", async () => {
    const h = await demo();
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/calls");
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    const wideBefore = await page.locator(".calls-beside").evaluate((el) => el.getBoundingClientRect().width);
    await page.locator("[data-calls-hide]").click();
    await expect(page.locator("[data-calls-list]").count()).resolves.toBe(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute("data-calls-show"))).toBe(true);
    const wide = await page.locator(".calls-beside").evaluate((el) => el.getBoundingClientRect().width);
    expect(wide).toBeGreaterThan(wideBefore + 300);
    await page.reload();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    await expect(page.locator("[data-calls-list]").count()).resolves.toBe(0);
    // Nothing of a call: no name, no id, no transcript words; only the fold, the filter and the tab's place.
    const names = (await call(page, "meeting.mine", {})).data.meetings.map((m: { name: string }) => m.name) as string[];
    const stored = await page.evaluate(() => Object.entries(localStorage).concat(Object.entries(sessionStorage)));
    for (const [k, v] of stored) {
      for (const n of [...names, "Northwind data model review", "Proposal review with Jordan"]) expect(v, k).not.toContain(n);
      expect(v, k).not.toMatch(/#\/(calls|meetings)\/\d/);
    }
    expect(stored.filter(([k]) => k.startsWith("focustime.calls")).map(([k]) => k).sort()).toEqual(["focustime.calls.folded", "focustime.calls.list"].filter((k) => stored.some(([x]) => x === k)));
    await page.locator("[data-calls-show]").click();
    await page.locator("[data-calls-list]").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  // The rule itself (a call that needs me stays listed until its transcript is dropped; the rest fold) is
  // plan/call-list.test.ts's; here, two weeks on, the list, the fold and the tab's count still agree.
  it("two weeks on: the tab's count is Needs you's; closed calls older than the list's days are off it", async () => {
    const h = await demo({}, "2026-11-19T10:00:00-05:00");
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/calls");
    await page.locator("[data-calls-list] .calls-scroll").waitFor({ timeout: 30_000 });
    const old = rows(page).filter({ hasText: "Northwind weekly status call" });
    await expect.poll(() => old.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const needing = await page.locator("[data-calls-list] [data-section='needs'] [data-call-row]").count();
    await expect(callsTab(page).locator(".count").textContent()).resolves.toBe(String(needing));
    await expect(page.locator('[data-calls-fold="older"]').count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("loading, failed with Try again, and no calls at all, said truthfully", async () => {
    const h = await demo();
    let mode: "slow" | "fail" | "none" | "pass" = "fail";
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, {
      before: (p) =>
        p.route("**/api/action", async (r) => {
          const a = /"action":"(meeting\.(?:mine|calls))"/.exec(r.request().postData() ?? "")?.[1];
          if (!a || mode === "pass") return r.continue();
          if (mode === "slow") return new Promise<void>((res) => setTimeout(() => void r.continue().then(res, res), 2500));
          if (mode === "fail") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "FocusTime couldn't read your calls just now.", status: 503 }) });
          return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: a === "meeting.mine" ? { meetings: [], occurrences: [], nudges: [] } : { calls: [], days: 14 } }) });
        }),
    });
    await go(page, "#/calls");
    const alert = page.locator("[data-calls-list] [role=alert]");
    await alert.waitFor({ timeout: 30_000 });
    await expect(alert.textContent()).resolves.toContain("couldn't read your calls");
    // No list at all rather than one without the calls that need me: no rows, no filters saying To review 0.
    await expect(rows(page).count()).resolves.toBe(0);
    await expect(page.locator("[data-calls-filter]").count()).resolves.toBe(0);
    await expect(page.locator(".calls-beside").textContent()).resolves.toContain("couldn't read your calls");
    mode = "slow";
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => page.locator("[data-calls-list] [role=status]").filter({ hasText: "Loading" }).count()).toBeGreaterThan(0);
    await rows(page).first().waitFor({ timeout: 30_000 });
    // A fresh start on Calls with no calls at all (from Week, so no call was already open).
    await go(page, "#/week");
    await expect.poll(() => hash(page)).toBe("#/week");
    mode = "none";
    await go(page, "#/calls");
    await page.locator(".calls-note").filter({ hasText: "No calls in the last 14 days" }).waitFor({ timeout: 30_000 });
    // Beside it: one sentence and Add a call.
    await expect(page.locator(".calls-beside .calls-empty p").textContent()).resolves.toMatch(/\.$/);
    await expect(page.locator(".calls-beside").getByRole("button", { name: "Add a call" }).count()).resolves.toBe(1);
    mode = "pass";
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  for (const [label, width, height] of [["narrow", 820, 900], ["phone", 390, 844]] as const)
    it(`two steps on the ${label}: the list, then the call with Back; rows and controls at least 44 px`, async () => {
      const h = await demo();
      const page = label === "phone" ? await phonePage(h, width) : (await freshPage(h, { width, height })).page;
      if (label === "phone") await page.setViewportSize({ width, height });
      await go(page, "#/calls");
      await rows(page).first().waitFor({ timeout: 30_000 });
      // The list alone; nothing opens by itself.
      await expect(page.locator(".calls-beside").count()).resolves.toBe(0);
      expect(await hash(page)).toMatch(/^#\/calls(\?|$)/);
      if (label === "phone") {
        for (const b of await page.locator("[data-calls-list] [data-call-row], [data-calls-list] .calls-row-acts button, [data-calls-list] .calls-row-acts select, [data-calls-list] .calls-tick, [data-calls-list] .calls-filters .seg-btn, [data-calls-list] .calls-chips .ib4-chip, [data-calls-list] .calls-head-actions button").all())
          expect((await b.boundingBox())!.height, (await b.textContent()) ?? "").toBeGreaterThanOrEqual(44);
        await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
      }
      await page.locator("[data-calls-list] [data-section='needs'] [data-call-row]").first().click();
      await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
      await expect(page.locator("[data-calls-list]").count()).resolves.toBe(0);
      const back = page.locator("[data-calls-back]");
      if (label === "phone") expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await back.click();
      await rows(page).first().waitFor();
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-section]")?.getAttribute("data-section"))).toBe("needs");
      // A call nobody has read: its setup is the second step too.
      await rows(page).filter({ hasText: "Northwind data model review" }).first().click();
      await page.getByRole("region", { name: /^Review Northwind data model review/ }).waitFor();
      await page.locator("[data-calls-back]").click();
      await rows(page).first().waitFor();
      // Back was the browser's own step: one more Back leaves Calls rather than reopening the call.
      expect(await hash(page)).toMatch(/^#\/calls(\?|$)/);
      await page.goBack();
      await expect.poll(() => hash(page)).not.toMatch(/^#\/calls/);
      await page.close();
    }, T);

  it("the phone keeps Calls in More, first, with its count; the bar is unchanged", async () => {
    const h = await demo();
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    const bar = await page.locator(".bottom-bar").getByRole("button").allTextContents();
    expect(bar.join(" ")).not.toMatch(/Calls/);
    await page.locator(".bottom-bar").getByRole("button", { name: /^More/ }).click();
    const first = page.locator(".more-screen .mr-list").first().locator("button").first();
    await expect.poll(() => first.textContent(), { timeout: 30_000 }).toMatch(/^Calls/);
    await expect.poll(() => first.textContent()).toMatch(/1/);
    await first.click();
    await expect.poll(() => hash(page)).toMatch(/^#\/calls/);
    await page.close();
  }, T);
});
