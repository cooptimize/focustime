import { describe, expect, it } from "vitest";
import { aClient, aFocusBlock, aMeeting, aPto, aUser, aWeek, aWorkItem } from "./index.ts";

describe("test builders", () => {
  it("give valid, distinct defaults", () => {
    expect(aUser().id).not.toBe(aUser().id);
    expect(aClient({ name: "Tailspin & Wingtip" }).clientKey).toBe("tailspinwingtip");
    expect(aWorkItem().id).not.toBe(aWorkItem().id);
  });
  it("build a week through Week's own logic", () => {
    const adatum = aClient({ name: "Adatum" });
    const week = aWeek({ patterns: [aFocusBlock({ client: adatum, days: { Mon: "AM", Thu: "PM" } })], events: [aMeeting({ start: "2026-11-02T10:00", end: "2026-11-02T11:00" })], pto: [aPto({ date: "2026-11-05" })] });
    const mon = week.days[0]!;
    expect(mon.am.focus[0]?.clientName).toBe("Adatum");
    expect(mon.am.busyMeetingMinutes).toBe(60);
    const thu = week.days.find((d) => d.date === "2026-11-05")!;
    expect(thu.pto?.titles).toEqual(["PTO"]);
    expect(thu.pm.pto).toBe(true);
  });
});
