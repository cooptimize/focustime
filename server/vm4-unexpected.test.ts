// VM-4: an action that throws in a way the server didn't expect. Nov 17 in production: Close out's check-in answer
// failed in the database and the screen showed the bare words "bad request". Now the answer is a server error in plain
// words with a short reference; the log has the action's name, the error's kind and that reference, nothing else. A
// request that really is malformed keeps its own answer (a 400). Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { parseConfig } from "../config/schema.ts";
import { FOUR_DAY_TOML } from "../fixtures/four-day-week.ts";
import type { LogRecord } from "../log/logger.ts";
import { startTestApp } from "./test-app.ts";
import { isRef, unexpectedWords } from "./unexpected.ts";

/** The database driver's error type, as production's log named it. */
class RequestError extends Error {
  constructor() {
    super("String or binary data would be truncated in table 'timeboxes', column 'settled_at'. Truncated value: 'Pat Example'.");
    this.name = "RequestError";
  }
}

const logs: LogRecord[] = [];
const errors: { where: string; ref?: string }[] = [];
let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  const plan = new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : async () => { throw new RequestError(); }) });
  const ctx = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(FOUR_DAY_TOML) }),
    makeDataverse: () => { throw new Error("n/a"); },
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => { throw new Error("n/a"); },
    saveSystemUserId: async () => {},
    now: () => "2026-11-17T22:17:17Z",
    plan,
  } as unknown as ActionContext;
  app = await startTestApp({ ctx: () => ctx, log: (r) => logs.push(r), extra: { onError: (_e, where, ref) => void errors.push({ where, ...(ref ? { ref } : {}) }) } });
});
afterAll(() => app.close());

describe("VM-4: an unexpected failure", () => {
  it("answers a server error in plain words with a reference, and logs only the action, the kind and the reference", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    logs.length = 0;
    const r = await b.action("checkin.answer", { date: "2026-11-17", moment: "end", pickId: 7, answer: "done" });
    expect(r.status).toBe(500);
    const body = JSON.parse(r.body) as { ok: boolean; status: number; code: string; ref: string; error: string };
    expect(body).toMatchObject({ ok: false, status: 500, code: "unexpected" });
    expect(isRef(body.ref)).toBe(true);
    expect(body.error).toBe(unexpectedWords(body.ref));
    expect(body.error).toContain("Try again");
    expect(body.error).toContain("tell an admin");
    expect(body.error).not.toMatch(/bad request/i);
    // Nothing from the error's message reaches the answer.
    expect(r.body).not.toMatch(/truncated|timeboxes|settled_at|Pat Example/);
    const line = logs.find((l) => l.op === "action_failed")!;
    expect(line).toEqual({ source: "server", op: "action_failed", status: 500, kind: "RequestError", action: "checkin.answer", ref: body.ref });
    expect(errors.at(-1)).toEqual({ where: "action", ref: body.ref });
    // Two failures, two references.
    const again = JSON.parse((await b.action("checkin.answer", { date: "2026-11-17", moment: "end", pickId: 7, answer: "done" })).body) as { ref: string };
    expect(again.ref).not.toBe(body.ref);
  });

  it("an action name that isn't registered stays out of the log", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    logs.length = 0;
    const r = await b.action("checkin.answer", { date: "2026-11-17", moment: "end", pickId: 7, answer: "done" }, {});
    expect(r.status).toBe(500);
    for (const l of logs) expect(Object.keys(l).every((k) => ["source", "op", "status", "kind", "action", "ref", "durationMs", "count", "client"].includes(k))).toBe(true);
  });

  it("a request that really is malformed keeps its own answer: a 400 in plain words, not a server error", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    const r = await b.send("/api/action", { origin: app.publicUrl, "content-type": "application/json", "x-csrf": b.jar.get("__Host-focustime-csrf") ?? "" }, "POST", "{not json");
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toMatchObject({ ok: false, status: 400, code: "malformed", error: "FocusTime couldn't read that request. Reload the page and try again." });
  });

  it("an action's own refusal is unchanged (a malformed input is still its 400)", async () => {
    const b = app.browser();
    await b.signIn("user-a");
    const r = await b.action("checkin.answer", { date: "2026-11-17", moment: "end", pickId: 7, answer: "maybe" });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe("answer is done, partly or none");
  });
});
