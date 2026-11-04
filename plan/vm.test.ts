import { describe, expect, it } from "vitest";
import { canStart, chipOf, CHIP_LABEL, chipText, morningPrompt, powerFrom, reached, refreshMs, shutdownFrom, shutdownLabel } from "./vm.ts";

describe("power state", () => {
  it("reads PowerState/<x> from instanceView statuses, ignoring provisioning", () => {
    const st = (code: string) => [{ code: "ProvisioningState/succeeded" }, { code, displayStatus: "x" }];
    expect(powerFrom(st("PowerState/running"))).toBe("running");
    expect(powerFrom(st("PowerState/deallocated"))).toBe("deallocated");
    expect(powerFrom(st("PowerState/stopped"))).toBe("stopped");
    expect(powerFrom(st("PowerState/deallocating"))).toBe("deallocating");
    expect(powerFrom(st("PowerState/hibernated"))).toBe("unknown");
    expect(powerFrom([{ code: "ProvisioningState/updating" }])).toBe("unknown");
    expect(powerFrom(null)).toBe("unknown");
  });

  it("maps to the six chip states", () => {
    expect(CHIP_LABEL[chipOf("running", null)]).toBe("Running");
    expect(CHIP_LABEL[chipOf("deallocated", null)]).toBe("Stopped (deallocated)");
    expect(CHIP_LABEL[chipOf("stopped", null)]).toBe("Stopped (still billing)");
    expect(CHIP_LABEL[chipOf("starting", null)]).toBe("Starting…");
    expect(CHIP_LABEL[chipOf("deallocating", null)]).toBe("Stopping…");
    expect(CHIP_LABEL[chipOf("stopping", null)]).toBe("Stopping…");
    expect(CHIP_LABEL[chipOf("unknown", null)]).toBe("Unknown");
  });

  it("a start FocusTime asked for shows Starting… until Azure says running", () => {
    const t = { op: "start" as const, since: "2026-11-02T14:00:00Z" };
    expect(chipOf("deallocated", t)).toBe("starting");
    expect(chipOf("running", t)).toBe("running");
    expect(reached("start", "running")).toBe(true);
    expect(reached("start", "starting")).toBe(false);
    expect(refreshMs("starting")).toBe(10_000);
    expect(refreshMs("running")).toBe(60_000);
    expect(canStart("billing") && canStart("deallocated")).toBe(true);
    expect(canStart("running") || canStart("starting")).toBe(false);
  });
});

describe("auto-shutdown", () => {
  const body = { properties: { status: "Enabled", taskType: "ComputeVmShutdownTask", dailyRecurrence: { time: "1900" }, timeZoneId: "Eastern Standard Time", targetResourceId: "/x" } };
  it("reads the daily time, status and zone", () => {
    expect(shutdownFrom(body)).toEqual({ time: "1900", status: "Enabled", timeZoneId: "Eastern Standard Time" });
    expect(shutdownFrom({ properties: { dailyRecurrence: { time: "7pm" } } })).toBeNull();
    expect(shutdownFrom({})).toBeNull();
  });

  it("labels the time in my zone", () => {
    const s = shutdownFrom(body)!;
    expect(shutdownLabel(s, "America/New_York", "2026-11-02")).toBe("Auto-shutdown 7:00 PM");
    expect(shutdownLabel(s, "America/Chicago", "2026-11-02")).toBe("Auto-shutdown 6:00 PM");
    expect(shutdownLabel({ ...s, status: "Disabled" }, "America/New_York", "2026-11-02")).toBe("Auto-shutdown off");
    expect(shutdownLabel(null, "America/New_York", "2026-11-02")).toBeNull();
  });

  it("step 16.3: the header chip's line: state, plus the auto-shutdown time while it runs or starts", () => {
    const s = { time: "1930", status: "Enabled" as const, timeZoneId: "Eastern Standard Time" };
    const z = "America/New_York";
    expect(chipText("running", s, z, "2026-11-02")).toBe("Running · off at 7:30 PM");
    expect(chipText("starting", s, z, "2026-11-02")).toBe("Starting… · off at 7:30 PM");
    expect(chipText("running", { ...s, status: "Disabled" }, z, "2026-11-02")).toBe("Running · auto-shutdown off");
    expect(chipText("running", null, z, "2026-11-02")).toBe("Running");
    expect(chipText("deallocated", s, z, "2026-11-02")).toBe(CHIP_LABEL.deallocated);
    expect(chipText("stopping", s, z, "2026-11-02")).toBe(CHIP_LABEL.stopping);
    expect(chipText("unknown", s, z, "2026-11-02")).toBe("Unknown");
  });
});

describe("morning prompt", () => {
  const base = { chip: "deallocated" as const, workday: true, nowMin: 9 * 60, workStartMin: 9 * 60, dismissed: false };
  it("asks from work start on a workday when the VM is off", () => {
    expect(morningPrompt(base)).toBe(true);
    expect(morningPrompt({ ...base, chip: "billing" })).toBe(true);
    expect(morningPrompt({ ...base, nowMin: 8 * 60 + 59 })).toBe(false);
  });
  it("never when running, starting, unknown, dismissed, not a workday or no VM", () => {
    for (const chip of ["running", "starting", "stopping", "unknown"] as const) expect(morningPrompt({ ...base, chip })).toBe(false);
    expect(morningPrompt({ ...base, dismissed: true })).toBe(false);
    expect(morningPrompt({ ...base, workday: false })).toBe(false);
    expect(morningPrompt({ ...base, chip: null })).toBe(false);
    expect(morningPrompt({ ...base, workStartMin: null })).toBe(false);
  });
});
