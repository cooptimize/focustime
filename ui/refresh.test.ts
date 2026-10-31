import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeekLoadData } from "../actions/types.ts";
import { afterLoad, createAutoRefresh, updatedAgo, type RefreshTrigger } from "./refresh.ts";

const MIN = 60_000;

function harness(opts: { hidden?: boolean; slow?: boolean } = {}) {
  const calls: RefreshTrigger[] = [];
  let release: () => void = () => {};
  const r = createAutoRefresh({
    now: () => Date.now(),
    isHidden: () => opts.hidden ?? false,
    refresh: (t) => {
      calls.push(t);
      return opts.slow ? new Promise<void>((res) => (release = res)) : Promise.resolve();
    },
  });
  return { r, calls, release: () => release() };
}

describe("auto refresh timing", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-11-02T13:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("window focus refetches at most once per 60 seconds", async () => {
    const { r, calls } = harness();
    expect(r.trigger("focus")).toBe(false); // just loaded
    await vi.advanceTimersByTimeAsync(59_000);
    expect(r.trigger("focus")).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.trigger("focus")).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.trigger("focus")).toBe(false);
    expect(calls).toEqual(["focus"]);
  });

  it("refetches quietly every 5 minutes", async () => {
    const { r, calls } = harness();
    r.start();
    await vi.advanceTimersByTimeAsync(4 * MIN + 59_000);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toEqual(["interval"]);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(calls).toEqual(["interval", "interval"]);
    r.stop();
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(calls).toHaveLength(2);
  });

  it("a manual or focus refresh pushes the next background one back", async () => {
    const { r, calls } = harness();
    r.start();
    await vi.advanceTimersByTimeAsync(4 * MIN);
    r.trigger("key");
    await vi.advanceTimersByTimeAsync(4 * MIN);
    expect(calls).toEqual(["key"]);
    await vi.advanceTimersByTimeAsync(1 * MIN + 30_000);
    expect(calls).toEqual(["key", "interval"]);
    r.stop();
  });

  it("the r key and the Refresh button always refetch, even right after a load", async () => {
    const { r, calls } = harness();
    expect(r.trigger("key")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.trigger("button")).toBe(true);
    expect(calls).toEqual(["key", "button"]);
  });

  it("never starts a second refresh while one is still running", async () => {
    const h = harness({ slow: true });
    expect(h.r.trigger("button")).toBe(true);
    expect(h.r.trigger("key")).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(h.r.trigger("focus")).toBe(false);
    h.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.r.trigger("key")).toBe(true);
  });

  it("skips background refreshes while the window is hidden; focus catches up", async () => {
    const { r, calls } = harness({ hidden: true });
    r.start();
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(calls).toEqual([]);
    expect(r.trigger("focus")).toBe(true);
    r.stop();
  });

  it("a failed refresh does not stop later ones", async () => {
    const calls: string[] = [];
    const r = createAutoRefresh({ refresh: async (t) => { calls.push(t); throw new Error("down"); } });
    r.trigger("key");
    await vi.advanceTimersByTimeAsync(0);
    expect(r.trigger("key")).toBe(true);
    expect(calls).toEqual(["key", "key"]);
  });
});

const data = (weekStart: string) => ({ weekStart }) as unknown as WeekLoadData;

describe("a load result never blanks the grid", () => {
  it("new data replaces old", () => {
    expect(afterLoad({ kind: "ready", data: data("a") }, { kind: "ok", data: data("b") })).toEqual({ kind: "ready", data: data("b") });
  });

  it("a failed refresh keeps the last good data and says so", () => {
    const prev = { kind: "ready", data: data("a") } as const;
    const next = afterLoad(prev, { kind: "error" });
    expect(next.kind).toBe("ready");
    expect(next.kind === "ready" && next.data).toBe(prev.data);
    expect(next.kind === "ready" && next.refreshError).toMatch(/Showing what was loaded earlier/);
  });

  it("the next good refresh clears the warning", () => {
    const failed = afterLoad({ kind: "ready", data: data("a") }, { kind: "error" });
    expect(afterLoad(failed, { kind: "ok", data: data("a") })).toEqual({ kind: "ready", data: data("a") });
  });

  it("with nothing loaded yet, a failure is shown as a failure", () => {
    expect(afterLoad({ kind: "loading" }, { kind: "error" }).kind).toBe("failed");
  });

  it("an expired session still shows the restart message", () => {
    expect(afterLoad({ kind: "ready", data: data("a") }, { kind: "session" }).kind).toBe("session");
  });
});

describe("updated N min ago", () => {
  const now = Temporal.Instant.from("2026-11-02T13:30:00Z").epochMilliseconds;
  const tz = "America/New_York";
  it.each([
    ["2026-11-02T13:29:30Z", "updated just now"],
    ["2026-11-02T13:29:00Z", "updated 1 min ago"],
    ["2026-11-02T13:01:00Z", "updated 29 min ago"],
    ["2026-11-02T10:00:00Z", "updated 3 h ago"],
    ["2026-10-30T15:00:00Z", "updated Oct 30"],
  ])("%s → %s", (at, want) => expect(updatedAgo(at, now, tz)).toBe(want));
});
