// TB-1: the quick commands on the demo's own week (week.load through the action context, as the bot's reader does):
// what's next and today say what Today says, from the same rule (plan/now.ts), with links into the app.
import { expect, it } from "vitest";
import { dispatch } from "../../actions/dispatch.ts";
import type { WeekLoadData } from "../../actions/types.ts";
import { createDemoContext, seedDemo } from "../demo.ts";
import { nowStrip } from "../../plan/now.ts";
import { nextCard, quickOf, todayCard, todayFacts } from "./quick.ts";

const NOW = "2026-11-02T15:30:00Z";
const URL_ = "https://ft-dev-app.example.azurecontainerapps.io";

it("knows the quick commands in everyday words, and nothing else", () => {
  expect(["What's next?", "whats next", "next", "WHAT IS NEXT"].map(quickOf)).toEqual(["next", "next", "next", "next"]);
  expect(["today", "Today!", "my day"].map(quickOf)).toEqual(["today", "today", "today"]);
  expect(["help", "?", "commands"].map(quickOf)).toEqual(["help", "help", "help"]);
  expect(["open FocusTime", "Open Focus Time", "<at>FocusTime</at> open"].map(quickOf)).toEqual(["open", "open", "open"]);
  expect(["what's next week look like", "move my 2pm", "today I want to do the export", ""].map(quickOf)).toEqual([null, null, null, null]);
});

it("what's next and today come from the loaded week, the way Today shows them", async () => {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  const r = await dispatch(ctx, { action: "week.load", input: {} });
  expect(r.ok).toBe(true);
  const data = (r as { ok: true; data: WeekLoadData }).data;
  const f = todayFacts(data, Temporal.Instant.from(NOW));
  expect(f.date).toBe(Temporal.Instant.from(NOW).toZonedDateTimeISO(data.hours.timeZone).toPlainDate().toString());
  // The same strip Today computes from the same week.
  const day = data.week.days.find((x) => x.date === f.date) ?? null;
  expect(f.strip.title).toBe(nowStrip({ now: Temporal.Instant.from(NOW).toZonedDateTimeISO(data.hours.timeZone), day, picks: data.plan?.[f.date]?.picks ?? [], committed: !!data.plan?.[f.date]?.committedAt, pto: data.ptoAhead.includes(f.date), nextWorkday: null, clientName: (k) => data.planClients.find((c) => c.clientKey === k)?.clientName ?? k, sizes: data.planning.sizes, timeboxes: data.timeboxes }).title);
  const next = nextCard(f, URL_);
  expect(next.links?.[0]?.url).toBe(`${URL_}/#/today`);
  expect(next.lines?.length).toBeGreaterThan(0);
  const today = todayCard(f, URL_);
  expect(today.title).toBe("Today");
  expect(f.blocks.length).toBeGreaterThan(0);
  for (const b of f.blocks) expect(today.lines?.some((l) => l.includes(b.client ?? "Open"))).toBe(true);
});
