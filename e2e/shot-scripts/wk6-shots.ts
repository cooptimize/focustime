// WK-6 screenshots on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port, the clock
// pinned to Wednesday Nov 4, 2026 3:00 PM ET). The demo's Northwind weekly status call (Monday) has proposals to
// review. Calls that aren't registered are started on Wednesday's meetings: the standup waits for its upload, the
// requirements workshop has proposals, the lunch and learn is reviewed (every proposal skipped). A call added by hand
// at 2:00 has no meeting; Tuesday's Atlas refinement waits for its upload. Extra fictional meetings for six in a block
// and a moved meeting are made in this browser's copy of the week only (the demo calendar is fixed).
// Usage: WK6_SHOTS=screenshots/wk6 npm run shots -- e2e/shot-scripts/wk6-shots.ts (WK6_BEFORE=1 on main's tree for the
// before pictures, which skips the call with no meeting). Nothing runs without WK6_SHOTS.
import { mkdirSync } from "node:fs";
import { describe, it } from "vitest";
import type { Page, Route } from "playwright-core";
import { startDemo } from "../harness.ts";
import { demoMeetingVtt } from "../../sources/demo/meetings.ts";

const out = process.env.WK6_SHOTS ?? "";
const before = process.env.WK6_BEFORE === "1";

const act = (page: Page, action: string, input: Record<string, unknown> = {}) =>
  page.evaluate(
    async ([action, input]) => {
      const csrf =
        document.cookie
          .split(";")
          .map((p) => p.trim().split("="))
          .find(([k]) => k === "__Host-focustime-csrf")
          ?.slice(1)
          .join("=") ?? "";
      const r = await fetch("/api/action", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf": csrf },
        body: JSON.stringify({ action, input }),
      });
      const body = (await r.json()) as {
        ok: boolean;
        data?: unknown;
        error?: string;
      };
      if (!body.ok) throw new Error(`${action}: ${body.error}`);
      return body.data as any;
    },
    [action, input] as const,
  );
