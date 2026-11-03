// Step 15.5: the one path for notifications: switches and quiet hours don't use up an occasion, each key goes out once,
// held during focus and delivered (collapsed) after, click routing (open, buttons, handled).
import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFY, notices, type GateFacts, type Notice } from "../plan/notify.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { createNotifier, HELD_KEY } from "./notifier.ts";

const AT = "2026-11-02T15:00:00Z";
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<GateFacts> = {}) {
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(AT).toZonedDateTimeISO("America/New_York") });
  const f: GateFacts = { settings: { ...DEFAULT_NOTIFY, kinds: { ...DEFAULT_NOTIFY.kinds } }, inHours: true, pto: false, focusRunning: false, ...over };
  const shown: Notice[] = [];
  const opened: string[] = [];
  const acted: string[] = [];
  let answer: string | null = null;
  const stillDue = new Set<string>();
  const n = createNotifier({
    plan,
    host: { show: async (x) => (shown.push(x), answer) },
    facts: async () => f,
    now: () => AT,
    open: (r) => void opened.push(r),
    act: async (x, key) => void acted.push(`${x.key}:${key}`),
    still: (x) => !stillDue.size || stillDue.has(x.key),
  });
  return { n, plan, f, shown, opened, acted, answer: (k: string | null) => (answer = k), stillDue };
}

describe("notifier", () => {
  it("sends once per occasion", async () => {
    const t = setup();
    await t.n.refresh();
    expect(await t.n.offer(notices.planDay("2026-11-02", AT))).toBe("send");
    expect(await t.n.offer(notices.planDay("2026-11-02", AT))).toBe("repeat");
    expect(t.shown).toHaveLength(1);
  });

  it("a switch that is off, or quiet hours, sends nothing and doesn't use up the occasion", async () => {
    const t = setup({ inHours: false });
    await t.n.refresh();
    expect(t.n.allows("closeout")).toBe(false);
    expect(await t.n.offer(notices.closeout("2026-11-02", AT))).toBe("quiet");
    t.f.inHours = true;
    t.f.settings.kinds.closeout = false;
    await t.n.refresh();
    expect(t.n.allows("closeout")).toBe(false);
    expect(await t.n.offer(notices.closeout("2026-11-02", AT))).toBe("off");
    t.f.settings.kinds.closeout = true;
    await t.n.refresh();
    expect(t.n.allows("closeout")).toBe(true);
    expect(await t.n.offer(notices.closeout("2026-11-02", AT))).toBe("send");
    expect(t.shown.map((x) => x.kind)).toEqual(["closeout"]);
  });

  it("holds during focus (kept in the store), then delivers when the session ends", async () => {
    const t = setup({ focusRunning: true });
    await t.n.refresh();
    expect(await t.n.offer(notices.checkin("2026-11-02", AT))).toBe("hold");
    expect(await t.n.offer(notices.timerEnd(false, "Write", "s1", AT))).toBe("send");
    expect(t.shown.map((x) => x.kind)).toEqual(["timer"]);
    expect((await t.plan.getState<Notice[]>(HELD_KEY))).toHaveLength(1);
    expect(await t.n.flush()).toBe(0); // still focusing
    t.f.focusRunning = false;
    await t.n.refresh();
    expect(await t.n.flush()).toBe(1);
    expect(t.shown.at(-1)).toMatchObject({ kind: "checkin", title: "Check-in" });
    expect(await t.n.held()).toEqual([]);
    expect(await t.n.offer(notices.checkin("2026-11-02", AT))).toBe("repeat");
  });

  it("several held become one; ones no longer due are dropped", async () => {
    const t = setup({ focusRunning: true });
    await t.n.refresh();
    const a = notices.vmOff("2026-11-02", "vm-demo", AT);
    const b = notices.followUps("2026-11-02", [{ id: 3, what: "Send the spec", overdue: false }], AT)!;
    const c = notices.planDay("2026-11-02", AT);
    for (const x of [a, b, c]) await t.n.offer(x);
    t.stillDue.add(a.key).add(b.key); // the day got planned meanwhile
    t.f.focusRunning = false;
    await t.n.refresh();
    expect(await t.n.flush()).toBe(2);
    expect(t.shown).toHaveLength(1);
    expect(t.shown[0]).toMatchObject({ kind: "held", title: "While you were focused (2)", route: "today" });
  });

  it("clicking the notification opens its view and marks it handled; a button runs its action", async () => {
    const t = setup();
    await t.n.refresh();
    t.answer("default");
    const fu = notices.followUps("2026-11-02", [{ id: 9, what: "Reply", overdue: true }], AT)!;
    await t.n.offer(fu);
    await flush();
    expect(t.opened).toEqual(["followup:9"]);
    expect(await t.n.handled(fu.key)).toBe(true);
    expect(t.acted).toEqual([]);
    t.answer("open"); // the notification's own "Plan the day" button
    await t.n.offer(notices.planDay("2026-11-02", AT));
    await flush();
    expect(t.opened).toEqual(["followup:9", "planday"]);
    t.answer("start");
    await t.n.offer(notices.vmOff("2026-11-02", "vm-demo", AT));
    await flush();
    expect(t.acted).toEqual(["vm_off:2026-11-02:start"]);
    expect(t.opened).toHaveLength(2);
  });

  it("an unknown key from the host does nothing; dismissed does nothing", async () => {
    const t = setup();
    await t.n.refresh();
    t.answer("rm -rf");
    await t.n.offer(notices.vmOff("2026-11-02", "vm-demo", AT));
    t.answer(null);
    await t.n.offer(notices.closeout("2026-11-02", AT));
    await flush();
    expect(t.acted).toEqual([]);
    expect(t.opened).toEqual([]);
  });

  it("the timer's buttons go to its own handler (it checks the session is still the one that ended)", async () => {
    const t = setup();
    await t.n.refresh();
    t.answer("extend");
    const heard: string[] = [];
    await t.n.offer(notices.timerEnd(false, "Write", "s1", AT), (k) => void heard.push(k));
    await flush();
    expect(heard).toEqual(["extend"]);
    expect(t.acted).toEqual([]);
  });

  it("clicking a collapsed one marks each it lists handled", async () => {
    const t = setup({ focusRunning: true });
    await t.n.refresh();
    const a = notices.checkin("2026-11-02", AT);
    const b = notices.closeout("2026-11-02", AT);
    await t.n.offer(a);
    await t.n.offer(b);
    t.f.focusRunning = false;
    await t.n.refresh();
    t.answer("default");
    await t.n.flush();
    await flush();
    expect(t.opened).toEqual(["today"]);
    expect((await t.n.handled(a.key)) && (await t.n.handled(b.key))).toBe(true);
  });

  it("the test notification goes out whatever the settings", async () => {
    const t = setup({ inHours: false, focusRunning: true, pto: true });
    await t.n.refresh();
    await t.n.test();
    expect(t.shown[0]).toMatchObject({ kind: "test", route: "settings:notifications" });
  });
});

