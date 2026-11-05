// ADM-2 (D604): the chat Rules' bounds. A stored value the Rule no longer allows (a poll interval over 30 minutes, from
// before the bound) reads as the built-in value and is listed as a problem for Status, never thrown.
import { describe, expect, it } from "vitest";
import { ORG_SPECS, resolveRules, type OrgRow } from "./org.ts";

const BOOT = { model: "m", appCapUsd: 100, inviteDomains: [], feedback: null };
const row = (key: string, value: unknown): OrgRow => ({ scope: "org", key, value: JSON.stringify(value), updatedAt: "2026-11-05T00:00:00Z", updatedBy: "x" });

describe("chat Rules", () => {
  it("poll minutes are 1 to 30; the closed-conversations days default to 14", () => {
    expect(ORG_SPECS["conv.poll_minutes"].parse(30)).toBe(30);
    expect(() => ORG_SPECS["conv.poll_minutes"].parse(31)).toThrow();
    expect(() => ORG_SPECS["conv.poll_minutes"].parse(0)).toThrow();
    expect(resolveRules([], BOOT).conversations).toMatchObject({ pollMinutes: 5, retentionDays: 14, closedShownDays: 14 });
    expect(resolveRules([row("conv.closed_shown_days", 30)], BOOT).conversations.closedShownDays).toBe(30);
  });
  it("a stored 45 falls back to 5 and is listed as a problem", () => {
    const r = resolveRules([row("conv.poll_minutes", 45)], BOOT);
    expect(r.conversations.pollMinutes).toBe(5);
    expect(r.problems).toEqual([{ key: "conv.poll_minutes", label: "Read client chats every (minutes)", fallback: 5 }]);
    expect(resolveRules([row("conv.poll_minutes", 12)], BOOT).problems).toEqual([]);
  });
});

describe("the in-use Rule (HK-3)", () => {
  it("is 5 to 60 minutes, 10 by default; a stored value outside reads as 10", () => {
    expect(resolveRules([], BOOT).organization.idleMinutes).toBe(10);
    expect(ORG_SPECS["org.idle_minutes"].parse(5)).toBe(5);
    expect(ORG_SPECS["org.idle_minutes"].parse(60)).toBe(60);
    expect(() => ORG_SPECS["org.idle_minutes"].parse(4)).toThrow();
    expect(() => ORG_SPECS["org.idle_minutes"].parse(61)).toThrow();
    expect(resolveRules([row("org.idle_minutes", 30)], BOOT).organization.idleMinutes).toBe(30);
    expect(resolveRules([row("org.idle_minutes", 2)], BOOT).organization.idleMinutes).toBe(10);
  });
});
