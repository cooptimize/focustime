// A3: the SQL Server driver's rules that need no server: which errors are retried and how long, and how times go in
// and come back. (The store tests run the driver itself against the container.)
import { describe, expect, it } from "vitest";
import { RETRY_WAITS_MS, showTime, transient, utcText, withRetry, type DbStatus } from "./sqlserver.ts";

/** An error as the mssql driver raises it: a RequestError or ConnectionError wrapping the server's number. */
const sqlError = (number: number) => Object.assign(new Error(`SQL error ${number}`), { name: "RequestError", originalError: { number } });
const connError = (code: string) => Object.assign(new Error("connection"), { name: "ConnectionError", code });

describe("the retry rule (A3)", () => {
  it("retries Azure SQL's transient errors and dropped connections, and nothing else", () => {
    for (const n of [40613, 40197, 40501, 49918, 4060, 1205]) expect(transient(sqlError(n)).retry, String(n)).toBe(true);
    for (const c of ["ESOCKET", "ECONNRESET", "ETIMEOUT"]) expect(transient(connError(c)).retry, c).toBe(true);
    for (const n of [2627, 547, 208, 102]) expect(transient(sqlError(n)).retry, String(n)).toBe(false);
    expect(transient(new Error("plain")).retry).toBe(false);
    // A paused serverless database answers 40613 while it resumes.
    expect(transient(sqlError(40613)).waking).toBe(true);
    expect(transient(sqlError(1205)).waking).toBe(false);
  });

  it("waits 5 s first, then longer, 60 s in all, and says Waking up while a paused database resumes", async () => {
    expect(RETRY_WAITS_MS[0]).toBe(5_000);
    expect(RETRY_WAITS_MS.reduce((a, b) => a + b, 0)).toBe(60_000);
    const slept: number[] = [];
    const states: DbStatus[] = [];
    let calls = 0;
    const out = await withRetry(
      async () => {
        if (++calls < 3) throw sqlError(40613);
        return "rows";
      },
      { sleep: async (ms) => void slept.push(ms), status: (s) => states.push(s) },
    );
    expect(out).toBe("rows");
    expect(slept).toEqual([5_000, 10_000]);
    expect(states).toEqual(["waking", "waking", "ok"]);
  });

  it("gives up after the last wait with the error, and the status says unavailable", async () => {
    const states: DbStatus[] = [];
    let calls = 0;
    const err = sqlError(40501);
    await expect(withRetry(async () => { calls++; throw err; }, { sleep: async () => {}, status: (s) => states.push(s) })).rejects.toBe(err);
    expect(calls).toBe(RETRY_WAITS_MS.length + 1);
    expect(states.at(-1)).toBe("unavailable");
  });

  it("doesn't retry a real error (a broken key, a bad statement)", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw sqlError(2627); }, { sleep: async () => {}, status: () => {} })).rejects.toThrow("2627");
    expect(calls).toBe(1);
  });
});

describe("times on SQL Server (A3)", () => {
  it("a stamp goes in as UTC with 7 digits", () => {
    expect(utcText("2026-11-02T09:30:00-05:00[America/New_York]")).toBe("2026-11-02T14:30:00.0000000");
    expect(utcText("2026-11-02T14:30:00.123456789Z")).toBe("2026-11-02T14:30:00.1234567");
  });

  it("comes back in the person's zone, or as an instant where the column holds one", () => {
    const d = new Date("2026-11-02T14:30:00Z");
    expect(showTime(d, "picks", "updated_at", "America/New_York")).toBe("2026-11-02T09:30:00-05:00[America/New_York]");
    expect(showTime(d, "focus_log", "started_at", "America/New_York")).toBe("2026-11-02T14:30:00Z");
    expect(showTime(d, "users", "created_at", "America/New_York")).toBe("2026-11-02T14:30:00Z");
    const fine = Object.assign(new Date("2026-11-02T14:30:00.123Z"), { nanosecondsDelta: 0.0004567 });
    expect(showTime(fine, "focus_log", "ended_at", undefined)).toBe("2026-11-02T14:30:00.1234567Z");
  });
});
