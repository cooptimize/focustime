// CF-1: the morning brief card says nothing about confirming the day, with work on today or none, and an earlier
// card's Confirm today comes back as a plain notice.
import { describe, expect, it } from "vitest";
import { briefCard, type PickRow } from "./rhythm-cards.ts";

const URL_ = "https://focustime.example.com";
const pk = (id: number, title: string): PickRow => ({ id, title, client: "Northwind", state: "open", note: null });
const base = { kind: "brief" as const, occasion: "brief:2026-11-05", date: "2026-11-05", dateLabel: "Thursday, Nov 5", promises: [], sends: [], destinations: [], more: 0 };

describe("the morning brief card (CF-1)", () => {
  it("never offers Confirm today or says the day is (not) confirmed", () => {
    const withWork = JSON.stringify(briefCard({ ...base, blocks: [{ label: "Morning 08:00–12:00", client: "Northwind", meetings: [], picks: [pk(1, "Fix the login timeout")] }] }, URL_));
    const empty = JSON.stringify(briefCard({ ...base, blocks: [{ label: "Morning 08:00–12:00", client: "Northwind", meetings: [], picks: [] }] }, URL_));
    for (const card of [withWork, empty]) expect(card).not.toMatch(/[Cc]onfirm|isn't planned/);
    expect(withWork).toContain("Fix the login timeout");
  });
  it("shows the plain notice for an earlier card's Confirm today", () => {
    const card = JSON.stringify(briefCard({ ...base, blocks: [], notice: "There's nothing to confirm now. Your plan is what's on your day." }, URL_));
    expect(card).toContain("There's nothing to confirm now. Your plan is what's on your day.");
  });
});
