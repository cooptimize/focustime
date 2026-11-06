import { describe, expect, it } from "vitest";
import { aReportComment, aReportItem } from "../test/builders/index.ts";
import { countLine, hintLines, lastKatRun, nextKatRun, nextStatusNudge, reportCounts, reportWindow, selectFeatures, sortComments, statusNudgeDue, DEFAULT_STATUS_NUDGE } from "./status-report.ts";
import { DEFAULT_NOTIFY, gate, notices, parseRoute, type GateFacts } from "./notify.ts";

const I = (s: string) => Temporal.Instant.from(s);

describe("the report window", () => {
  it("falls back to the most recent Monday 7:00 AM in New York (EST in November)", () => {
    // Thursday Nov 5, 2026: Monday Nov 2 at 7:00 EST is 12:00 UTC.
    expect(lastKatRun(I("2026-11-05T15:00:00Z")).toString()).toBe("2026-11-02T12:00:00Z");
    expect(nextKatRun(I("2026-11-05T15:00:00Z")).toString()).toBe("2026-11-09T12:00:00Z");
  });
  it("on Monday before 7:00 ET the window is still last week's", () => {
    expect(lastKatRun(I("2026-11-09T11:59:00Z")).toString()).toBe("2026-11-02T12:00:00Z");
    expect(lastKatRun(I("2026-11-09T12:00:00Z")).toString()).toBe("2026-11-09T12:00:00Z");
  });
  it("follows daylight saving: 7:00 EDT is 11:00 UTC", () => {
    expect(lastKatRun(I("2026-10-28T15:00:00Z")).toString()).toBe("2026-10-26T11:00:00Z");
  });
  it("uses Kat's own last send when it is sensible", () => {
    const w = reportWindow("2026-11-02T12:04:31Z", I("2026-11-05T15:00:00Z"));
    expect(w).toMatchObject({ since: "2026-11-02T12:04:31Z", source: "kat", katSentAt: "2026-11-02T12:04:31Z", prevSince: "2026-10-26T12:04:31Z" });
  });
  it("ignores a send in the future, an old one, or nonsense", () => {
    const now = I("2026-11-05T15:00:00Z");
    expect(reportWindow("2026-11-06T12:00:00Z", now).source).toBe("fallback");
    expect(reportWindow("2026-08-01T12:00:00Z", now).source).toBe("fallback");
    expect(reportWindow("not a date", now)).toMatchObject({ source: "fallback", katSentAt: null, since: "2026-11-02T12:00:00Z" });
    expect(reportWindow(null, now).source).toBe("fallback");
  });
});

describe("comments in the window", () => {
  const w = { since: "2026-11-02T12:04:00Z", prevSince: "2026-10-26T12:04:00Z" };
  const mine = (u: string | null) => u === "me@contoso.example";
  it("a comment just before the watermark is last week's, just after is this week's", () => {
    const before = aReportComment({ createdAt: "2026-11-02T12:03:59Z" });
    const after = aReportComment({ createdAt: "2026-11-02T12:04:00Z" });
    const r = sortComments([after, before], w, mine, true);
    expect(r.thisWeek.map((c) => c.id)).toEqual([after.id]);
    expect(r.lastWeek.map((c) => c.id)).toEqual([before.id]);
  });
  it("counts by modified date, as Kat does: an old comment edited this week is in", () => {
    const edited = aReportComment({ createdAt: "2026-10-20T10:00:00Z", modifiedAt: "2026-11-03T10:00:00Z" });
    expect(sortComments([edited], w, mine, true).thisWeek).toHaveLength(1);
  });
  it("only my own comments in the window are editable; teammates' and Coop's never are", () => {
    const own = aReportComment({ authorUnique: "me@contoso.example", createdAt: "2026-11-03T10:00:00Z" });
    const team = aReportComment({ createdAt: "2026-11-03T11:00:00Z" });
    const coop = aReportComment({ authorUnique: "me@contoso.example", text: "[Coop update v1]\nTwo stories merged", createdAt: "2026-11-03T12:00:00Z" });
    const old = aReportComment({ authorUnique: "me@contoso.example", createdAt: "2026-10-30T12:00:00Z" });
    const r = sortComments([own, team, coop, old], w, mine, true);
    expect(r.thisWeek.map((c) => [c.who, c.editable])).toEqual([["mine", true], ["teammate", false], ["coop", false]]);
    expect(r.lastWeek.map((c) => [c.who, c.editable])).toEqual([["mine", false]]);
    // Without write access to the client, nothing is editable.
    expect(sortComments([own], w, mine, false).thisWeek[0]!.editable).toBe(false);
  });
});

