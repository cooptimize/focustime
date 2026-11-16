// HK-5, BT-1: the worker counts follow the machine (test/workers.ts): browser files by HK-5's rule, unit files on every
// idle CPU, SQL Server files capped so two sessions at once stay within what HK-5 measured as safe.
import { describe, expect, it } from "vitest";
import { SQL_MAX, sqlWorkers, testWorkers, unitWorkers } from "./workers.ts";

const GB = 1024 ** 3;

describe("browser workers (HK-5's rule)", () => {
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

describe("unit workers (BT-1): every core the machine has to give", () => {
  it("uses every CPU on CI's runner, whatever its load average", () => {
    expect(unitWorkers({ cpus: 4, load1: 3.5, freeBytes: 14 * GB, ci: true })).toBe(4);
    expect(unitWorkers({ cpus: 2, load1: 0, freeBytes: 6 * GB, ci: true })).toBe(2);
  });

  it("on a laptop takes the idle CPUs: a second session's suite takes its share first", () => {
    expect(unitWorkers({ cpus: 20, load1: 0.3, freeBytes: 20 * GB, ci: false })).toBe(19);
    expect(unitWorkers({ cpus: 20, load1: 14, freeBytes: 20 * GB, ci: false })).toBe(6);
    expect(unitWorkers({ cpus: 20, load1: 40, freeBytes: 20 * GB, ci: false })).toBe(1);
  });

  it("is capped by free memory (half a GB each beyond 2 GB), and is always at least one", () => {
    expect(unitWorkers({ cpus: 20, load1: 0, freeBytes: 5 * GB, ci: false })).toBe(6);
    expect(unitWorkers({ cpus: 20, load1: 0, freeBytes: 1 * GB, ci: false })).toBe(1);
  });

  it("FOCUSTIME_TEST_WORKERS sets it too", () => expect(unitWorkers({ cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false, override: "1" })).toBe(1));
});

describe("SQL Server workers (BT-1): the store isolation test stays well inside its time", () => {
  it(`is at most ${SQL_MAX} from one suite, so two sessions at once put at most 12 on the container (HK-5: 12 kept isolation at 63 s)`, () => {
    expect(SQL_MAX).toBe(6);
    const idleLaptop = sqlWorkers({ cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false });
    const second = sqlWorkers({ cpus: 20, load1: idleLaptop, freeBytes: 20 * GB, ci: false });
    expect(idleLaptop).toBe(6);
    expect(idleLaptop + second).toBeLessThanOrEqual(12);
  });

  it("on CI's four cores is two, as before BT-1, so the store isolation test keeps its time (the unit files get four)", () => {
    const ci = { cpus: 4, load1: 3.5, freeBytes: 14 * GB, ci: true };
    expect(sqlWorkers(ci)).toBe(2);
    expect(unitWorkers(ci)).toBe(4);
  });

  it("on a private repository's two-core runner is one, and the unit count is two", () => {
    const two = { cpus: 2, load1: 1.5, freeBytes: 6 * GB, ci: true };
    expect([sqlWorkers(two), unitWorkers(two), testWorkers(two)]).toEqual([1, 2, 1]);
  });

  it("FOCUSTIME_TEST_WORKERS sets it too", () => expect(sqlWorkers({ cpus: 20, load1: 0, freeBytes: 20 * GB, ci: false, override: "2" })).toBe(2));
});
