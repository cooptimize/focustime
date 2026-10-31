import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTION_NAMES, ACTIONS } from "./registry.ts";
import { PLAN_ACTIONS } from "./plan-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

const ctx = {
  loadConfig: async () => ({ path: "/x", parsed: { ok: false, errors: [{ field: "x", message: "y" }] } }),
  makeDataverse: () => { throw new Error("n/a"); },
  makeOutlook: () => { throw new Error("n/a"); },
  makeGoogle: () => { throw new Error("n/a"); },
  makeDevOps: () => { throw new Error("n/a"); },
  saveSystemUserId: async () => {},
  now: () => "2026-11-03T14:00:00Z",
} as unknown as ActionContext;

describe("action registry (one list for the dispatcher and the command menu)", () => {
  it("names are unique and every entry has a title, group and summary", () => {
    expect(new Set(ACTION_NAMES).size).toBe(ACTIONS.length);
    for (const a of ACTIONS) expect(a.title && a.group && a.summary, a.name).toBeTruthy();
  });

  it("the dispatcher handles exactly the registered actions", () => {
    const src = readFileSync(new URL("./dispatch.ts", import.meta.url), "utf8");
    const cases = [...src.matchAll(/case "([a-z_.]+)":/g)].map((m) => m[1]);
    expect(new Set(cases)).toEqual(new Set(ACTION_NAMES));
  });

  it("every plan action is registered", () => {
    for (const a of PLAN_ACTIONS) expect(ACTION_NAMES).toContain(a);
  });

  it("every registered action reaches a handler; anything else is unknown", async () => {
    for (const name of ACTION_NAMES) {
      const r = await dispatch(ctx, { action: name, input: { bogus: true } }).catch(() => ({ ok: false as const, status: 0, error: "threw" }));
      expect(r.ok ? "" : r.error, name).not.toMatch(/^unknown action/);
    }
    expect(await dispatch(ctx, { action: "pick.delete_everything", input: {} })).toEqual({ ok: false, status: 400, error: "unknown action" });
    expect(await dispatch(ctx, { action: "toString", input: {} })).toMatchObject({ ok: false, error: "unknown action" });
  });
});
