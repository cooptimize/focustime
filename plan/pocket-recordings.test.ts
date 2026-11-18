// MC-2b: the pure rules for Pocket recordings in Calls: whose are kept, which call a recording goes with, the part
// during a long call, the time unit and the speaker labels. Invented times and words only.
import { describe, expect, it } from "vitest";
import { forCall, goesWith, hasTimes, inSeconds, lengthWords, longerThanCall, partDuring, pocketLines, whoseKept, withNoCall, type Segment } from "./pocket-recordings.ts";

const rec = (id: string, startAt: string, minutes: number) => ({ id, startAt, seconds: minutes * 60 });
const call = (startAt: string, minutes: number) => ({ startAt, endAt: Temporal.Instant.from(startAt).add({ minutes }).toString() });

describe("whose recordings are kept", () => {
  it("mine by any address FocusTime knows me by, case aside; another person's dropped", () => {
    expect(whoseKept(["you@example.com", "sam@example.com", "YOU2@example.com", null], ["you@example.com", "you2@example.com"])).toEqual([true, false, true, false]);
  });
  it("every recording when the whole list has one recorder, under an address FocusTime doesn't know", () => {
    expect(whoseKept(["me@personal.example", "me@personal.example"], ["you@example.com"])).toEqual([true, true]);
    expect(whoseKept(["me@personal.example", "sam@example.com"], ["you@example.com"])).toEqual([false, false]);
    expect(whoseKept([null, null], ["you@example.com"])).toEqual([false, false]);
    expect(whoseKept([], ["you@example.com"])).toEqual([]);
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
    expect(lengthWords(8100)).toBe("2 h 15 min");
    expect(lengthWords(2820)).toBe("47 min");
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
