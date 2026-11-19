// MC-2b, PK-4: the pure rules for Pocket recordings in Calls: whose are kept, which call a recording goes with, the part
// during a long call, the time unit and the speaker labels. Invented times and words only.
import { describe, expect, it } from "vitest";
import { colleagueOf, forCall, goesWith, hasTimes, inSeconds, lengthWords, longerThanCall, partDuring, pocketLines, whoseKept, withNoCall, countWhy, type Segment } from "./pocket-recordings.ts";

const rec = (id: string, startAt: string, minutes: number) => ({ id, startAt, seconds: minutes * 60 });
const call = (startAt: string, minutes: number) => ({ startAt, endAt: Temporal.Instant.from(startAt).add({ minutes }).toString() });

describe("PK-4: whose listed items are kept", () => {
  const ME = { mine: ["you@example.com", "you2@example.com"] };
  /** Every item a recording unless named in `not`; records which items were asked about. */
  const asking = (not: number[] = []) => {
    const asked: number[] = [];
    return { asked, isRecording: (i: number) => (asked.push(i), !not.includes(i)) };
  };

  it("mine by any address FocusTime knows me by, case aside; another person's left out and never asked about", () => {
    const a = asking();
    const why = whoseKept(["you@example.com", "sam@example.com", "YOU2@example.com", null], ME, a.isRecording);
    expect(why).toEqual(["mine", "address", "mine", "no_recorder"]);
    expect(a.asked).not.toContain(1);
    expect(a.asked).not.toContain(3);
    expect(countWhy(why)).toEqual({ listed: 4, notRecordings: 0, kept: 2, address: 1, noRecorder: 1 });
  });

  it("mine by a Pocket address I set", () => {
    const why = whoseKept(["me@personal.example", "sam@example.com"], { mine: [...ME.mine, "Me@Personal.example"] }, asking().isRecording);
    expect(why).toEqual(["mine", "address"]);
  });

  it("one recorder among the recordings that name one keeps them all, with those that name none", () => {
    const why = whoseKept(["me@personal.example", null, "me@personal.example"], ME, asking().isRecording);
    expect(why).toEqual(["one", "one", "one"]);
    expect(countWhy(why)).toEqual({ listed: 3, notRecordings: 0, kept: 3, address: 0, noRecorder: 0 });
    // Only items with no recorder: nothing decides against them.
    expect(whoseKept([null, null], ME, asking().isRecording)).toEqual(["one", "one"]);
    expect(whoseKept([], ME, asking().isRecording)).toEqual([]);
  });

  it("two recorders and none mine keeps nothing, and says why in counts", () => {
    const why = whoseKept(["me@personal.example", "sam@example.com", null], ME, asking().isRecording);
    expect(why).toEqual(["address", "address", "no_recorder"]);
    expect(countWhy(why)).toEqual({ listed: 3, notRecordings: 0, kept: 0, address: 2, noRecorder: 1 });
  });

  it("an item with no length or time is never a recording and never someone else's: it doesn't break one recorder", () => {
    // Item 1 isn't a recording (a summary, an upload not yet done) under another address.
    const why = whoseKept(["me@personal.example", "pocket-bot@example.com", "me@personal.example"], ME, asking([1]).isRecording);
    expect(why).toEqual(["one", "not_recording", "one"]);
    expect(countWhy(why)).toMatchObject({ kept: 2, notRecordings: 1, address: 0 });
    // Mine by address, but not a recording: counted apart, never kept.
    expect(whoseKept(["you@example.com", "you@example.com"], ME, asking([1]).isRecording)).toEqual(["mine", "not_recording"]);
  });

  it("a record with no recorder beside another person's recordings is left out, and so is anything not asked about", () => {
    const a = asking();
    expect(whoseKept(["you@example.com", "sam@example.com", null], ME, a.isRecording)).toEqual(["mine", "address", "no_recorder"]);
    expect(a.asked).toEqual([0]);
  });

  it("one recorder who is another FocusTime person is never kept as mine, and is never asked about", () => {
    const a = asking();
    const why = whoseKept(["lee@cooptimize.example", "lee@cooptimize.example"], { ...ME, theirs: ["lee@cooptimize.example"] }, a.isRecording);
    expect(why).toEqual(["address", "address"]);
    expect(a.asked).toEqual([]);
  });

  it("another address on my work domain is a colleague's: never kept as the one recorder", () => {
    const work = ["you@example.com"];
    expect(whoseKept(["sam@example.com", "sam@example.com"], { mine: work, work }, asking().isRecording)).toEqual(["address", "address"]);
    expect(whoseKept(["me@personal.example", "me@personal.example"], { mine: work, work }, asking().isRecording)).toEqual(["one", "one"]);
    expect(colleagueOf(work, [])("sam@example.com")).toBe(true);
    expect(colleagueOf(work, [])("you@example.com")).toBe(false);
    expect(colleagueOf(work, ["lee@other.example"])("lee@other.example")).toBe(true);
  });

  it("fails closed: when who else FocusTime knows can't be read, one recorder isn't kept", () => {
    expect(whoseKept(["me@personal.example", "me@personal.example"], { ...ME, others: false }, asking().isRecording)).toEqual(["address", "address"]);
    expect(whoseKept(["you@example.com", "sam@example.com"], { ...ME, others: false }, asking().isRecording)).toEqual(["mine", "address"]);
  });

  it("the case of Nov 18: sixteen under one unknown address and two with no recorder are all kept", () => {
    const rs = [...Array.from({ length: 16 }, () => "me@personal.example"), null, null];
    const why = whoseKept(rs, ME, asking().isRecording);
    expect(countWhy(why)).toEqual({ listed: 18, notRecordings: 0, kept: 18, address: 0, noRecorder: 0 });
  });
});

