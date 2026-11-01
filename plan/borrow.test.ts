import { describe, expect, it } from "vitest";
import { legacyHours } from "../config/schema.ts";
import { borrowedSummary, borrowMinutes, flexOffer, paybackSlot } from "./borrow.ts";

const model = legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" });
const at = (s: string) => Temporal.ZonedDateTime.from(`${s}[America/New_York]`);

describe("borrowed time (step 7)", () => {
  it("pays back tonight, on the coming Friday, or a chosen day and slot", () => {
    expect(paybackSlot("tonight", "2026-11-02")).toEqual({ date: "2026-11-02", half: "EVE" });
    expect(paybackSlot("friday", "2026-11-02")).toEqual({ date: "2026-11-06", half: "AM" });
    expect(paybackSlot("friday", "2026-11-06")).toEqual({ date: "2026-11-06", half: "AM" });
    expect(paybackSlot("friday", "2026-11-07")).toEqual({ date: "2026-11-13", half: "AM" });
    expect(paybackSlot("day", "2026-11-02", { date: "2026-11-07", half: "AM" })).toEqual({ date: "2026-11-07", half: "AM" });
    expect(paybackSlot("day", "2026-11-02", { date: "2026-11-01", half: "AM" })).toBe("Make it up today or later");
    expect(paybackSlot("day", "2026-11-02")).toBe("Choose the day and half-day to make it up");
  });
  it("owes the size less what was already focused, in quarter hours", () => {
    expect(borrowMinutes(120, 45 * 60)).toBe(75);
    expect(borrowMinutes(120, 50 * 60)).toBe(75);
    expect(borrowMinutes(60, 59 * 60)).toBe(15);
    expect(borrowMinutes(60, 0)).toBe(60);
  });
  it("offers a flex session for tonight or a weekend day without hours, never past midnight", () => {
    expect(flexOffer({ date: "2026-11-02", half: "EVE" }, 75, model, at("2026-11-02T17:15"))).toEqual({ date: "2026-11-02", start: "20:00", end: "21:15" });
    expect(flexOffer({ date: "2026-11-02", half: "EVE" }, 60, model, at("2026-11-02T20:40"))).toEqual({ date: "2026-11-02", start: "21:00", end: "22:00" });
    expect(flexOffer({ date: "2026-11-07", half: "AM" }, 120, model, at("2026-11-02T17:15"))).toEqual({ date: "2026-11-07", start: "10:00", end: "12:00" });
    expect(flexOffer({ date: "2026-11-02", half: "EVE" }, 300, model, at("2026-11-02T20:40"))).toBeNull();
    // A weekday slot with hours, or an evening that already has hours: nothing to add.
    expect(flexOffer({ date: "2026-11-04", half: "PM" }, 60, model, at("2026-11-02T17:15"))).toBeNull();
    const split = { ...model, overrides: [{ date: "2026-11-02", segments: [{ start: "09:00", end: "16:00" }, { start: "20:00", end: "22:00" }] }] };
    expect(flexOffer({ date: "2026-11-02", half: "EVE" }, 60, split, at("2026-11-02T17:15"))).toBeNull();
  });
  it("totals the week's borrowed time and counts what is unpaid from any week", () => {
    const list = [
      { minutes: 60, date: "2026-11-02", paidAt: null },
      { minutes: 30, date: "2026-11-03", paidAt: "x" },
      { minutes: 45, date: "2026-10-28", paidAt: null },
    ];
    expect(borrowedSummary(list, "2026-11-02", "2026-11-08")).toEqual({ totalMinutes: 90, unpaid: 2, unpaidMinutes: 105 });
  });
});
