// Step 15.5: notifications: per-kind switches, quiet hours, holding during focus, collapsing, routes, texts.
import { describe, expect, it } from "vitest";
import { legacyHours } from "../config/schema.ts";
import { collapse, DEFAULT_NOTIFY, dueFollowUps, gate, inWorkingHours, notices, parseRoute, routeText, type GateFacts, type NotifyKind } from "./notify.ts";

const NY = "America/New_York";
const facts = (over: Partial<GateFacts> = {}, kinds: Partial<Record<NotifyKind, boolean>> = {}): GateFacts => ({
  settings: { ...DEFAULT_NOTIFY, kinds: { ...DEFAULT_NOTIFY.kinds, ...kinds } },
  inHours: true,
  pto: false,
  focusRunning: false,
  ...over,
});

describe("gate", () => {
  it("sends by default, and nothing whose switch is off", () => {
    expect(gate("plan_day", facts())).toBe("send");
    expect(gate("plan_day", facts({}, { plan_day: false }))).toBe("off");
    expect(gate("vm", facts({}, { vm: false }))).toBe("off");
    expect(gate("timer", facts({}, { timer: false }))).toBe("off");
    expect(gate("checkin", facts({}, { plan_day: false }))).toBe("send");
  });

  it("quiet hours: outside working hours and on PTO days by default; off sends outside hours", () => {
    expect(gate("followups", facts({ inHours: false }))).toBe("quiet");
    expect(gate("followups", facts({ pto: true }))).toBe("quiet");
    const noQuiet = facts({ inHours: false });
    noQuiet.settings.quiet = "off";
    expect(gate("followups", noQuiet)).toBe("send");
    const ptoOk = facts({ pto: true });
    ptoOk.settings.quietPto = false;
    expect(gate("followups", ptoOk)).toBe("send");
  });

  it("during focus, holds everything but the timer and meeting warnings", () => {
    const f = facts({ focusRunning: true });
    for (const k of ["plan_day", "checkin", "closeout", "plan_week", "look_ahead", "vm", "followups", "expiry"] as const) expect(gate(k, f)).toBe("hold");
    expect(gate("timer", f)).toBe("send");
    expect(gate("meeting", f)).toBe("send");
  });

  it("the timer and meeting warnings belong to my session: never quiet", () => {
    expect(gate("timer", facts({ inHours: false, pto: true }))).toBe("send");
    expect(gate("meeting", facts({ inHours: false }))).toBe("send");
  });

  it("the test notification always goes out", () => {
    expect(gate("test", facts({ inHours: false, pto: true, focusRunning: true }))).toBe("send");
  });
});

describe("working hours", () => {
  const model = legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: NY });
  const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[${NY}]`);
  it("inside any span of the day, not before, after or on a day without hours", () => {
    expect(inWorkingHours(model, at("2026-11-02T09:00"))).toBe(true);
    expect(inWorkingHours(model, at("2026-11-02T16:59"))).toBe(true);
    expect(inWorkingHours(model, at("2026-11-02T08:59"))).toBe(false);
    expect(inWorkingHours(model, at("2026-11-02T17:00"))).toBe(false);
    expect(inWorkingHours(model, at("2026-11-08T10:00"))).toBe(false); // Sunday
  });
});

describe("collapse", () => {
  const at = "2026-11-02T15:00:00Z";
  it("one held notification is delivered as it was", () => {
    const n = notices.planDay("2026-11-02", at);
    expect(collapse([n], at)).toBe(n);
    expect(collapse([], at)).toBeNull();
  });
  it("several become one that lists them, without buttons, opening Today", () => {
    const list = [notices.checkin("2026-11-02", at), notices.vmOff("2026-11-02", "vm-demo", at), notices.followUps("2026-11-02", [{ id: 4, what: "Send the spec", overdue: false }], at)!];
    const one = collapse(list, at)!;
    expect(one).toMatchObject({ kind: "held", title: "While you were focused (3)", buttons: [], route: "today" });
    expect(one.body.split("\n")).toEqual(["Check-in · Your VM is off · Follow-up due", "Click to open Today."]);
  });
  it("lists four and says how many more; one shared view opens that view", () => {
    const list = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) => notices.checkin(d, at));
    const one = collapse(list, at)!;
    expect(one.body).toBe("Check-in · Check-in · Check-in · Check-in · 1 more\nClick to open.");
    expect(one.route).toBe("checkin");
  });
});

describe("routes", () => {
  it("each kind opens its view", () => {
    const at = "2026-11-02T15:00:00Z";
    expect(notices.planDay("2026-11-02", at).route).toBe("planday");
    expect(notices.checkin("2026-11-02", at).route).toBe("checkin");
    expect(notices.closeout("2026-11-02", at).route).toBe("closeout");
    expect(notices.week("2026-11-09", false, at)).toMatchObject({ kind: "look_ahead", route: "planweek:2026-11-09" });
    expect(notices.week("2026-11-02", true, at)).toMatchObject({ kind: "plan_week", route: "planweek:2026-11-02" });
    expect(notices.timerEnd(false, "Write the summary", at, at)).toMatchObject({ route: "focus", buttons: [{ key: "done" }, { key: "extend" }, { key: "next" }] });
    expect(notices.vmOff("2026-11-02", "vm-x", at)).toMatchObject({ route: "vm", buttons: [{ key: "start", label: "Start" }] });
    expect(notices.followUps("2026-11-02", [{ id: 7, what: "A", overdue: true }], at)!.route).toBe("followup:7");
    expect(notices.followUps("2026-11-02", [{ id: 7, what: "A", overdue: true }, { id: 8, what: "B", overdue: false }], at)!).toMatchObject({ route: "inbox", body: "1 due today, 1 overdue: A and 1 more\nClick to open the Inbox." });
    expect(notices.expiry("2026-11-02", [{ text: "Fabrikam DevOps write access expires in 3 days. Update in Settings", section: "clients" }], at)!.route).toBe("settings:clients");
  });
  it("parses only known routes", () => {
    for (const r of ["today", "planday", "checkin", "closeout", "focus", "vm", "inbox", "planweek:2026-11-09", "followup:12", "settings:notifications"]) expect(routeText(parseRoute(r)!)).toBe(r);
    for (const bad of ["", "planweek:soon", "followup:0", "followup:x", "settings:../x", "javascript:alert(1)", "week:1:2", 42, null]) expect(parseRoute(bad)).toBeNull();
  });
});

describe("follow-ups due", () => {
  it("due today or overdue, not snoozed, overdue first", () => {
    const f = (id: number, due: string | null, snoozedUntil: string | null = null) => ({ id, what: `F${id}`, due, snoozedUntil, closedAt: null });
    expect(dueFollowUps([f(1, "2026-11-02"), f(2, "2026-10-30"), f(3, "2026-11-03"), f(4, null), f(5, "2026-11-01", "2026-11-04")], "2026-11-02")).toEqual([
      { id: 2, what: "F2", overdue: true },
      { id: 1, what: "F1", overdue: false },
    ]);
  });
});
