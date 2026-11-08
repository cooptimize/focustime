// SR-3: the pure rules: who "worked on" a feature (each kind of contribution, and what clears the badge), the plain
// template with AI off, the nudge counting Needs your update first, holidays among the team's PTO, and the inline
// lines (Enter, Esc, what's pending, stack rank).
import { describe, expect, it } from "vitest";
import { aReportItem } from "../test/builders/index.ts";
import { closeLine, enterLine, needsLabel, pendingLabel, pendingLines, previewFeatures, byRank, type Line } from "../ui/status-lines.ts";
import { contributionLine, contributions, needsMyUpdate, nudgeLineFor, templateLine, upcomingRows, type ContributionInput } from "./status-report.ts";
import { notices, parseRoute } from "./notify.ts";

const SINCE = "2026-11-02T12:04:00Z";
const ME = "me@contoso.example";
const feature = aReportItem({ id: 100, title: "Order history export" });
const s1 = aReportItem({ id: 101, level: "child", parentId: 100, title: "CSV export", assigneeEmail: "other@contoso.example" });
const s2 = aReportItem({ id: 102, level: "child", parentId: 100, title: "Date filter" });
const task = aReportItem({ id: 103, level: "child", parentId: 101, title: "Write the query", type: "Task" });
const other = aReportItem({ id: 200, title: "Loyalty points" });
const s3 = aReportItem({ id: 201, level: "child", parentId: 200, title: "Points page", assigneeEmail: ME });
const epic = aReportItem({ id: 900, level: "top", title: "Epic" });

const input = (o: Partial<ContributionInput> = {}): ContributionInput => ({
  items: [epic, feature, s1, s2, task, other, s3],
  myEmails: new Set([ME]),
  since: SINCE,
  activity: [],
  todos: [],
  timeboxes: [],
  created: [],
  featureComments: new Set(),
  ...o,
});

describe("You worked on this: the contribution rule (SR-3)", () => {
  it("nothing of mine: no feature", () => {
    expect([...contributions(input()).keys()]).toEqual([]);
  });
  it("a story assigned to me that DevOps changed since the watermark counts; one untouched since doesn't", () => {
    const before = input({ items: [feature, other, { ...s3, changedAt: "2026-10-30T10:00:00Z" }] });
    expect(contributions(before).size).toBe(0);
    const after = contributions(input({ items: [feature, other, { ...s3, changedAt: "2026-11-03T10:00:00Z" }] }));
    expect(after.get(200)).toEqual({ kinds: ["assigned"], stories: [{ id: 201, title: "Points page" }] });
  });
  it("my state change or comment on a story (DV-1's rows marked mine), at any depth under the feature; others' don't", () => {
    const c = contributions(input({ activity: [
      { itemId: 103, kind: "state", changedAt: "2026-11-03T10:00:00Z", mine: true },
      { itemId: 102, kind: "comments", changedAt: "2026-11-04T10:00:00Z", mine: true },
      { itemId: 201, kind: "state", changedAt: "2026-11-04T10:00:00Z", mine: false },
      { itemId: 101, kind: "state", changedAt: "2026-10-30T10:00:00Z", mine: true },
    ] }));
    expect([...c.keys()]).toEqual([100]);
    expect(c.get(100)).toEqual({ kinds: ["state", "comment"], stories: [{ id: 102, title: "Date filter" }, { id: 103, title: "Write the query" }] });
  });
  it("a story I created, a to-do or a timebox of mine, and my comment on the feature itself", () => {
    const c = contributions(input({ created: [102], todos: [201], timeboxes: [100], featureComments: new Set([200]) }));
    expect(c.get(100)!.kinds).toEqual(["created", "time"]);
    expect(c.get(200)!.kinds).toEqual(["todo", "feature_comment"]);
    expect(contributionLine(c.get(200)!)).toBe("1 story · your to-dos");
    expect(contributionLine(c.get(100)!)).toBe("1 story · time on your calendar");
  });
  it("an item outside any feature (an epic, or unknown) is ignored", () => {
    expect(contributions(input({ todos: [900, 12345] })).size).toBe(0);
  });
  it("Needs your update until I comment on the feature in the window; nothing worked on, no badge", () => {
    const c = contributions(input({ todos: [102] })).get(100);
    expect(needsMyUpdate(c, false)).toBe(true);
    expect(needsMyUpdate(c, true)).toBe(false);
    expect(needsMyUpdate(undefined, false)).toBe(false);
  });
  it("with AI off: Worked on: <story titles>, four at most", () => {
    const c = contributions(input({ todos: [101, 102, 103] })).get(100)!;
    expect(templateLine(c, "Order history export")).toBe("Worked on: CSV export, Date filter, Write the query");
    expect(templateLine({ kinds: ["feature_comment"], stories: [] }, "Order history export")).toBe("Worked on: Order history export");
    const many = { kinds: ["todo" as const], stories: [1, 2, 3, 4, 5, 6].map((id) => ({ id, title: `S${id}` })) };
    expect(templateLine(many, "F")).toBe("Worked on: S1, S2, S3, S4 and 2 more");
  });
});

