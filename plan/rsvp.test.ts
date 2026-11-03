// Step 16, slice 2: meeting RSVP rules (D283, D284). Fictional data only.
import { describe, expect, it } from "vitest";
import { overlapHint, proposalProblem, responseLabel, rsvpBody, rsvpProblem, rsvpVisibility, type MeetingFacts } from "./rsvp.ts";
import { undoOf, type Fields } from "./timebox.ts";

const meeting = (x: Partial<MeetingFacts> = {}): MeetingFacts => ({ isOrganizer: false, others: 3, isCancelled: false, marker: null, response: "notResponded", organizer: "Dana Morales", allowNewTimeProposals: true, ...x });

describe("which meetings can be answered (D284)", () => {
  it("answers a meeting someone else organizes with others on it", () => {
    expect(rsvpProblem(meeting())).toBeNull();
  });
  it("refuses one I organize, a FocusTime event, one with nobody else, and a cancelled one", () => {
    expect(rsvpProblem(meeting({ isOrganizer: true }))).toMatch(/You organize/);
    expect(rsvpProblem(meeting({ marker: "tb-1" }))).toMatch(/FocusTime's/);
    expect(rsvpProblem(meeting({ others: 0 }))).toMatch(/Nobody else/);
    expect(rsvpProblem(meeting({ isCancelled: true }))).toMatch(/cancelled/);
  });
});

describe("the request Graph gets (D284)", () => {
  const P = { start: "2026-11-03T15:00:00-06:00", end: "2026-11-03T15:30:00-06:00" };
  it("always tells the organizer, with the note only when there is one", () => {
    expect(rsvpBody("accepted")).toEqual({ sendResponse: true });
    expect(rsvpBody("declined", { comment: "Out that afternoon" })).toEqual({ sendResponse: true, comment: "Out that afternoon" });
  });
  it("sends a proposed new time in UTC for Tentative and Decline, never for Accept", () => {
    expect(rsvpBody("tentativelyAccepted", { proposed: P })).toEqual({ sendResponse: true, proposedNewTime: { start: { dateTime: "2026-11-03T21:00:00", timeZone: "UTC" }, end: { dateTime: "2026-11-03T21:30:00", timeZone: "UTC" } } });
    expect(rsvpBody("accepted", { proposed: P })).toEqual({ sendResponse: true });
  });
  it("checks a proposed time against the response and the meeting", () => {
    expect(proposalProblem("declined", P, true)).toBeNull();
    expect(proposalProblem("accepted", P, true)).toMatch(/only with Tentative or Decline/);
    expect(proposalProblem("declined", P, false)).toMatch(/doesn't allow/);
    expect(proposalProblem("declined", { start: P.end, end: P.start }, true)).toMatch(/ends after it starts/);
    expect(proposalProblem("declined", null, false)).toBeNull();
  });
});

describe("preview words (D284)", () => {
  it("names the response and who is notified, and says the organizer hears again on undo", () => {
    expect(responseLabel("tentativelyAccepted")).toBe("Tentative");
    expect(responseLabel("notResponded")).toBe("No response yet");
    expect(responseLabel("none")).toBe("No response yet");
    expect(rsvpVisibility("Dana Morales", false, true)).toBe("Dana Morales gets your response by email, with your note. The meeting itself isn't changed.");
    expect(rsvpVisibility("Dana Morales", true, false)).toMatch(/^Dana Morales is notified again/);
    expect(rsvpVisibility(null, false, false)).toMatch(/^The organizer gets/);
  });
});

describe("undo is a new response (D284)", () => {
  const F: Fields = { subject: "Sprint review", body: "", start: "2026-11-03T20:00:00Z", end: "2026-11-03T21:00:00Z", showAs: "busy", reminder: false, organizer: "Dana Morales" };
  const rec = (before: string, after: string) => ({ op: "update" as const, kind: "rsvp" as const, uid: "rsvp:M1", eventId: "M1", before: { ...F, response: before, comment: "old note" }, after: { ...F, response: after, comment: "Out that afternoon", proposed: { start: F.start, end: F.end } }, localBefore: null });
  it("restores the previous response with no note and no proposed time", () => {
    const u = undoOf(rec("tentativelyAccepted", "declined"))!;
    expect(u).toMatchObject({ op: "update", eventId: "M1", fields: { response: "tentativelyAccepted" } });
    expect(u.fields).not.toHaveProperty("comment");
    expect(u.fields).not.toHaveProperty("proposed");
  });
  it("has no undo when there was no response before", () => {
    expect(undoOf(rec("notResponded", "accepted"))).toBeNull();
    expect(undoOf(rec("none", "accepted"))).toBeNull();
  });
});

describe("overlap hint (D283)", () => {
  const blocks = [{ start: "2026-11-03T14:00:00Z", end: "2026-11-03T17:00:00Z", clientName: "Fabrikam" }, { start: "2026-11-03T18:00:00Z", end: "2026-11-03T22:00:00Z", clientName: "Contoso" }];
  it("names the focus block a meeting overlaps, and none when it doesn't", () => {
    expect(overlapHint({ start: "2026-11-03T16:30:00Z", end: "2026-11-03T17:00:00Z" }, blocks)).toBe("Overlaps your Fabrikam focus block");
    expect(overlapHint({ start: "2026-11-03T16:30:00Z", end: "2026-11-03T18:30:00Z" }, blocks)).toBe("Overlaps your Fabrikam and Contoso focus blocks");
    expect(overlapHint({ start: "2026-11-03T17:00:00Z", end: "2026-11-03T18:00:00Z" }, blocks)).toBeNull();
  });
});
