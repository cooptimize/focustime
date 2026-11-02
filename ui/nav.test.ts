// Step 16.2: tabs, modes, addresses (back and reopen), P, keys 1–4, entry points and notification and command routes.
import { describe, expect, it } from "vitest";
import { notices, parseRoute, type Notice } from "../plan/notify.ts";
import { afterDone, hashOf, HOME, isPlanning, MODES, modeNav, navOf, parseHash, planDayNav, planDayTitle, planWeekOf, planWeekTitle, routeLoc, tabForKey, TABS, toggleP, viewNav, type Loc, type Nav, type ViewName } from "./nav.ts";

const loc = (nav: Nav): Loc => ({ nav, overlay: null });

describe("tabs and modes", () => {
  it("four tabs in order; Today has four modes, Week and Roadmap two, the Inbox none", () => {
    expect(TABS).toEqual(["today", "week", "roadmap", "inbox"]);
    expect(MODES.today).toEqual(["now", "plan", "checkin", "closeout"]);
    expect(MODES.week).toEqual(["week", "planweek"]);
    expect(MODES.roadmap).toEqual(["roadmap", "ahead"]);
    expect(MODES.inbox).toEqual([]);
  });

  it("keys 1–4 pick the tabs in order (T is Today); other keys none", () => {
    expect(["1", "2", "3", "4", "t", "T"].map(tabForKey)).toEqual(["today", "week", "roadmap", "inbox", "today", "today"]);
    expect(tabForKey("5")).toBeNull();
    expect(tabForKey("p")).toBeNull();
  });

  it("P toggles the current tab's planning mode, and back; the Inbox has none", () => {
    expect(toggleP(navOf.today())).toEqual(navOf.today("plan"));
    expect(toggleP(navOf.today("plan", "2026-11-03"))).toEqual(navOf.today());
    expect(toggleP(navOf.today("checkin"))).toEqual(navOf.today());
    expect(toggleP(navOf.today("closeout", "2026-10-30"))).toEqual(navOf.today());
    expect(toggleP(navOf.week("week", "2026-11-02"))).toEqual(navOf.week("planweek"));
    expect(toggleP(navOf.week("planweek", "2026-11-09"))).toEqual(navOf.week("week", "2026-11-09"));
    expect(toggleP(navOf.roadmap())).toEqual(navOf.roadmap("ahead"));
    expect(toggleP(navOf.roadmap("ahead"))).toEqual(navOf.roadmap());
    expect(toggleP(navOf.inbox())).toEqual(navOf.inbox());
  });

  it("planning modes have a Done that returns to the tab's view mode", () => {
    expect([navOf.today("plan"), navOf.today("checkin"), navOf.today("closeout"), navOf.week("planweek"), navOf.roadmap("ahead")].map(isPlanning)).toEqual([true, true, true, true, true]);
    expect([navOf.today(), navOf.week(), navOf.roadmap(), navOf.inbox()].map(isPlanning)).toEqual([false, false, false, false]);
    expect(afterDone(navOf.today("closeout", "2026-11-02"))).toEqual(navOf.today());
    expect(afterDone(navOf.week("planweek", "2026-11-09"))).toEqual(navOf.week());
    expect(afterDone(navOf.roadmap("ahead"))).toEqual(navOf.roadmap());
  });

  it("each mode on a switch opens its place", () => {
    for (const tab of TABS) for (const m of MODES[tab]) expect(modeNav(tab, m)).toMatchObject({ tab, mode: m });
  });
});

describe("addresses", () => {
  const places: [Loc, string][] = [
    [HOME, "#/today"],
    [loc(navOf.today("plan")), "#/today/plan"],
    [loc(navOf.today("plan", "2026-11-03")), "#/today/plan/2026-11-03"],
    [loc(navOf.today("plan", "2026-11-03", "PM")), "#/today/plan/2026-11-03/PM"],
    [loc(navOf.today("checkin")), "#/today/checkin"],
    [loc(navOf.today("closeout", "2026-10-30")), "#/today/closeout/2026-10-30"],
    [loc(navOf.week()), "#/week"],
    [loc(navOf.week("week", "2026-11-09")), "#/week/2026-11-09"],
    [loc(navOf.week("planweek")), "#/week/plan"],
    [loc(navOf.week("planweek", "2026-11-09")), "#/week/plan/2026-11-09"],
    [loc(navOf.roadmap()), "#/roadmap"],
    [loc(navOf.roadmap("ahead")), "#/roadmap/ahead"],
    [loc(navOf.inbox()), "#/inbox"],
    [loc(navOf.inbox(12)), "#/inbox/12"],
    [{ nav: navOf.today(), overlay: { kind: "focus" } }, "#/focus"],
    [{ nav: navOf.today(), overlay: { kind: "settings", section: "notifications" } }, "#/settings/notifications"],
  ];
  it("every tab and mode has an address that reads back as the same place (back and reopen land there)", () => {
    for (const [l, h] of places) {
      expect(hashOf(l)).toBe(h);
      expect(parseHash(h)).toEqual(l);
    }
  });
  it("an empty address is Today; anything unknown or malformed is refused", () => {
    expect(parseHash("")).toEqual(HOME);
    expect(parseHash("#/")).toEqual(HOME);
    for (const bad of ["#/delivery", "#/plan", "#/today/plan/2026-13-40", "#/today/plan/soon", "#/today/checkin/2026-11-02", "#/today/plan/2026-11-03/XM", "#/week/plan/x", "#/inbox/0", "#/settings/../x", "#/roadmap/later", "#/today/plan/2026-11-03/PM/extra", "#/" + "x".repeat(90)]) expect(parseHash(bad), bad).toBeNull();
  });
});

