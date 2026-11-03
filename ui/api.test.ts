// Step 15.4 fix, A2: an action's refusal (even a 401 or 403) is never shown as signed out; only the server's
// signed_out answer (no live session) asks the person to sign in again.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRefusal, call, readResponse, SessionError, setDbStateListener, setStaleListener, STALE_MESSAGE, type DbState } from "./api.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => setStaleListener(null));

describe("readResponse", () => {
  it("keeps missing Azure consent as a refusal with code consent, so Settings shows Allow Azure access", async () => {
    const stale = vi.fn();
    setStaleListener(stale);
    const e = await readResponse(json(401, { ok: false, status: 401, code: "consent", error: "FocusTime needs your OK to use Azure" })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ActionRefusal);
    expect(e).not.toBeInstanceOf(SessionError);
    expect((e as ActionRefusal).code).toBe("consent");
    expect(stale).not.toHaveBeenCalled();
  });

  it("keeps an action's 403 (another VM, demo mode) as a refusal", async () => {
    const e = await readResponse(json(403, { ok: false, status: 403, error: "FocusTime only acts on the VM you confirmed as yours" })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ActionRefusal);
    expect((e as Error).message).toContain("VM you confirmed");
  });

  it("turns the server's signed_out answer into Sign in again, never Session expired", async () => {
    const stale = vi.fn();
    setStaleListener(stale);
    const e = await readResponse(json(401, { ok: false, status: 401, code: "signed_out", error: "Sign in to continue" })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionError);
    expect((e as Error).message).toBe(STALE_MESSAGE);
    expect((e as Error).message).not.toMatch(/session expired/i);
    expect(stale).toHaveBeenCalledOnce();
  });

  it("treats a plain-text 401 (an older server) as signed out too, and other plain errors as refusals", async () => {
    await expect(readResponse(new Response("Session expired: restart FocusTime", { status: 401 }))).rejects.toBeInstanceOf(SessionError);
    await expect(readResponse(new Response("Forbidden", { status: 403 }))).rejects.toBeInstanceOf(ActionRefusal);
  });

  it("returns data when the action worked", async () => {
    expect(await readResponse(json(200, { ok: true, data: { a: 1 } }))).toEqual({ a: 1 });
  });
});

describe("the signed-out banner and the sign-in screen (A2)", () => {
  it("doesn't flag an ended session while the sign-in screen shows, and hides a flag already raised", async () => {
    const { setSignInShowing, setSignInShownListener } = await import("./api.ts");
    const stale = vi.fn();
    const hide = vi.fn();
    setStaleListener(stale);
    setSignInShownListener(hide);
    setSignInShowing(true);
    expect(hide).toHaveBeenCalledTimes(1);
    await expect(readResponse(new Response(JSON.stringify({ ok: false, status: 401, error: "x", code: "signed_out" }), { status: 401 }))).rejects.toBeInstanceOf(SessionError);
    expect(stale).not.toHaveBeenCalled();
    setSignInShowing(false);
    await expect(readResponse(new Response(JSON.stringify({ ok: false, status: 401, error: "x", code: "signed_out" }), { status: 401 }))).rejects.toBeInstanceOf(SessionError);
    expect(stale).toHaveBeenCalledTimes(1);
    setSignInShownListener(null);
  });
});

describe("a call that waits on a waking database (A3)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setDbStateListener(null);
  });

  it("asks the server's state after 1.5 seconds, says waking, and goes back to ok when the call answers", async () => {
    vi.useFakeTimers();
    let answer!: (r: Response) => void;
    const asked: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      asked.push(url);
      if (url === "/api/db-status") return Promise.resolve(json(200, { status: "waking" }));
      return new Promise<Response>((r) => (answer = r));
    });
    const seen: DbState[] = [];
    setDbStateListener((s) => seen.push(s));
    const p = call<string>("week.load", {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked).toEqual(["/api/action"]);
    await vi.advanceTimersByTimeAsync(2600);
    expect(asked.filter((u) => u === "/api/db-status").length).toBe(3);
    expect(seen.at(-1)).toBe("waking");
    answer(json(200, { ok: true, data: "fine" }));
    await expect(p).resolves.toBe("fine");
    expect(seen.at(-1)).toBe("ok");
    const n = asked.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked.length).toBe(n);
  });

  it("a quick call never asks", async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      asked.push(url);
      return Promise.resolve(json(200, { ok: true, data: 1 }));
    });
    await expect(call<number>("week.load", {})).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked).toEqual(["/api/action"]);
  });
});