describe("which features", () => {
  const me = new Set(["me@contoso.example"]);
  it("planned and touched are shown; assigned and untouched are folded; in backlog order", () => {
    const planned = aReportItem({ order: 30 });
    const touched = aReportItem({ order: 10 });
    const story = aReportItem({ level: "child", parentId: touched.id });
    const assigned = aReportItem({ assigneeEmail: "Me@contoso.example" });
    const other = aReportItem({ assigneeEmail: "dana@contoso.example" });
    const closedMine = aReportItem({ assigneeEmail: "me@contoso.example", stateCategory: "Completed" });
    const r = selectFeatures({ items: [planned, touched, story, assigned, other, closedMine], planned: [{ itemId: planned.id, level: "feature", parentId: null }], picked: [story.id], changed: [], myEmails: me });
    expect(r.shown.map((s) => [s.item.id, s.why])).toEqual([[touched.id, "touched"], [planned.id, "planned"]]);
    expect(r.also.map((s) => s.item.id)).toEqual([assigned.id]);
  });
  it("a planned story brings its feature; a changed task brings its story's feature; an epic never shows", () => {
    const f = aReportItem();
    const s = aReportItem({ level: "child", parentId: f.id });
    const t = aReportItem({ level: "task", parentId: s.id });
    const f2 = aReportItem();
    const epic = aReportItem({ level: "top" });
    const r = selectFeatures({ items: [f, s, t, f2, epic], planned: [{ itemId: 999, level: "story", parentId: f2.id }, { itemId: epic.id, level: "feature", parentId: null }], picked: [], changed: [t.id], myEmails: me });
    expect(r.shown.map((x) => x.item.id).sort()).toEqual([f.id, f2.id].sort());
  });
  it("nothing from items not in this client's store", () => {
    const r = selectFeatures({ items: [], planned: [{ itemId: 5, level: "feature", parentId: null }], picked: [6], changed: [7], myEmails: me });
    expect(r).toEqual({ shown: [], also: [] });
  });
});

describe("counts, hints and the nudge", () => {
  it("counts the shown features", () => {
    expect(countLine(reportCounts([{ thisWeek: 2 }, { thisWeek: 0 }, { thisWeek: 1 }, { thisWeek: 0 }, { thisWeek: 0 }]))).toBe("5 features · 2 with an update · 3 without");
  });
  it("hint lines are plain and deduplicated", () => {
    expect(hintLines([{ kind: "state", itemId: 4, title: "Login", from: "Active", to: "Resolved" }, { kind: "done_pick", itemId: 4, title: "Login" }, { kind: "done_pick", itemId: 4, title: "Login" }])).toEqual(["#4 Login: Active → Resolved", "Done in FocusTime: #4 Login"]);
  });
  const on = { ...DEFAULT_STATUS_NUDGE, friday: true };
  const fri = { localDate: "2026-11-06", s: on, dayEnd: "17:00", pto: false, without: 3 };
  it("fires Friday from 3:00 PM with features missing updates", () => {
    expect(statusNudgeDue({ ...fri, localTime: "14:59" })).toBeNull();
    expect(statusNudgeDue({ ...fri, localTime: "15:00" })).toEqual({ occasion: "status_report:2026-11-06" });
  });
  it("comes before a day that ends early", () => {
    expect(statusNudgeDue({ ...fri, dayEnd: "14:00", localTime: "13:00" })).not.toBeNull();
    expect(statusNudgeDue({ ...fri, dayEnd: "14:00", localTime: "14:00" })).toBeNull();
  });
  it("never when all are done, on PTO, with the switch off, or another day", () => {
    expect(statusNudgeDue({ ...fri, localTime: "15:30", without: 0 })).toBeNull();
    expect(statusNudgeDue({ ...fri, localTime: "15:30", pto: true })).toBeNull();
    expect(statusNudgeDue({ ...fri, localTime: "15:30", s: DEFAULT_STATUS_NUDGE })).toBeNull();
    expect(statusNudgeDue({ ...fri, localDate: "2026-11-05", localTime: "15:30" })).toBeNull();
  });
  it("Sunday evening only when turned on", () => {
    const sun = { localDate: "2026-11-08", localTime: "19:30", dayEnd: null, pto: false, without: 1 };
    expect(statusNudgeDue({ ...sun, s: on })).toBeNull();
    expect(statusNudgeDue({ ...sun, s: { ...on, sunday: true } })).toEqual({ occasion: "status_report:2026-11-08" });
  });
});

describe("SR-1: the status nudge in the notifier", () => {
  const facts = (o: Partial<GateFacts> = {}): GateFacts => ({ settings: { ...DEFAULT_NOTIFY, kinds: { ...DEFAULT_NOTIFY.kinds, status_report: true } }, inHours: true, pto: false, focusRunning: false, ...o });
  it("is off until turned on; keeps its own times outside working hours; quiet on PTO; held during focus", () => {
    expect(DEFAULT_NOTIFY.kinds.status_report).toBe(false);
    expect(DEFAULT_NOTIFY.status.sunday).toBe(false);
    expect(gate("status_report", { ...facts(), settings: DEFAULT_NOTIFY })).toBe("off");
    expect(gate("status_report", facts({ inHours: false }))).toBe("send");
    expect(gate("status_report", facts({ pto: true }))).toBe("quiet");
    expect(gate("status_report", facts({ focusRunning: true }))).toBe("hold");
    expect(parseRoute(notices.statusReport("status_report:2026-11-06", "2 features have no update yet for Monday's report", "2026-11-06T20:00:00Z").route)).toEqual({ view: "status" });
  });
  it("wakes at Friday's time, inside a window in 30 minutes, and skips a sent occasion", () => {
    const end = () => "17:00";
    const on = { ...DEFAULT_STATUS_NUDGE, friday: true };
    const thu = Temporal.ZonedDateTime.from("2026-11-05T10:00[America/New_York]");
    expect(nextStatusNudge(thu, on, end, () => false)?.toString()).toBe("2026-11-06T20:00:00Z");
    const fri = Temporal.ZonedDateTime.from("2026-11-06T15:10[America/New_York]");
    expect(nextStatusNudge(fri, on, end, () => false)?.toString()).toBe("2026-11-06T20:40:00Z");
    expect(nextStatusNudge(fri, on, end, (o) => o === "status_report:2026-11-06")?.toString()).toBe("2026-11-13T20:00:00Z");
    expect(nextStatusNudge(fri, DEFAULT_STATUS_NUDGE, end, () => false)).toBeNull();
  });
});
