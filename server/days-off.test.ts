// NT-1: the one day-off reader every part of a person's background asks (server/days-off.ts).
import { describe, expect, it, vi } from "vitest";
import { parseConfig, type AppConfig } from "../config/schema.ts";
import { setValue } from "../config/edit.ts";
import { starterToml } from "../config/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { DAY_OFF_READ_LIMIT_MS, daysOffReader, isDayOff, type DaysOffRead } from "./days-off.ts";

const NY = "America/New_York";
const cfg = (() => {
  const p = parseConfig(setValue(setValue(starterToml(NY), "dataverse", "my_email", "ana@example.com"), "dataverse", "my_systemuserid", "11111111-2222-4333-8444-555566667777"));
  if (!p.ok) throw new Error("bad config");
  return p.config as AppConfig;
})();

function reader(o: { production?: boolean; pto?: string[] | null; holidays?: string[] | null } = {}) {
  let at = Temporal.Instant.from("2026-11-02T13:54:00Z"); // Mon 8:54 AM in New York.
  const calls: string[] = [];
  const logs: LogRecord[] = [];
  const read: DaysOffRead = async (_c, from, to) => {
    calls.push(`${from}..${to}`);
    return { pto: o.pto === null ? null : new Set(o.pto ?? []), holidays: o.holidays === null ? null : new Set(o.holidays ?? []) };
  };
  const r = daysOffReader({ production: o.production ?? true, read: async () => read, now: () => at, log: (x) => void logs.push(x) });
  return { r, calls, logs, advance: (m: number) => void (at = at.add({ minutes: m })) };
}

describe("NT-1: one day-off answer per person per day", () => {
  it("the VM start's read and the notices' answer come from one read", async () => {
    const x = reader({ pto: ["2026-11-02"] });
    const start = await x.r.read(cfg, "2026-11-02", "2026-11-02");
    const chip = await x.r.read(cfg, "2026-11-02", "2026-11-15");
    const gate = await x.r.day(cfg, "2026-11-02");
    expect(start.pto?.has("2026-11-02")).toBe(true);
    expect(chip.pto?.has("2026-11-02")).toBe(true);
    expect(gate).toEqual({ pto: true, holiday: false });
    expect(x.calls).toEqual(["2026-11-02..2026-11-15"]);
  });

  it("read again after 30 minutes, not before; a range outside the window (the pause check) is read on its own", async () => {
    const x = reader();
    await x.r.day(cfg, "2026-11-02");
    x.advance(29);
    await x.r.day(cfg, "2026-11-02");
    expect(x.calls).toHaveLength(1);
    x.advance(1);
    await x.r.day(cfg, "2026-11-02");
    expect(x.calls).toHaveLength(2);
    await x.r.read(cfg, "2026-10-29", "2026-11-02");
    expect(x.calls.at(-1)).toBe("2026-10-29..2026-11-02");
  });

  it("a company holiday is a day off; holidays that can't be read are a working day", async () => {
    expect(await reader({ holidays: ["2026-11-02"] }).r.day(cfg, "2026-11-02")).toEqual({ pto: false, holiday: true });
    expect(await reader({ holidays: null }).r.day(cfg, "2026-11-02")).toEqual({ pto: false, holiday: false });
  });

  it("PTO that can't be read and no recent read: unknown, and each caller decides", async () => {
    const a = await reader({ pto: null }).r.day(cfg, "2026-11-02");
    expect(a).toEqual({ pto: null, holiday: false });
    expect(isDayOff(a, false)).toBe(false);
    expect(isDayOff(a, true)).toBe(true);
  });

  it("outside production nothing is read and the answer is not a day off", async () => {
    const x = reader({ production: false, pto: ["2026-11-02"] });
    expect(await x.r.day(cfg, "2026-11-02")).toEqual({ pto: false, holiday: false });
    expect(x.calls).toEqual([]);
  });

  it("log lines carry the kind only", async () => {
    const x = reader({ pto: null, holidays: null });
    await x.r.day(cfg, "2026-11-02");
    for (const l of x.logs) expect(Object.keys(l).sort()).toEqual(["kind", "op", "source"]);
  });

  it("a failed read kept for the notices doesn't decide the VM start: the start reads again", async () => {
    let fail = true;
    const calls: string[] = [];
    const read: DaysOffRead = async (_c, from, to) => (calls.push(`${from}..${to}`), fail ? { pto: null, holidays: null } : { pto: new Set(["2026-11-02"]), holidays: new Set() });
    const r = daysOffReader({ production: true, read: async () => read, now: () => Temporal.Instant.from("2026-11-02T13:40:00Z"), log: () => {} });
    expect((await r.day(cfg, "2026-11-02")).pto).toBeNull();
    expect((await r.day(cfg, "2026-11-02")).pto).toBeNull();
    expect(calls).toHaveLength(1);
    fail = false;
    expect((await r.read(cfg, "2026-11-02", "2026-11-02")).pto?.has("2026-11-02")).toBe(true);
    expect(calls).toHaveLength(2);
    // And the notices now have that fresh answer.
    expect((await r.day(cfg, "2026-11-02")).pto).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("a read that never answers is unread after a minute, and the next one tries again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let hang = true;
      const read: DaysOffRead = async () => (hang ? new Promise(() => {}) : { pto: new Set(), holidays: new Set() });
      const r = daysOffReader({ production: true, read: async () => read, now: () => Temporal.Instant.from("2026-11-02T13:40:00Z"), log: () => {} });
      const first = r.read(cfg, "2026-11-02", "2026-11-02");
      await vi.advanceTimersByTimeAsync(DAY_OFF_READ_LIMIT_MS);
      expect(await first).toEqual({ pto: null, holidays: null });
      hang = false;
      expect(await r.read(cfg, "2026-11-02", "2026-11-02")).toEqual({ pto: new Set(), holidays: new Set() });
    } finally {
      vi.useRealTimers();
    }
  });
});
