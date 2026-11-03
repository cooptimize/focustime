// A2: one person's background work, run by the scheduler (server/scheduler.ts): what is due is read from their rows
// each pass (the timer in kv, once-a-day marks in markers, held notices, Teams status), so a restart loses nothing: a
// timer that ended while the server was down ends on the first pass after it starts, and a reminder still in its
// window fires then, once. Notifications (step 15.5): every reminder, the timer, my VM, follow-ups due and expiring
// secrets go through one notifier, which applies Settings > Notifications (switches, quiet hours, holding during
// focus) and routes clicks. The slow pass is every 30 s (so day rollover is handled while running for days), the fast
// one every 5 s.
import type { ActionContext } from "../actions/dispatch.ts";
import { presenceContext, vmContext, expiringFor } from "../actions/dispatch.ts";
import { syncTeamsStatus, TEAMS_STATUS_KEY } from "../actions/presence-actions.ts";
import { restoreTick, vmAction, type VmStatus } from "../actions/vm-actions.ts";
import { CHECKIN_DONE_MARK } from "../actions/closeout-actions.ts";
import { refreshTodayWarnings } from "../actions/warnings.ts";
import { TIMER_KEY, timerAction, timerLike } from "../actions/timer-actions.ts";
import { createNotifier } from "../actions/notifier.ts";
import type { AppConfig } from "../config/schema.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { Logger } from "../log/logger.ts";
import { DEFAULT_FOCUS } from "../plan/focussound.ts";
import { DEFAULT_NOTIFY, dueFollowUps, inWorkingHours, noticeDone, notices, type Notice } from "../plan/notify.ts";
import type { TeamsStatusState } from "../plan/presence.ts";
import { AHEAD_SEEN_MARK, aheadRitualsDue } from "../plan/rituals.ts";
import type { TimerState } from "../plan/timer.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday, mondayOf } from "../week/dates.ts";
import { hoursOn } from "../week/hours.ts";
import { userZone } from "../week/zone.ts";
import { checkDayReminder, checkinReminderDue, checkReminder, checkWeekNudges, closeoutReminderDue } from "./notify.ts";
import { calendarRefreshDue, checkTimer, TIMER_BUTTONS } from "./timer.ts";

export type TickDeps = {
  log: Logger;
  now: () => Temporal.Instant;
  notifications: HostNotifications;
  media: HostMedia;
  /** A clicked notification asks for a view: kept for the person's window, which is brought up. */
  openRoute: (route: string) => void;
};

/** One person's passes; the scheduler runs them for everyone, never two of the same kind at once. */
export type PersonTicks = { fast: () => Promise<void>; slow: () => Promise<void> };

