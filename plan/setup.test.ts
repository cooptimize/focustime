// S1 (D451): who sees first-run setup, where it resumes, and Today's one quiet line.
import { describe, expect, it } from "vitest";
import { autoOpen, dismissFrom, leftLine, reachesEnd, remainingSteps, todayLine, type SetupState } from "./setup.ts";

const allDone: SetupState = { day: "done", clients: "done", blocks: "done", calendars: "done" };

describe("who sees the flow", () => {
  it("a new person (no record) sees it from the first step", () => {
    expect(autoOpen({ demo: false, state: {} })).toBe("day");
    expect(todayLine({ demo: false, state: {} })).toBeNull();
  });
  it("someone with settings from before setup (recorded done by the migration) never does", () => {
    expect(autoOpen({ demo: false, state: allDone })).toBeNull();
    expect(todayLine({ demo: false, state: allDone })).toBeNull();
  });
  it("never in demo mode", () => {
    expect(autoOpen({ demo: true, state: {} })).toBeNull();
    expect(todayLine({ demo: true, state: { day: "skipped" } })).toBeNull();
  });
});

describe("resume and skip", () => {
  it("signing out halfway resumes at the first step without a record", () => {
    expect(autoOpen({ demo: false, state: { day: "done" } })).toBe("clients");
    expect(autoOpen({ demo: false, state: { day: "done", clients: "skipped" } })).toBe("blocks");
  });
  it("skipping leaves the Today line, opening at the first step not done", () => {
    const state: SetupState = { day: "done", clients: "skipped", blocks: "skipped", calendars: "done" };
    expect(autoOpen({ demo: false, state })).toBeNull();
    // VM-2: the count includes Your VM (not done), but Your VM alone never brings the line back.
    expect(todayLine({ demo: false, state })).toEqual({ text: "3 setup steps left", step: "clients" });
    expect(todayLine({ demo: false, state: { ...allDone, calendars: "skipped" } })).toEqual({ text: "2 setup steps left", step: "calendars" });
  });
  it("closing the flow skips the rest (dismissed) without touching earlier steps, and it doesn't open by itself again", () => {
    const state: SetupState = { day: "done", ...dismissFrom({ day: "done" }, "clients") };
    expect(state).toEqual({ day: "done", clients: "dismissed", blocks: "dismissed", calendars: "dismissed", vm: "dismissed" });
    expect(autoOpen({ demo: false, state })).toBeNull();
    expect(remainingSteps(state)).toEqual(["clients", "blocks", "calendars", "vm"]);
    expect(todayLine({ demo: false, state })?.text).toBe("4 setup steps left");
  });
});

describe("RF-1: through to the end", () => {
  it("once stepped through, Day has no line even with steps skipped; what's left stays for Settings", () => {
    const state: SetupState = { day: "done", clients: "skipped", blocks: "skipped", calendars: "skipped" };
    expect(todayLine({ demo: false, state, through: true })).toBeNull();
    expect(todayLine({ demo: false, state, through: false })).toEqual({ text: "4 setup steps left", step: "clients" });
    expect(leftLine(state)).toEqual({ text: "4 setup steps left", step: "clients" });
    expect(leftLine({ ...allDone, vm: "done" })).toBeNull();
  });
  it("the end is the last step done or skipped, not closing the flow", () => {
    expect(reachesEnd("vm", "done")).toBe(true);
    expect(reachesEnd("vm", "skipped")).toBe(true);
    expect(reachesEnd("vm", "dismissed")).toBe(false);
    expect(reachesEnd("calendars", "done")).toBe(false);
  });
});

describe("VM-2: Your VM, a late step", () => {
  it("people who went through the four steps aren't asked again: no flow, no Today line; Settings shows it not done", () => {
    expect(autoOpen({ demo: false, state: allDone })).toBeNull();
    expect(todayLine({ demo: false, state: allDone })).toBeNull();
    expect(todayLine({ demo: false, state: { ...allDone, calendars: "skipped" }, through: true })).toBeNull();
    expect(leftLine(allDone)).toEqual({ text: "1 setup step left", step: "vm" });
    expect(remainingSteps(allDone)).toEqual(["vm"]);
  });
  it("a new person reaches it as the last screen, and it can be skipped", () => {
    expect(autoOpen({ demo: false, state: { ...allDone } })).toBeNull();
    expect(autoOpen({ demo: false, state: { day: "done", clients: "done", blocks: "skipped" } })).toBe("calendars");
    expect(reachesEnd("vm", "skipped")).toBe(true);
    expect(leftLine({ ...allDone, vm: "skipped" })).toEqual({ text: "1 setup step left", step: "vm" });
  });
});

