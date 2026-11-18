// MC-3: Calls as one list by day. Every call once, newest first, a registered call and another on the same day in time
// order, a state and a filter for each, counts that add up, older calls only while they need me, the chips' clients.
// Fictional data only (builders).
import { describe, expect, it } from "vitest";
import { anOccurrenceView, anOtherCall, aSeriesView, ZONE } from "../test/builders/index.ts";
import { byDay, callRows, chipClients, dayHeading, filterCounts, filterRows, firstToOpen } from "./call-list.ts";

const TODAY = "2026-11-05";
const weekly = aSeriesView({ id: 1, name: "Contoso weekly status call", clientKey: "Contoso", clientName: "Contoso" });
const pressed = aSeriesView({ id: 2, name: "Fabrikam design review", clientKey: "Fabrikam", clientName: "Fabrikam", call: "calendar", roleLabel: "Weekly status call" });
const look = aSeriesView({ id: 3, name: "Adatum planning", clientKey: "Adatum", clientName: "Adatum", mine: { review: false, attend: true } });

describe("MC-3: one list by day", () => {
  const occs = [
    anOccurrenceView({ id: 10, seriesId: 1, startAt: "2026-11-02T18:00:00Z", endAt: "2026-11-02T18:30:00Z", state: "ready", open: 4, proposals: 6 }),
    anOccurrenceView({ id: 11, seriesId: 2, startAt: "2026-11-04T15:00:00Z", endAt: "2026-11-04T16:00:00Z", state: "failed", open: 0, retryAt: null }),
    anOccurrenceView({ id: 12, seriesId: 3, startAt: "2026-11-03T14:00:00Z", endAt: "2026-11-03T15:00:00Z", state: "ready", open: 2 }),
    anOccurrenceView({ id: 13, seriesId: 1, startAt: "2026-10-26T18:00:00Z", endAt: "2026-10-26T18:30:00Z", state: "reviewed", open: 0, proposals: 3 }),
    // Older than 14 days and still needing me (proposals open, the transcript not dropped): listed.
    anOccurrenceView({ id: 14, seriesId: 1, startAt: "2026-10-19T18:00:00Z", endAt: "2026-10-19T18:30:00Z", state: "ready", open: 1 }),
    // Older than 14 days and done: not listed (the fold has it).
    anOccurrenceView({ id: 15, seriesId: 1, startAt: "2026-10-12T18:00:00Z", endAt: "2026-10-12T18:30:00Z", state: "reviewed", open: 0 }),
  ];
  const others = [
    anOtherCall({ name: "Team standup", startAt: "2026-11-02T14:00:00Z", endAt: "2026-11-02T14:15:00Z", minutes: 15, people: 4 }),
    // The pressed call, from my calendar too: listed once, as the call FocusTime keeps, with its people.
    anOtherCall({ name: "Fabrikam design review", startAt: "2026-11-04T15:00:00Z", endAt: "2026-11-04T16:00:00Z", occurrenceId: 11, people: 6 }),
    anOtherCall({ name: "Lunch and learn", startAt: "2026-11-02T19:00:00Z", endAt: "2026-11-02T20:00:00Z", teams: false, outside: false }),
  ];
  const { rows, older } = callRows({ meetings: [weekly, pressed, look], occurrences: occs, others, today: TODAY, zone: ZONE });

  it("every call once, newest first; a registered call and another on the same day in time order", () => {
    expect(rows.map((r) => r.name)).toEqual(["Fabrikam design review", "Adatum planning", "Lunch and learn", "Contoso weekly status call", "Team standup", "Contoso weekly status call", "Contoso weekly status call"]);
    expect(rows.map((r) => r.occurrenceId)).toEqual([11, 12, null, 10, null, 13, 14]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.find((r) => r.occurrenceId === 11)!.people).toBe(6);
    expect(older.map((r) => r.occurrenceId)).toEqual([15]);
  });

  it("a state in words on every row, and the weekly mark on a registered call only", () => {
    const at = (id: number | null, name?: string) => rows.find((r) => (id ? r.occurrenceId === id : r.name === name))!;
    expect(at(10).state).toEqual({ label: "Review 4 proposals", needsMe: true });
    expect(at(11).state.label).toBe("The AI step failed");
    expect(at(12).state).toEqual({ label: "2 proposals to review", needsMe: false });
    expect(at(13).state.label).toBe("Reviewed");
    expect(at(null, "Team standup").state.label).toBe("Not reviewed");
    expect(at(10).weekly).toBe("Weekly status call");
    expect(at(11).weekly).toBeNull();
    expect(at(null, "Team standup").weekly).toBeNull();
    expect(at(null, "Lunch and learn").source).toBe("Upload only");
    expect(at(null, "Team standup").source).toBe("From Teams or a file");
    expect(at(10).source).toBe("Transcript from Teams");
    expect(at(null, "Team standup").clientKey).toBeNull();
  });

  it("the filters' counts add up, and each shows exactly its calls; the client chips filter", () => {
    const c = filterCounts(rows, null);
    expect(c.all).toBe(rows.length);
    expect(c.review + c.open + c.done).toBe(c.all);
    expect(filterRows(rows, "review", null).map((r) => r.occurrenceId)).toEqual([11, 10, 14]);
    expect(filterRows(rows, "done", null).map((r) => r.occurrenceId)).toEqual([13]);
    expect(filterRows(rows, "open", null).map((r) => r.name)).toEqual(["Adatum planning", "Lunch and learn", "Team standup"]);
    expect(filterRows(rows, "all", "Contoso").every((r) => r.clientKey === "Contoso")).toBe(true);
    expect(filterRows(rows, "all", "").map((r) => r.name)).toEqual(["Lunch and learn", "Team standup"]);
    expect(filterCounts(rows, "Contoso")).toEqual({ all: 3, review: 2, open: 0, done: 1 });
    expect(chipClients(rows).map((x) => x.name)).toEqual(["Adatum", "Contoso", "Fabrikam", "No client yet"]);
  });

  it("days under a heading, Today and Yesterday by name", () => {
    expect(byDay(rows).map((d) => d.day)).toEqual(["2026-11-04", "2026-11-03", "2026-11-02", "2026-10-26", "2026-10-19"]);
    expect(dayHeading("2026-11-05", TODAY)).toBe("Today");
    expect(dayHeading("2026-11-04", TODAY)).toBe("Yesterday");
    expect(dayHeading("2026-11-02", TODAY)).toBe("Mon, Nov 2");
  });

  it("with no call named, the newest call that needs me opens; with none, the newest call", () => {
    expect(firstToOpen(rows)?.occurrenceId).toBe(11);
    expect(firstToOpen(rows.filter((r) => !r.state.needsMe))?.occurrenceId).toBe(12);
    expect(firstToOpen([])).toBeNull();
  });

  it("an older call that needs me is listed for as long as the server returns it, so To review is the tab's count", () => {
    const old = anOccurrenceView({ id: 20, seriesId: 1, startAt: "2026-10-01T18:00:00Z", endAt: "2026-10-01T18:30:00Z", state: "ready", open: 2 });
    const r = callRows({ meetings: [weekly], occurrences: [old], others: [], today: TODAY, zone: ZONE });
    expect(r.rows.map((x) => x.occurrenceId)).toEqual([20]);
    expect(r.older).toEqual([]);
    expect(filterCounts(r.rows, null).review).toBe(1);
  });
  it("a calendar call is keyed by its own calendar key, so a refetch in another order keeps the same row", () => {
    const a = anOtherCall({ key: "ical-a", name: "Team standup", startAt: "2026-11-02T14:00:00Z", endAt: "2026-11-02T14:15:00Z" });
    const b = anOtherCall({ key: "ical-b", name: "Design review", startAt: "2026-11-03T14:00:00Z", endAt: "2026-11-03T15:00:00Z" });
    const one = callRows({ meetings: [], occurrences: [], others: [a, b], today: TODAY, zone: ZONE }).rows;
    const two = callRows({ meetings: [], occurrences: [], others: [b, a], today: TODAY, zone: ZONE }).rows;
    expect(one.map((r) => [r.key, r.name])).toEqual(two.map((r) => [r.key, r.name]));
  });
});

