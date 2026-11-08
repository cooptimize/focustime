// IB-2: the one way FocusTime says when something happened (Teams style), in the person's time zone.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dayHeading, stampDay, stampFull, stampText } from "./stamp.ts";

const NY = "America/New_York";
const TODAY = "2026-11-08";

describe("stampText", () => {
  it("today, yesterday, older", () => {
    expect(stampText("2026-11-08T21:07:00Z", NY, TODAY)).toBe("Today 4:07 PM");
    expect(stampText("2026-11-07T23:58:00Z", NY, TODAY)).toBe("Yesterday 6:58 PM");
    expect(stampText("2026-11-06T21:07:00Z", NY, TODAY)).toBe("Fri, Nov 6, 4:07 PM");
  });
  it("adds the year only when it isn't this year", () => {
    expect(stampText("2025-11-06T21:07:00Z", NY, TODAY)).toBe("Thu, Nov 6, 2025, 4:07 PM");
    expect(stampText("2026-12-31T17:00:00Z", NY, "2027-01-05")).toBe("Thu, Dec 31, 2026, 12:00 PM");
  });
  it("just after local midnight is the new day, whatever UTC says", () => {
    expect(stampText("2026-11-08T05:00:30Z", NY, TODAY)).toBe("Today 12:00 AM");
    expect(stampText("2026-11-08T04:59:30Z", NY, TODAY)).toBe("Yesterday 11:59 PM");
  });
  it("follows the person's time zone setting", () => {
    const at = "2026-11-08T03:30:00Z";
    expect(stampText(at, NY, "2026-11-07")).toBe("Today 10:30 PM");
    expect(stampText(at, "Asia/Tokyo", "2026-11-08")).toBe("Today 12:30 PM");
    expect(stampText(at, "America/Los_Angeles", "2026-11-08")).toBe("Yesterday 7:30 PM");
  });
  it("reads the plan store's zoned stamps", () => {
    expect(stampText("2026-11-08T16:07:00-05:00[America/New_York]", NY, TODAY)).toBe("Today 4:07 PM");
  });
  it("drops the time only when asked and only past a week", () => {
    expect(stampText("2026-10-30T21:07:00Z", NY, TODAY, { dateOnlyIfOld: true })).toBe("Fri, Oct 30");
    expect(stampText("2026-11-02T21:07:00Z", NY, TODAY, { dateOnlyIfOld: true })).toBe("Mon, Nov 2, 4:07 PM");
    expect(stampText("2026-11-08T21:07:00Z", NY, TODAY, { dateOnlyIfOld: true })).toBe("Today 4:07 PM");
  });
  it("says so when it can't read a stamp", () => expect(stampText("garbage", NY, TODAY)).toBe("Unknown time"));
});

describe("stampFull (the tooltip)", () => {
  it("has the seconds and the zone", () => {
    expect(stampFull("2026-11-08T21:07:32Z", NY)).toMatch(/^Sun, Nov 8, 2026, 4:07:32 PM EST$/);
    expect(stampFull("2026-11-08T21:07:32Z", "Asia/Tokyo")).toMatch(/Mon, Nov 9, 2026, 6:07:32 AM/);
  });
});

describe("day headings", () => {
  it("Today, Yesterday, then the date", () => {
    expect(dayHeading(TODAY, TODAY)).toBe("Today");
    expect(dayHeading("2026-11-07", TODAY)).toBe("Yesterday");
    expect(dayHeading("2026-11-06", TODAY)).toBe("Fri, Nov 6");
  });
  it("across a year boundary", () => {
    expect(dayHeading("2026-12-31", "2027-01-01")).toBe("Yesterday");
    expect(dayHeading("2026-12-30", "2027-01-01")).toBe("Wed, Dec 30, 2026");
    expect(dayHeading("2027-01-01", "2027-01-02")).toBe("Yesterday");
  });
  it("the day a stamp falls on is the person's", () => {
    expect(stampDay("2026-11-08T03:30:00Z", NY)).toBe("2026-11-07");
    expect(stampDay("2026-11-08T03:30:00Z", "Asia/Tokyo")).toBe("2026-11-08");
  });
});

// Step 0's list (docs/ux/ib2/date-inventory.md): every place that says when something happened uses the formatter.
describe("every place uses the shared formatter", () => {
  const files = ["ui/inbox/InboxPage.tsx", "ui/inbox/Detail.tsx", "ui/inbox/HeldBack.tsx", "ui/inbox/MergePane.tsx", "ui/MessageThread.tsx", "ui/Conversations.tsx", "ui/FollowUps.tsx", "ui/StatusBar.tsx", "ui/Status.tsx", "ui/Today.tsx", "ui/WeekGrid.tsx", "ui/Phone.tsx", "ui/PhoneToday.tsx", "ui/DetailPanel.tsx"];
  it.each(files)("%s has no other stamp formatter", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/\bwhenText\(/);
    expect(src).not.toMatch(/split\(", "\)\[1\]/);
  });
  it.each(["ui/inbox/InboxPage.tsx", "ui/inbox/Detail.tsx", "ui/inbox/HeldBack.tsx", "ui/inbox/MergePane.tsx", "ui/MessageThread.tsx", "ui/Conversations.tsx", "ui/Status.tsx"])("%s draws them with Stamp (full time on hover)", (f) => {
    expect(readFileSync(f, "utf8")).toMatch(/<Stamp\b/);
  });
  it("FollowUps and the status bar's strings come from stampText", () => {
    expect(readFileSync("ui/FollowUps.tsx", "utf8")).toMatch(/stampText\(iso, tz\)/);
    expect(readFileSync("ui/StatusBar.tsx", "utf8")).toMatch(/stampText\(iso, tz\)/);
  });
});
