// Step 16.3: Teams presence rules (my status during focus, teammates' presence words).
import { describe, expect, it } from "vitest";
import { afterStep, availableFirst, checkDue, DEFAULT_TEAMS_STATUS, expiryMinutes, focusGoal, isoDuration, manualChange, NO_TEAMS_STATUS, presenceWord, setBody, teamsStep, type FocusSession, type TeamsStatusState } from "./presence.ts";

const T0 = "2026-11-02T15:00:00Z";
const at = (min: number) => Temporal.Instant.from(T0).add({ seconds: Math.round(min * 60) }).toString();
const focus = (o: Partial<NonNullable<FocusSession>> = {}): FocusSession => ({ kind: "focus", startedAt: T0, running: true, ended: false, deep: false, plannedMinutes: 50, remainingMs: 50 * 60_000, ...o });
const S = DEFAULT_TEAMS_STATUS;

/** Runs steps like the server does: each successful step updates the state. */
function run(state: TeamsStatusState, s: FocusSession, now: string, settings = S) {
  const step = teamsStep(state, s, settings, now);
  return { step, state: afterStep(state, step, s, now) };
}

describe("words for teammates (never color alone; unknown shows nothing)", () => {
  it("maps availability and activity to one word", () => {
    expect(presenceWord("Available", "Available")).toBe("Available");
    expect(presenceWord("AvailableIdle", "Available")).toBe("Available");
    expect(presenceWord("Busy", "Busy")).toBe("Busy");
    expect(presenceWord("Busy", "InAMeeting")).toBe("In a meeting");
    expect(presenceWord("Busy", "InACall")).toBe("In a meeting");
    expect(presenceWord("DoNotDisturb", "Presenting")).toBe("Do not disturb");
    expect(presenceWord("Focusing", "Focusing")).toBe("Do not disturb");
    expect(presenceWord("Away", "Away")).toBe("Away");
    expect(presenceWord("BeRightBack", "BeRightBack")).toBe("Be right back");
    expect(presenceWord("Offline", "OffWork")).toBe("Offline");
  });
  it("unknown, missing or odd values give null (show nothing rather than a guess)", () => {
    for (const a of ["PresenceUnknown", "", null, undefined, 3, "Something"]) expect(presenceWord(a, "x")).toBeNull();
  });
  it("Ask to collaborate puts Available now first within a tier, keeping the rest in order", () => {
    const words: Record<string, ReturnType<typeof presenceWord>> = { a: "Busy", b: "Available", c: null, d: "Available", e: "Away" };
    expect(availableFirst(["a", "b", "c", "d", "e"], (x) => words[x] ?? null)).toEqual(["b", "d", "a", "c", "e"]);
  });
});

describe("expiration: the time left plus 5 minutes", () => {
  it("rounds up to whole minutes and adds 5", () => {
    expect(expiryMinutes(50 * 60_000)).toBe(55);
    expect(expiryMinutes(49 * 60_000 + 1)).toBe(55);
    expect(expiryMinutes(0)).toBe(5);
    expect(expiryMinutes(-1)).toBe(5);
    expect(expiryMinutes(240 * 60_000)).toBe(245);
  });
  it("as an ISO 8601 duration", () => {
    expect(isoDuration(55)).toBe("PT55M");
    expect(isoDuration(60)).toBe("PT1H");
    expect(isoDuration(65)).toBe("PT1H5M");
    expect(isoDuration(5)).toBe("PT5M");
  });
  it("the request body sets the same value as availability and activity", () => {
    expect(setBody("Busy", 55)).toEqual({ availability: "Busy", activity: "Busy", expirationDuration: "PT55M" });
    expect(setBody("DoNotDisturb", 20)).toEqual({ availability: "DoNotDisturb", activity: "DoNotDisturb", expirationDuration: "PT20M" });
  });
});

describe("what my status should be", () => {
  it("Busy for focus, Do not disturb for deep focus; nothing for breaks, paused, ended or no session", () => {
    expect(focusGoal(focus(), S)).toBe("Busy");
    expect(focusGoal(focus({ deep: true }), S)).toBe("DoNotDisturb");
    expect(focusGoal(focus({ kind: "break" }), S)).toBeNull();
    expect(focusGoal(focus({ running: false }), S)).toBeNull();
    expect(focusGoal(focus({ ended: true, running: false }), S)).toBeNull();
    expect(focusGoal(null, S)).toBeNull();
  });
  it("Settings: off sets nothing; plain focus can leave status alone while deep focus still sets Do not disturb", () => {
    expect(focusGoal(focus({ deep: true }), { teamsStatus: false, plainFocus: "busy" })).toBeNull();
    expect(focusGoal(focus(), { teamsStatus: true, plainFocus: "none" })).toBeNull();
    expect(focusGoal(focus({ deep: true }), { teamsStatus: true, plainFocus: "none" })).toBe("DoNotDisturb");
  });
});

