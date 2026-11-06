// Step 16.2, NV-1: tabs (Today · Week · Ahead · Inbox), Week's Board and Commit, Ahead's Grid, Gantt and Fix next (AH-1),
// Today's flows, addresses (back and reopen), every older address redirecting with its date or id kept, P, keys 1–4,
// entry points, and notification and command routes.
import { describe, expect, it } from "vitest";
import { notices, parseRoute, type Notice } from "../plan/notify.ts";
import { afterDone, focusOf, hashOf, HOME, isPlanning, MODE_NAMES, MODES, modeNav, navOf, parseHash, planDayNav, planDayTitle, planWeekOf, planWeekTitle, routeLoc, TAB_NAMES, tabForKey, TABS, toggleP, viewName, viewNav, type Loc, type Nav, type ViewName } from "./nav.ts";

const loc = (nav: Nav): Loc => ({ nav, overlay: null });

describe("tabs and modes", () => {
  it("four tabs in order, Roadmap now named Ahead; Week has Board, Commit, Team and Status (SR-1), Ahead Grid, Gantt and Fix next, Today and the Inbox none", () => {
    expect(TABS).toEqual(["today", "week", "ahead", "inbox"]);
    expect(TABS.map((t) => TAB_NAMES[t])).toEqual(["Today", "Week", "Ahead", "Inbox"]);
    expect(MODES.today).toEqual([]);
    expect(MODES.week).toEqual(["board", "commit", "team", "status"]);
    expect(MODES.ahead).toEqual(["grid", "gantt", "fix"]);
    expect(MODES.inbox).toEqual([]);
  });

  it("SR-1: Week › Status has its own address and comes back from it", () => {
    expect(hashOf({ nav: navOf.week("status"), overlay: null })).toBe("#/week/status");
    expect(parseHash("#/week/status")).toEqual({ nav: navOf.week("status"), overlay: null });
    expect(parseHash("#/week/status/2026-11-02")).toBeNull();
  });

  it("SW-1: Week › Team has its own address, with or without a week, and a notification opens it", () => {
    expect(hashOf({ nav: navOf.week("team"), overlay: null })).toBe("#/week/team");
    expect(hashOf({ nav: navOf.week("team", "2026-11-09"), overlay: null })).toBe("#/week/team/2026-11-09");
    expect(parseHash("#/week/team/2026-11-09")?.nav).toEqual(navOf.week("team", "2026-11-09"));
    expect(parseHash("#/week/team")?.nav).toEqual(navOf.week("team"));
    expect(routeLoc({ view: "team" }).loc.nav).toEqual(navOf.week("team"));
  });

  it("keys 1–4 pick the tabs in order (T is Today); other keys none", () => {
    expect(["1", "2", "3", "4", "t", "T"].map(tabForKey)).toEqual(["today", "week", "ahead", "inbox", "today", "today"]);
    expect(tabForKey("5")).toBeNull();
    expect(tabForKey("p")).toBeNull();
  });

  it("P: Week toggles Board and Commit, Ahead Grid and Gantt, Today opens Plan today (and a flow goes back); the Inbox has none", () => {
    expect(toggleP(navOf.week("board", "2026-11-02"))).toEqual(navOf.week("commit"));
    expect(toggleP(navOf.planDay("2026-11-03"))).toEqual(navOf.week("commit"));
    expect(toggleP(navOf.week("commit", "2026-11-09"))).toEqual(navOf.week("board", "2026-11-09"));
    expect(toggleP(navOf.ahead())).toEqual(navOf.ahead("gantt"));
    expect(toggleP(navOf.ahead("gantt"))).toEqual(navOf.ahead());
    expect(toggleP(navOf.ahead("fix"))).toEqual(navOf.ahead("gantt"));
    expect(toggleP(navOf.today())).toEqual(navOf.planDay());
    expect(toggleP(navOf.today("checkin"))).toEqual(navOf.today());
    expect(toggleP(navOf.inbox())).toEqual(navOf.inbox());
  });

  it("planning places have a Done that returns to their view; a focused day goes back to its own week", () => {
    expect([navOf.planDay(), navOf.today("checkin"), navOf.today("closeout"), navOf.week("commit")].map(isPlanning)).toEqual([true, true, true, true]);
    expect([navOf.today(), navOf.week(), navOf.ahead(), navOf.ahead("gantt"), navOf.ahead("fix"), navOf.inbox()].map(isPlanning)).toEqual([false, false, false, false, false, false]);
    expect(afterDone(navOf.today("closeout", "2026-11-02"))).toEqual(navOf.today());
    expect(afterDone(navOf.week("commit", "2026-11-09"))).toEqual(navOf.week());
    expect(afterDone(navOf.planDay("2026-11-11", "PM"))).toEqual(navOf.week("board", "2026-11-09"));
    expect(afterDone(navOf.planDay())).toEqual(navOf.week());
    expect(afterDone(navOf.ahead("gantt"))).toEqual(navOf.ahead());
  });

  it("each mode on a switch opens its place", () => {
    for (const tab of ["week", "ahead"] as const) for (const m of MODES[tab]) expect(modeNav(tab, m)).toMatchObject({ tab, mode: m });
    // UI-7: the Inbox's modes are its flags (their addresses are unchanged).
  });

  it("the focused day is the Board's (Commit has none)", () => {
    expect(focusOf(navOf.planDay("2026-11-03", "AM"))).toEqual({ date: "2026-11-03", half: "AM" });
    expect(focusOf(navOf.week())).toBeNull();
    expect(focusOf(navOf.week("commit"))).toBeNull();
    expect(focusOf(navOf.today())).toBeNull();
  });
});

