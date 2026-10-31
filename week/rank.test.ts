import { describe, expect, it } from "vitest";
import { rankRisks, topRisk } from "./risks.ts";
import type { Risk, RiskRule, Severity } from "./types.ts";

const r = (rule: RiskRule, severity: Severity): Risk => ({ rule, severity, reason: `${rule} ${severity}` });

describe("one badge per half-day", () => {
  it("at risk always beats watch", () => {
    expect(topRisk([r("out_of_office", "watch"), r("meeting_load", "at_risk")]).top).toEqual(r("meeting_load", "at_risk"));
  });

  it("within a level: out of office, then personal conflict, then no focus window, then meetings", () => {
    const at = [r("meeting_load", "at_risk"), r("no_focus_window", "at_risk"), r("personal_conflict", "at_risk"), r("out_of_office", "at_risk")];
    expect(rankRisks(at).map((x) => x.rule)).toEqual(["out_of_office", "personal_conflict", "no_focus_window", "meeting_load"]);
    const watch = [r("meeting_load", "watch"), r("no_focus_window", "watch"), r("personal_conflict", "watch")];
    expect(rankRisks(watch).map((x) => x.rule)).toEqual(["personal_conflict", "no_focus_window", "meeting_load"]);
  });

  it("places the rules not named in the order: double-booked after personal conflict, all-day event before meetings", () => {
    const all = [r("meeting_load", "at_risk"), r("double_booked_block", "at_risk"), r("personal_conflict", "at_risk"), r("no_focus_window", "at_risk")];
    expect(rankRisks(all).map((x) => x.rule)).toEqual(["personal_conflict", "double_booked_block", "no_focus_window", "meeting_load"]);
    expect(rankRisks([r("meeting_load", "watch"), r("all_day_busy", "watch")]).map((x) => x.rule)).toEqual(["all_day_busy", "meeting_load"]);
  });

  it("counts the rest as +N more and keeps every reason for the details panel", () => {
    const risks = [r("meeting_load", "watch"), r("personal_conflict", "at_risk"), r("no_focus_window", "watch")];
    expect(topRisk(risks)).toEqual({ top: r("personal_conflict", "at_risk"), more: 2 });
    expect(rankRisks(risks)).toHaveLength(3);
    expect(risks[0]!.rule).toBe("meeting_load"); // input untouched
  });

  it("keeps the original order for two risks of the same rule and level", () => {
    const a = { ...r("personal_conflict", "at_risk"), reason: "first" };
    const b = { ...r("personal_conflict", "at_risk"), reason: "second" };
    expect(rankRisks([a, b]).map((x) => x.reason)).toEqual(["first", "second"]);
  });

  it("no risks: no badge", () => {
    expect(topRisk([])).toEqual({ top: null, more: 0 });
  });
});
