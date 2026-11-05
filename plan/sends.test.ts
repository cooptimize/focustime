import { describe, expect, it } from "vitest";
import { sendRefusal, shownState, stateWords, todayLine, toldOf } from "./sends.ts";

const on = { onClient: true, lead: false, cooptimizer: true };
const them = { ...on, onFocusTime: true, self: false };
const s = (o: Partial<Parameters<typeof shownState>[0]> = {}) => ({ state: "waiting" as const, by: null, weekStart: "2026-11-02", ...o });
const person = (name: string) => ({ id: name.toLowerCase(), name });

describe("sends (SW-1)", () => {
  it("a Must only from a lead; nobody off the client, no guests, not to someone not on FocusTime", () => {
    expect(sendRefusal("suggested", on, them)).toBeNull();
    expect(sendRefusal("must", on, them)).toMatch(/leads send a Must/);
    expect(sendRefusal("must", { ...on, lead: true }, them)).toBeNull();
    expect(sendRefusal("suggested", { ...on, onClient: false }, them)).toMatch(/on this client/);
    expect(sendRefusal("suggested", { ...on, cooptimizer: false }, them)).toMatch(/Only Cooptimizers/);
    expect(sendRefusal("suggested", on, { ...them, cooptimizer: false })).toMatch(/only to Cooptimizers/);
    expect(sendRefusal("suggested", on, { ...them, onFocusTime: false })).toBe("They aren't on FocusTime yet");
    expect(sendRefusal("suggested", on, { ...them, self: true })).toMatch(/That's you/);
  });

  it("what a send shows: Done once resolved, Not answered after its week, Passed to when someone passed it", () => {
    expect(shownState(s(), { resolved: false, thisWeek: "2026-11-02" })).toBe("waiting");
    expect(shownState(s({ by: person("Dana") }), { resolved: false, thisWeek: "2026-11-02" })).toBe("passed");
    expect(shownState(s(), { resolved: false, thisWeek: "2026-11-09" })).toBe("not_answered");
    expect(shownState(s({ state: "accepted" }), { resolved: true, thisWeek: "2026-11-02" })).toBe("done");
    expect(shownState(s({ state: "cancelled" }), { resolved: true, thisWeek: "2026-11-02" })).toBe("cancelled");
    expect(stateWords({ to: person("Sam"), reason: null }, "passed")).toBe("Passed to Sam");
    expect(stateWords({ to: person("Sam"), reason: "Out Friday" }, "cant")).toBe("Can't: Out Friday");
  });

  it("Today's line: one names the sender and a Must; several are a count", () => {
    expect(todayLine([])).toBeNull();
    expect(todayLine([{ from: person("Josh Kim"), title: "Order export", kind: "must" }])).toBe("Josh sent you Order export (Must)");
    expect(todayLine([{ from: person("Josh Kim"), title: "A", kind: "must" }, { from: person("Dana"), title: "B", kind: "suggested" }])).toBe("2 items sent to your week · 1 Must");
  });

  it("a Must's Can't tells the other leads, never the sender or the recipient twice; a Suggested's tells nobody else", () => {
    const send = { kind: "must" as const, from: person("Lee"), to: person("Dana") };
    expect(toldOf(send, "cant", ["lee", "lou", "dana", "LOU"])).toEqual({ sender: "lee", leads: ["lou"] });
    expect(toldOf({ ...send, kind: "suggested" }, "cant", ["lee", "lou"])).toEqual({ sender: "lee", leads: [] });
    expect(toldOf(send, "accepted", ["lee", "lou"]).leads).toEqual([]);
  });
});
