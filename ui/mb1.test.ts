// MB-1: the phone's pure pieces. The commands without Ahead, the status dot's one word, and where the to-do sheet's
// Move to tomorrow and Snooze go.
import { describe, expect, it } from "vitest";
import type { SourceSummary, WeekLoadData } from "../actions/types.ts";
import type { ClientWork } from "../week/types.ts";
import type { TimeModel } from "../week/hours.ts";
import { aPick } from "../test/builders/index.ts";
import { withoutAhead, type MenuItem } from "./menu.ts";
import { sourceHealth } from "./PhoneShell.tsx";
import { sheetMoves } from "./TodoSheet.tsx";
import { shortClient } from "./NowStrip.tsx";

const AT = "2026-11-02T09:30:00-05:00";
const src = (source: SourceSummary["source"], over: Partial<SourceSummary> = {}): SourceSummary => ({ source, status: "ok", fetchedAt: AT, fromCache: false, itemCount: 3, ...over });
const client = (over: Partial<ClientWork> = {}): ClientWork => ({ clientKey: "contoso", clientName: "Contoso", status: "ok", fetchedAt: AT, fromCache: false, items: [], children: [], ...over });

describe("the phone's commands leave Ahead out", () => {
  it("drops Ahead's views and actions, keeps the rest", () => {
    const items = [
      { id: "view.today", label: "Today" },
      { id: "view.week", label: "Week" },
      { id: "view.ahead", label: "Ahead" },
      { id: "view.roadmap", label: "Roadmap" },
      { id: "view.backlog", label: "Backlog" },
      { id: "view.gaps", label: "Gaps" },
      { id: "ahead.save", label: "Save changes" },
      { id: "x.y", label: "Ahead: show all" },
      { id: "capture.open", label: "Capture" },
    ] as unknown as MenuItem[];
    expect(withoutAhead(items).map((i) => (i as { id: string }).id)).toEqual(["view.today", "view.week", "capture.open"]);
  });
});

describe("the status dot's one word", () => {
  it("live when every source is live, stale when something is cached, trouble when something fails", () => {
    expect(sourceHealth([src("dataverse"), src("outlook")], [client()])).toBe("live");
    expect(sourceHealth([src("dataverse"), src("outlook", { status: "error", fromCache: true })], [client()])).not.toBe("live");
    expect(sourceHealth([src("dataverse"), src("outlook", { status: "auth_required" })], null)).toBe("trouble");
    expect(sourceHealth([src("dataverse", { status: "error", fromCache: true, cause: "network", message: "offline" })], null)).toBe("trouble");
  });
});

const WEEK = ["mon", "tue", "wed", "thu", "fri"] as const;
const hours: TimeModel = {
  timeZone: "America/New_York",
  weekdays: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [], ...Object.fromEntries(WEEK.map((d) => [d, [{ start: "09:00", end: "17:00" }]])) } as TimeModel["weekdays"],
  lunch: { start: "12:30", end: "12:30" },
  overrides: [],
};
const data = (o: { pto?: string[] } = {}) =>
  ({
    hours,
    ptoAhead: o.pto ?? [],
    week: { days: [{ date: "2026-11-02", pto: false, pm: { off: false, end: "2026-11-02T17:00:00-05:00" } }] },
  }) as unknown as WeekLoadData;

describe("the to-do sheet's moves", () => {
  it("Move to tomorrow is the next working day, same half; Snooze is this afternoon for a morning to-do", () => {
    const m = sheetMoves(aPick({ date: "2026-11-02", half: "AM" }), data(), AT);
    expect(m.tomorrow).toEqual({ date: "2026-11-03", half: "AM", label: "Move to tomorrow" });
    expect(m.later).toEqual({ date: "2026-11-02", half: "PM", label: "Snooze to this afternoon" });
  });
  it("skips PTO and says the day; an afternoon to-do has no Snooze; none once the afternoon is over", () => {
    const m = sheetMoves(aPick({ date: "2026-11-02", half: "PM" }), data({ pto: ["2026-11-03"] }), AT);
    expect(m.tomorrow).toEqual({ date: "2026-11-04", half: "PM", label: "Move to Wednesday" });
    expect(m.later).toBeNull();
    expect(sheetMoves(aPick({ date: "2026-11-02", half: "AM" }), data(), "2026-11-02T17:30:00-05:00").later).toBeNull();
  });
  it("a Friday to-do goes to Monday", () => {
    expect(sheetMoves(aPick({ date: "2026-11-06", half: "AM" }), data(), AT).tomorrow?.label).toBe("Move to Monday");
  });
});

describe("Musts on the phone", () => {
  it("a client's short name: the first word, at most 10 letters", () => {
    expect(shortClient("Northwind Traders")).toBe("Northwind");
    expect(shortClient("Cooptimize")).toBe("Cooptimize");
    expect(shortClient("Internationalization Inc")).toBe("Internati…");
  });
});
