// MC-3, MC-4: Calls' list. Every call once, newest first; MC-4: Open, Closed and Hidden with counts, Needs you first,
// then This week, Last week and Earlier with their closed and still-open counts, a repeat as one row, calls with no
// transcript in the fold, the marks, and the tab's count equal to Needs you. Fictional data only (builders).
import { describe, expect, it } from "vitest";
import { anOccurrenceView, anOtherCall, aSeriesView, ZONE } from "../test/builders/index.ts";
import { pocketRows } from "./call-list-pocket.ts";
import { callRows, chipClients, closedAtOf, closedLine, closedList, dayHeading, filterCounts, firstToOpen, hiddenList, hiddenMissing, hideKeyOf, markShort, needsAction, needsNote, openList, outcomeOfCall, shortWhen, weekOf } from "./call-list.ts";
import { CALL_STATE } from "./call-words.ts";

// Thursday Nov 5: This week is Nov 2 to 8, Last week Oct 26 to Nov 1.
const TODAY = "2026-11-05";
const weekly = aSeriesView({ id: 1, name: "Contoso weekly status call", clientKey: "Contoso", clientName: "Contoso" });
const pressed = aSeriesView({ id: 2, name: "Fabrikam design review", clientKey: "Fabrikam", clientName: "Fabrikam", call: "calendar", roleLabel: "Weekly status call" });
const look = aSeriesView({ id: 3, name: "Adatum planning", clientKey: "Adatum", clientName: "Adatum", mine: { review: false, attend: true } });
const done = { created: 2, promises: 1, comments: 0, skipped: 5 };

