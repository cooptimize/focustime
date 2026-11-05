// TB-2: the rhythm's rules: each kind's time and window, the days it never goes, what waits (focus, quiet hours), the
// idle wake, the nudges and their one-an-hour limit, "capture:", close out in my words and takeovers.
import { describe, expect, it } from "vitest";
import { aWeekConfig, ZONE } from "../test/builders/index.ts";
import { captureText, DEFAULT_TEAMS_RHYTHM, doneFromWords, nextRhythmWake, nudgeAllowed, nudgeOccasion, nudges, rhythmDue, rhythmTimes, takeoversOf, type RhythmFacts, type TeamsRhythm } from "./teams-rhythm.ts";

const hours = aWeekConfig().hours; // 9:00 to 17:00, lunch 12:30, New York
const ALL: TeamsRhythm = { ...DEFAULT_TEAMS_RHYTHM, brief: true, checkin: true, closeout: true, nudges: true };
const at = (local: string) => Temporal.ZonedDateTime.from(`${local}[${ZONE}]`);
const facts = (local: string, o: Partial<RhythmFacts> = {}): RhythmFacts => ({ now: at(local), model: hours, master: true, settings: ALL, quietNow: false, pto: false, focusRunning: false, ...o });
const kinds = (f: RhythmFacts, sent: string[] = []) => rhythmDue(f, new Set(sent)).due.map((d) => d.kind);

describe("rhythm times (TB-2)", () => {
  it("brief at the day's start until the morning ends, check-in at 12:00, close out 30 minutes before the day ends", () => {
    expect(rhythmTimes(hours, "2026-11-02", ALL)).toEqual({ brief: { at: "09:00", until: "12:30" }, checkin: { at: "12:00", until: "15:00" }, closeout: { at: "16:30", until: "17:00" } });
    expect(rhythmTimes(hours, "2026-11-02", { ...ALL, briefAt: "08:00", checkinAt: "13:15", closeoutMinutes: 60 })).toEqual({ brief: { at: "09:00", until: "12:30" }, checkin: { at: "13:15", until: "15:00" }, closeout: { at: "16:00", until: "17:00" } });
  });
  it("each kind is due once inside its window, with the master switch and its own on", () => {
    expect(kinds(facts("2026-11-02T08:59"))).toEqual([]);
    expect(kinds(facts("2026-11-02T09:00"))).toEqual(["brief"]);
    expect(kinds(facts("2026-11-02T09:00"), ["brief:2026-11-02"])).toEqual([]);
    expect(kinds(facts("2026-11-02T12:40"))).toEqual(["checkin"]);
    expect(kinds(facts("2026-11-02T16:45"))).toEqual(["closeout"]);
    expect(kinds(facts("2026-11-02T17:00"))).toEqual([]);
    expect(kinds(facts("2026-11-02T09:00", { master: false }))).toEqual([]);
    expect(kinds(facts("2026-11-02T09:00", { settings: { ...ALL, brief: false } }))).toEqual([]);
  });
  it("past its window a kind is skipped (a late wake never sends a stale brief)", () => {
    expect(kinds(facts("2026-11-02T12:31"))).toEqual(["checkin"]);
    expect(kinds(facts("2026-11-02T15:30"))).toEqual([]);
  });
  it("never on weekends or PTO days; Friday only when turned on", () => {
    expect(kinds(facts("2026-11-07T09:30"))).toEqual([]);
    expect(kinds(facts("2026-11-08T09:30"))).toEqual([]);
    expect(kinds(facts("2026-11-03T09:30", { pto: true }))).toEqual([]);
    expect(kinds(facts("2026-11-06T09:30"))).toEqual([]);
    const fri = { ...hours, weekdays: { ...hours.weekdays, fri: hours.weekdays.mon } };
    expect(kinds(facts("2026-11-06T09:30", { model: fri }))).toEqual([]);
    expect(kinds(facts("2026-11-06T09:30", { model: fri, settings: { ...ALL, friday: true } }))).toEqual(["brief"]);
  });
  it("waits while focus runs or in quiet hours, and goes once that's over if the window is still open", () => {
    const f = facts("2026-11-02T09:10", { focusRunning: true });
    expect(rhythmDue(f, new Set()).waiting).toEqual([{ kind: "brief", why: "focus" }]);
    expect(kinds(f)).toEqual([]);
    expect(rhythmDue(facts("2026-11-02T09:10", { quietNow: true }), new Set()).waiting).toEqual([{ kind: "brief", why: "quiet" }]);
    expect(kinds(facts("2026-11-02T10:40"))).toEqual(["brief"]);
  });
  it("wakes the idle scheduler at the next time, in 5 minutes while one waits, nothing when off", () => {
    const base = { model: hours, master: true, settings: { ...ALL, nudges: false } };
    expect(nextRhythmWake({ ...base, now: at("2026-11-02T07:00") }, new Set(), null)?.toString()).toBe(at("2026-11-02T09:00").toInstant().toString());
    expect(nextRhythmWake({ ...base, now: at("2026-11-02T09:10") }, new Set(), null)?.toString()).toBe(at("2026-11-02T09:15").toInstant().toString());
    expect(nextRhythmWake({ ...base, now: at("2026-11-02T09:10") }, new Set(["brief:2026-11-02"]), null)?.toString()).toBe(at("2026-11-02T12:00").toInstant().toString());
    // Friday evening: Monday's brief (Friday and the weekend are skipped).
    expect(nextRhythmWake({ ...base, now: at("2026-11-06T18:00") }, new Set(), null)?.toString()).toBe(at("2026-11-09T09:00").toInstant().toString());
    expect(nextRhythmWake({ ...base, master: false, now: at("2026-11-02T07:00") }, new Set(), null)).toBeNull();
  });
});