describe("addresses", () => {
  const places: [Loc, string][] = [
    [HOME, "#/today"],
    [loc(navOf.today("checkin")), "#/today/checkin"],
    [loc(navOf.today("closeout")), "#/today/closeout"],
    [loc(navOf.today("closeout", "2026-10-30")), "#/today/closeout/2026-10-30"],
    [loc(navOf.week()), "#/week"],
    [loc(navOf.week("board", "2026-11-09")), "#/week/2026-11-09"],
    [loc(navOf.planDay()), "#/week/day"],
    [loc(navOf.planDay("2026-11-03")), "#/week/day/2026-11-03"],
    [loc(navOf.planDay("2026-11-03", "PM")), "#/week/day/2026-11-03/PM"],
    [loc(navOf.week("commit")), "#/week/commit"],
    [loc(navOf.week("commit", "2026-11-09")), "#/week/commit/2026-11-09"],
    [loc(navOf.ahead()), "#/ahead"],
    [loc(navOf.ahead("gantt")), "#/ahead/gantt"],
    [loc(navOf.ahead("fix")), "#/ahead/fix"],
    [loc(navOf.aheadItem(437)), "#/ahead/item/437"],
    [loc(navOf.inbox()), "#/inbox"],
    [loc(navOf.inbox(12)), "#/inbox/item/f12"],
    [loc(navOf.conversations()), "#/inbox/needs-you"],
    [loc(navOf.myPromises()), "#/inbox/promises"],
    [{ nav: navOf.today(), overlay: { kind: "focus" } }, "#/focus"],
    [{ nav: navOf.today(), overlay: { kind: "settings", section: "notifications" } }, "#/settings/notifications"],
  ];
  it("every tab, mode and flow has an address that reads back as the same place (back and reopen land there)", () => {
    for (const [l, h] of places) {
      expect(hashOf(l)).toBe(h);
      expect(parseHash(h)).toEqual(l);
    }
  });

  // NV-1: links, bookmarks and notifications from before still land, with their date, block, week or id.
  const redirects: [string, Loc, string][] = [
    ["#/today/plan", loc(navOf.planDay()), "#/week/day"],
    ["#/today/plan/2026-11-03", loc(navOf.planDay("2026-11-03")), "#/week/day/2026-11-03"],
    ["#/today/plan/2026-11-03/PM", loc(navOf.planDay("2026-11-03", "PM")), "#/week/day/2026-11-03/PM"],
    ["#/week/plan", loc(navOf.week("commit")), "#/week/commit"],
    ["#/week/plan/2026-11-09", loc(navOf.week("commit", "2026-11-09")), "#/week/commit/2026-11-09"],
    ["#/roadmap", loc(navOf.ahead()), "#/ahead"],
    ["#/roadmap/ahead", loc(navOf.ahead("gantt")), "#/ahead/gantt"],
    ["#/ahead/plan", loc(navOf.ahead("gantt")), "#/ahead/gantt"],
    ["#/conversations", loc(navOf.conversations()), "#/inbox/needs-you"],
    ["#/my-promises", loc(navOf.myPromises()), "#/inbox/promises"],
    ["#/inbox/requests", loc(navOf.conversations()), "#/inbox/needs-you"],
    ["#/inbox/asks", loc(navOf.conversations()), "#/inbox/needs-you"],
    ["#/inbox/my-promises", loc(navOf.myPromises()), "#/inbox/promises"],
    ["#/inbox/conversation/12", loc(navOf.inboxItem("v12")), "#/inbox/item/v12"],
    ["#/inbox/promise/7", loc(navOf.inboxItem("c7")), "#/inbox/item/c7"],
    ["#/inbox/12", loc(navOf.inboxItem("f12")), "#/inbox/item/f12"],
  ];
  it("each older address redirects to its new home, keeping the date, block and week", () => {
    for (const [old, l, now] of redirects) {
      expect(parseHash(old), old).toEqual(l);
      expect(hashOf(parseHash(old)!), old).toBe(now);
    }
  });

  it("an empty address is Today; anything unknown or malformed is refused", () => {
    expect(parseHash("")).toEqual(HOME);
    expect(parseHash("#/")).toEqual(HOME);
    for (const bad of ["#/delivery", "#/plan", "#/today/plan/2026-13-40", "#/today/plan/soon", "#/today/checkin/2026-11-02", "#/today/plan/2026-11-03/XM", "#/week/plan/x", "#/week/day/2026-11-03/XM", "#/week/commit/x/y", "#/inbox/0", "#/settings/../x", "#/roadmap/later", "#/ahead/later", "#/ahead/item/0", "#/ahead/gantt/x", "#/conversations/1", "#/today/plan/2026-11-03/PM/extra", "#/" + "x".repeat(90)]) expect(parseHash(bad), bad).toBeNull();
  });
});

