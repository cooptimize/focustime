import { describe, expect, it } from "vitest";
import { checkIn } from "./checkin.ts";
import type { Pick } from "./types.ts";

const SIZES = { XS: 30, S: 60, M: 120, L: 210, unsized: 60 };
const Z = (hm: string) => Temporal.ZonedDateTime.from(`2026-11-02T${hm}[America/New_York]`).toInstant().toString();
const pick = (id: number, half: Pick["half"], size: Pick["size"], status: Pick["status"] = "planned") => ({ id, half, size, status, position: id }) as Pick;
// Afternoon 12:30 to 5:00 with a meeting 2:00 to 3:00: free 12:30-2:00 and 3:00-5:00.
const pm = { start: Z("12:30"), end: Z("17:00"), longestFreeMinutes: 120, freeGaps: [{ start: Z("12:30"), end: Z("14:00"), minutes: 90 }, { start: Z("15:00"), end: Z("17:00"), minutes: 120 }] };
const am = { start: Z("09:00"), end: Z("12:30"), longestFreeMinutes: 210, freeGaps: [{ start: Z("09:00"), end: Z("12:30"), minutes: 210 }] };

describe("Check-in free time (step 7; QT-2: no fit, no over)", () => {
  const picks = [pick(1, "AM", "S", "done"), pick(2, "AM", "S"), pick(3, "PM", "M"), pick(4, "PM", "S")];
  it("at 1:00 PM: the morning has ended; the afternoon has 3h free after its meeting", () => {
    const [a, p] = checkIn([{ half: "AM", slot: am }, { half: "PM", slot: pm }], picks, () => 0, SIZES, Z("13:00"));
    expect(a).toMatchObject({ ended: true, leftMinutes: 0 });
    expect(a!.picks.map((x) => x.pick.id)).toEqual([1, 2]);
    expect(p).toMatchObject({ ended: false, leftMinutes: 180, needMinutes: 180 });
  });
  it("as time passes the free time shrinks; focused time lowers the need; nothing is flagged", () => {
    const [, p] = checkIn([{ half: "AM", slot: am }, { half: "PM", slot: pm }], picks, () => 0, SIZES, Z("15:30"));
    expect(p).toMatchObject({ leftMinutes: 90, needMinutes: 180 });
    expect(p).not.toHaveProperty("overBy");
    expect(p!.picks.every((x) => !("fits" in x))).toBe(true);
    const [, q] = checkIn([{ half: "AM", slot: am }, { half: "PM", slot: pm }], picks, (id) => (id === 3 ? 90 * 60 : 0), SIZES, Z("15:30"));
    expect(q).toMatchObject({ leftMinutes: 90, needMinutes: 90 });
    expect(q!.picks.map((x) => [x.needMinutes, x.focusedMinutes])).toEqual([[30, 90], [60, 0]]);
  });
});
