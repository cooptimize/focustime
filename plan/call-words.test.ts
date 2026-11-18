// MC-1d: each state a person can see has its words, the same for the mark, the list and the page (one function); a
// failed AI pass says so with its why, never "Nothing proposed"; a reviewer hears about a failed step only once
// FocusTime has stopped trying by itself. Fictional data only.
import { describe, expect, it } from "vitest";
import { AI_MESSAGES } from "../ai/types.ts";
import { aiFailedLine, aiNextLine, callLabel, CALL_STATE } from "./call-words.ts";
import { AI_RETRIES, nextRetry, nudgesFor, outcomeOf, parseOutcome, retryable, type MeetingSeries, type Occurrence } from "./meetings.ts";
import { notices } from "./notify.ts";

describe("MC-1d: a call's state in words", () => {
  const cases: [Parameters<typeof callLabel>[0], boolean, string, boolean][] = [
    [{ state: "waiting", open: 0 }, true, CALL_STATE.waiting, false],
    [{ state: "fetching", open: 0 }, false, CALL_STATE.waiting, false],
    [{ state: "ready", open: 6, proposals: 6 }, true, "Review 6 proposals", true],
    [{ state: "ready", open: 1, proposals: 1 }, true, "Review 1 proposal", true],
    [{ state: "ready", open: 6, proposals: 6 }, false, "6 proposals to review", false],
    [{ state: "ready", open: 0, proposals: 0 }, true, CALL_STATE.nothing, false],
    [{ state: "ready", open: 0, proposals: 3 }, true, CALL_STATE.reviewed, false],
    [{ state: "reviewed", open: 0, proposals: 3 }, true, CALL_STATE.reviewed, false],
    [{ state: "needs_upload", open: 0 }, true, CALL_STATE.upload, true],
    [{ state: "needs_upload", open: 0 }, false, CALL_STATE.waiting, false],
    [{ state: "needs_upload", open: 0, readFailed: true }, true, CALL_STATE.readFailed, true],
    [{ state: "no_transcript", open: 0 }, true, CALL_STATE.noTranscript, false],
    [{ state: "failed", open: 0, retryAt: null }, true, CALL_STATE.aiFailed, true],
    [{ state: "failed", open: 0, retryAt: "2026-11-10T17:15:00Z" }, true, CALL_STATE.aiFailed, false],
    [{ state: "failed", open: 0, retryAt: null }, false, CALL_STATE.aiFailed, false],
  ];
  it.each(cases)("%o as a reviewer %s: %s", (o, review, label, needsMe) => {
    expect(callLabel(o, review)).toEqual({ label, needsMe });
  });

  it("a failed pass's line names the AI step and its why; FocusTime's own failures aren't the AI service's", () => {
    expect(aiFailedLine("done")).toBeNull();
    expect(aiFailedLine(null)).toBeNull();
    expect(aiFailedLine("timeout")).toBe("The AI step failed: the AI service didn't answer in time.");
    expect(aiFailedLine("provider")).toBe(`The AI step failed: ${AI_MESSAGES.provider.replace(/^The/, "the")}.`);
    expect(aiFailedLine("not_set_up")).toBe("The AI step failed: AI isn't set up.");
    expect(aiFailedLine("no_context")).not.toContain("AI service");
    expect(aiFailedLine("provider_refused")).toBe(aiFailedLine("provider"));
    expect(aiFailedLine("no_ai")).toContain("Admin › AI");
    expect(aiFailedLine("provider@2/3")).toContain("The call was sent in 3 parts and part 2 failed, so nothing was proposed");
    for (const k of Object.keys(AI_MESSAGES)) expect(aiFailedLine(k)).not.toMatch(/Nothing to propose/);
  });

  it("what happens next: tries by itself (production), stopped after three, or a person fixes it first", () => {
    const at = () => "3:15 PM";
    expect(aiNextLine({ retryAt: "2026-11-10T20:15:00Z", tries: 0, retryable: true, retriesHere: true, at })).toBe(`FocusTime tries again by itself at 3:15 PM (1 of ${AI_RETRIES}). A reviewer can Propose again now.`);
    expect(aiNextLine({ retryAt: null, tries: 3, retryable: true, retriesHere: true, at })).toMatch(/tried again 3 times and stopped/);
    expect(aiNextLine({ retryAt: null, tries: 0, retryable: true, retriesHere: false, at })).toBe("A reviewer can Propose again.");
    expect(aiNextLine({ retryAt: null, tries: 0, retryable: false, retriesHere: true, at })).toMatch(/doesn't try this one again by itself/);
  });

  it("which failures are retried, and the stored outcome of a call sent in parts", () => {
    for (const k of ["rate_limited", "timeout", "provider", "invalid_output", "no_context"]) expect(retryable(k), k).toBe(true);
    for (const k of ["provider_refused", "no_ai", "off", "client_off", "not_set_up", "over_budget", "zero_budget", "quota", "refused_client", "refused_secret", "refused_email", "bad_task"]) expect(retryable(k), k).toBe(false);
    expect(outcomeOf("timeout")).toBe("timeout");
    expect(outcomeOf("timeout", 2, 3)).toBe("timeout@2/3");
    expect(outcomeOf("timeout", 1, 1)).toBe("timeout");
    expect(parseOutcome("timeout@2/3")).toEqual({ kind: "timeout", part: 2, parts: 3 });
    expect(parseOutcome("no_ai")).toEqual({ kind: "no_ai", part: null, parts: 1 });
    const now = "2026-11-10T17:00:00Z";
    expect(nextRetry("timeout", 0, now)).toBe("2026-11-10T17:15:00Z");
    expect(nextRetry("timeout", 2, now)).toBe("2026-11-10T17:15:00Z");
    expect(nextRetry("timeout", 3, now)).toBeNull();
    expect(nextRetry("over_budget", 0, now)).toBeNull();
  });

  it("a reviewer hears about a failed step once FocusTime stopped trying; an attendee never", () => {
    const s = { id: 1, clientKey: "contoso", name: "Contoso sync", reviewers: ["rev"], attendees: ["att"], removedAt: null } as unknown as MeetingSeries;
    const o = (p: Partial<Occurrence>): Occurrence => ({ id: 7, seriesId: 1, date: "2026-11-10", startAt: "", endAt: "", state: "failed", nextCheckAt: null, checks: 3, transcriptFrom: "upload", transcriptAt: null, aiOutcome: "timeout", dismissedBy: null, reviewedBy: null, lastRead: null, eventKey: null, updatedAt: "", ...p });
    expect(nudgesFor("rev", [s], [o({ nextCheckAt: "2026-11-10T17:15:00Z" })])).toEqual([]);
    expect(nudgesFor("rev", [s], [o({})]).map((n) => [n.kind, n.key])).toEqual([["failed", "meeting_failed:7"]]);
    expect(nudgesFor("att", [s], [o({})])).toEqual([]);
    const n = notices.meetingReview("meeting_failed:7", 7, "failed", "Contoso", "Contoso sync", "Tue, Nov 10", "2026-11-10T18:00:00Z");
    expect([n.title, n.body]).toEqual(["Contoso's call: the AI step failed", "Contoso sync · Tue, Nov 10\nNothing was proposed. Open the call to see why, then Propose again."]);
    expect(n.body).not.toMatch(/ready to review/);
  });
});