describe("which call a recording goes with", () => {
  const c = call("2026-11-16T16:00:00Z", 60);
  it("at least half the call's length overlapping", () => {
    expect(goesWith(rec("a", "2026-11-16T16:30:00Z", 60), c)).toBe(true); // 30 of 60
    expect(goesWith(rec("b", "2026-11-16T16:31:00Z", 60), c)).toBe(false); // 29 of 60
    expect(goesWith(rec("c", "2026-11-16T15:00:00Z", 180), c)).toBe(true); // covers it all
    expect(goesWith(rec("d", "2026-11-16T17:00:00Z", 30), c)).toBe(false); // after it
  });
  it("PK-4: a recording started late or stopped early still finds its call when half of it, and 5 minutes, is inside", () => {
    expect(goesWith(rec("late", "2026-11-16T16:35:00Z", 20), c)).toBe(true); // 20 minutes inside a 60 minute call
    expect(goesWith(rec("tail", "2026-11-16T16:50:00Z", 18), c)).toBe(true); // 10 of 18 inside
    expect(goesWith(rec("tiny", "2026-11-16T16:20:00Z", 4), c)).toBe(false); // 4 minutes inside: too little
    expect(goesWith(rec("mostly-after", "2026-11-16T16:52:00Z", 20), c)).toBe(false); // 8 of 20 inside
  });
  it("two recordings on one call: both, the longer overlap first", () => {
    const rs = [rec("short", "2026-11-16T16:25:00Z", 35), rec("long", "2026-11-16T15:55:00Z", 70)];
    expect(forCall(rs, c).map((r) => r.id)).toEqual(["long", "short"]);
  });
  it("one recording across two calls goes with both", () => {
    const r = rec("x", "2026-11-16T16:00:00Z", 120);
    expect(goesWith(r, c)).toBe(true);
    expect(goesWith(r, call("2026-11-16T17:00:00Z", 60))).toBe(true);
  });
  it("a recording with no call is its own row", () => {
    const rs = [rec("on", "2026-11-16T16:00:00Z", 60), rec("off", "2026-11-16T20:00:00Z", 25)];
    expect(withNoCall(rs, [c]).map((r) => r.id)).toEqual(["off"]);
  });
  it("a call just after midnight in New York and a recording dated the day before in UTC still go together", () => {
    // 00:10 to 00:40 on Nov 17 in New York is 05:10 to 05:40 UTC; the recording started at 04:59 UTC.
    const late = call(Temporal.ZonedDateTime.from("2026-11-17T00:10[America/New_York]").toInstant().toString(), 30);
    expect(goesWith(rec("r", "2026-11-17T04:59:00Z", 40), late)).toBe(true);
  });
  it("longer than its call by more than 10 minutes", () => {
    expect(longerThanCall(rec("a", "2026-11-16T16:00:00Z", 70), c)).toBe(false);
    expect(longerThanCall(rec("b", "2026-11-16T16:00:00Z", 71), c)).toBe(true);
    expect(lengthWords(8100)).toBe("2h 15m");
    expect(lengthWords(2820)).toBe("47m");
  });
});

describe("the part during the call", () => {
  const segs: Segment[] = [
    { start: 0, end: 300, speaker: "S0", text: "before" },
    { start: 900, end: 1000, speaker: "S1", text: "five minutes before" },
    { start: 1200, end: 2000, speaker: "S0", text: "during" },
    { start: 4800, end: 4900, speaker: "S1", text: "five minutes after" },
    { start: 6000, end: 6100, speaker: "S0", text: "after" },
  ];
  it("takes only lines during the call, 5 minutes either side", () => {
    // The recording started 20 minutes before a 60 minute call.
    const r = rec("r", "2026-11-16T15:40:00Z", 120);
    expect(partDuring(segs, r, call("2026-11-16T16:00:00Z", 60)).map((s) => s.text)).toEqual(["five minutes before", "during", "five minutes after"]);
  });
  it("knows when Pocket gave no times, and reads milliseconds as seconds", () => {
    expect(hasTimes([{ start: null, end: null, speaker: "a", text: "x" }])).toBe(false);
    const ms = inSeconds([{ start: 0, end: 1_000_000, speaker: "a", text: "x" }], 1200);
    expect(ms[0]).toMatchObject({ start: 0, end: 1000 });
    expect(inSeconds([{ start: 10, end: 1190, speaker: "a", text: "x" }], 1200)[0]).toMatchObject({ end: 1190 });
  });
});

describe("segments as transcript lines", () => {
  it("numbers speakers by Pocket's label number, never their names, and keeps line times", () => {
    const lines = pocketLines([
      { start: 5, end: 9, speaker: "SPEAKER_3", text: "First words." },
      { start: 10, end: 12, speaker: "SPEAKER_1", text: "Second." },
      { start: 13, end: 14, speaker: "SPEAKER_1", text: "Still second." },
    ]);
    expect(lines).toEqual([
      { n: 1, speaker: "Speaker 2", at: 5, text: "First words." },
      { n: 2, speaker: "Speaker 1", at: 10, text: "Second. Still second." },
    ]);
  });
  it("labels without numbers go in the order they first speak", () => {
    expect(pocketLines([{ start: null, end: null, speaker: "Dana", text: "a" }, { start: null, end: null, speaker: "Guest", text: "b" }]).map((l) => [l.speaker, l.at])).toEqual([["Speaker 1", null], ["Speaker 2", null]]);
  });
});
