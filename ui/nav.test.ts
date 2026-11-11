// Step 16.2, NV-1, WD-1, RF-1: tabs (Day · Week · Ahead · Status · Inbox), Week with no modes and its Add work panel,
// Ahead's Grid, Gantt, Gaps and Backlog, Day's flows, addresses (back and reopen), every older address landing with
// its date, block, week or id, P, keys 1–5, entry points, and notification and command routes.
import { describe, expect, it } from "vitest";
import { notices, parseRoute, type Notice } from "../plan/notify.ts";
import { addOf, addWorkNav, afterDone, hashOf, HOME, isPlanning, MODES, modeNav, navOf, parseHash, routeLoc, TAB_NAMES, tabForKey, TABS, toggleP, viewName, viewNav, weekOfAdd, type Loc, type Nav, type ViewName, queryOf, setAheadQuery } from "./nav.ts";

const loc = (nav: Nav): Loc => ({ nav, overlay: null });

describe("tabs and modes", () => {
  it("WD-1: five tabs in order, Today named Day and Status its own tab; Week, Day, Inbox and Status have no modes", () => {
    expect(TABS).toEqual(["today", "week", "ahead", "status", "inbox"]);
    expect(TABS.map((t) => TAB_NAMES[t])).toEqual(["Day", "Week", "Ahead", "Status", "Inbox"]);
    expect(MODES.today).toEqual([]);
    expect(MODES.week).toEqual([]);
    expect(MODES.ahead).toEqual(["grid", "gantt", "fix", "backlog"]);
    expect(MODES.inbox).toEqual([]);
    expect(MODES.status).toEqual([]);
  });

  it("WD-1: Team is hidden but its address still opens it; its notification opens the week", () => {
    expect(hashOf(loc(navOf.week("team")))).toBe("#/week/team");
    expect(hashOf(loc(navOf.week("team", "2026-11-09")))).toBe("#/week/team/2026-11-09");
    expect(parseHash("#/week/team/2026-11-09")?.nav).toEqual(navOf.week("team", "2026-11-09"));
    expect(parseHash("#/week/team")?.nav).toEqual(navOf.week("team"));
    expect(routeLoc({ view: "team" }).loc.nav).toEqual(navOf.week());
  });

  it("keys 1–5 pick the tabs in order (T is Day, L the Inbox); other keys none", () => {
    expect(["1", "2", "3", "4", "5", "t", "T", "l", "L"].map(tabForKey)).toEqual(["today", "week", "ahead", "status", "inbox", "today", "today", "inbox", "inbox"]);
    expect(tabForKey("6")).toBeNull();
    expect(tabForKey("p")).toBeNull();
  });

  it("review fix: a week's Add work address is on its Monday, whatever day was typed", () => {
    expect(parseHash("#/week/commit/2026-11-10")?.nav).toEqual(navOf.weekAdd("2026-11-09"));
    expect(parseHash("#/week/2026-11-12/add")?.nav).toEqual(navOf.weekAdd("2026-11-09"));
    expect(navOf.weekAdd("2026-11-13")).toEqual({ tab: "week", mode: "board", week: "2026-11-09", add: { date: null, half: null } });
  });

  it("P: on Week opens or closes the Add work panel (keeping the week); Ahead toggles Grid and Gantt; a Day flow goes back; elsewhere opens Week with the panel", () => {
    expect(toggleP(navOf.week("board", "2026-11-09"))).toEqual(navOf.weekAdd("2026-11-09"));
    expect(toggleP(navOf.weekAdd("2026-11-09"))).toEqual(navOf.week("board", "2026-11-09"));
    expect(toggleP(navOf.addWork("2026-11-11", "PM"))).toEqual(navOf.week("board", "2026-11-09"));
    expect(toggleP(navOf.ahead())).toEqual(navOf.ahead("gantt"));
    expect(toggleP(navOf.ahead("gantt"))).toEqual(navOf.ahead());
    expect(toggleP(navOf.ahead("fix"))).toEqual(navOf.ahead("gantt"));
    expect(toggleP(navOf.today("checkin"))).toEqual(navOf.today());
    expect(toggleP(navOf.today())).toEqual(navOf.weekAdd());
    expect(toggleP(navOf.myPromises())).toEqual(navOf.weekAdd());
    expect(toggleP(navOf.status())).toEqual(navOf.weekAdd());
  });

  it("only Day's flows are planning places; Done closes the panel on its own week", () => {
    expect([navOf.today("checkin"), navOf.today("closeout")].map(isPlanning)).toEqual([true, true]);
    expect([navOf.today(), navOf.week(), navOf.weekAdd(), navOf.addWork("2026-11-03"), navOf.ahead(), navOf.ahead("gantt"), navOf.inbox(), navOf.status()].map(isPlanning)).toEqual([false, false, false, false, false, false, false, false]);
    expect(afterDone(navOf.today("closeout", "2026-11-02"))).toEqual(navOf.today());
    expect(afterDone(navOf.weekAdd("2026-11-09"))).toEqual(navOf.week("board", "2026-11-09"));
    expect(afterDone(navOf.addWork("2026-11-11", "PM"))).toEqual(navOf.week("board", "2026-11-09"));
    expect(afterDone(navOf.addWork())).toEqual(navOf.week());
    expect(afterDone(navOf.ahead("gantt"))).toEqual(navOf.ahead());
  });

  it("each of Ahead's modes on its switch opens its place", () => {
    for (const m of MODES.ahead) expect(modeNav("ahead", m)).toMatchObject({ tab: "ahead", mode: m });
  });

  it("the panel's block, and the week a panel place shows", () => {
    expect(addOf(navOf.addWork("2026-11-03", "AM"))).toEqual({ date: "2026-11-03", half: "AM" });
    expect(addOf(navOf.addWork("2026-11-03"))).toEqual({ date: "2026-11-03", half: null });
    expect(addOf(navOf.weekAdd())).toEqual({ date: null, half: null });
    expect(addOf(navOf.week())).toBeNull();
    expect(addOf(navOf.week("team"))).toBeNull();
    expect(addOf(navOf.today())).toBeNull();
    // A half with no date means nothing.
    expect(navOf.addWork(null, "PM")).toEqual(navOf.addWork());
    expect(weekOfAdd(navOf.addWork("2026-11-12", "AM") as Extract<Nav, { tab: "week" }>)).toBe("2026-11-09");
    expect(weekOfAdd(navOf.weekAdd("2026-11-16") as Extract<Nav, { tab: "week" }>)).toBe("2026-11-16");
    expect(weekOfAdd(navOf.weekAdd() as Extract<Nav, { tab: "week" }>)).toBeNull();
  });
});

