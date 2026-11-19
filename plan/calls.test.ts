// MC-2: which of my own calendar's meetings are "your other calls", the window they come from, and the client a
// call is likely about (a suggestion the person changes freely).
import { describe, expect, it } from "vitest";
import { inWindow, isOtherCall, lengthLabel, otherCallsWindow, suggestClient } from "./calls.ts";

const base = { isAllDay: false, isCancelled: false, isOrganizer: false, response: "accepted", others: 2 };
const clients = [
  { clientKey: "contoso", clientName: "Contoso" },
  { clientKey: "northwind", clientName: "Northwind Traders" },
  { clientKey: "Cooptimize", clientName: "Cooptimize" },
];

describe("your other calls (MC-2)", () => {
  it("is a meeting with someone else on it, not declined, cancelled, all day or my own hold", () => {
    expect(isOtherCall(base)).toBe(true);
    expect(isOtherCall({ ...base, response: "tentativelyAccepted" })).toBe(true);
    expect(isOtherCall({ ...base, response: "notResponded" })).toBe(true);
    expect(isOtherCall({ ...base, response: "organizer", isOrganizer: true })).toBe(true);
    expect(isOtherCall({ ...base, response: "Declined" })).toBe(false);
    expect(isOtherCall({ ...base, isCancelled: true })).toBe(false);
    expect(isOtherCall({ ...base, isAllDay: true })).toBe(false);
    expect(isOtherCall({ ...base, isOrganizer: true, response: "organizer", others: 0 })).toBe(false);
  });

  it("comes from the last 14 of my own local days, up to now", () => {
    // 9:00 PM in New York on Nov 17 is already Nov 18 in UTC; the window still starts at local midnight on Nov 4.
    const w = otherCallsWindow("2026-11-18T02:00:00Z", "America/New_York");
    expect(w).toEqual({ fromIso: "2026-11-04T05:00:00Z", toIso: "2026-11-18T02:00:00Z", fromDay: "2026-11-04" });
    expect(inWindow("2026-11-04T05:00:00Z", w)).toBe(true);
    expect(inWindow("2026-11-04T04:59:00Z", w)).toBe(false);
    expect(inWindow("2026-11-18T02:00:00Z", w)).toBe(false);
    expect(otherCallsWindow("2026-11-17T12:00:00Z", "Asia/Tokyo").fromDay).toBe("2026-11-04");
  });

  it("says a length plainly", () => {
    expect(lengthLabel(45)).toBe("45m");
    expect(lengthLabel(60)).toBe("1h");
    expect(lengthLabel(90)).toBe("1h 30m");
  });
});

describe("the suggested client (MC-2)", () => {
  it("is the one client named in the title, else the focus block's, else nothing", () => {
    expect(suggestClient("Contoso data review", clients)).toBe("contoso");
    expect(suggestClient("Weekly: northwind traders", clients, "contoso")).toBe("northwind");
    expect(suggestClient("Contoso and Northwind Traders sync", clients, "Cooptimize")).toBe("Cooptimize");
    expect(suggestClient("Contosoville planning", clients)).toBeNull();
    expect(suggestClient("Design review", clients, "northwind")).toBe("northwind");
    expect(suggestClient("Design review", clients, "elsewhere")).toBeNull();
    expect(suggestClient("Design review", clients)).toBeNull();
    // MC-4: everyone at Cooptimize and no client named: nothing from the focus block ("Which client?"); a named client still wins.
    expect(suggestClient("Design review", clients, "northwind", true)).toBeNull();
    expect(suggestClient("Contoso data review", clients, "northwind", true)).toBe("contoso");
    expect(suggestClient("Design review", clients, "northwind", false)).toBe("northwind");
  });
});
