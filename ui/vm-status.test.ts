// VM-4: the page's side of the chip while reads fail (ui/vm-status.ts). Fictional VM only.
import { describe, expect, it } from "vitest";
import type { VmStatus } from "../actions/account-types.ts";
import { agoText, READ_PROBLEM } from "../plan/vm.ts";
import { mergeStatus, onPageClock, unreachable } from "./vm-status.ts";

const vm = { id: "/subscriptions/00000000-0000-4000-8000-0000000000aa/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1", name: "vm-1", resourceGroup: "rg", subscriptionId: "00000000-0000-4000-8000-0000000000aa", location: "eastus", chosenAt: "2026-11-17T20:00:00Z" };
const base: VmStatus = { signedIn: true, vm, chip: "running", label: "Running", text: "Running · off at 7:00 PM", power: "running", transition: null, canStart: false, canStop: true, schedule: null, prompt: false, startWithoutAsking: true, refreshMs: 60_000, needsConsent: false, error: null, autoStart: null, readAt: "2026-11-17T21:00:00.000Z", checking: null, problem: null };
const T = Date.parse("2026-11-17T21:01:00Z");

describe("VM-4: the page keeps the last state", () => {
  it("a server that restarted answers Checking… with no state: the page keeps what it showed, checking", () => {
    const next: VmStatus = { ...base, chip: null, label: null, text: "Checking…", power: null, canStop: false, readAt: null, checking: { since: "2026-11-17T21:01:00.000Z" }, refreshMs: 10_000 };
    expect(mergeStatus(base, next)).toMatchObject({ chip: "running", text: "Running · off at 7:00 PM", canStop: true, readAt: "2026-11-17T21:00:00.000Z", checking: { since: "2026-11-17T21:01:00.000Z" }, refreshMs: 10_000 });
  });
  it("nothing shown before: Checking… as the server says; a good answer replaces everything", () => {
    const next: VmStatus = { ...base, chip: null, text: "Checking…", checking: { since: "2026-11-17T21:01:00.000Z" } };
    expect(mergeStatus(null, next).text).toBe("Checking…");
    expect(mergeStatus({ ...base, checking: { since: "x" } }, base)).toEqual(base);
  });
  it("the request itself fails: the last state, checking, asked again in 10 s; after 2 minutes, Can't reach FocusTime", () => {
    const a = unreachable(base, T)!;
    expect(a).toMatchObject({ chip: "running", checking: { since: "2026-11-17T21:01:00.000Z" }, problem: null, refreshMs: 10_000 });
    const b = unreachable(a, T + 119_000)!;
    expect(b.problem).toBeNull();
    const c = unreachable(b, T + 120_000)!;
    expect(c).toMatchObject({ chip: "running", problem: { kind: "app", short: READ_PROBLEM.app.short }, refreshMs: 30_000 });
    expect(unreachable(null, T)).toBeNull();
  });
  it("says how old the state is in plain words", () => {
    expect(agoText("2026-11-17T21:00:58Z", T)).toBe("just now");
    expect(agoText("2026-11-17T21:00:20Z", T)).toBe("40 seconds ago");
    expect(agoText("2026-11-17T21:00:00Z", T)).toBe("1 minute ago");
    expect(agoText("2026-11-17T20:58:00Z", T)).toBe("3 minutes ago");
    expect(agoText("2026-11-17T18:59:00Z", T)).toBe("2 hours ago");
    expect(agoText(null, T)).toBeNull();
  });
});

describe("VM-4: times on the page's clock", () => {
  it("a server clock 15 days off still reads as 1 minute ago", () => {
    const off = 15 * 24 * 3600_000;
    const s: VmStatus = { ...base, answeredAt: new Date(T - off).toISOString(), readAt: new Date(T - off - 60_000).toISOString(), checking: { since: new Date(T - off - 30_000).toISOString() } };
    const p = onPageClock(s, T);
    expect(agoText(p.readAt ?? null, T)).toBe("1 minute ago");
    expect(p.checking?.since).toBe(new Date(T - 30_000).toISOString());
    expect(onPageClock(base, T)).toBe(base);
  });
});