describe("MC-2b: my Pocket recordings in the list", () => {
  const waiting = aSeriesView({ id: 4, name: "Contoso intake", clientKey: "Contoso", clientName: "Contoso", call: "calendar" });
  const occs = [
    // A kept call waiting for its transcript (no transcript): a recording may go on it.
    anOccurrenceView({ id: 20, seriesId: 4, startAt: "2026-11-03T15:00:00Z", endAt: "2026-11-03T16:00:00Z", state: "needs_upload", open: 0, hasTranscript: false }),
    // A call that has its transcript: never marked, and a recording on it isn't a row of its own either.
    anOccurrenceView({ id: 21, seriesId: 1, startAt: "2026-11-02T18:00:00Z", endAt: "2026-11-02T18:30:00Z", state: "ready", open: 2, hasTranscript: true }),
  ];
  const others = [anOtherCall({ key: "standup", name: "Team standup", startAt: "2026-11-04T14:00:00Z", endAt: "2026-11-04T14:15:00Z", minutes: 15 })];
  const rec = (id: string, startAt: string, minutes: number, title = "") => ({ id, startAt, endAt: Temporal.Instant.from(startAt).add({ minutes }).toString(), minutes, title });
  const pocket = [
    rec("on-intake", "2026-11-03T14:58:00Z", 65, "Intake"),
    rec("short-on-intake", "2026-11-03T15:30:00Z", 31, "Intake part 2"),
    rec("on-standup", "2026-11-04T14:00:00Z", 15, "Standup"),
    rec("on-done", "2026-11-02T18:00:00Z", 30, "Weekly"),
    rec("no-call", "2026-11-01T20:00:00Z", 25, "Call with the carrier"),
    rec("untitled", "2026-11-04T20:00:00Z", 10),
  ];
  const { rows } = callRows({ meetings: [weekly, waiting], occurrences: occs, others, today: TODAY, zone: ZONE, pocket });
  const at = (k: string) => rows.find((r) => r.key === k)!;

  it("a call it goes with says Pocket recording found, with both recordings, the longer overlap first", () => {
    expect(at("o20").pocket.map((r) => r.id)).toEqual(["on-intake", "short-on-intake"]);
    expect(at("o20").state.label).toBe("Pocket recording found");
    expect(at("o20").source).toBe("Your Pocket recording");
    expect(at("cstandup").pocket.map((r) => r.id)).toEqual(["on-standup"]);
    expect(at("o21").pocket).toEqual([]);
    expect(at("o21").state.label).not.toBe("Pocket recording found");
  });

  it("a recording with no call is its own row on its day, under Not reviewed; its title or the kind as its name", () => {
    expect(rows.filter((r) => r.recording).map((r) => [r.key, r.name, r.day, r.bucket, r.state.label])).toEqual([
      ["puntitled", "Pocket recording", "2026-11-04", "open", "Not reviewed"],
      ["pno-call", "Call with the carrier", "2026-11-01", "open", "Not reviewed"],
    ]);
    expect(filterCounts(rows, null).open).toBe(rows.filter((r) => r.bucket === "open").length);
  });

  it("without a press, nothing changes", () => {
    const plain = callRows({ meetings: [weekly, waiting], occurrences: occs, others, today: TODAY, zone: ZONE });
    expect(plain.rows.every((r) => !r.pocket.length && !r.recording)).toBe(true);
  });
});