describe("the nudge counts Needs your update first (SR-3)", () => {
  it("the line", () => {
    expect(nudgeLineFor(3, 0)).toBe("3 features you worked on need an update for Monday");
    expect(nudgeLineFor(1, 2)).toBe("1 feature you worked on needs an update for Monday · 2 more have no update yet");
    expect(nudgeLineFor(0, 2)).toBe("2 features have no update yet for Monday's report");
  });
  it("tapping it opens the report on Needs your update", () => {
    const n = notices.statusReport("status_report:2026-11-06", nudgeLineFor(3, 0), "2026-11-06T20:00:00Z", true);
    expect(parseRoute(n.route)).toEqual({ view: "status_needs" });
    expect(n.buttons[0]!.label).toBe("Open Needs your update");
    expect(parseRoute(notices.statusReport("k", "x", "2026-11-06T20:00:00Z").route)).toEqual({ view: "status" });
  });
});

describe("holidays among the team's PTO (SR-3)", () => {
  it("date order, a holiday before people on the same day, runs of days for people", () => {
    const rows = upcomingRows([{ name: "Sam", date: "2026-11-12" }, { name: "Sam", date: "2026-11-13" }, { name: "Ada", date: "2026-11-12" }], [{ date: "2026-11-12", label: "Founders Day (observed)" }, { date: "2026-11-10", label: "Holiday" }]);
    expect(rows.map((r) => `${r.kind}:${r.name} · ${r.when}`)).toEqual(["holiday:Holiday · Tue, Nov 10", "holiday:Founders Day (observed) · Thu, Nov 12", "pto:Ada · Thu, Nov 12", "pto:Sam · Thu, Nov 12 to Fri, Nov 13"]);
  });
});

describe("inline lines (SR-3)", () => {
  const L = (o: Partial<Line>): Line => ({ key: "a", clientKey: "c", itemId: 1, kind: "comment", commentId: null, text: "", from: "me", ...o });
  it("Enter on a line with text keeps it and opens the next empty one under it; on an empty one it stays", () => {
    const r = enterLine([L({ key: "a", text: "Merged" }), L({ key: "z", itemId: 2, text: "x" })], "a", "b");
    expect(r.open).toBe("b");
    expect(r.lines.map((l) => [l.key, l.itemId, l.text])).toEqual([["a", 1, "Merged"], ["b", 1, ""], ["z", 2, "x"]]);
    expect(enterLine([L({ key: "a", text: "  " })], "a", "b")).toEqual({ lines: [L({ key: "a", text: "  " })], open: "a" });
    expect(enterLine([L({ key: "e", kind: "comment_edit", commentId: 5, text: "y" })], "e", "b").open).toBeNull();
  });
  it("Esc closes: an empty line goes, an edit that changes nothing goes, the rest stays pending", () => {
    const lines = [L({ key: "a" }), L({ key: "b", text: "keep" }), L({ key: "e", kind: "comment_edit", commentId: 5, text: "same" })];
    const cur = (id: number) => (id === 5 ? "same" : null);
    expect(closeLine(lines, "a", cur).map((l) => l.key)).toEqual(["b", "e"]);
    expect(closeLine(lines, "b", cur).map((l) => l.key)).toEqual(["a", "b", "e"]);
    expect(closeLine(lines, "e", cur).map((l) => l.key)).toEqual(["a", "b"]);
  });
  it("the header counts what Push all would write", () => {
    const lines = [L({ key: "a" }), L({ key: "b", text: "one" }), L({ key: "c", text: "two" }), L({ key: "e", kind: "comment_edit", commentId: 5, text: "same" }), L({ key: "d", kind: "comment_delete", commentId: 6, text: "old" })];
    const n = pendingLines(lines, (id) => (id === 5 ? "same" : "old")).length;
    expect(n).toBe(3);
    expect(pendingLabel(n)).toBe("3 lines to push");
    expect(pendingLabel(1)).toBe("1 line to push");
    expect(needsLabel(3)).toBe("3 features need your update");
  });
  it("an added feature with a pending line takes its stack-rank place in Preview", () => {
    const inReport = [{ id: 10, order: 2 }, { id: 11, order: 5 }];
    const others = [{ id: 12, order: 3 }, { id: 13, order: 1 }];
    expect(previewFeatures(inReport, others, [L({ itemId: 12, text: "hi" })]).map((f) => f.id)).toEqual([10, 12, 11]);
    expect([{ id: 3 }, { id: 2, order: 9 }, { id: 1, order: 9 }].sort(byRank).map((f) => f.id)).toEqual([1, 2, 3]);
  });
});
