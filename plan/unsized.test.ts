// SZ-1: unsized work counts as one value, the person's (Settings › Planning, 1h by default). Each place that used to
// assume 2h is checked at the default and at 2h, and a scan keeps new copies of the number from appearing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN } from "../config/schema.ts";
import { aFocusBlock, aClient, aWeek, aWeekFeature } from "../test/builders/index.ts";
import { DEFAULT_MIN_SIZES, didntFitText, planMyDay } from "./agenda.ts";
import { reviewTotal } from "./breakdown.ts";
import { DEFAULT_SIZE_SCALE, DEFAULT_UNSIZED_MINUTES, estimate, namedSize, plannedMinutesOf, sizeChipText, storyMinutes, UNSIZED_CHOICES, unsizedText, validUnsizedMinutes, type SizeScale } from "./estimate.ts";
import { gapsOf, type GapItem } from "./fixnext.ts";
import { focusLabel, dayFocus } from "./focus.ts";
import { timeChoices } from "./picktime.ts";
import { reach } from "./reach.ts";
import { plannedMinutes } from "./rules.ts";
import { nextFreeSpan } from "./timeline.ts";
import { suggestMinutes } from "./timer.ts";
import { pickNeed, sizeMinutes, SIZE_MINUTES, type Pick } from "./types.ts";
import { progress } from "./weeklist.ts";
import { weekBudget } from "./weekplan.ts";
import { slotPlanned } from "./timebox.ts";

const scale = (unsized: number): SizeScale => ({ ...DEFAULT_SIZE_SCALE, unsized });
const ONE = scale(60), TWO = scale(120), HALF = scale(30), THREE = scale(180);
const iso = (t: string) => `2026-11-03T${t}:00-05:00`;
const slot = { date: "2026-11-03", half: "AM", start: iso("08:00"), end: iso("12:00"), windows: [{ start: iso("08:00"), end: iso("12:00") }], freeGaps: [{ start: iso("08:00"), end: iso("12:00"), minutes: 240 }], focus: [], busyMeetingMinutes: 0, pto: false, off: false } as never;
const pick = (o: Partial<Pick> = {}): Pick => ({ id: 1, date: "2026-11-03", half: "AM", clientKey: "k", kind: "item", itemId: 7, title: "A story", size: null, status: "planned", position: 0, ...o }) as Pick;

describe("the single source (SZ-1)", () => {
  it("the default is 1h, one value, in the plan defaults too", () => {
    expect(DEFAULT_UNSIZED_MINUTES).toBe(60);
    expect(DEFAULT_SIZE_SCALE.unsized).toBe(60);
    expect(SIZE_MINUTES).toBe(DEFAULT_SIZE_SCALE);
    expect(DEFAULT_PLAN.sizes).toBe(DEFAULT_SIZE_SCALE);
    expect(UNSIZED_CHOICES).toEqual([30, 60, 120, 180]);
    expect([30, 60, 120, 180].every(validUnsizedMinutes)).toBe(true);
    expect([0, 45, 90, 240, "60", null].some(validUnsizedMinutes)).toBe(false);
  });
  it("no other code holds the assumption: no size lookup falls back to M, no hard-coded chip or 2h note", () => {
    const skip = new Set(["node_modules", "dist", ".git", "docs", "e2e", "fixtures", "test"]);
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (skip.has(n)) continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
      }
    };
    walk(".");
    const banned = [/[sS]izes\??\.?\[[\w.]*size \?\? "M"\]/, /\[[\w.]*size \?\? "M"\]/, /\bsizes\.M\b/, /"Size\? · \d/, /not sized, 2h/, /counts as 2h/, /UNSIZED_MINUTES = (?!60\b)/, /\?\? 120\)/];
    const comment = /^\s*(\/\/|\/\*|\*)/;
    const hits = files.flatMap((f) => readFileSync(f, "utf8").split("\n").flatMap((l, i) => (!comment.test(l) && banned.some((b) => b.test(l)) ? [`${f}:${i + 1}`] : [])));
    expect(hits).toEqual([]);
  });
});