describe("MC-4: Calls' list", () => {
  const occs = [
    anOccurrenceView({ id: 10, seriesId: 1, startAt: "2026-11-02T18:00:00Z", endAt: "2026-11-02T18:30:00Z", state: "ready", open: 4, proposals: 6 }),
    anOccurrenceView({ id: 11, seriesId: 2, startAt: "2026-11-04T15:00:00Z", endAt: "2026-11-04T16:00:00Z", state: "failed", open: 0, retryAt: null }),
    // I look, not review: open, but not Needs you.
    anOccurrenceView({ id: 12, seriesId: 3, startAt: "2026-11-03T14:00:00Z", endAt: "2026-11-03T15:00:00Z", state: "ready", open: 2, proposals: 2 }),
    // Closed last week, with what came of it.
    anOccurrenceView({ id: 13, seriesId: 1, startAt: "2026-10-26T18:00:00Z", endAt: "2026-10-26T18:30:00Z", state: "reviewed", open: 0, proposals: 8, done, closedAt: "2026-10-27T15:00:00Z" }),
    // Last week and still open (needs me): the week says "1 still open".
    anOccurrenceView({ id: 14, seriesId: 1, startAt: "2026-10-27T18:00:00Z", endAt: "2026-10-27T18:30:00Z", state: "ready", open: 1, proposals: 3 }),
    // Closed and older than 14 days: off the list (reachable from its meeting and its address).
    anOccurrenceView({ id: 15, seriesId: 1, startAt: "2026-10-12T18:00:00Z", endAt: "2026-10-12T18:30:00Z", state: "reviewed", open: 0, proposals: 1, done: { created: 0, promises: 0, comments: 0, skipped: 1 } }),
  ];
  const standup = (n: number, day: string) => anOtherCall({ key: `standup-${n}`, name: "Team standup", startAt: `${day}T14:00:00Z`, endAt: `${day}T14:15:00Z`, minutes: 15, seriesKey: "series-standup", allHome: true });
  const others = [
    standup(1, "2026-11-02"), standup(2, "2026-11-03"), standup(3, "2026-11-04"),
    anOtherCall({ key: "pressed", name: "Fabrikam design review", startAt: "2026-11-04T15:00:00Z", endAt: "2026-11-04T16:00:00Z", occurrenceId: 11, people: 6 }),
    anOtherCall({ key: "model", name: "Northwind model review", startAt: "2026-11-03T19:00:00Z", endAt: "2026-11-03T20:00:00Z" }),
    anOtherCall({ key: "lunch", name: "Lunch and learn", startAt: "2026-11-02T19:00:00Z", endAt: "2026-11-02T20:00:00Z", teams: false }),
    anOtherCall({ key: "sync", name: "Fabrikam sync", startAt: "2026-10-28T15:00:00Z", endAt: "2026-10-28T16:00:00Z" }),
    anOtherCall({ key: "hid", name: "Hidden one", startAt: "2026-11-03T16:00:00Z", endAt: "2026-11-03T16:30:00Z" }),
  ];
  const check = { "standup-1": "no", "standup-2": "no", "standup-3": "no", model: "yes", sync: "unchecked", hid: "yes" } as const;
  const hides = { keys: new Set(["hid", "gone-long-ago"]), series: new Set<string>() };
  const suggest = (c: { name: string }) => (c.name.startsWith("Northwind") ? "Northwind" : null);
  const rows = callRows({ meetings: [weekly, pressed, look], occurrences: occs, others, today: TODAY, zone: ZONE, check, hides, suggest });
  const at = (k: string) => rows.find((r) => r.key === k)!;

  it("every call once, newest first; a closed call older than the list's days drops off", () => {
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.some((r) => r.occurrenceId === 15)).toBe(false);
    expect(at("o11").people).toBe(6);
    expect(rows.filter((r) => r.key === "cpressed")).toEqual([]);
    const starts = rows.map((r) => Date.parse(r.startAt));
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
  });

  it("Open, Closed and Hidden with counts that add up; a hidden meeting with nothing in the window is counted in Hidden", () => {
    const gone = hiddenMissing(rows, hides);
    expect(gone).toEqual({ keys: ["gone-long-ago"], series: [] });
    const c = filterCounts(rows, null, gone.keys.length);
    expect(c.closed).toBe(1);
    expect(c.hidden).toBe(2);
    expect(c.open + c.closed + c.hidden - gone.keys.length).toBe(rows.length);
    expect(closedList(rows, null).map((r) => r.occurrenceId)).toEqual([13]);
    expect(hiddenList(rows, null).map((r) => r.key)).toEqual(["chid"]);
  });

  it("Needs you first, then the weeks with closed and still-open counts; a repeat is one row; no transcript goes in the fold", () => {
    const l = openList(rows, null, TODAY);
    expect(l.needs.map((r) => r.occurrenceId)).toEqual([11, 10, 14]);
    expect(l.weeks.map((w) => [w.label, w.closed, w.stillOpen])).toEqual([["This week", 0, 0], ["Last week", 1, 1]]);
    const thisWeek = l.weeks[0]!.entries.map((e) => (e.kind === "one" ? e.row.key : `series:${e.name}:${e.rows.length}`));
    // The model review (a transcript in Teams) and the call I only look at; the hidden one never shows as reviewable.
    expect(thisWeek).toEqual(["cmodel", "o12"]);
    expect(l.weeks[1]!.entries.map((e) => (e.kind === "one" ? e.row.key : e.name))).toEqual(["csync"]);
    // The standups (no transcript in Teams) are one row in the fold; Lunch and learn isn't a Teams meeting.
    expect(l.foldCount).toBe(4);
    expect(l.fold.map((e) => (e.kind === "one" ? e.row.name : `${e.name} · ${e.rows.length}`))).toEqual(["Team standup · 3", "Lunch and learn"]);
  });

  it("the marks: Transcript in Teams, Not checked, checking while the answer is on its way", () => {
    expect(at("cmodel").mark).toBe("teams");
    expect(at("csync").mark).toBeNull();
    expect(at("csync").check).toBe("unchecked");
    expect(at("clunch").check).toBe("no");
    const before = callRows({ meetings: [], occurrences: [], others: [others[4]!], today: TODAY, zone: ZONE });
    expect(before[0]!.check).toBe("checking");
    expect(before[0]!.place).toBe("week");
  });

  it("a Pocket recording and a Teams transcript on one call is both", () => {
    const rec = { id: "r1", startAt: "2026-11-03T19:00:00Z", endAt: "2026-11-03T20:00:00Z", minutes: 60, title: "Model review" };
    const r = callRows({ meetings: [], occurrences: [], others: [others[4]!], today: TODAY, zone: ZONE, check, addPocket: pocketRows([rec], ZONE) });
    expect(r[0]!.mark).toBe("both");
  });

  it("the client: FocusTime's suggestion, or Which client? (none)", () => {
    expect(at("cmodel").suggested).toBe("Northwind");
    expect(at("cstandup-1").suggested).toBeNull();
    expect(chipClients(rows, (k) => k).map((x) => x.name)).toContain("Northwind");
  });

  it("a closed call says what came of it, or Nothing taken", () => {
    expect(closedLine(at("o13").closed!)).toBe("2 created · 1 promise · 5 skipped");
    expect(closedLine({ at: null, done: { created: 0, promises: 0, comments: 0, skipped: 3 }, noTranscript: false })).toBe("Nothing taken");
    expect(closedLine({ at: null, done: null, noTranscript: true })).toBe("No transcript");
  });

  it("what came of a call and when it closed, from its proposals alone", () => {
    const p = (kind: "gap" | "commitment" | "comment", state: "open" | "skipped" | "confirmed" | "failed", decidedAt: string | null = null) => ({ kind, state, decidedAt });
    expect(outcomeOfCall([p("gap", "confirmed"), p("commitment", "confirmed"), p("comment", "skipped"), p("gap", "open")])).toEqual({ created: 1, promises: 1, comments: 0, skipped: 1 });
    expect(closedAtOf([p("gap", "confirmed", "2026-11-02T10:00:00Z"), p("gap", "open")])).toBeNull();
    expect(closedAtOf([p("gap", "confirmed", "2026-11-02T10:00:00Z"), p("gap", "skipped", "2026-11-03T10:00:00Z")])).toBe("2026-11-03T10:00:00Z");
    expect(closedAtOf([p("gap", "failed", "2026-11-02T10:00:00Z")])).toBeNull();
    expect(closedAtOf([])).toBeNull();
  });

  it("weeks start on Monday; headings say Today and Yesterday by name", () => {
    expect(weekOf("2026-11-02", TODAY)).toBe("this");
    expect(weekOf("2026-11-01", TODAY)).toBe("last");
    expect(weekOf("2026-10-25", TODAY)).toBe("earlier");
    expect(dayHeading("2026-11-05", TODAY)).toBe("Today");
    expect(dayHeading("2026-11-04", TODAY)).toBe("Yesterday");
  });

  it("with no call named, the newest call that needs me opens", () => {
    expect(firstToOpen(rows)?.occurrenceId).toBe(11);
    expect(firstToOpen([])).toBeNull();
  });

  it("a calendar call is keyed by its own calendar key, so a refetch in another order keeps the same row", () => {
    const a = anOtherCall({ key: "ical-a", startAt: "2026-11-02T14:00:00Z", endAt: "2026-11-02T14:15:00Z" });
    const b = anOtherCall({ key: "ical-b", startAt: "2026-11-03T14:00:00Z", endAt: "2026-11-03T15:00:00Z" });
    const one = callRows({ meetings: [], occurrences: [], others: [a, b], today: TODAY, zone: ZONE });
    const two = callRows({ meetings: [], occurrences: [], others: [b, a], today: TODAY, zone: ZONE });
    expect(one.map((r) => r.key)).toEqual(two.map((r) => r.key));
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
  const rows = callRows({ meetings: [weekly, waiting], occurrences: occs, others, today: TODAY, zone: ZONE, addPocket: pocketRows(pocket, ZONE) });
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

  it("MC-4: Hidden counts a meeting hidden every one once, as its list shows it", () => {
    const rows = [1, 2, 3].map((n) => ({ key: `c${n}`, bucket: "hidden", seriesKey: "standup", clientKey: null, suggested: null }) as unknown as Parameters<typeof filterCounts>[0][number]);
    expect(filterCounts(rows, null).hidden).toBe(3);
    expect(filterCounts(rows, null, 0, new Set(["standup"])).hidden).toBe(1);
  });

  it("MC-5: a call that closed with no transcript stays closed when my recording later goes with it, with the mark, reviewable from Closed", () => {
    const gone = anOccurrenceView({ id: 30, seriesId: 4, startAt: "2026-10-27T15:00:00Z", endAt: "2026-10-27T16:00:00Z", state: "no_transcript", open: 0, hasTranscript: false });
    const plain = callRows({ meetings: [waiting], occurrences: [gone], others: [], today: TODAY, zone: ZONE });
    expect(plain[0]!.bucket).toBe("closed");
    const withRec = callRows({ meetings: [waiting], occurrences: [gone], others: [], today: TODAY, zone: ZONE, addPocket: pocketRows([rec("r", "2026-10-27T15:00:00Z", 60)], ZONE) });
    expect([withRec[0]!.bucket, withRec[0]!.mark, withRec[0]!.closed?.noTranscript]).toEqual(["closed", "pocket", true]);
    // Its recording goes with it (the call's page offers it there), and it is listed under Closed, not Open.
    expect(withRec[0]!.pocket.map((r) => r.id)).toEqual(["r"]);
    expect(closedList(withRec, null).map((r) => r.key)).toEqual(["o30"]);
    expect(openList(withRec, null, TODAY).weeks.flatMap((w) => w.rows)).toEqual([]);
  });

  it("PK-4: a recording with no call has its mark and hides by its id alone; Put back brings it back", () => {
    expect(at("pno-call").mark).toBe("pocket");
    expect(hideKeyOf(at("pno-call"))).toBe("pocket:no-call");
    const hides = { keys: new Set(["pocket:no-call"]), series: new Set<string>() };
    const hidden = callRows({ meetings: [weekly, waiting], occurrences: occs, others, today: TODAY, zone: ZONE, hides, addPocket: pocketRows(pocket, ZONE) });
    expect(hidden.find((r) => r.key === "pno-call")!.bucket).toBe("hidden");
    expect(hiddenList(hidden, null).map((r) => r.key)).toEqual(["pno-call"]);
    // Its hide is never counted as a meeting gone from the list, with or without my list from Pocket.
    expect(hiddenMissing(hidden, hides)).toEqual({ keys: [], series: [] });
    expect(hiddenMissing(callRows({ meetings: [], occurrences: [], others: [], today: TODAY, zone: ZONE, hides }), hides)).toEqual({ keys: [], series: [] });
    const back = callRows({ meetings: [weekly, waiting], occurrences: occs, others, today: TODAY, zone: ZONE, hides: { keys: new Set(), series: new Set() }, addPocket: pocketRows(pocket, ZONE) });
    expect(back.find((r) => r.key === "pno-call")!.bucket).toBe("open");
  });

  it("without a press, nothing changes", () => {
    const plain = callRows({ meetings: [weekly, waiting], occurrences: occs, others, today: TODAY, zone: ZONE });
    expect(plain.every((r) => !r.pocket.length && !r.recording)).toBe(true);
  });
});

describe("MC-5: a row's one button, its short note, its when and its mark", () => {
  const row = (x: Partial<Parameters<typeof needsAction>[0]>) => ({ left: null, state: { label: CALL_STATE.upload, needsMe: true }, pocket: [], ...x }) as Parameters<typeof needsAction>[0];
  it("Needs you: what is left (no button), else Try again, Use Pocket recording or Add transcript; nothing while waiting on someone else", () => {
    expect(needsAction(row({ left: { open: 3, all: 11 } }))).toEqual({ kind: "left", text: "3 left" });
    expect(needsAction(row({ state: { label: CALL_STATE.aiFailed, needsMe: true } }))?.text).toBe("Try again");
    expect(needsAction(row({ pocket: [{ id: "r", startAt: "", endAt: "", minutes: 30, title: "" }] }))?.text).toBe("Use Pocket recording");
    expect(needsAction(row({}))?.text).toBe("Add transcript");
    expect(needsAction(row({ state: { label: CALL_STATE.readFailed, needsMe: true } }))?.text).toBe("Add transcript");
    expect(needsAction(row({ state: { label: CALL_STATE.waiting, needsMe: false } }))).toBeNull();
  });
  it("line 2's note: the transcript's last day for a call before this week, else a bar once something is decided; nothing with none decided", () => {
    expect(needsNote({ day: "2026-10-27", left: { open: 2, all: 4 }, occurrenceId: 1 }, "2026-11-05")).toEqual({ amber: "Transcript goes Nov 26" });
    expect(needsNote({ day: "2026-11-03", left: { open: 1, all: 4 }, occurrenceId: 1 }, "2026-11-05")).toEqual({ done: 0.75 });
    expect(needsNote({ day: "2026-11-03", left: { open: 4, all: 4 }, occurrenceId: 1 }, "2026-11-05")).toBeNull();
  });
  it("when: the weekday this week and last, the date before that", () => {
    expect(shortWhen("2026-11-03T18:00:00Z", "2026-11-03", "2026-11-05", "America/New_York")).toBe("Tue 1:00 PM");
    expect(shortWhen("2026-10-27T18:00:00Z", "2026-10-27", "2026-11-05", "America/New_York")).toBe("Tue 2:00 PM");
    expect(shortWhen("2026-10-20T18:00:00Z", "2026-10-20", "2026-11-05", "America/New_York")).toBe("Oct 20, 2:00 PM");
  });
  it("the mark, short, with its full words", () => {
    expect(markShort("both")).toEqual({ short: "Teams · Pocket", full: "Transcript in Teams and your Pocket recording" });
    expect(markShort("teams")?.short).toBe("Teams");
    expect(markShort(null)).toBeNull();
  });
});