describe("entry points", () => {
  it("a Week day header's Plan chip focuses the Board on that day; + Add work on that day and block", () => {
    expect(planDayNav("2026-11-04")).toEqual({ tab: "week", mode: "board", week: null, focus: { date: "2026-11-04", half: null } });
    expect(planDayNav("2026-11-04", "PM")).toEqual({ tab: "week", mode: "board", week: null, focus: { date: "2026-11-04", half: "PM" } });
    expect(hashOf(loc(planDayNav("2026-11-04", "PM")))).toBe("#/week/day/2026-11-04/PM");
  });
  it("Commit (Plan the week) defaults to next week; headers say which day and week", () => {
    expect(planWeekOf(null, "2026-11-02")).toBe("2026-11-09");
    expect(planWeekOf("2026-11-02", "2026-11-02")).toBe("2026-11-02");
    expect(planWeekTitle("2026-11-09", "2026-11-02")).toBe("Plan the week of Nov 9 · next week");
    expect(planWeekTitle("2026-11-02", "2026-11-02")).toBe("Plan the week of Nov 2 · this week");
    expect(planWeekTitle("2026-10-26", "2026-11-02")).toBe("Plan the week of Oct 26 · review");
    expect(planDayTitle("2026-11-02", "2026-11-02")).toBe("Plan today");
    expect(planDayTitle("2026-11-03", "2026-11-02")).toBe("Plan Tuesday, Nov 3");
    expect(planDayTitle("2026-10-30", "2026-11-02")).toBe("Review Friday, Oct 30");
  });
  it("Feedback names the place in the new words", () => {
    expect(viewName(HOME)).toBe("Today");
    expect(viewName(loc(navOf.today("checkin")))).toBe("Today › Midday check-in");
    expect(viewName(loc(navOf.planDay()))).toBe("Week › Plan today");
    expect(viewName(loc(navOf.planDay("2026-11-03")))).toBe("Week › Plan 2026-11-03");
    expect(viewName(loc(navOf.week("commit")))).toBe("Week › Plan");
    expect(viewName(loc(navOf.ahead()))).toBe("Ahead › Grid");
    expect(viewName(loc(navOf.ahead("gantt")))).toBe("Ahead › Gantt");
    expect(viewName(loc(navOf.ahead("fix")))).toBe("Ahead › Gaps");
    expect(viewName(loc(navOf.conversations()))).toBe("Inbox › Needs you");
  });
});

describe("notification routes (all kinds of step 15.5)", () => {
  const at = "2026-11-02T15:00:00Z";
  const all: [string, Notice, Loc, boolean][] = [
    // NV-1: Plan the day opens Week's Board focused on the day.
    ["plan_day", notices.planDay("2026-11-02", at), loc(navOf.planDay()), false],
    ["checkin", notices.checkin("2026-11-02", at), loc(navOf.today("checkin")), false],
    ["closeout", notices.closeout("2026-11-02", at), loc(navOf.today("closeout")), false],
    ["plan_week", notices.week("2026-11-02", true, at), loc(navOf.week("commit", "2026-11-02")), false],
    ["look_ahead", notices.week("2026-11-09", false, at), loc(navOf.week("commit", "2026-11-09")), false],
    ["timer", notices.timerEnd(false, "A", at, at), { nav: navOf.today(), overlay: { kind: "focus" } }, false],
    ["meeting", notices.meeting(["10:00 Standup"], ["k"], at), { nav: navOf.today(), overlay: { kind: "focus" } }, false],
    ["vm", notices.vmOff("2026-11-02", "vm-demo", at), loc(navOf.today()), true],
    ["followups (one)", notices.followUps("2026-11-02", [{ id: 7, what: "A", overdue: false }], at)!, loc(navOf.inbox(7)), false],
    ["followups (several)", notices.followUps("2026-11-02", [{ id: 7, what: "A", overdue: false }, { id: 8, what: "B", overdue: true }], at)!, loc(navOf.myPromises()), false],
    ["expiry", notices.expiry("2026-11-02", [{ text: "x", section: "clients" }], at)!, { nav: navOf.today(), overlay: { kind: "settings", section: "clients" } }, false],
    // Both Plan ahead rituals open Ahead › Gantt (AH-1).
    ["plan_ahead", notices.planAhead("plan_ahead:2026-11-05", at), loc(navOf.ahead("gantt")), false],
    ["direction", notices.direction("direction:2026-12", "2026-12-03", at), loc(navOf.ahead("gantt")), false],
  ];
  it("each opens its tab, mode or flow", () => {
    for (const [name, n, want, vmMenu] of all) {
      const r = parseRoute(n.route);
      expect(r, name).not.toBeNull();
      expect(routeLoc(r!), name).toEqual({ loc: want, vmMenu });
    }
  });
});

