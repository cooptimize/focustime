// MB-1: the phone's Now card in each state: in a block, in a meeting, between blocks, before the day, after it.
import { describe, expect, it } from "vitest";
import { meetingNow, nowCard, type NowBlock, type NowEvent } from "./phonenow.ts";

const at = (hm: string) => `2026-11-02T${hm}:00-05:00`;
const AM: NowBlock = { half: "AM", clientKey: "contoso", start: at("09:00"), end: at("12:00") };
const PM: NowBlock = { half: "PM", clientKey: "fabrikam", start: at("13:00"), end: at("17:00") };
const ev = (id: string, s: string, e: string, o: Partial<NowEvent> = {}): NowEvent => ({ id, title: `Meeting ${id}`, start: at(s), end: at(e), isPersonal: false, ...o });
const EVENTS = [ev("standup", "09:00", "09:15"), ev("review", "11:00", "11:45"), ev("dentist", "12:00", "12:30", { isPersonal: true }), ev("box", "14:00", "15:00", { notMeeting: "timebox" }), ev("status", "15:00", "15:30")];

describe("the phone's Now card", () => {
  it("in a block: its client, how long is left, and the next meeting with how long until it", () => {
    const c = nowCard([AM, PM], EVENTS, at("09:30"));
    expect(c).toMatchObject({ kind: "block", block: { half: "AM" }, leftMinutes: 150, meeting: { id: "review", underWay: false, minutes: 90 } });
  });
  it("in a meeting: the meeting under way and its minutes left", () => {
    expect(nowCard([AM, PM], EVENTS, at("11:15"))).toMatchObject({ kind: "block", meeting: { id: "review", underWay: true, minutes: 30 } });
  });
  it("between blocks: the next block (free until it starts); a personal event is never the meeting", () => {
    const c = nowCard([AM, PM], EVENTS, at("12:15"));
    expect(c).toMatchObject({ kind: "between", block: { half: "PM" } });
    // The timebox at 2:00 is mine, not a meeting: the next meeting is the 3:00 status.
    expect(c.kind === "between" && c.meeting?.id).toBe("status");
  });
  it("before the day starts, and after it ends", () => {
    expect(nowCard([PM, AM], EVENTS, at("08:00"))).toMatchObject({ kind: "before", block: { half: "AM" }, meeting: { id: "standup", minutes: 60 } });
    expect(nowCard([AM, PM], EVENTS, at("17:30"))).toEqual({ kind: "after" });
    expect(nowCard([], EVENTS, at("10:00"))).toEqual({ kind: "none" });
  });
  it("no meeting left today: none", () => {
    expect(meetingNow(EVENTS, at("16:00"))).toBeNull();
  });
});
