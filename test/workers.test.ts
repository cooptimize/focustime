// HK-5: the worker count follows the machine (test/workers.ts).
import { describe, expect, it } from "vitest";
import { testWorkers } from "./workers.ts";

const GB = 1024 ** 3;

describe("test workers", () => {
  it("takes 60% of the idle CPUs, leaves out what is already busy, never more than CPUs − 1", () => {
    expect(testWorkers({ cpus: 20, load1: 0.3, freeBytes: 20 * GB, ci: false })).toBe(11);
    expect(testWorkers({ cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false })).toBe(12);
    // Another session's suite already running: this one takes what's left.
    expect(testWorkers({ cpus: 20, load1: 14, freeBytes: 20 * GB, ci: false })).toBe(3);
    expect(testWorkers({ cpus: 2, load1: 0, freeBytes: 8 * GB, ci: false })).toBe(1);
  });

  it("on CI ignores the load average (npm ci and apt just ran; the runner is ours alone)", () => {
    expect(testWorkers({ cpus: 4, load1: 3.5, freeBytes: 14 * GB, ci: true })).toBe(2);
  });

  it("is capped by free memory, and is always at least one", () => {
    expect(testWorkers({ cpus: 20, load1: 0, freeBytes: 6 * GB, ci: false })).toBe(4);
    expect(testWorkers({ cpus: 20, load1: 40, freeBytes: 1 * GB, ci: false })).toBe(1);
  });

  it("FOCUSTIME_TEST_WORKERS sets it; anything but a positive whole number is ignored", () => {
    expect(testWorkers({ cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false, override: "3" })).toBe(3);
    expect(testWorkers({ cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false, override: "lots" })).toBe(12);
  });
});