export function personTicks(d: TickDeps, store: PlanStore, liveCtx: ActionContext, who: { zone: string }): PersonTicks {
  const log = d.log;
  const instantNow = d.now;
  const zonedNow = (tz: string) => d.now().toZonedDateTimeISO(tz);
  const host = { notifications: d.notifications, media: d.media };
  const media = d.media;
  const openRoute = d.openRoute;
  const loadConfig = liveCtx.loadConfig;
  const configOrNull = async () => {
    const r = await loadConfig();
    return r.parsed.ok ? r.parsed.config : null;
  };
  const hoursOrNull = async () => (await configOrNull())?.week.hours ?? null;
  // PTO for a date, kept for 30 minutes (the gate asks every tick; the Dataverse read has its own cache too).
  const ptoMemo = new Map<string, { at: number; off: boolean }>();
  const ptoOff = async (d: string) => {
    const hit = ptoMemo.get(d);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.off;
    const c = await configOrNull();
    if (!c?.dataverse.mySystemUserId) return false;
    const off = (await liveCtx.makeDataverse(c.dataverse, userZone(c)).pto(d, d)).items.some((e) => e.date === d);
    ptoMemo.set(d, { at: Date.now(), off });
    return off;
  };
  const focusRunning = () => {
    const s = store.getState<TimerState>(TIMER_KEY);
    return !!s && s.kind === "focus" && !s.ended && !!s.runningSince;
  };
  const todayOf = (c: AppConfig) => localToday(instantNow().toString(), userZone(c));
  const vmCtx = () => vmContext(liveCtx);

  /** A button on a notification: the VM's Start and Restore (the timer's buttons go to checkTimer). */
  const act = async (n: Notice, key: string) => {
    const sample = n.key.startsWith("sample:");
    if (n.kind === "vm" && (key === "start" || key === "restore")) {
      // Samples never touch Azure unless asked for live (notify.sample { live: true }): they open the VM menu.
      if (sample && !n.key.startsWith("sample:live:")) return openRoute("vm");
      const r = await vmAction(await vmCtx(), key === "start" ? "vm.start_now" : "vm.restore", {});
      log({ source: "azure", op: key === "start" ? "notify_start" : "notify_restore", kind: r.ok ? "ok" : (r.code ?? "refused") });
      // Start asks first (Settings > You), or it couldn't: open the VM menu, where the preview and the reason show.
      if (!r.ok) {
        openRoute("vm");
        if (r.code !== "ask_first") host.notifications.line("FocusTime", `Couldn't ${key === "start" ? "start your VM" : "restore auto-shutdown"}: ${r.error}.`);
      }
    }
  };
  /** Whether a held notification still matters when focus ends. */
  const still = async (n: Notice) => {
    const c = await configOrNull();
    if (!c) return true;
    const today = todayOf(c);
    if (n.kind === "plan_day") return !store.day(today)?.committedAt;
    if (n.kind === "closeout") return !store.day(today)?.closedOutAt;
    if (n.kind === "checkin") return !!store.day(today)?.committedAt && !store.day(today)?.closedOutAt;
    if (n.kind === "plan_week" || n.kind === "look_ahead") return !store.weekPlan(n.route.slice("planweek:".length)).committedAt;
    if (n.kind === "followups") return dueFollowUps(store.openFollowUps(), today).length > 0;
    if (n.kind === "plan_ahead" || n.kind === "direction") return !n.ref || !store.marked(AHEAD_SEEN_MARK, n.ref);
    if (n.kind === "vm" && n.key.startsWith("vm_off:")) {
      const st = await vmAction(await vmCtx(), "vm.status", {});
      return st.ok && (st.data as VmStatus).prompt;
    }
    return true;
  };
  /** Q91: whether a shown notification's occasion was handled since (it is then closed). The VM is read at most once a minute. */
  let vmSeen: { at: number; st: VmStatus | null } | null = null;
  const vmNow = async () => {
    if (vmSeen && Date.now() - vmSeen.at < 60_000) return vmSeen.st;
    const r = await vmAction(await vmCtx(), "vm.status", {}).catch(() => null);
    vmSeen = { at: Date.now(), st: r?.ok ? (r.data as VmStatus) : null };
    return vmSeen.st;
  };
  const done = async (n: Notice) => {
    const c = await configOrNull();
    const today = c ? todayOf(c) : null;
    const vs = n.kind === "vm" ? await vmNow() : null;
    return noticeDone(n, {
      committed: (d) => !!store.day(d)?.committedAt,
      checkedIn: (d) => store.marked(CHECKIN_DONE_MARK, d),
      closedOut: (d) => !!store.day(d)?.closedOutAt,
      weekCommitted: (w) => !!store.weekPlan(w).committedAt,
      followUpOpen: (id) => store.openFollowUps().some((f) => f.id === id && !f.closedAt),
      dueCount: () => (today ? dueFollowUps(store.openFollowUps(), today).length : 1),
      timerWaiting: (startedAt) => {
        const t = store.getState<TimerState>(TIMER_KEY);
        return !!t && t.ended && t.startedAt === startedAt;
      },
      vmOff: () => (vs ? vs.prompt : null),
      vmChanged: () => (vs ? !!vs.change : null),
      aheadSeen: (key) => store.marked(AHEAD_SEEN_MARK, key),
    });
  };
  const notifier = createNotifier({
    plan: store,
    host: { show: (n, shown) => host.notifications.show(n, shown), close: (h) => host.notifications.close(h) },
    done,
    facts: async () => {
      const c = await configOrNull();
      const settings = c?.notify ?? DEFAULT_NOTIFY;
      if (!c) return { settings, inHours: false, pto: false, focusRunning: focusRunning() };
      const today = todayOf(c);
      return { settings, inHours: inWorkingHours(c.week.hours, zonedNow(userZone(c))), pto: await ptoOff(today).catch(() => false), focusRunning: focusRunning() };
    },
    now: () => instantNow().toString(),
    open: (route) => openRoute(route),
    act,
    still,
    log: (op, kind) => log({ source: "plan", op, kind }),
  });

  // Settings > Notifications > Send a test notification, and one sample per kind for the live check.
  const samples = (c: AppConfig, live: boolean): Record<string, Notice | null> => {
    const at = instantNow().toString();
    const today = todayOf(c);
    const monday = Temporal.PlainDate.from(today).subtract({ days: Temporal.PlainDate.from(today).dayOfWeek - 1 });
    const pfx = (n: Notice | null): Notice | null => (n ? { ...n, key: `sample:${live ? "live:" : ""}${n.key}:${at}` } : null);
    const open = dueFollowUps(store.openFollowUps(), today);
    return {
      plan_day: pfx(notices.planDay(today, at)),
      checkin: pfx(notices.checkin(today, at)),
      closeout: pfx(notices.closeout(today, at)),
      plan_week: pfx(notices.week(monday.toString(), true, at)),
      look_ahead: pfx(notices.week(monday.add({ days: 7 }).toString(), false, at)),
      plan_ahead: pfx(notices.planAhead(`plan_ahead:${today}`, at)),
      direction: pfx(notices.direction(`direction:${today.slice(0, 7)}`, today, at)),
      timer: pfx(notices.timerEnd(false, "Sample: a focus session", at, at)),
      meeting: pfx(notices.meeting(["Sample: a meeting at 10:00"], ["sample"], at)),
      vm: pfx(notices.vmOff(today, live ? "Your VM" : "Your VM (sample: Start opens the VM menu)", at)),
      vm_changed: pfx(notices.vmChanged(today, live ? "Auto-shutdown set to 9:00 PM" : "Sample: auto-shutdown set to 9:00 PM (Restore opens the VM menu)", at)),
      // With none due, a made-up one that opens the Inbox (there is no follow-up to open).
      followups: pfx(open.length ? notices.followUps(today, open, at) : { ...notices.followUps(today, [{ id: 1, what: "Sample: reply about the proposal", overdue: false }], at)!, route: "inbox" }),
      expiry: pfx(notices.expiry(today, [{ text: "Sample: a DevOps write access expires in 9 days. Update in Settings", section: "clients" }], at)),
    };
  };
  liveCtx.notifications = {
    test: () => notifier.test(),
    sample: async (kind, live, gated) => {
      const c = await configOrNull();
      const n = c ? samples(c, live)[kind] : null;
      if (!n) return false;
      // Gated: through Settings > Notifications like a real one (switch, quiet hours, held during focus).
      if (gated) {
        await notifier.refresh();
        log({ source: "plan", op: "notify_sample", kind: await notifier.offer(n) });
        return true;
      }
      // A sample's timer buttons run the real timer actions (local; refused when no timer has ended).
      notifier.show(n, n.kind === "timer" ? async (key) => void (key in TIMER_BUTTONS && (await timerAction(timerCtx(), TIMER_BUTTONS[key as keyof typeof TIMER_BUTTONS], {}).catch(() => null))) : undefined);
      return true;
    },
  };

  const send = (n: Notice | null) => (n ? notifier.offer(n).catch(() => log({ source: "plan", op: "notify", kind: "failed" })) : undefined);
  const dayReminders = async () => {
    const c = await configOrNull();
    if (!c) return;
    const at = instantNow().toString();
    await checkReminder({
      now: () => zonedNow(who.zone),
      hours: hoursOrNull,
      offsetMinutes: async () => c.plan.reminderOffsetMinutes,
      committed: (d) => !!store.day(d)?.committedAt,
      off: ptoOff,
      once: (d) => notifier.allows("plan_day") && store.markOnce("reminder", d),
      send: () => void send(notices.planDay(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "reminder", kind: "failed" }));
    // Check-in and Close out (step 7): once a day each.
    await checkDayReminder({
      now: () => zonedNow(who.zone),
      hours: hoursOrNull,
      due: (n, m) => checkinReminderDue(n, m, !!store.day(n.toPlainDate().toString())?.committedAt, c.plan.checkinReminderMinutes),
      off: ptoOff,
      once: (d) => notifier.allows("checkin") && store.markOnce("checkin_reminder", d),
      send: () => void send(notices.checkin(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "checkin_reminder", kind: "failed" }));
    await checkDayReminder({
      now: () => zonedNow(who.zone),
      hours: hoursOrNull,
      due: (n, m) => closeoutReminderDue(n, m, !!store.day(n.toPlainDate().toString())?.closedOutAt, c.plan.closeoutReminderMinutes),
      off: ptoOff,
      once: (d) => notifier.allows("closeout") && store.markOnce("closeout_reminder", d),
      send: () => void send(notices.closeout(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "closeout_reminder", kind: "failed" }));
    // Plan the week (Monday, this week) and Look ahead (Thursday and Friday, next week), step 8.
    const thisWeek = mondayOf(todayOf(c));
    await checkWeekNudges({
      now: () => zonedNow(who.zone),
      times: async () => ({ thu: c.plan.weekNudgeThu, fri: c.plan.weekNudgeFri, mon: c.plan.weekNudgeMon }),
      committed: (w) => !!store.weekPlan(w).committedAt,
      off: ptoOff,
      workStart: async (d) => hoursOn(c.week.hours, d).segments[0]?.start ?? null,
      once: (key, w) => notifier.allows(w === thisWeek ? "plan_week" : "look_ahead") && store.markOnce(key, w),
      send: (_body, w) => void send(notices.week(w, w === thisWeek, at)),
    }).catch(() => log({ source: "plan", op: "week_nudge", kind: "failed" }));
    // Step 17: Look ahead 4 weeks (every other Thursday, once next week is planned) and the direction review (first
    // Thursday of the month), from work start on a working day; once each; both open Roadmap › Plan ahead.
    try {
      const today = todayOf(c);
      const due = aheadRitualsDue({
        today,
        time: zonedNow(who.zone).toPlainTime().toString().slice(0, 5),
        workStart: hoursOn(c.week.hours, today).segments[0]?.start ?? null,
        pto: await ptoOff(today).catch(() => true),
        weekCommitted: (w) => !!store.weekPlan(w).committedAt,
        seen: (k) => store.marked(AHEAD_SEEN_MARK, k),
      });
      for (const r of due) if (notifier.allows(r.kind) && store.markOnce("ahead_notice", r.key)) await send(r.kind === "plan_ahead" ? notices.planAhead(r.key, at) : notices.direction(r.key, r.occasion, at));
    } catch {
      log({ source: "plan", op: "ahead_nudge", kind: "failed" });
    }
  };
  // Once a workday from work start (working hours, not PTO): follow-ups due or overdue, and expiring secrets.
  const workdayNotices = async () => {
    const c = await configOrNull();
    if (!c) return;
    const today = todayOf(c);
    const ws = hoursOn(c.week.hours, today).segments[0]?.start ?? null;
    if (!ws || zonedNow(userZone(c)).toPlainTime().toString().slice(0, 5) < ws) return;
    const at = instantNow().toString();
    if (notifier.allows("followups") && store.markOnce("followups_notice", today)) await send(notices.followUps(today, dueFollowUps(store.openFollowUps(), today), at));
    if (notifier.allows("expiry") && store.markOnce("expiry_notice", today)) await send(notices.expiry(today, expiringFor(store, c, today), at));
  };
  // My VM (step 15.4): put back a changed auto-shutdown the next morning (first run after midnight, retried, and at work
  // start), and once a workday at work start say so when the VM is off. Never starts anything by itself.
  const vmTick = async () => {
    const c = await configOrNull();
    if (!c) return;
    const tz = userZone(c);
    const n = zonedNow(tz);
    const today = todayOf(c);
    const ws = hoursOn(c.week.hours, today).segments[0]?.start ?? null;
    const afterStart = !!ws && n.toPlainTime().toString().slice(0, 5) >= ws;
    const vc = await vmCtx();
    if (!vc.account) return;
    const atWorkStart = afterStart && store.markOnce("vm_restore_workstart", today);
    const r = await restoreTick(vc, { atWorkStart });
    if (r) log({ source: "azure", op: "shutdown_restore", kind: r });
    const at = instantNow().toString();
    if (r === "failed" && atWorkStart) {
      const st = await vmAction(vc, "vm.status", {});
      await send(notices.vmChanged(today, st.ok ? ((st.data as VmStatus).change?.text ?? "Auto-shutdown is changed") : "Auto-shutdown is changed", at));
    }
    if (afterStart && notifier.allows("vm") && store.markOnce("vm_prompt_notice", today)) {
      const st = await vmAction(vc, "vm.status", {});
      if (st.ok && (st.data as VmStatus).prompt) await send(notices.vmOff(today, (st.data as VmStatus).vm?.name ?? "Your VM", at));
    }
  };
  const tick = async () => {
    await notifier.refresh().catch(() => null);
    await dayReminders();
    await workdayNotices().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
    await vmTick().catch(() => log({ source: "azure", op: "vm_tick", kind: "failed" }));
  };

  // The focus timer (step 6c): ends sessions on time and warns 5 minutes ahead, window open or not.
  const timerCtx = () => ({ plan: store, config: configOrNull, now: () => instantNow().toString(), media });
  const timerTick = () =>
    checkTimer({
      plan: store,
      now: () => instantNow(),
      endSound: async () => (await configOrNull())?.plan.endSound ?? false,
      // Through the notifier (its switch); the buttons come back here, where the session is checked.
      notify: (n) =>
        new Promise((resolve) => {
          void notifier.offer(n, (key) => resolve(key || null)).then((g) => g !== "send" && resolve(null), () => resolve(null));
        }),
      sound: () => host.media.endSound(),
      act: (action) => timerAction(timerCtx(), action, {}),
      // Step 10: a session that ends on its own pauses media too (when Settings > Focus asks for it).
      ended: async (before, after) => void (await media.transition(timerLike(before), timerLike(after), ((await configOrNull())?.focus ?? DEFAULT_FOCUS).pauseMedia)),
    })
      .then((did) => did && log({ source: "plan", op: "timer", kind: did }))
      .catch(() => log({ source: "plan", op: "timer", kind: "failed" }));
  // Held notifications go out once the focus session is over (collapsed into one when there are several).
  const flushHeld = async () => {
    if (!notifier.held().length || focusRunning()) return;
    await notifier.refresh();
    const n = await notifier.flush();
    if (n) log({ source: "plan", op: "notify", kind: "held_delivered", count: n });
  };
  // Fresher warnings (step 6d): while a timer runs, reload today's calendars every 5 minutes (their own cache
  // decides whether that is a live call) and recompute today's warning points.
  let lastCalendar: number | null = null;
  const warningsTick = () => {
    const s = store.getState<TimerState>(TIMER_KEY);
    const t = Date.now();
    if (!s?.runningSince) return void (lastCalendar = null);
    if (!calendarRefreshDue(s, lastCalendar, t)) return;
    lastCalendar = t;
    void refreshTodayWarnings({ loadConfig, makeOutlook: liveCtx.makeOutlook, makeGoogle: liveCtx.makeGoogle, plan: store, now: () => instantNow().toString() })
      .then((n) => n !== null && log({ source: "plan", op: "warnings", kind: "refreshed", count: n }))
      .catch(() => log({ source: "plan", op: "warnings", kind: "failed" }));
  };
  /** Every 5 seconds: the timer, meeting warnings, held notices after focus, handled ones closed, Teams status. */
  const fast = async () => {
    await timerTick();
    warningsTick();
    await flushHeld().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
    // Q91: close notifications on screen whose occasion was handled (the day planned, the follow-up closed...).
    if (notifier.onScreen().length) await notifier.sweep().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
    // Step 16.3: my Teams status follows focus (set, refreshed on +15, cleared however the session ends, even after a
    // restart). Only while a timer exists or a status FocusTime set is still to clear.
    if (store.getState(TIMER_KEY) || store.accountState<TeamsStatusState>(TEAMS_STATUS_KEY)?.set)
      await presenceContext(liveCtx).then(syncTeamsStatus).catch(() => log({ source: "outlook", op: "teams_status", kind: "failed" }));
  };
  return { fast, slow: tick };
}
