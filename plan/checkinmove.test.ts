import { describe, expect, it } from "vitest";
import { suggestedMove } from "./checkinmove.ts";

const p = { clientKey: "northwind", half: "AM" as const, date: "2026-11-02" };

describe("suggestedMove: one move per pick in Check-in", () => {
  it("makes up a pick owed today tonight", () => {
    expect(suggestedMove(p, { owedToday: true, later: [{ half: "PM", clientKey: "northwind" }], carryTo: "2026-11-03" })).toEqual({ kind: "tonight", label: "Tonight" });
  });
  it("moves to the same client's later block today", () => {
    expect(suggestedMove(p, { owedToday: false, later: [{ half: "PM", clientKey: "northwind" }], carryTo: "2026-11-03" })).toMatchObject({ kind: "move", date: "2026-11-02", half: "PM", label: "Move to PM" });
  });
  it("never moves into another client's block: the next workday instead", () => {
    expect(suggestedMove(p, { owedToday: false, later: [{ half: "PM", clientKey: "fabrikam" }], carryTo: "2026-11-03" })).toMatchObject({ kind: "move", date: "2026-11-03", half: "AM", label: "Move to Tue" });
  });
  it("falls back to tonight with no day to carry to", () => {
    expect(suggestedMove({ ...p, half: "PM" }, { owedToday: false, later: [], carryTo: null })).toEqual({ kind: "tonight", label: "Tonight" });
  });
});