describe("addresses", () => {
  const places: [Loc, string][] = [
    [HOME, "#/day"],
    [loc(navOf.todayOn("2026-11-03")), "#/day/2026-11-03"],
    [loc(navOf.today("checkin")), "#/day/checkin"],
    [loc(navOf.today("closeout")), "#/day/closeout"],
    [loc(navOf.today("closeout", "2026-10-30")), "#/day/closeout/2026-10-30"],
    [loc(navOf.week()), "#/week"],
    [loc(navOf.week("board", "2026-11-09")), "#/week/2026-11-09"],
    [loc(navOf.weekAdd()), "#/week/add"],
    [loc(navOf.weekAdd("2026-11-09")), "#/week/2026-11-09/add"],
    [loc(navOf.addWork("2026-11-03")), "#/week/day/2026-11-03"],
    [loc(navOf.addWork("2026-11-03", "PM")), "#/week/day/2026-11-03/PM"],
    [loc(navOf.status()), "#/status"],
    [loc(navOf.statusNeeds()), "#/status/needs"],
    [loc(navOf.ahead()), "#/ahead"],
    [loc(navOf.ahead("gantt")), "#/ahead/gantt"],
    [loc(navOf.ahead("backlog")), "#/ahead/backlog"],
    [loc(navOf.ahead("fix")), "#/ahead/fix"],
    [loc(navOf.aheadItem(437)), "#/ahead/item/437"],
    [loc(navOf.inbox()), "#/inbox"],
    [loc(navOf.inbox(12)), "#/inbox/item/f12"],
    [loc(navOf.conversations()), "#/inbox/needs-you"],
    [loc(navOf.myPromises()), "#/inbox/promises"],
    [{ nav: navOf.today(), overlay: { kind: "focus" } }, "#/focus"],
    [{ nav: navOf.today(), overlay: { kind: "settings", section: "notifications" } }, "#/settings/notifications"],
    // ST-1: Settings' own page (the rail as a list on a phone) and one setting in a section.
    [{ nav: navOf.today(), overlay: { kind: "settings", section: "" } }, "#/settings"],
    [{ nav: navOf.today(), overlay: { kind: "settings", section: "devops", setting: "devops-write" } }, "#/settings/devops/devops-write"],
    [{ nav: navOf.today(), overlay: { kind: "settings", section: "client", setting: "Wide World Importers" } }, "#/settings/client/Wide%20World%20Importers"],
  ];
  it("every tab, panel and flow has an address that reads back as the same place (back and reopen land there)", () => {
    for (const [l, h] of places) {
      expect(hashOf(l), h).toBe(h);
      expect(parseHash(h), h).toEqual(l);
    }
  });

  // NV-1, WD-1: links, bookmarks and notifications from before still land, with their date, block, week or id.
  const redirects: [string, Loc, string][] = [
    // WD-1: Today is Day.
    ["#/today", HOME, "#/day"],
    ["#/today/2026-11-03", loc(navOf.todayOn("2026-11-03")), "#/day/2026-11-03"],
    ["#/today/checkin", loc(navOf.today("checkin")), "#/day/checkin"],
    ["#/today/closeout", loc(navOf.today("closeout")), "#/day/closeout"],
    ["#/today/closeout/2026-10-30", loc(navOf.today("closeout", "2026-10-30")), "#/day/closeout/2026-10-30"],
    // Before NV-1, Today › Plan; WD-1: Week with the panel on that day and block.
    ["#/today/plan", loc(navOf.weekAdd()), "#/week/add"],
    ["#/today/plan/2026-11-03", loc(navOf.addWork("2026-11-03")), "#/week/day/2026-11-03"],
    ["#/today/plan/2026-11-03/PM", loc(navOf.addWork("2026-11-03", "PM")), "#/week/day/2026-11-03/PM"],
    ["#/day/plan/2026-11-03/PM", loc(navOf.addWork("2026-11-03", "PM")), "#/week/day/2026-11-03/PM"],
    // NV-1's Board focused on a day: now the panel on it.
    ["#/week/day", loc(navOf.weekAdd()), "#/week/add"],
    // WD-1: Plan (Commit) opens the week with the panel.
    ["#/week/commit", loc(navOf.weekAdd()), "#/week/add"],
    ["#/week/commit/2026-11-09", loc(navOf.weekAdd("2026-11-09")), "#/week/2026-11-09/add"],
    ["#/week/plan", loc(navOf.weekAdd()), "#/week/add"],
    ["#/week/plan/2026-11-09", loc(navOf.weekAdd("2026-11-09")), "#/week/2026-11-09/add"],
    // WD-1: Week › Status is the Status tab.
    ["#/week/status", loc(navOf.status()), "#/status"],
    ["#/week/status/needs", loc(navOf.statusNeeds()), "#/status/needs"],
    ["#/roadmap", loc(navOf.ahead()), "#/ahead"],
    ["#/roadmap/ahead", loc(navOf.ahead("gantt")), "#/ahead/gantt"],
    ["#/ahead/plan", loc(navOf.ahead("gantt")), "#/ahead/gantt"],
    ["#/ahead/gaps", loc(navOf.ahead("fix")), "#/ahead/fix"],
    ["#/conversations", loc(navOf.conversations()), "#/inbox/needs-you"],
    ["#/my-promises", loc(navOf.myPromises()), "#/inbox/promises"],
    ["#/inbox/requests", loc(navOf.conversations()), "#/inbox/needs-you"],
    ["#/inbox/asks", loc(navOf.conversations()), "#/inbox/needs-you"],
    ["#/inbox/my-promises", loc(navOf.myPromises()), "#/inbox/promises"],
    ["#/inbox/conversation/12", loc(navOf.inboxItem("v12")), "#/inbox/item/v12"],
    ["#/inbox/promise/7", loc(navOf.inboxItem("c7")), "#/inbox/item/c7"],
    ["#/inbox/12", loc(navOf.inboxItem("f12")), "#/inbox/item/f12"],
  ];
  it("each older address lands on its new home, keeping the date, block and week", () => {
    for (const [old, l, now] of redirects) {
      expect(parseHash(old), old).toEqual(l);
      expect(hashOf(parseHash(old)!), old).toBe(now);
    }
  });

  it("an empty address is Day; anything unknown or malformed is refused", () => {
    expect(parseHash("")).toEqual(HOME);
    expect(parseHash("#/")).toEqual(HOME);
    for (const bad of ["#/delivery", "#/plan", "#/today/plan/2026-13-40", "#/today/plan/soon", "#/today/checkin/2026-11-02", "#/day/checkin/2026-11-02", "#/today/plan/2026-11-03/XM", "#/week/plan/x", "#/week/day/2026-11-03/XM", "#/week/commit/x/y", "#/week/2026-11-09/add/x", "#/week/add/x", "#/status/later", "#/status/needs/x", "#/week/status/2026-11-02", "#/inbox/0", "#/settings/../x", "#/roadmap/later", "#/ahead/later", "#/ahead/item/0", "#/ahead/gantt/x", "#/conversations/1", "#/today/plan/2026-11-03/PM/extra", "#/" + "x".repeat(90)]) expect(parseHash(bad), bad).toBeNull();
  });
});