describe("nudges (TB-2)", () => {
  const now = at("2026-11-02T15:30").toInstant();
  const dayEnd = at("2026-11-02T17:00").toInstant();
  const base = { now, today: "2026-11-02", dayEnd, promises: [], sends: [], takeovers: [] };
  it("a promise due today that's still open, about 2 hours before my day ends", () => {
    const promises = [{ key: "f1", title: "Send the notes", clientName: "Northwind", due: "2026-11-02", done: false }, { key: "f2", title: "Later", clientName: null, due: "2026-11-03", done: false }, { key: "f3", title: "Done one", clientName: null, due: "2026-11-02", done: true }];
    expect(nudges({ ...base, promises }).map((n) => n.key)).toEqual(["promise:f1"]);
    expect(nudges({ ...base, promises, now: at("2026-11-02T14:00").toInstant() })).toEqual([]);
  });
  it("a send waiting for my answer for more than half a day, and an item someone else took from me", () => {
    const sends = [{ key: "s1", title: "Export", clientName: "Northwind", waiting: true, at: at("2026-11-02T09:00").toInstant().toString(), from: "Dana" }, { key: "s2", title: "New", clientName: null, waiting: true, at: at("2026-11-02T14:00").toInstant().toString(), from: null }];
    const takeovers = [{ key: "nw-4417-9", itemId: 4417, title: "Login fix", clientName: "Northwind", byName: "Sam", at: now.toString() }];
    expect(nudges({ ...base, sends, takeovers }).map((n) => [n.kind, n.key, n.line])).toEqual([["send_waiting", "send:s1", "From Dana, waiting for your answer"], ["taken_over", "taken:nw-4417-9", "Sam assigned it to someone else"]]);
  });
  it("at most one nudge card an hour, claimed by the hour", () => {
    expect(nudgeAllowed(null, now)).toBe(true);
    expect(nudgeAllowed(now.subtract({ minutes: 59 }).toString(), now)).toBe(false);
    expect(nudgeAllowed(now.subtract({ minutes: 60 }).toString(), now)).toBe(true);
    expect(nudgeOccasion(Temporal.Instant.from("2026-11-02T20:31:00Z"))).toBe("nudges:2026-11-02T20");
  });
});

describe("capture: and close out in my words (TB-2)", () => {
  it("capture: or c:, any case, the text as typed", () => {
    expect(captureText("capture: call Dana about the export")).toBe("call Dana about the export");
    expect(captureText("C : ship it")).toBe("ship it");
    expect(captureText("Capture:")).toBe("");
    expect(captureText("can you capture this")).toBeNull();
    expect(captureText("cat: no")).toBeNull();
  });
  const picks = [{ id: 11, title: "Fix the login timeout" }, { id: 12, title: "Review the export mapping" }, { id: 13, title: "Standup notes" }];
  it("all, none, the card's numbers, or words from the titles", () => {
    expect(doneFromWords("all done", picks)).toEqual([11, 12, 13]);
    expect(doneFromWords("everything but the export", picks)).toEqual([11, 13]);
    expect(doneFromWords("the export", picks)).toEqual([12]);
    expect(doneFromWords("nothing", picks)).toEqual([]);
    expect(doneFromWords("1 and 3", picks)).toEqual([11, 13]);
    expect(doneFromWords("fixed the login timeout and the standup notes", picks)).toEqual([11, 13]);
    expect(doneFromWords("lunch", picks)).toEqual([]);
  });
  it("takeovers: my old assignment given to someone else by someone else", () => {
    const c = (o: Partial<Parameters<typeof takeoversOf>[0][number]>) => ({ id: 1, itemId: 4417, kind: "assignee", oldValue: "Ana Rivera", newValue: "Sam Lee", byName: "Sam Lee", byUnique: "sam@cooptimize.example", changedAt: "2026-11-02T15:00:00Z", rev: 9, ...o });
    const me = { names: ["Ana Rivera"], emails: ["ana@cooptimize.example"] };
    expect(takeoversOf([c({})], me)).toEqual([{ key: "4417-9", itemId: 4417, byName: "Sam", at: "2026-11-02T15:00:00Z" }]);
    expect(takeoversOf([c({ byUnique: "ana@cooptimize.example", byName: "Ana Rivera" })], me)).toEqual([]);
    expect(takeoversOf([c({ oldValue: "Sam Lee", newValue: "Ana Rivera" })], me)).toEqual([]);
    expect(takeoversOf([c({ kind: "target_date" })], me)).toEqual([]);
  });
});
