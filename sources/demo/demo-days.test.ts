// QF-1 (part 3): the demo's PTO day and its afternoon out are never today, whatever weekday the demo opens on, so
// Today always has content in a demo. Each weekday's clock, fixed.
import { describe, expect, it } from "vitest";
import { demoGoogle, demoPto } from "./data.ts";

const MONDAY = "2026-11-02";
const days = Array.from({ length: 7 }, (_, i) => Temporal.PlainDate.from(MONDAY).add({ days: i }).toString());

describe("the demo's PTO day", () => {
  for (const today of days)
    it(`is never today (${Temporal.PlainDate.from(today).toLocaleString("en-US", { weekday: "long" })})`, () => {
      const pto = demoPto(days[0]!, days[6]!, today).map((p) => p.date);
      expect(pto).toHaveLength(1);
      expect(pto).not.toContain(today);
      const out = demoGoogle(MONDAY, today).find((e) => e.title.startsWith("Out"))!;
      expect(out.start.slice(0, 10)).not.toBe(today);
      expect(out.start.slice(0, 10)).not.toBe(pto[0]);
    });

  it("keeps the usual story on a Monday: Thursday off, Wednesday afternoon out", () => {
    expect(demoPto(days[0]!, days[6]!, MONDAY).map((p) => p.date)).toEqual(["2026-11-05"]);
    expect(demoGoogle(MONDAY, MONDAY).find((e) => e.title.startsWith("Out"))!.start.slice(0, 10)).toBe("2026-11-04");
  });
});
