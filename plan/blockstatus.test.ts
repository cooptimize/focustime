import { describe, expect, it } from "vitest";
import { blockStatus, watchTip } from "./blockstatus.ts";
import type { Risk } from "../week/types.ts";

const risk = (severity: Risk["severity"], reason = "Out of office") => ({ severity, reason, rule: "out_of_office" }) as unknown as Risk;

describe("one status per block (QT-1: the calendar only)", () => {
  it("is At risk only when a calendar rule says so", () => {
    expect(blockStatus([risk("at_risk")])).toMatchObject({ kind: "at_risk", label: "At risk", detail: "Out of office" });
    expect(blockStatus([risk("watch"), risk("at_risk", "Dentist 12:00")])).toMatchObject({ kind: "at_risk", detail: "Dentist 12:00" });
  });
  it("says nothing for Watch alone, or for how much is planned", () => {
    expect(blockStatus([risk("watch")])).toMatchObject({ kind: "none", label: "" });
    expect(blockStatus([])).toMatchObject({ kind: "none", label: "" });
  });
  it("keeps Watch reasons for a hover", () => {
    expect(watchTip([risk("watch", "All-day busy event: Offsite"), risk("at_risk", "x")])).toBe("All-day busy event: Offsite");
    expect(watchTip([risk("at_risk")])).toBeNull();
  });
});
