// Step 15.4 fix: an action's refusal (even a 401 or 403) is never shown as an out-of-date window, and only the
// guard's launch_token answer asks to reopen Coopilot.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRefusal, readResponse, SessionError, setStaleListener, STALE_MESSAGE } from "./api.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => setStaleListener(null));

describe("readResponse", () => {
  it("keeps missing Azure consent as a refusal with code consent, so Settings shows Allow Azure access", async () => {
    const stale = vi.fn();
    setStaleListener(stale);
    const e = await readResponse(json(401, { ok: false, status: 401, code: "consent", error: "Coopilot needs your OK to use Azure" })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ActionRefusal);
    expect(e).not.toBeInstanceOf(SessionError);
    expect((e as ActionRefusal).code).toBe("consent");
    expect(stale).not.toHaveBeenCalled();
  });

  it("keeps an action's 403 (another VM, demo mode) as a refusal", async () => {
    const e = await readResponse(json(403, { ok: false, status: 403, error: "Coopilot only acts on the VM you confirmed as yours" })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ActionRefusal);
    expect((e as Error).message).toContain("VM you confirmed");
  });

  it("turns the guard's launch_token answer into Reopen Coopilot, never Session expired", async () => {
    const stale = vi.fn();
    setStaleListener(stale);
    const e = await readResponse(json(401, { ok: false, status: 401, code: "launch_token", error: "out of date" })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionError);
    expect((e as Error).message).toBe(STALE_MESSAGE);
    expect((e as Error).message).not.toMatch(/session expired/i);
    expect(stale).toHaveBeenCalledOnce();
  });

  it("treats a plain-text 401 (an older server) as out of date too, and other plain errors as refusals", async () => {
    await expect(readResponse(new Response("Session expired: restart Coopilot", { status: 401 }))).rejects.toBeInstanceOf(SessionError);
    await expect(readResponse(new Response("Forbidden", { status: 403 }))).rejects.toBeInstanceOf(ActionRefusal);
  });

  it("returns data when the action worked", async () => {
    expect(await readResponse(json(200, { ok: true, data: { a: 1 } }))).toEqual({ a: 1 });
  });
});
