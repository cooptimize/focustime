// Step 15.5: notifications: per-kind switches, quiet hours, holding during focus, collapsing, routes, texts.
import { describe, expect, it } from "vitest";
import { legacyHours } from "../config/schema.ts";
import { collapse, DEFAULT_NOTIFY, dueFollowUps, gate, inWorkingHours, noticeDone, notices, parseRoute, RITUAL_KINDS, routeText, type DoneFacts, type GateFacts, type Notice, type NotifyKind } from "./notify.ts";

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

describe("notifications that no longer apply (step 16.2, Q91)", () => {
  const at = "2026-11-02T15:00:00Z";
  const none: DoneFacts = { committed: () => false, checkedIn: () => false, closedOut: () => false, weekCommitted: () => false, followUpOpen: () => true, dueCount: () => 1, timerWaiting: () => true, vmOff: () => true };
  const yes = (over: Partial<DoneFacts>) => ({ ...none, ...over });
  it("each kind closes on its own signal, and not before", () => {
    const cases: [Notice, Partial<DoneFacts>][] = [
      [notices.planDay("2026-11-02", at), { committed: (d) => d === "2026-11-02" }],
      [notices.checkin("2026-11-02", at), { checkedIn: (d) => d === "2026-11-02" }],
      [notices.checkin("2026-11-02", at), { closedOut: (d) => d === "2026-11-02" }],
      [notices.closeout("2026-11-02", at), { closedOut: (d) => d === "2026-11-02" }],
      [notices.week("2026-11-02", true, at), { weekCommitted: (w) => w === "2026-11-02" }],
      [notices.week("2026-11-09", false, at), { weekCommitted: (w) => w === "2026-11-09" }],
      [notices.timerEnd(false, "A", "2026-11-02T14:00:00Z", at), { timerWaiting: (s) => s !== "2026-11-02T14:00:00Z" }],
      [notices.vmOff("2026-11-02", "vm", at), { vmOff: () => false }],
      [notices.followUps("2026-11-02", [{ id: 7, what: "A", overdue: false }], at)!, { followUpOpen: (id) => id !== 7 }],
      [notices.followUps("2026-11-02", [{ id: 7, what: "A", overdue: false }, { id: 8, what: "B", overdue: true }], at)!, { dueCount: () => 0 }],
      // Step 17: closed once Plan ahead was opened for that ritual.
      [notices.planAhead("plan_ahead:2026-11-05", at), { aheadSeen: (k) => k === "plan_ahead:2026-11-05" }],
      [notices.direction("direction:2026-12", "2026-12-03", at), { aheadSeen: (k) => k === "direction:2026-12" }],
    ];
    for (const [n, f] of cases) {
      expect(noticeDone(n, none), n.key).toBe(false);
      expect(noticeDone(n, yes(f)), n.key).toBe(true);
    }
  });
  it("D475: an \"auto-shutdown still changed\" notice from before closes at once (there is nothing to restore)", () => {
    const old: Notice = { kind: "vm", key: "vm_changed:2026-11-02", title: "Auto-shutdown is still changed", body: "x", buttons: [{ key: "restore", label: "Restore" }], route: "vm", at, ref: "2026-11-02" };
    expect(noticeDone(old, none)).toBe(true);
  });
  it("another day's plan doesn't close today's; an unknown VM state never closes; meetings and expiry stay", () => {
    expect(noticeDone(notices.planDay("2026-11-02", at), yes({ committed: (d) => d === "2026-11-03" }))).toBe(false);
    expect(noticeDone(notices.vmOff("2026-11-02", "vm", at), yes({ vmOff: () => null }))).toBe(false);
    expect(noticeDone(notices.meeting(["x"], ["k"], at), yes({ committed: () => true }))).toBe(false);
    expect(noticeDone(notices.expiry("2026-11-02", [{ text: "x", section: "clients" }], at)!, yes({ dueCount: () => 0 }))).toBe(false);
  });
});

describe("the Plan ahead rituals (step 17)", () => {
  it("their own switches, quiet on PTO and outside hours, held during focus; texts in plain words", () => {
    const settings = { ...DEFAULT_NOTIFY, kinds: { ...DEFAULT_NOTIFY.kinds, direction: false } };
    const f = { settings, inHours: true, pto: false, focusRunning: false };
    expect(gate("plan_ahead", f)).toBe("send");
    expect(gate("direction", f)).toBe("off");
    expect(gate("plan_ahead", { ...f, pto: true })).toBe("quiet");
    expect(gate("plan_ahead", { ...f, inHours: false })).toBe("quiet");
    expect(gate("plan_ahead", { ...f, focusRunning: true })).toBe("hold");
    expect(RITUAL_KINDS).toEqual(expect.arrayContaining(["plan_ahead", "direction"]));
    const n = notices.direction("direction:2026-12", "2026-12-03", "2026-12-03T14:30:00Z");
    expect([n.title, n.body, n.route]).toEqual(["Direction review", "First Thursday of December: look 8 to 12 weeks ahead.\nClick to open Plan ahead.", "ahead"]);
    expect(parseRoute("ahead")).toEqual({ view: "ahead" });
  });
});

describe("urgent asks (AP-2)", () => {
  const base: GateFacts = { settings: DEFAULT_NOTIFY, inHours: true, pto: false, focusRunning: true };
  it("held during focus by default; sent when urgent asks are let through; quiet hours still apply", () => {
    expect(gate("asks", base)).toBe("hold");
    expect(gate("asks", { ...base, settings: { ...DEFAULT_NOTIFY, asksThroughFocus: true } })).toBe("send");
    expect(gate("asks", { ...base, inHours: false, settings: { ...DEFAULT_NOTIFY, asksThroughFocus: true } })).toBe("quiet");
    expect(gate("asks", { ...base, settings: { ...DEFAULT_NOTIFY, kinds: { ...DEFAULT_NOTIFY.kinds, asks: false } } })).toBe("off");
  });
  it("once per ask, opening Asks", () => {
    const n = notices.urgentAsk("1700000000001", "Fabrikam", "Portal down", "2026-11-04T15:00:00Z");
    expect(n).toMatchObject({ kind: "asks", key: "ask:1700000000001", title: "Urgent ask from Fabrikam", route: "asks" });
    expect(parseRoute(n.route)).toEqual({ view: "asks" });
  });
});
