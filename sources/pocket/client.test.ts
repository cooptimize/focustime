// PK-2: the Pocket client makes one call (list recordings between two dates) and refuses everything else before the
// key is read or the network is used; one try with a time limit; each failure in its own words; the log lines hold
// the call's kind, status and time only; nothing of a recording comes out. Pretend Pocket only: no real key.
import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import type { LogRecord } from "../../log/logger.ts";
import { createDemoPocketFetch, DEMO_POCKET_KEYS, type PocketCall } from "../demo/pocket.ts";
import { allowedPocketCall, createPocketClient, keyProblem, POCKET_FAILURE_TEXT, POCKET_LIST_PATH, POCKET_ORIGIN, PocketError, PocketKey } from "./client.ts";

const KEY = "pk_test_0123456789abcdef";
const NOW = Date.parse("2026-11-17T15:00:00Z");
const LIST = `${POCKET_ORIGIN}${POCKET_LIST_PATH}`;

function setup(o: { timeoutMs?: number; fetch?: typeof fetch } = {}) {
  const calls: PocketCall[] = [];
  const logs: LogRecord[] = [];
  let keyReads = 0;
  const pretend = createDemoPocketFetch({ now: () => NOW, calls });
  let netCalls = 0;
  const f = (async (u: string | URL | Request, i?: RequestInit) => (netCalls++, (o.fetch ?? pretend)(u, i))) as typeof fetch;
  const client = createPocketClient({ fetch: f, log: (r) => logs.push(r), timeoutMs: o.timeoutMs ?? 200 });
  const key = (v = KEY) => async () => (keyReads++, new PocketKey(v));
  return { client, calls, logs, key, keyReads: () => keyReads, netCalls: () => netCalls };
}

describe("PK-2: the Pocket client", () => {
  it("counts the last 7 days with one GET for one item, and returns only the count", async () => {
    const t = setup();
    const r = await t.client.countLastWeek(t.key(), NOW);
    expect(r).toEqual({ recordings: 6 });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ method: "GET", authorized: true, url: `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=1&limit=1` });
    // Nothing of a recording comes out: not a title, a date or a word.
    expect(JSON.stringify(r)).not.toMatch(/Invented|rec-demo|2026-11-1[0-9]T/);
  });

  it.each([
    ["POST", LIST],
    ["DELETE", LIST],
    ["PATCH", LIST],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/recordings/rec-1`],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/recordings/rec-1/audio`],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/recordings/../search`],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/recordings%2Frec-1`],
    ["POST", `${POCKET_ORIGIN}/api/v1/public/search`],
    ["POST", `${POCKET_ORIGIN}/api/v1/public/recordings/upload-url`],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/tags`],
    ["GET", `${POCKET_ORIGIN}/api/v1/organization/org-1/api-keys`],
    ["GET", `https://evil.example/api/v1/public/recordings`],
    ["GET", `http://public.heypocketai.com/api/v1/public/recordings`],
    ["GET", `https://user:pw@public.heypocketai.com/api/v1/public/recordings`],
    ["GET", `${LIST}?include=transcript`],
    ["GET", `${LIST}?limit=500`],
    ["GET", `${LIST}?tag_ids=1`],
    ["GET", `${LIST}?page=1&page=2`],
    ["GET", `${LIST}#x`],
    ["GET", `${LIST}?start_date=2026-11-11%0A`],
  ])("refuses %s %s before the key is read or the network is used", async (method, url) => {
    const t = setup();
    await expect(t.client.request(method, url, t.key())).rejects.toMatchObject({ kind: "refused" });
    expect(t.keyReads()).toBe(0);
    expect(t.netCalls()).toBe(0);
    expect(t.logs).toEqual([{ source: "pocket", op: "refused", kind: "refused" }]);
  });

  it("allows only the list call with known parameters", () => {
    expect(allowedPocketCall("GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=1&limit=1`)).toBe("list");
    expect(allowedPocketCall("GET", LIST)).toBe("list");
    expect(allowedPocketCall("HEAD", LIST)).toBeNull();
  });

  it.each([
    [DEMO_POCKET_KEYS.wrong, "not_accepted", 401],
    [DEMO_POCKET_KEYS.busy, "busy", 429],
    [DEMO_POCKET_KEYS.slow, "no_answer", 0],
    [DEMO_POCKET_KEYS.odd, "unexpected", 200],
  ] as const)("a failure says its own words: %s → %s", async (key, kind, status) => {
    const t = setup();
    const e = (await t.client.countLastWeek(t.key(key), NOW).catch((x) => x)) as PocketError;
    expect(e).toBeInstanceOf(PocketError);
    expect(e).toMatchObject({ kind, status, message: POCKET_FAILURE_TEXT[kind] });
    // Tried once.
    expect(t.calls).toHaveLength(1);
    expect(e.message).not.toContain(key);
  });

  it("a server error is 'didn't answer', a 503 is busy, and an unknown 4xx is unexpected", async () => {
    for (const [status, kind] of [[500, "no_answer"], [503, "busy"], [404, "unexpected"]] as const) {
      const t = setup({ fetch: (async () => new Response("{}", { status })) as typeof fetch });
      await expect(t.client.countLastWeek(t.key(), NOW)).rejects.toMatchObject({ kind, status });
    }
  });

  it("logs the call's kind, status and time, never the key, a count or any of Pocket's answer", async () => {
    const t = setup();
    await t.client.countLastWeek(t.key(), NOW);
    await t.client.countLastWeek(t.key(DEMO_POCKET_KEYS.wrong), NOW).catch(() => null);
    await t.client.countLastWeek(t.key(DEMO_POCKET_KEYS.odd), NOW).catch(() => null);
    for (const l of t.logs) {
      expect(Object.keys(l).every((k) => ["source", "op", "status", "durationMs", "kind"].includes(k)), JSON.stringify(l)).toBe(true);
      expect(l.source).toBe("pocket");
    }
    const all = JSON.stringify(t.logs);
    expect(all).not.toMatch(/pk_|Invented|rec-demo|count/);
  });

  it("the key never prints, serializes or inspects as itself", () => {
    const k = new PocketKey(KEY);
    expect(String(k)).toBe("[Pocket key]");
    expect(JSON.stringify({ k })).toBe('{"k":"[Pocket key]"}');
    expect(inspect(k)).toBe("[Pocket key]");
    expect(k.bearer()).toBe(`Bearer ${KEY}`);
  });

  it("checks a pasted key's shape without echoing it", () => {
    expect(keyProblem("")).toMatch(/Paste/);
    expect(keyProblem("not a key")).toMatch(/one line/);
    expect(keyProblem("sk_abcdefgh")).toMatch(/start with pk_/);
    expect(keyProblem(KEY)).toBeNull();
    for (const v of ["not a key", "sk_abcdefgh"]) expect(keyProblem(v)).not.toContain(v);
  });
});
