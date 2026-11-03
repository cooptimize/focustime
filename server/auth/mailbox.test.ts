import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { mailboxZone, MAILBOX_ZONE_URL } from "./mailbox.ts";

const answer = (status: number, body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
  expect(String(url)).toBe(MAILBOX_ZONE_URL);
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fake-access");
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};

describe("time zone from Outlook at the first sign-in (A2)", () => {
  it.each([
    ["Eastern Standard Time", "America/New_York"],
    ["Central Standard Time", "America/Chicago"],
    ["Mountain Standard Time", "America/Denver"],
    ["Pacific Standard Time", "America/Los_Angeles"],
    ["Europe/Berlin", "Europe/Berlin"],
  ])("maps %s to %s", async (windows, iana) => {
    const logs: LogRecord[] = [];
    expect(await mailboxZone({ fetch: answer(200, { value: windows }) as typeof fetch, accessToken: "fake-access", log: (r) => logs.push(r) })).toBe(iana);
    expect(JSON.stringify(logs)).not.toContain("fake-access");
  });

  it("says nothing (the host clock is used) when Graph refuses, is unreachable or names no zone it knows", async () => {
    const log = () => {};
    expect(await mailboxZone({ fetch: answer(403, { error: { code: "ErrorAccessDenied" } }) as typeof fetch, accessToken: "fake-access", log })).toBeNull();
    expect(await mailboxZone({ fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch, accessToken: "fake-access", log })).toBeNull();
    expect(await mailboxZone({ fetch: answer(200, { value: "Nowhere Standard Time" }) as typeof fetch, accessToken: "fake-access", log })).toBeNull();
  });
});