describe("every place reads the setting (1h by default, then 2h)", () => {
  const places: [string, (s: SizeScale) => unknown, unknown, unknown][] = [
    ["storyMinutes", (s) => storyMinutes(null, s), 60, 120],
    ["sizeMinutes (assistant context)", (s) => sizeMinutes(null, s), 60, 120],
    ["pickNeed", (s) => pickNeed(pick(), s), 60, 120],
    ["a to-do's own minutes still win", (s) => pickNeed(pick({ minutes: 30 } as Partial<Pick>), s), 30, 30],
    ["plannedMinutes (Today and Plan fit)", (s) => plannedMinutes([pick()], s), 60, 120],
    ["slotPlanned (block fit)", (s) => slotPlanned([pick()], s, [], { date: "2026-11-03", start: iso("08:00"), end: iso("12:00") }), 60, 120],
    ["dayFocus (Close out)", (s) => dayFocus([pick()], {}, s).plannedMinutes, 60, 120],
    ["suggestMinutes (Start focus)", (s) => suggestMinutes(null, s), 60, 120],
    ["the chip", (s) => sizeChipText(null, s), "Size? · 1h", "Size? · 2h"],
    ["focusLabel", (s) => focusLabel(45 * 60, null, s), "45m of 1h", "45m of 2h"],
    ["didn't fit", (s) => didntFitText([{ title: "A", size: null }], s), "1 to-do didn't fit: A (not sized, 1h).", "1 to-do didn't fit: A (not sized, 2h)."],
    ["Break down's total", (s) => reviewTotal([{ keep: true, size: null }, { keep: true, size: "S" }], s), "2 items · about 2h", "2 items · about 3h"],
    ["a feature's load (Plan the week)", (s) => estimate([{ clientKey: "k", itemId: 1, level: "feature", tier: "must", estimate: null }, { clientKey: "k", itemId: 2, level: "story", tier: "must", estimate: null, size: "L", parentId: 1 }, { clientKey: "k", itemId: 3, level: "story", tier: "must", estimate: null, size: null, parentId: 1 }], s).envelopes[0]!.minutes, 300, 360],
    ["a loose story (budget)", (s) => plannedMinutesOf(estimate([{ clientKey: "k", itemId: 2, level: "story", tier: "must", estimate: null, size: null }], s), "k", "must"), 60, 120],
    ["progress (Week)", (s) => progress([{ clientKey: "k", itemId: 2, tier: "must", estimate: null, level: "story", size: null, parentId: null }], () => false, s)[0]!.leftMinutes, 60, 120],
    ["can't reach the target (Ahead)", (s) => reach({ unsizedMinutes: s.unsized, target: "2026-11-06", today: "2026-11-02", me: "me@example.com", weeks: [{ weekStart: "2026-11-02", freeMinutes: 300 }], months: [], stories: [{ assigneeEmail: "me@example.com", assigneeName: "Me", minutes: null }] }), { kind: "ok", needMinutes: 60, freeMinutes: 300 }, { kind: "ok", needMinutes: 120, freeMinutes: 300 }],
    ["Timebox my day", (s) => planMyDay([pick()], { AM: slot }, [], s, new Set(), undefined, DEFAULT_MIN_SIZES).placed.map((p) => p.end.slice(11, 16)), ["09:00"], ["10:00"]],
    ["T on the timeline (nextFreeSpan)", (s) => { const x = nextFreeSpan(slot, [], { id: 1, size: null }, s, undefined, DEFAULT_MIN_SIZES)!; return x.end.slice(11, 16); }, "09:00", "10:00"],
    ["+ time's choices", (s) => timeChoices(slot, [], { id: 1, size: null }, s, undefined, DEFAULT_MIN_SIZES)[0]!.minutes, 60, 120],
  ];
  it.each(places)("%s", (_n, run, one, two) => {
    expect(run(ONE)).toEqual(one);
    expect(run(TWO)).toEqual(two);
  });

  it("the week's budget and its over line follow the setting", () => {
    const week = aWeek({ patterns: [aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Tue: "AM" } })] });
    const items = [aWeekFeature({ itemId: 1, level: "story", estimate: null, size: null, parentId: null }), aWeekFeature({ itemId: 2, level: "story", estimate: null, size: null, parentId: null })];
    const planned = (s: SizeScale) => weekBudget(week, items, { sizes: s, borrowedMinutes: {} }).find((b) => b.clientKey === "adatum")!.plannedMinutes;
    expect(planned(ONE)).toBe(120);
    expect(planned(TWO)).toBe(240);
  });

  it("the words: 30 min is the only value that isn't whole hours; a sized chip doesn't move", () => {
    expect([HALF, ONE, TWO, THREE].map(unsizedText)).toEqual(["30 min", "1h", "2h", "3h"]);
    expect(sizeChipText(null, HALF)).toBe("Size? · 30 min");
    expect(["S", "M", "L"].map((z) => sizeChipText(z as "S", TWO))).toEqual(["S · 1h", "M · 2h", "L · 4h"]);
  });

  it("where a size has to be named, unsized is the smallest size that holds the assumption", () => {
    expect([HALF, ONE, TWO, THREE].map((s) => namedSize(null, s))).toEqual(["XS", "S", "M", "L"]);
    expect(namedSize("L", ONE)).toBe("L");
  });

  it("a 30 minute assumption is never asked for a longer stretch than it needs", () => {
    const narrow = { ...(slot as object), freeGaps: [{ start: iso("08:00"), end: iso("08:30"), minutes: 30 }], windows: [{ start: iso("08:00"), end: iso("08:30") }], end: iso("08:30") } as never;
    expect(timeChoices(narrow, [], { id: 1, size: null }, HALF, undefined, { XS: 15, S: 60, M: 60, L: 90 }).map((c) => c.minutes)).toEqual([30]);
    expect(didntFitText([{ title: "A", size: null }], HALF)).toBe("1 to-do didn't fit: A (not sized, 30 min).");
  });
});

describe("Readiness is about DevOps, not this setting", () => {
  it("an unsized DevOps item stays Unsized: the gap reads the item's own size field", () => {
    const item: GapItem = { clientKey: "k", id: 1, open: true, needsBreakdown: false, openChildren: 1, startField: "S", targetField: "T", sizeField: "Z", child: true, assigneeField: true, canEdit: true, start: "2026-11-02", target: "2026-11-06", size: null, assigneeEmail: "a@example.com" } as unknown as GapItem;
    expect(gapsOf(item)).toEqual(["unsized"]);
    expect(gapsOf({ ...item, size: 3 } as GapItem)).toEqual([]);
  });
});