describe("entry points", () => {
  it("+ Add and a day header open Week with the Add work panel on that day and block", () => {
    expect(addWorkNav("2026-11-04")).toEqual({ tab: "week", mode: "board", week: null, add: { date: "2026-11-04", half: null } });
    expect(addWorkNav("2026-11-04", "PM")).toEqual({ tab: "week", mode: "board", week: null, add: { date: "2026-11-04", half: "PM" } });
    expect(hashOf(loc(addWorkNav("2026-11-04", "PM")))).toBe("#/week/day/2026-11-04/PM");
  });
  it("Feedback names the place in the new words", () => {
    expect(viewName(HOME)).toBe("Day");
    expect(viewName(loc(navOf.today("checkin")))).toBe("Day › Midday check-in");
    expect(viewName(loc(navOf.week()))).toBe("Week");
    expect(viewName(loc(navOf.addWork("2026-11-03")))).toBe("Week › Add work");
    expect(viewName(loc(navOf.status()))).toBe("Status");
    expect(viewName(loc(navOf.ahead()))).toBe("Ahead › Grid");
    expect(viewName(loc(navOf.ahead("gantt")))).toBe("Ahead › Gantt");
    expect(viewName(loc(navOf.conversations()))).toBe("Inbox › Needs you");
  });
});