describe("closing notifications that no longer apply (step 16.2, Q91)", () => {
  function closable(done: (x: Notice) => boolean) {
    const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(AT).toZonedDateTimeISO("America/New_York") });
    const f: GateFacts = { settings: { ...DEFAULT_NOTIFY, kinds: { ...DEFAULT_NOTIFY.kinds } }, inHours: true, pto: false, focusRunning: false };
    const closed: string[] = [];
    const pending = new Map<string, (k: string | null) => void>();
    let next = 100;
    const n = createNotifier({
      plan,
      host: {
        // Stays open until closed (like notify-send waiting on a notification with actions).
        show: (x, shown) =>
          new Promise((resolve) => {
            const h = String(next++);
            shown?.(h);
            pending.set(h, resolve);
            void x;
          }),
        close: (h) => {
          closed.push(h);
          pending.get(h)?.(null);
        },
      },
      facts: async () => f,
      now: () => AT,
      open: () => {},
      act: async () => {},
      done,
    });
    return { n, plan, closed };
  }

  it("closes a shown notification once its occasion is handled, marks it handled, and only once", async () => {
    let planned = false;
    const t = closable((x) => x.kind === "plan_day" && planned);
    await t.n.refresh();
    await t.n.offer(notices.planDay("2026-11-02", AT));
    await flush();
    expect(await t.n.sweep()).toBe(0);
    expect(t.n.onScreen()).toEqual(["plan_day:2026-11-02"]);
    planned = true;
    expect(await t.n.sweep()).toBe(1);
    expect(t.closed).toEqual(["100"]);
    expect(await t.n.handled("plan_day:2026-11-02")).toBe(true);
    await flush();
    expect(t.n.onScreen()).toEqual([]);
    expect(await t.n.sweep()).toBe(0);
  });

  it("leaves test notifications and plain samples alone", async () => {
    const t = closable(() => true);
    await t.n.refresh();
    await t.n.test();
    t.n.show({ ...notices.planDay("2026-11-02", AT), key: "sample:plan_day:2026-11-02:x" });
    await flush();
    expect(await t.n.sweep()).toBe(0);
    t.n.show({ ...notices.planDay("2026-11-02", AT), key: "sample:live:plan_day:2026-11-02:x" });
    await flush();
    expect(await t.n.sweep()).toBe(1);
  });

  it("a collapsed one closes only when every notification it lists is handled", async () => {
    const done = new Set<string>();
    const t = closable((x) => done.has(x.key));
    await t.n.refresh();
    (await t.plan.setState(HELD_KEY, [notices.planDay("2026-11-02", AT), notices.checkin("2026-11-02", AT)]));
    expect(await t.n.flush()).toBe(2);
    await flush();
    done.add("plan_day:2026-11-02");
    expect(await t.n.sweep()).toBe(0);
    done.add("checkin:2026-11-02");
    expect(await t.n.sweep()).toBe(1);
  });

  it("without a host that can close, nothing is closed (clicking it opens the view that shows it's done)", async () => {
    const t = setup();
    await t.n.refresh();
    await t.n.offer(notices.planDay("2026-11-02", AT));
    expect(await t.n.sweep()).toBe(0);
  });
});