describe("command menu views", () => {
  it("every view a command opens is a tab and mode, a flow, or an overlay", () => {
    const want: Partial<Record<ViewName, string>> = {
      today: "#/today", week: "#/week", inbox: "#/inbox", follow_ups: "#/inbox/promises", capture: "#/inbox/captures", roadmap: "#/ahead", ahead: "#/ahead/gantt",
      planday: "#/week/day", planweek: "#/week/commit", commit: "#/week/commit", checkin: "#/today/checkin", closeout: "#/today/closeout", focus: "#/focus", settings: "#/settings/you",
      conversations: "#/inbox/needs-you", requests: "#/inbox/needs-you", my_promises: "#/inbox/promises",
    };
    for (const [v, h] of Object.entries(want)) {
      const r = viewNav(v as ViewName);
      expect(hashOf({ nav: r.nav ?? navOf.today(), overlay: r.overlay }), v).toBe(h);
    }
  });
});

describe("Inbox views and items (IB-1)", () => {
  it("one list with views: no modes; each view and item has an address that reads back", () => {
    expect(MODES.inbox).toEqual([]);
    for (const v of ["needs_you", "promises", "waiting", "in_progress", "captures", "teammates", "done", "chatter"] as const) {
      const l = loc(navOf.inboxView(v));
      expect(parseHash(hashOf(l))).toEqual(l);
    }
    expect(hashOf(loc(navOf.inboxView("needs_you")))).toBe("#/inbox/needs-you");
    for (const k of ["v12", "c7", "f42", "s3", "k9", "d5"]) expect(parseHash(`#/inbox/item/${k}`)?.nav).toEqual(navOf.inboxItem(k));
    expect(parseHash("#/inbox/item/x1")).toBeNull();
    expect(parseHash("#/inbox/item/v0")).toBeNull();
  });
  it("old links open the right item or view (they still land)", () => {
    expect(parseHash("#/inbox/conversation/12")?.nav).toEqual(navOf.inboxItem("v12"));
    expect(parseHash("#/inbox/promise/7")?.nav).toEqual(navOf.inboxItem("c7"));
    expect(parseHash("#/inbox/42")?.nav).toEqual(navOf.inboxItem("f42"));
    expect(hashOf(loc(navOf.inbox(42)))).toBe("#/inbox/item/f42");
    for (const [h, v] of [["#/inbox/conversations", "needs_you"], ["#/conversations", "needs_you"], ["#/inbox/requests", "needs_you"], ["#/inbox/my-promises", "promises"], ["#/promises", "promises"], ["#/my-promises", "promises"], ["#/inbox/captures", "captures"]] as const) {
      const n = parseHash(h)!.nav;
      expect(n.tab === "inbox" && n.view, h).toBe(v);
    }
  });
  it("the bare Inbox is the view I last used; notifications and commands land on Promises and Captures", () => {
    expect(parseHash("#/inbox")!.nav).toEqual({ tab: "inbox", view: null, item: null });
    expect(routeLoc({ view: "followup", id: 5 }).loc.nav).toEqual(navOf.inboxItem("f5"));
    expect(routeLoc({ view: "inbox" }).loc.nav).toEqual(navOf.myPromises());
    expect(viewNav("capture").nav).toEqual(navOf.captures());
    expect(viewNav("follow_ups").nav).toEqual(navOf.myPromises());
    expect(viewNav("inbox").nav).toEqual(navOf.inbox());
    expect(viewName(loc(navOf.captures()))).toBe("Inbox › Captures and drafts");
    expect(viewName(loc(navOf.myPromises()))).toBe("Inbox › Promises");
    expect(toggleP(navOf.myPromises())).toEqual(navOf.myPromises());
  });
});