// The demo's own fictional transcript (the demo's AI answers it with its sample proposals).
const VTT = demoMeetingVtt();
const upload = (page: Page, series: number, date: string) =>
  page.evaluate(
    async ([series, date, vtt]) => {
      const csrf =
        document.cookie
          .split(";")
          .map((p) => p.trim().split("="))
          .find(([k]) => k === "__Host-focustime-csrf")
          ?.slice(1)
          .join("=") ?? "";
      const r = await fetch(
        `/api/meetings/upload?series=${series}&date=${date}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "text/vtt", "x-csrf": csrf },
          body: vtt,
        },
      );
      const body = (await r.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new Error(`upload: ${body.error}`);
    },
    [series, date, VTT] as const,
  );
const at = (d: string, t: string) => `${d}T${t}:00-05:00`;
const utc = (d: string, t: string) => new Date(at(d, t)).toISOString();

/** This browser's copy of the week: shift one meeting, or add fictional ones to a block. */
type Edit = {
  move?: { title: string; minutes: number };
  add?: { date: string; half: "AM" | "PM"; items: [string, string, string][] };
};
async function editWeek(page: Page, edit: Edit) {
  await page.route("**/api/action", async (route: Route) => {
    if (!(route.request().postData() ?? "").includes('"week.load"'))
      return route.fallback();
    const res = await route.fetch();
    const j = (await res.json()) as any;
    const days = j?.data?.week?.days ?? [];
    const shift = (iso: string, m: number) =>
      new Date(Date.parse(iso) + m * 60_000)
        .toISOString()
        .replace(/\.000Z$/, "Z");
    for (const d of days)
      for (const s of [d.am, d.pm, d.eve].filter(Boolean)) {
        if (edit.move)
          for (const p of s.events)
            if (p.event.title === edit.move.title) {
              p.event = {
                ...p.event,
                start: shift(p.event.start, edit.move.minutes),
                end: shift(p.event.end, edit.move.minutes),
              };
              p.clipStart = shift(p.clipStart, edit.move.minutes);
              p.clipEnd = shift(p.clipEnd, edit.move.minutes);
            }
        if (edit.add && d.date === edit.add.date && s.half === edit.add.half)
          for (const [title, from, to] of edit.add.items) {
            const e = {
              id: `outlook:shot-${title}`,
              source: "outlook",
              title,
              start: at(d.date, from),
              end: at(d.date, to),
              allDay: false,
              showAs: "busy",
              isPersonal: false,
              responseStatus: "accepted",
            };
            s.events.push({
              event: e,
              clipStart: utc(d.date, from),
              clipEnd: utc(d.date, to),
              minutesInside: 30,
              continuesBefore: false,
              continuesAfter: false,
            });
          }
      }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(j),
    });
  });
}

describe.skipIf(!out)("WK-6 screenshots", () => {
  it("takes them", async () => {
    mkdirSync(out, { recursive: true });
    const harness = await startDemo(
      "chromium",
      {},
      "2026-11-04T15:00:00-05:00",
    );
    const errors: string[] = [];
    const runs = [
      {
        tag: "1440",
        vp: { width: 1440, height: 900 },
        size: "default",
        scheme: "dark",
      },
      {
        tag: "1280",
        vp: { width: 1280, height: 720 },
        size: "default",
        scheme: "dark",
      },
      {
        tag: "1440-larger",
        vp: { width: 1440, height: 900 },
        size: "larger",
        scheme: "dark",
      },
      {
        tag: "1440-light",
        vp: { width: 1440, height: 900 },
        size: "default",
        scheme: "light",
      },
    ] as const;
    try {
      for (const run of runs) {
        for (const variant of run.tag === "1440"
          ? (["plain", "six", "moved"] as const)
          : (["plain"] as const)) {
          const ctx = await harness.browser.newContext({
            viewport: run.vp,
            colorScheme: run.scheme,
            reducedMotion: "reduce",
            ignoreHTTPSErrors: true,
          });
          await ctx.addInitScript(() =>
            localStorage.setItem("focustime.hint.flow", "dismissed"),
          );
          const page = await ctx.newPage();
          page.on(
            "pageerror",
            (e) =>
              !/WebSocket/.test(e.message) &&
              errors.push(`${run.tag}: ${e.message}`),
          );
          if (variant === "six")
            await editWeek(page, {
              add: {
                date: "2026-11-04",
                half: "AM",
                items: [
                  ["Harbor intake review", "10:00", "10:30"],
                  ["Atlas data sync", "11:00", "11:30"],
                  ["Expense report check-in", "11:45", "12:15"],
                ],
              },
            });
          if (variant === "moved")
            await editWeek(page, {
              move: { title: "Northwind requirements workshop", minutes: 60 },
            });
          await page.goto(harness.url);
          await page.getByText(/Try the demo/).click({ timeout: 60_000 });
          await page.waitForSelector(".demo-tag", { timeout: 60_000 });
          await page.waitForSelector(".brand-stage", {
            state: "detached",
            timeout: 30_000,
          });
          await act(page, "ui.set_theme", {
            theme:
              run.scheme === "dark" ? "cooptimize-dark" : "cooptimize-light",
          });
          await act(page, "ui.set_text_size", { size: run.size });
          await act(page, "ui.set_show_timelines", { show: false });
          await act(page, "ui.set_today_timeline", { show: false });
          {
            // Each demo session keeps its own calls, so every one is seeded.
            const W = "2026-11-04";
            const start = (
              id: string,
              d: string,
              a: string,
              b: string,
              clientKey: string,
            ) =>
              act(page, "meeting.call_start", {
                key: `demo-ical-demo-${id}-${d}`,
                startAt: utc(d, a),
                endAt: utc(d, b),
                clientKey,
              });
            await start("standup2", W, "09:00", "09:15", "Cooptimize");
            const shop = await start(
              "nwshop",
              W,
              "09:30",
              "11:30",
              "Northwind",
            );
            const lunch = await start(
              "lunch",
              W,
              "12:00",
              "12:45",
              "Cooptimize",
            );
            await start("atref", "2026-11-03", "13:00", "14:00", "Atlas");
            if (!before)
              await act(page, "meeting.call_add", {
                name: "Harbor hallway chat",
                date: W,
                start: "14:00",
                minutes: 20,
                clientKey: "Harbor",
              });
            const mine = await act(page, "meeting.mine");
            const seriesOf = (occ: number) =>
              mine.occurrences.find((o: any) => o.id === occ)
                .seriesId as number;
            await upload(page, seriesOf(shop.occurrenceId), W);
            await upload(page, seriesOf(lunch.occurrenceId), W);
            const rv = await act(page, "meeting.review", {
              occurrenceId: lunch.occurrenceId,
            });
            for (const p of rv.proposals)
              await act(page, "meeting.edit", { proposalId: p.id, skip: true });
          }
          const base = harness.url.split("#")[0]!;
          const go = async (hash: string, keep = false) => {
            if (!keep)
              await page.evaluate(() =>
                localStorage.removeItem("focustime.week.meetings"),
              );
            await page.goto(`${base}${hash}`);
            await page.reload();
            await page.waitForSelector(".topbar", { timeout: 30_000 });
            await page.waitForTimeout(1200);
          };
          const shot = (name: string) =>
            page.screenshot({ path: `${out}/wk6-${name}-${run.tag}.png` });
          const block = (date: string, half: string) =>
            page.locator(`[data-drop="${date}:${half}"]`).first();

          if (variant === "six") {
            await go("#/week");
            await block("2026-11-04", "AM").screenshot({
              path: `${out}/wk6-six-meetings-${run.tag}.png`,
            });
            await ctx.close();
            continue;
          }
          if (variant === "moved") {
            await go("#/week");
            await block("2026-11-04", "AM").screenshot({
              path: `${out}/wk6-moved-${run.tag}.png`,
            });
            await ctx.close();
            continue;
          }
          await go("#/week");
          await shot("week");
          if (run.tag === "1440") {
            await block("2026-11-04", "AM").screenshot({
              path: `${out}/wk6-focus-am-${run.tag}.png`,
            });
            await block("2026-11-04", "PM").screenshot({
              path: `${out}/wk6-focus-pm-${run.tag}.png`,
            });
            const sw = page.locator(".meetings-switch");
            if (await sw.count()) {
              await sw.click();
              await page.waitForTimeout(600);
              await shot("week-switch-on");
              await sw.click();
              await page.waitForTimeout(400);
            }
            // Another day in focus (the panel on Friday): today folds to its one line.
            await page.getByText("Catch-up", { exact: true }).first().click();
            await page.waitForTimeout(900);
            await shot("other-focus");
            await block("2026-11-04", "AM").screenshot({
              path: `${out}/wk6-folded-two-${run.tag}.png`,
            });
            await block("2026-11-04", "PM").screenshot({
              path: `${out}/wk6-folded-one-${run.tag}.png`,
            });
            // The block panel on Wednesday AM, its line and its agenda open.
            await go("#/week");
            await block("2026-11-04", "AM")
              .locator(".card-head")
              .first()
              .click();
            await page.waitForTimeout(900);
            await shot("panel");
            const line = page.locator(".block-panel .bp-meet-line");
            if (await line.count()) {
              await line.click();
              await page.waitForTimeout(500);
              await page
                .locator(".block-panel .bp-meetings")
                .scrollIntoViewIfNeeded();
              await shot("panel-agenda");
            }
            await go("#/today/2026-11-04");
            await shot("day");
          }
          await ctx.close();
        }
      }
    } finally {
      await harness.stop();
    }
    if (errors.length) throw new Error(errors.join("\n"));
  }, 1_800_000);
});
