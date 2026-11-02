// Step 16.3: Graph presence request shapes, batching and what is (not) kept or logged.
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { HttpError } from "../calendar/http.ts";
import { createPresenceClient, PRESENCE_BATCH } from "./presence.ts";

const ME = "11111111-2222-4333-8444-555555555555";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup(answer: (url: string, body: unknown) => { status: number; json?: unknown } = () => ({ status: 200, json: {} })) {
  const calls: { url: string; method: string; body: unknown; auth: string }[] = [];
  const logs: LogRecord[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", body, auth: String((init.headers as Record<string, string>).authorization) });
    const a = answer(url, body);
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status });
  }) as unknown as typeof globalThis.fetch;
  let invalidated = 0;
  const c = createPresenceClient({ fetch, token: async () => "tok-secret", invalidate: () => void invalidated++, log: (r) => logs.push(r) });
  return { c, calls, logs, invalidated: () => invalidated };
}

describe("my status", () => {
  it("set: POST setUserPreferredPresence on my user with availability, activity and the expiration", async () => {
    const s = setup();
    await s.c.setMine(ME, "Busy", 55);
    expect(s.calls).toEqual([{ url: `https://graph.microsoft.com/v1.0/users/${ME}/presence/setUserPreferredPresence`, method: "POST", body: { availability: "Busy", activity: "Busy", expirationDuration: "PT55M" }, auth: "Bearer tok-secret" }]);
    await s.c.setMine(ME, "DoNotDisturb", 65);
    expect(s.calls[1]!.body).toEqual({ availability: "DoNotDisturb", activity: "DoNotDisturb", expirationDuration: "PT1H5M" });
  });
  it("clear: POST clearUserPreferredPresence with an empty object", async () => {
    const s = setup();
    await s.c.clearMine(ME);
    expect(s.calls).toEqual([{ url: `https://graph.microsoft.com/v1.0/users/${ME}/presence/clearUserPreferredPresence`, method: "POST", body: {}, auth: "Bearer tok-secret" }]);
  });
  it("refuses anything but an object id as my user (no other paths)", async () => {
    const s = setup();
    await expect(s.c.setMine("../me", "Busy", 10)).rejects.toBeInstanceOf(HttpError);
    expect(s.calls).toEqual([]);
  });
  it("reads my presence: availability and activity only", async () => {
    const s = setup(() => ({ status: 200, json: { id: ME, availability: "Available", activity: "Available", statusMessage: { message: { content: "secret note" } }, outOfOfficeSettings: { message: "away note" } } }));
    expect(await s.c.mine()).toEqual({ availability: "Available", activity: "Available" });
    expect(s.calls[0]).toMatchObject({ url: "https://graph.microsoft.com/v1.0/me/presence", method: "GET" });
  });
  it("a 401 refreshes the token once; other errors carry only the status", async () => {
    let n = 0;
    const s = setup(() => (n++ === 0 ? { status: 401 } : { status: 200 }));
    await s.c.clearMine(ME);
    expect(s.invalidated()).toBe(1);
    const f = setup(() => ({ status: 403, json: { error: { message: "body text" } } }));
    const e = await f.c.setMine(ME, "Busy", 10).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(String(e)).not.toContain("body text");
  });
});

describe("teammates", () => {
  it("one batched request for everyone on screen; only id, availability and activity kept", async () => {
    const s = setup((_u, b) => ({ status: 200, json: { value: (b as { ids: string[] }).ids.map((x) => ({ id: x, availability: "Busy", activity: "InAMeeting", statusMessage: { message: { content: "private" } }, outOfOfficeSettings: { message: "ooo", isOutOfOffice: true }, workLocation: { workLocationType: "office" } })) } }));
    const r = await s.c.people([id(1), id(2), id(1).toUpperCase(), "not-a-guid"]);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ url: "https://graph.microsoft.com/v1.0/communications/getPresencesByUserId", method: "POST", body: { ids: [id(1), id(2)] } });
    expect([...r.entries()]).toEqual([[id(1), { availability: "Busy", activity: "InAMeeting" }], [id(2), { availability: "Busy", activity: "InAMeeting" }]]);
    expect(JSON.stringify([...r])).not.toMatch(/private|ooo|office/);
  });
  it("splits at Graph's 650 per request", async () => {
    const s = setup(() => ({ status: 200, json: { value: [] } }));
    await s.c.people(Array.from({ length: PRESENCE_BATCH + 3 }, (_, i) => id(i + 1)));
    expect(s.calls.map((c) => (c.body as { ids: string[] }).ids.length)).toEqual([PRESENCE_BATCH, 3]);
  });
  it("logs only op, status, count and duration: no ids, tokens or bodies", async () => {
    const s = setup(() => ({ status: 200, json: { value: [{ id: id(1), availability: "Away", activity: "Away" }] } }));
    await s.c.people([id(1)]);
    await s.c.setMine(ME, "Busy", 10);
    const text = JSON.stringify(s.logs);
    expect(s.logs.map((l) => l.op)).toEqual(["presence_people", "presence_set"]);
    for (const bad of [id(1), ME, "tok-secret", "Away", "Busy"]) expect(text).not.toContain(bad);
  });
});