describe("notification routes (all kinds of step 15.5)", () => {
  const at = "2026-11-02T15:00:00Z";
  const all: [string, Notice, Loc, boolean][] = [
    // WD-1: Plan the day opens Week with the Add work panel on the current block.
    ["plan_day", notices.planDay("2026-11-02", at), loc(navOf.addWork()), false],
    ["checkin", notices.checkin("2026-11-02", at), loc(navOf.today("checkin")), false],
    ["closeout", notices.closeout("2026-11-02", at), loc(navOf.today("closeout")), false],
    ["plan_week", notices.week("2026-11-02", true, at), loc(navOf.weekAdd("2026-11-02")), false],
    ["look_ahead", notices.week("2026-11-09", false, at), loc(navOf.weekAdd("2026-11-09")), false],
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
      today: "#/day", week: "#/week", inbox: "#/inbox", follow_ups: "#/inbox/promises", capture: "#/inbox/captures", roadmap: "#/ahead", ahead: "#/ahead/gantt", status: "#/status", team: "#/week/team",
      planday: "#/week/add", planweek: "#/week/add", commit: "#/week/add", checkin: "#/day/checkin", closeout: "#/day/closeout", focus: "#/focus", settings: "#/settings/you",
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
    // LP-1: a promise's Close the loop draft (the assistant's link); only promises (c, f) take /loop.
    for (const k of ["c7", "f42"]) {
      const l = parseHash(`#/inbox/item/${k}/loop`)!;
      expect(l.nav).toEqual({ tab: "inbox", view: null, item: k, loop: true });
      expect(hashOf(l)).toBe(`#/inbox/item/${k}/loop`);
    }
    expect(parseHash("#/inbox/item/v12/loop")).toBeNull();
    expect(parseHash("#/inbox/item/c7/send")).toBeNull();
  });
  it("UI-9: Promises narrowed to late ones, for one client or any, reads back", () => {
    for (const c of ["contoso", "Fabrikam Inc", null]) {
      const l = loc(navOf.inboxLate(c));
      expect(parseHash(hashOf(l))).toEqual(l);
    }
    expect(hashOf(loc(navOf.inboxLate("Fabrikam Inc")))).toBe("#/inbox/promises/late/Fabrikam%20Inc");
    expect(parseHash("#/inbox/promises/late/%E0")).toBeNull();
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
  });
});

describe("AH-6: Ahead's address carries its view", () => {
  it("an Ahead address may have a query; other addresses may not; hashOf adds Ahead's current query", () => {
    expect(parseHash("#/ahead/gantt?c=northwind&l=epic")?.nav).toEqual(navOf.ahead("gantt"));
    expect(parseHash("#/ahead?r=next4")?.nav).toEqual(navOf.ahead());
    expect(parseHash("#/ahead/fix?k=unsized")?.nav).toEqual(navOf.ahead("fix"));
    expect(parseHash("#/week?c=northwind")).toBeNull();
    expect(queryOf("#/ahead/gantt?c=northwind")).toBe("c=northwind");
    setAheadQuery("c=northwind");
    try {
      expect(hashOf({ nav: navOf.ahead("backlog"), overlay: null })).toBe("#/ahead/backlog?c=northwind");
      expect(hashOf({ nav: navOf.week(), overlay: null })).toBe("#/week");
    } finally {
      setAheadQuery("");
    }
  });
});
