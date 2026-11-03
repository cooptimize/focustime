// S1 (D451): who sees first-run setup, where it resumes, and Today's one quiet line.
import { describe, expect, it } from "vitest";
import { autoOpen, dismissFrom, remainingSteps, todayLine, type SetupState } from "./setup.ts";

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
    expect(todayLine({ demo: false, state })).toEqual({ text: "2 setup steps left", step: "clients" });
    expect(todayLine({ demo: false, state: { ...allDone, calendars: "skipped" } })).toEqual({ text: "1 setup step left", step: "calendars" });
  });
  it("closing the flow skips the rest (dismissed) without touching earlier steps, and it doesn't open by itself again", () => {
    const state: SetupState = { day: "done", ...dismissFrom({ day: "done" }, "clients") };
    expect(state).toEqual({ day: "done", clients: "dismissed", blocks: "dismissed", calendars: "dismissed" });
    expect(autoOpen({ demo: false, state })).toBeNull();
    expect(remainingSteps(state)).toEqual(["clients", "blocks", "calendars"]);
    expect(todayLine({ demo: false, state })?.text).toBe("3 setup steps left");
  });
});
