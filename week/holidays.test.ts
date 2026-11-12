// PS-1: observed holidays shown like PTO. A holiday is a whole day off named by the Working Days Calendar; it wins over
// PTO; unread holidays change nothing; and a holiday is never "the next working day".
import { describe, expect, it } from "vitest";
import { aClient, aFocusBlock, aPto, aWeek, aWeekConfig, ptoMap, WEEK } from "../test/builders/index.ts";
import { holidayDays, holidayLabel } from "../sources/dataverse/holidays.ts";
import { nextWorkDay, suggestable } from "../plan/boardsuggest.ts";
import { canAddWork } from "../plan/days.ts";
import { withHolidays } from "./pto.ts";
import { offWord, ptoLabel } from "../plan/days.ts";

const DATES = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const labelled = (rows: { coop_date: string; coop_holidayname?: string | null }[]) =>
  holidayDays(rows.map((r) => ({ ...r, coop_observedholidayflag: true })), DATES[0]!, DATES[6]!).map((d) => ({ date: d.date, label: holidayLabel(d) }));

describe("holidays as days off (PS-1)", () => {
  it("a named holiday is a whole day off that reads as its name, observed", () => {
    const pto = withHolidays({}, labelled([{ coop_date: "2026-11-05", coop_holidayname: "Thanksgiving Day" }]), DATES);
    expect(pto["2026-11-05"]).toEqual({ date: "2026-11-05", titles: ["Thanksgiving Day (observed)"], holiday: "Thanksgiving Day (observed)" });
    expect(ptoLabel(pto["2026-11-05"]!)).toBe("Thanksgiving Day (observed)");
    expect(offWord(pto["2026-11-05"])).toBe("Holiday");
  });

  it('an unnamed holiday reads "Holiday"', () => {
    const pto = withHolidays({}, labelled([{ coop_date: "2026-11-05", coop_holidayname: null }]), DATES);
    expect(pto["2026-11-05"]!.holiday).toBe("Holiday");
    expect(ptoLabel(pto["2026-11-05"]!)).toBe("Holiday");
  });

  it("a day that is both PTO and a holiday shows the holiday, as a whole day", () => {
    const pto = withHolidays(ptoMap(aPto({ date: "2026-11-05", titles: ["Trip"] }), aPto({ date: "2026-11-04", titles: ["Dentist"], half: "AM" })), labelled([{ coop_date: "2026-11-04", coop_holidayname: "Founders Day" }]), DATES);
    expect(pto["2026-11-04"]).toEqual({ date: "2026-11-04", titles: ["Founders Day (observed)"], holiday: "Founders Day (observed)" });
    // PTO alone is unchanged and still reads PTO.
    expect(pto["2026-11-05"]!.holiday).toBeUndefined();
    expect(offWord(pto["2026-11-05"])).toBe("PTO");
  });

  it("holidays that couldn't be read change nothing (never guessed)", () => {
    const before = ptoMap(aPto({ date: "2026-11-05" }));
    expect(withHolidays(before, [], DATES)).toEqual(before);
  });

  it("only the dates asked for", () => {
    expect(withHolidays({}, [{ date: "2026-11-12", label: "Holiday" }], DATES)).toEqual({});
  });

  it("a holiday day in the week has no free time, no risks, takes no + Add and gets no suggestions", () => {
    const client = aClient();
    const pto = withHolidays({}, [{ date: "2026-11-04", label: "Founders Day (observed)" }], DATES);
    const w = aWeek({ patterns: [aFocusBlock({ client, days: { Mon: "AM", Tue: "AM", Wed: "AM", Thu: "AM" } })], config: aWeekConfig(), pto });
    const wed = w.days.find((d) => d.date === "2026-11-04")!;
    expect(wed.pto?.holiday).toBe("Founders Day (observed)");
    expect(wed.am.pto).toBe(true);
    expect(wed.am.risks).toEqual([]);
    expect(canAddWork({ date: wed.date, today: "2026-11-03", pto: !!wed.pto, off: wed.am.off })).toBe(false);
    expect(suggestable(wed.am, wed, { now: "2026-11-03T14:00:00Z", today: "2026-11-03", nextWorkDay: "2026-11-04" })).toBe(false);
  });

  it("is skipped as the next working day", () => {
    const client = aClient();
    const pto = withHolidays({}, [{ date: "2026-11-04", label: "Holiday" }], DATES);
    const w = aWeek({ weekStart: WEEK, patterns: [aFocusBlock({ client, days: { Tue: "AM", Wed: "AM", Thu: "AM" } })], config: aWeekConfig(), pto });
    expect(nextWorkDay(w.days, "2026-11-03")).toBe("2026-11-05");
  });
});