describe("set and clear over a session", () => {
  it("start sets Busy with the expiration; nothing more while unchanged", () => {
    const a = run(NO_TEAMS_STATUS, focus(), T0);
    expect(a.step).toEqual({ do: "set", status: "Busy", minutes: 55, key: `${T0}|50|Busy` });
    expect(a.state).toMatchObject({ session: T0, set: "Busy", until: at(55), manual: false });
    expect(run(a.state, focus({ remainingMs: 40 * 60_000 }), at(10)).step).toEqual({ do: "none" });
  });
  it("+15 sets again with a fresh expiration; switching to deep focus sets Do not disturb", () => {
    const a = run(NO_TEAMS_STATUS, focus(), T0).state;
    const b = run(a, focus({ plannedMinutes: 65, remainingMs: 45 * 60_000 }), at(20));
    expect(b.step).toEqual({ do: "set", status: "Busy", minutes: 50, key: `${T0}|65|Busy` });
    expect(b.state.until).toBe(at(70));
    expect(run(b.state, focus({ plannedMinutes: 65, remainingMs: 44 * 60_000, deep: true }), at(21)).step).toMatchObject({ do: "set", status: "DoNotDisturb", minutes: 49 });
  });
  it("every way a session ends clears: stop or done (no timer), ended on time, paused, switched to a break, turned off", () => {
    const set = run(NO_TEAMS_STATUS, focus(), T0).state;
    const ends: [string, FocusSession, typeof S][] = [
      ["stop, done, next with nothing left, or abandoned", null, S],
      ["ended on time", focus({ running: false, ended: true, remainingMs: 0 }), S],
      ["paused", focus({ running: false }), S],
      ["a break started", focus({ kind: "break", startedAt: at(30) }), S],
      ["Settings turned it off", focus(), { teamsStatus: false, plainFocus: "busy" }],
    ];
    for (const [name, s, settings] of ends) {
      const r = run(set, s, at(30), settings);
      expect(r.step, name).toEqual({ do: "clear" });
      expect(r.state.set, name).toBeNull();
      // Once cleared, nothing more.
      expect(run(r.state, s, at(31), settings).step, name).toEqual({ do: "none" });
    }
  });
  it("resume after a pause sets it again", () => {
    const paused = run(run(NO_TEAMS_STATUS, focus(), T0).state, focus({ running: false, remainingMs: 30 * 60_000 }), at(20)).state;
    expect(run(paused, focus({ remainingMs: 30 * 60_000 }), at(25)).step).toMatchObject({ do: "set", status: "Busy", minutes: 35 });
  });
  it("Next pick (a new session) sets again for the new one", () => {
    const a = run(NO_TEAMS_STATUS, focus(), T0).state;
    expect(run(a, focus({ startedAt: at(40), plannedMinutes: 60, remainingMs: 60 * 60_000 }), at(40)).step).toMatchObject({ do: "set", minutes: 65 });
  });
  it("a failure waits a minute before trying again", () => {
    const failed: TeamsStatusState = { ...NO_TEAMS_STATUS, error: "Teams unreachable", errorAt: T0 };
    expect(teamsStep(failed, focus(), S, at(0.5)).do).toBe("none");
    expect(teamsStep(failed, focus(), S, at(1)).do).toBe("set");
  });
});

describe("a status I set by hand in Teams wins until the next session", () => {
  const set = run(NO_TEAMS_STATUS, focus(), T0).state;
  it("read a minute after setting; another availability is a manual change; Offline or unknown is not", () => {
    expect(checkDue(set, at(0.5))).toBe(false);
    expect(checkDue(set, at(1))).toBe(true);
    expect(manualChange(set, "Available", at(0.5))).toBe(false);
    expect(manualChange(set, "Available", at(2))).toBe(true);
    expect(manualChange(set, "DoNotDisturb", at(2))).toBe(true);
    for (const same of ["Busy", "InAMeeting", "InACall", "Offline", "PresenceUnknown", null]) expect(manualChange(set, same, at(2)), String(same)).toBe(false);
    const dnd = run(NO_TEAMS_STATUS, focus({ deep: true }), T0).state;
    expect(manualChange(dnd, "Presenting", at(2))).toBe(false);
    expect(manualChange(dnd, "Busy", at(2))).toBe(true);
  });
  it("after a manual change: no more sets this session (extend, deep), and the end leaves it alone", () => {
    const manual: TeamsStatusState = { ...set, manual: true };
    expect(checkDue(manual, at(5))).toBe(false);
    expect(teamsStep(manual, focus({ plannedMinutes: 65 }), S, at(10)).do).toBe("none");
    expect(teamsStep(manual, focus({ deep: true }), S, at(10)).do).toBe("none");
    expect(teamsStep(manual, null, S, at(50)).do).toBe("none");
    expect(teamsStep(manual, focus({ running: false, ended: true }), S, at(50)).do).toBe("none");
  });
  it("the next session sets again and forgets the manual change", () => {
    const manual: TeamsStatusState = { ...set, manual: true };
    const next = run(manual, focus({ startedAt: at(60) }), at(60));
    expect(next.step).toMatchObject({ do: "set", status: "Busy" });
    expect(next.state.manual).toBe(false);
  });
});
