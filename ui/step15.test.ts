import { describe, expect, it } from "vitest";
import { whenText } from "./labels.ts";
import { labelHere } from "./layout.ts";

describe("whenText (DevOps write log When, D271)", () => {
  it("reads the plan store's zoned stamps that new Date can't", () => {
    const stamp = "2026-11-01T14:05:09-05:00[America/New_York]";
    expect(String(new Date(stamp))).toBe("Invalid Date");
    expect(whenText(stamp, "America/New_York")).toBe("Nov 1, 2:05 PM");
  });
  it("reads plain instants and converts to the zone", () => {
    expect(whenText("2026-11-01T19:05:00Z", "America/New_York")).toBe("Nov 1, 2:05 PM");
    expect(whenText("2026-11-02T05:30:00Z", "America/New_York")).toBe("Nov 2, 12:30 AM");
  });
  it("never shows Invalid Date", () => expect(whenText("garbage", "UTC")).toBe("Unknown time"));
});

describe("labelHere (an event across the AM/PM seam, D271)", () => {
  const ev = (id: string) => ({ id }) as never;
  it("labels the part in the block it starts in, not its continuation", () => {
    expect(labelHere({ event: ev("e1"), continuesBefore: false }, new Set())).toBe(true);
    expect(labelHere({ event: ev("e1"), continuesBefore: true }, new Set(["e1"]))).toBe(false);
  });
  it("an event that began before the first block keeps its label", () => {
    expect(labelHere({ event: ev("e2"), continuesBefore: true }, new Set(["e1"]))).toBe(true);
  });
});