describe("entry points", () => {
  it("a Week day header's Plan chip opens Today › Plan on that day; + Add work on that day and block", () => {
    expect(planDayNav("2026-11-04")).toEqual({ tab: "today", mode: "plan", date: "2026-11-04", half: null });
    expect(planDayNav("2026-11-04", "PM")).toEqual({ tab: "today", mode: "plan", date: "2026-11-04", half: "PM" });
    expect(hashOf(loc(planDayNav("2026-11-04", "PM")))).toBe("#/today/plan/2026-11-04/PM");
  });
  it("Plan the week defaults to next week; headers say which day and week", () => {
    expect(planWeekOf(null, "2026-11-02")).toBe("2026-11-09");
    expect(planWeekOf("2026-11-02", "2026-11-02")).toBe("2026-11-02");
    expect(planWeekTitle("2026-11-09", "2026-11-02")).toBe("Plan the week of Nov 9 · next week");
    expect(planWeekTitle("2026-11-02", "2026-11-02")).toBe("Plan the week of Nov 2 · this week");
    expect(planWeekTitle("2026-10-26", "2026-11-02")).toBe("Plan the week of Oct 26 · review");
    expect(planDayTitle("2026-11-02", "2026-11-02")).toBe("Plan today");
    expect(planDayTitle("2026-11-03", "2026-11-02")).toBe("Plan Tuesday, Nov 3");
    expect(planDayTitle("2026-10-30", "2026-11-02")).toBe("Review Friday, Oct 30");
  });
});

describe("notification routes (all 11 kinds of step 15.5)", () => {
  const at = "2026-11-02T15:00:00Z";
  const all: [string, Notice, Loc, boolean][] = [
    ["plan_day", notices.planDay("2026-11-02", at), loc(navOf.today("plan")), false],
    ["checkin", notices.checkin("2026-11-02", at), loc(navOf.today("checkin")), false],
    ["closeout", notices.closeout("2026-11-02", at), loc(navOf.today("closeout")), false],
    ["plan_week", notices.week("2026-11-02", true, at), loc(navOf.week("planweek", "2026-11-02")), false],
    ["look_ahead", notices.week("2026-11-09", false, at), loc(navOf.week("planweek", "2026-11-09")), false],
    ["timer", notices.timerEnd(false, "A", at, at), { nav: navOf.today(), overlay: { kind: "focus" } }, false],
    ["meeting", notices.meeting(["10:00 Standup"], ["k"], at), { nav: navOf.today(), overlay: { kind: "focus" } }, false],
    ["vm", notices.vmOff("2026-11-02", "vm-demo", at), loc(navOf.today()), true],
    ["vm_changed", notices.vmChanged("2026-11-02", "Delayed 1h", at), loc(navOf.today()), false],
    ["followups (one)", notices.followUps("2026-11-02", [{ id: 7, what: "A", overdue: false }], at)!, loc(navOf.inbox(7)), false],
    ["followups (several)", notices.followUps("2026-11-02", [{ id: 7, what: "A", overdue: false }, { id: 8, what: "B", overdue: true }], at)!, loc(navOf.inbox()), false],
    ["expiry", notices.expiry("2026-11-02", [{ text: "x", section: "clients" }], at)!, { nav: navOf.today(), overlay: { kind: "settings", section: "clients" } }, false],
  ];
  it("each opens its tab and mode", () => {
    for (const [name, n, want, vmMenu] of all) {
      const r = parseRoute(n.route);
      expect(r, name).not.toBeNull();
      expect(routeLoc(r!), name).toEqual({ loc: want, vmMenu });
    }
  });
});

describe("command menu views", () => {
  it("every view a command opens is a tab and mode, or an overlay", () => {
    const want: Record<ViewName, string> = {
      today: "#/today", week: "#/week", inbox: "#/inbox", follow_ups: "#/inbox", capture: "#/inbox", roadmap: "#/roadmap", ahead: "#/roadmap/ahead",
      planday: "#/today/plan", planweek: "#/week/plan", checkin: "#/today/checkin", closeout: "#/today/closeout", focus: "#/focus", settings: "#/settings/you",
    };
    for (const [v, h] of Object.entries(want)) {
      const r = viewNav(v as ViewName);
      expect(hashOf({ nav: r.nav ?? navOf.today(), overlay: r.overlay }), v).toBe(h);
    }
  });
});
