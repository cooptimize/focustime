// A2: one person's background work, run by the scheduler (server/scheduler.ts): what is due is read from their rows
// each pass (the timer in kv, once-a-day marks in markers, held notices, Teams status), so a restart loses nothing: a
// timer that ended while the server was down ends on the first pass after it starts, and a reminder still in its
// window fires then, once. Notifications (step 15.5): every reminder, the timer, my VM, follow-ups due and expiring
// secrets go through one notifier, which applies Settings > Notifications (switches, quiet hours, holding during
// focus) and routes clicks. The slow pass is every 30 s (so day rollover is handled while running for days), the fast
// one every 5 s.
import type { ActionContext } from "../actions/dispatch.ts";
import { dispatch, presenceContext, vmContext, expiringFor } from "../actions/dispatch.ts";
import { withoutUpdate } from "../actions/status-actions.ts";
import { nextStatusNudge, nudgeLineFor, statusNudgeDue } from "../plan/status-report.ts";
import type { StatusLoad } from "../plan/status-types.ts";
import { syncTeamsStatus, TEAMS_STATUS_KEY } from "../actions/presence-actions.ts";
import { requestContext, teamCtx } from "../actions/dispatch.ts";
import { teamNotices } from "../actions/team-actions.ts";
import type { MeetingNudgeView } from "../actions/meeting-actions.ts";
import { myLinkedLogins } from "../actions/identities.ts";
import { storedIdentity } from "../actions/account.ts";
import { visibleChats } from "../actions/request-actions.ts";
import { urgentRequests } from "../actions/request-actions.ts";
import { UNMATCHED_DAYS } from "../plan/asks.ts";

/** An urgent request is notified while its sort is this fresh (a person who signs in later isn't told of old ones). */
const URGENT_NOTICE_HOURS = 2;
import { vmAction, type VmStatus } from "../actions/vm-actions.ts";
import { CHECKIN_DONE_MARK } from "../actions/closeout-actions.ts";
import { refreshTodayWarnings } from "../actions/warnings.ts";
import { TIMER_KEY, timerAction, timerLike } from "../actions/timer-actions.ts";
import { createNotifier } from "../actions/notifier.ts";
import type { AppConfig } from "../config/schema.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { Logger } from "../log/logger.ts";
import { DEFAULT_FOCUS } from "../plan/focussound.ts";
import { DEFAULT_NOTIFY, dueFollowUps, inWorkingHours, noticeDone, notices, QUIET_KINDS, type Notice } from "../plan/notify.ts";
import type { TeamsStatusState } from "../plan/presence.ts";
import { AHEAD_SEEN_MARK, aheadRitualsDue } from "../plan/rituals.ts";
import type { TimerState, WarnPoint } from "../plan/timer.ts";
import { nextWake } from "../plan/wake.ts";
import type { PlanStore } from "../store/plan-store.ts";
import type { PushControl } from "./push.ts";
import { localToday, mondayOf } from "../week/dates.ts";
import { dayEndOf, hoursOn } from "../week/hours.ts";
import { userZone } from "../week/zone.ts";
import { checkDayReminder, checkinReminderDue, checkReminder, checkWeekNudges, closeoutReminderDue } from "./notify.ts";
import { calendarRefreshDue, checkTimer, TIMER_BUTTONS } from "./timer.ts";
import type { PassFacts } from "./teams/rhythm.ts";
import type { BackgroundName, BackgroundPolicy } from "../config/background-policy.ts";

/**
 * ENV-1: the parts of a person's passes, in the order they run, each under its name in the background policy
 * (config/background-policy.ts). Production runs every part, as before ENV-1; outside production a part runs only when
 * the policy allows it (opt_in parts only for a person who switched "from this test site" on).
 */
export const SLOW_PARTS = [
  ["teams_rhythm", "teams_rhythm"],
  ["day_reminders", "notices"],
  ["workday_notices", "notices"],
  ["vm_notice", "notices"],
  ["urgent_asks", "notices"],
  ["chat_text_cleanup", "chat_text_cleanup"],
  ["conversation_notices", "notices"],
  ["takes", "notices"],
  ["notes", "notices"],
  ["team", "notices"],
  ["meetings", "notices"],
] as const satisfies readonly (readonly [string, BackgroundName])[];
export const FAST_PARTS = [
  ["timer", "focus_timer"],
  ["warnings", "calendar_refresh"],
  ["held", "notices"],
  ["sweep", "notice_sweep"],
  ["teams_status", "teams_status"],
] as const satisfies readonly (readonly [string, BackgroundName])[];
export type SlowPart = (typeof SLOW_PARTS)[number][0];
export type FastPart = (typeof FAST_PARTS)[number][0];

/** The parts a person's passes run under a policy (their opt-in read from their settings). */
export function partsFor(policy: BackgroundPolicy, optIn: boolean): { slow: SlowPart[]; fast: FastPart[] } {
  return {
    slow: SLOW_PARTS.filter(([, n]) => policy.allows(n, { optIn })).map(([p]) => p),
    fast: FAST_PARTS.filter(([, n]) => policy.allows(n, { optIn })).map(([p]) => p),
  };
}

export type TickDeps = {
  log: Logger;
  /** ENV-1: what may run here (server/main.ts computes it once from the environment). */
  policy: BackgroundPolicy;
  now: () => Temporal.Instant;
  notifications: HostNotifications;
  media: HostMedia;
  /** A clicked notification asks for a view: kept for the person's window, which is brought up. */
  openRoute: (route: string) => void;
  /** P1: this person's Web Push (their devices); absent where there is none (tests). */
  push?: PushControl;
  /** TB-2: this person's rhythm in Teams (the brief, check-in, close out and nudges); absent without the bot. */
  teams?: { tick: (f: PassFacts) => Promise<void>; wake: (c: AppConfig | null) => Promise<Temporal.Instant | null> };
};

/** One person's passes; the scheduler runs them for everyone, never two of the same kind at once. */
export type PersonTicks = {
  fast: () => Promise<void>;
  slow: () => Promise<void>;
  wake?: () => Promise<Temporal.Instant>;
  /** HK-1: resolves once every notice a pass handed to the notifier (which doesn't wait for them) has been offered. */
  settled?: () => Promise<void>;
};

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
  const focusRunning = async () => {
    const s = (await store.getState<TimerState>(TIMER_KEY));
    return !!s && s.kind === "focus" && !s.ended && !!s.runningSince;
  };
  const todayOf = (c: AppConfig) => localToday(instantNow().toString(), userZone(c));
  const vmCtx = () => vmContext(liveCtx);

  /** A button on a notification: the VM's Start (the timer's buttons go to checkTimer). D475: there is no Restore. */
  const act = async (n: Notice, key: string) => {
    const sample = n.key.startsWith("sample:");
    if (n.kind === "vm" && key === "start") {
      // Samples never touch Azure unless asked for live (notify.sample { live: true }): they open the VM menu.
      if (sample && !n.key.startsWith("sample:live:")) return openRoute("vm");
      const r = await vmAction(await vmCtx(), "vm.start_now", {});
      log({ source: "azure", op: "notify_start", kind: r.ok ? "ok" : (r.code ?? "refused") });
      // Start asks first (Settings > You), or it couldn't: open the VM menu, where the preview and the reason show.
      if (!r.ok) {
        openRoute("vm");
        if (r.code !== "ask_first") host.notifications.line("FocusTime", `Couldn't start your VM: ${r.error}.`);
      }
    }
  };
  /** Whether a held notification still matters when focus ends. */
  const still = async (n: Notice) => {
    const c = await configOrNull();
    if (!c) return true;
    const today = todayOf(c);
    if (n.kind === "plan_day") return !(await store.dayHasWork(today));
    if (n.kind === "closeout") return !(await store.day(today))?.closedOutAt;
    if (n.kind === "checkin") return (await store.dayHasWork(today)) && !(await store.day(today))?.closedOutAt;
    if (n.kind === "plan_week" || n.kind === "look_ahead") return !(await store.weeksWithWork([n.route.slice("planweek:".length)])).size;
    if (n.kind === "followups") return dueFollowUps((await store.openFollowUps()), today).length > 0;
    if (n.kind === "plan_ahead" || n.kind === "direction") return !n.ref || !(await store.marked(AHEAD_SEEN_MARK, n.ref));
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
    // A3: the facts noticeDone weighs, read up front for this notice's ref (noticeDone is pure and sync).
    const ref = n.ref ?? "";
    const day = ref && ["plan_day", "checkin", "closeout"].includes(n.kind) ? await store.day(ref) : null;
    const checked = n.kind === "checkin" && ref ? await store.marked(CHECKIN_DONE_MARK, ref) : false;
    const dayWork = ref && n.kind === "plan_day" ? await store.dayHasWork(ref) : false;
    const weekWork = ref && (n.kind === "plan_week" || n.kind === "look_ahead") ? (await store.weeksWithWork([ref])).size > 0 : false;
    const open = n.kind === "followups" ? await store.openFollowUps() : [];
    const timer = n.kind === "timer" ? await store.getState<TimerState>(TIMER_KEY) : null;
    const seen = ref && (n.kind === "plan_ahead" || n.kind === "direction") ? await store.marked(AHEAD_SEEN_MARK, ref) : false;
    return noticeDone(n, {
      dayHasWork: () => dayWork,
      checkedIn: () => checked,
      closedOut: () => !!day?.closedOutAt,
      weekHasWork: () => weekWork,
      followUpOpen: (id) => open.some((f) => f.id === id && !f.closedAt),
      dueCount: () => (today ? dueFollowUps(open, today).length : 1),
      timerWaiting: (startedAt) => !!timer && timer.ended && timer.startedAt === startedAt,
      vmOff: () => (vs ? vs.prompt : null),
      aheadSeen: () => seen,
    });
  };
  const notifier = createNotifier({
    plan: store,
    host: {
      // P1: what passes the gate also goes into the in-app list (⋯ › Notifications) and to the devices with push on.
      // The handle carries both the list row and the host's own, so a handled occasion closes both.
      // The host shows it at once (never waiting on the database); the handle names the list row once it is written.
      show: (n, shown) => {
        const row = store.addNotice({ key: n.key, kind: String(n.kind), title: n.title, body: n.body, route: n.route }).catch(() => null);
        // ENV-1: outside production Web Push goes only to a person who opted in, or for a test or sample they pressed.
        const pressed = n.kind === "test" || n.key.startsWith("sample:");
        if (d.push && !QUIET_KINDS.has(n.kind))
          void configOrNull()
            .then((c) => (pressed || d.policy.allows("web_push", { optIn: !!c?.notify.fromTestSite }) ? d.push!.send(n, c?.notify.pushDetails ?? false) : undefined))
            .catch(() => log({ source: "server", op: "push_failed" }));
        return host.notifications.show(n, (h) => void row.then((r) => shown?.(`${r ?? ""}|${h}`)));
      },
      close: (h) => {
        const [row, own = ""] = h.split(/\|(.*)/s);
        if (row) void store.closeNotice(Number(row)).catch(() => undefined);
        if (own) host.notifications.close(own);
      },
    },
    done,
    facts: async () => {
      const c = await configOrNull();
      const settings = c?.notify ?? DEFAULT_NOTIFY;
      if (!c) return { settings, inHours: false, pto: false, focusRunning: await focusRunning() };
      const today = todayOf(c);
      return { settings, inHours: inWorkingHours(c.week.hours, zonedNow(userZone(c))), pto: await ptoOff(today).catch(() => false), focusRunning: await focusRunning() };
    },
    now: () => instantNow().toString(),
    open: (route) => openRoute(route),
    act,
    still,
    log: (op, kind) => log({ source: "plan", op, kind }),
  });

  // Settings > Notifications > Send a test notification, and one sample per kind for the live check.
  const samples = async (c: AppConfig, live: boolean): Promise<Record<string, Notice | null>> => {
    const at = instantNow().toString();
    const today = todayOf(c);
    const monday = Temporal.PlainDate.from(today).subtract({ days: Temporal.PlainDate.from(today).dayOfWeek - 1 });
    const pfx = (n: Notice | null): Notice | null => (n ? { ...n, key: `sample:${live ? "live:" : ""}${n.key}:${at}` } : null);
    const open = dueFollowUps((await store.openFollowUps()), today);
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
      // With none due, a made-up one that opens the Inbox (there is no follow-up to open).
      followups: pfx(open.length ? notices.followUps(today, open, at) : { ...notices.followUps(today, [{ id: 1, what: "Sample: reply about the proposal", overdue: false }], at)!, route: "inbox" }),
      expiry: pfx(notices.expiry(today, [{ text: "Sample: a DevOps write access expires in 9 days. Update in Settings", section: "clients" }], at)),
    };
  };
  liveCtx.notifications = {
    test: () => notifier.test(),
    sample: async (kind, live, gated) => {
      const c = await configOrNull();
      const n = c ? (await samples(c, live))[kind] : null;
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

  // HK-1: offers in flight, so settled() can wait for them instead of a test sleeping and hoping.
  const inflight = new Set<Promise<unknown>>();
  const track = <T,>(p: Promise<T>): Promise<T> => {
    inflight.add(p);
    void p.finally(() => inflight.delete(p)).catch(() => undefined);
    return p;
  };
  const settled = async () => {
    while (inflight.size) await Promise.allSettled([...inflight]);
  };
  const send = (n: Notice | null) => (n ? track(notifier.offer(n).catch(() => log({ source: "plan", op: "notify", kind: "failed" }))) : undefined);
  const dayReminders = async () => {
    const c = await configOrNull();
    if (!c) return;
    const at = instantNow().toString();
    await checkReminder({
      now: () => zonedNow(who.zone),
      hours: hoursOrNull,
      offsetMinutes: async () => c.plan.reminderOffsetMinutes,
      hasWork: (d) => store.dayHasWork(d),
      off: ptoOff,
      once: async (d) => (await notifier.allows("plan_day")) && (await store.markOnce("reminder", d)),
      send: () => void send(notices.planDay(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "reminder", kind: "failed" }));
    // Check-in and Close out (step 7): once a day each.
    await checkDayReminder({
      now: () => zonedNow(who.zone),
      hours: hoursOrNull,
      due: async (n, m) => checkinReminderDue(n, m, await store.dayHasWork(n.toPlainDate().toString()), c.plan.checkinReminderMinutes),
      off: ptoOff,
      once: async (d) => (await notifier.allows("checkin")) && (await store.markOnce("checkin_reminder", d)),
      send: () => void send(notices.checkin(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "checkin_reminder", kind: "failed" }));
    await checkDayReminder({
      now: () => zonedNow(who.zone),
      hours: hoursOrNull,
      due: async (n, m) => closeoutReminderDue(n, m, !!(await store.day(n.toPlainDate().toString()))?.closedOutAt, c.plan.closeoutReminderMinutes),
      off: ptoOff,
      once: async (d) => (await notifier.allows("closeout")) && (await store.markOnce("closeout_reminder", d)),
      send: () => void send(notices.closeout(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "closeout_reminder", kind: "failed" }));
    // Plan the week (Monday, this week) and Look ahead (Thursday and Friday, next week), step 8.
    const thisWeek = mondayOf(todayOf(c));
    await checkWeekNudges({
      now: () => zonedNow(who.zone),
      times: async () => ({ thu: c.plan.weekNudgeThu, fri: c.plan.weekNudgeFri, mon: c.plan.weekNudgeMon }),
      hasWork: async (w) => (await store.weeksWithWork([w])).size > 0,
      off: ptoOff,
      workStart: async (d) => hoursOn(c.week.hours, d).segments[0]?.start ?? null,
      once: async (key, w) => (await notifier.allows(w === thisWeek ? "plan_week" : "look_ahead")) && (await store.markOnce(key, w)),
      send: (_body, w) => void send(notices.week(w, w === thisWeek, at)),
    }).catch(() => log({ source: "plan", op: "week_nudge", kind: "failed" }));
    // Step 17: Look ahead 4 weeks (every other Thursday, once next week has work on it) and the direction review (first
    // Thursday of the month), from work start on a working day; once each; both open Roadmap › Plan ahead.
    try {
      const today = todayOf(c);
      const mon = Temporal.PlainDate.from(today).subtract({ days: Temporal.PlainDate.from(today).dayOfWeek - 1 });
      const workWeeks = await store.weeksWithWork([0, 7, 14].map((n) => mon.add({ days: n }).toString()));
      const seenKeys = await store.markedDates(AHEAD_SEEN_MARK);
      const due = aheadRitualsDue({
        today,
        time: zonedNow(who.zone).toPlainTime().toString().slice(0, 5),
        workStart: hoursOn(c.week.hours, today).segments[0]?.start ?? null,
        pto: await ptoOff(today).catch(() => true),
        weekHasWork: (w) => workWeeks.has(w),
        seen: (k) => seenKeys.has(k),
      });
      for (const r of due) if (notifier.allows(r.kind) && (await store.markOnce("ahead_notice", r.key))) await send(r.kind === "plan_ahead" ? notices.planAhead(r.key, at) : notices.direction(r.key, r.occasion, at));
    } catch {
      log({ source: "plan", op: "ahead_nudge", kind: "failed" });
    }
    await statusNudge(c).catch(() => log({ source: "plan", op: "status_nudge", kind: "failed" }));
  };
  // SR-1: Monday's status report, Friday afternoon (and Sunday evening when turned on), once per occasion, when some
  // feature has no update yet. Status is read at most every 30 minutes inside the window; a source that can't be read
  // tries again later, and nothing missing marks the day done.
  let statusChecked = 0;
  const statusNudge = async (c: AppConfig) => {
    if (!c.notify.kinds.status_report) return;
    const z = zonedNow(userZone(c));
    const date = z.toPlainDate().toString();
    const due = statusNudgeDue({ localDate: date, localTime: z.toPlainTime().toString({ smallestUnit: "minute" }), s: { ...c.notify.status, friday: true }, dayEnd: dayEndOf(c.week.hours, date), pto: await ptoOff(date).catch(() => true), without: 1 });
    if (!due || (await store.marked("status_notice", date)) || Date.now() - statusChecked < 30 * 60_000) return;
    statusChecked = Date.now();
    const r = await dispatch(liveCtx, { action: "status.load", input: {} });
    const w = r.ok ? withoutUpdate(r.data as StatusLoad) : null;
    if (!w) return void log({ source: "plan", op: "status_nudge", kind: "unavailable" });
    if (!(await store.markOnce("status_notice", date))) return;
    if (w.without) await send(notices.statusReport(due.occasion, nudgeLineFor(w.needsYou, w.rest), instantNow().toString(), w.needsYou > 0));
    else log({ source: "plan", op: "status_nudge", kind: "skipped" });
  };
  // Once a workday from work start (working hours, not PTO): follow-ups due or overdue, and expiring secrets.
  const workdayNotices = async () => {
    const c = await configOrNull();
    if (!c) return;
    const today = todayOf(c);
    const ws = hoursOn(c.week.hours, today).segments[0]?.start ?? null;
    if (!ws || zonedNow(userZone(c)).toPlainTime().toString().slice(0, 5) < ws) return;
    const at = instantNow().toString();
    if (notifier.allows("followups") && (await store.markOnce("followups_notice", today))) await send(notices.followUps(today, dueFollowUps((await store.openFollowUps()), today), at));
    if (notifier.allows("expiry") && (await store.markOnce("expiry_notice", today))) await send(notices.expiry(today, (await expiringFor(store, c, today)), at));
  };
  // My VM (step 15.4): once a workday at work start, say so when the VM is off. Never starts anything by itself, and
  // never touches its auto-shutdown (D475: the old next-morning restore is gone).
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
    const at = instantNow().toString();
    if (afterStart && notifier.allows("vm") && (await store.markOnce("vm_prompt_notice", today))) {
      const st = await vmAction(vc, "vm.status", {});
      if (st.ok && (st.data as VmStatus).prompt) await send(notices.vmOff(today, (st.data as VmStatus).vm?.name ?? "Your VM", at));
    }
  };
  // Shared polling (D517): the job reads the chats for everyone; here, one notification per request the AI sorted as
  // needing someone now in a chat I see, within URGENT_NOTICE_HOURS of its sort (each key goes out once; held during
  // focus unless Settings lets it through). And once a day, the AP-1 per-person message rows that didn't become asks
  // are deleted after UNMATCHED_DAYS (that table stays until its safe-drop).
  const asksTick = async () => {
    const c = await configOrNull();
    if (!c) return;
    const teams = liveCtx.requests?.teams;
    if (teams && notifier.allows("asks")) {
      const rc = await requestContext(liveCtx);
      const since = instantNow().subtract({ hours: URGENT_NOTICE_HOURS }).epochMilliseconds;
      const me = await rc.me();
      const urgent = (await urgentRequests(me ? teams.viewer(me) : null, await rc.followed().catch(() => null))).filter((a) => a.sort!.urgency === "now" && !!a.sortedAt && Date.parse(a.sortedAt) >= since);
      for (const u of urgent) await send(notices.urgentAsk(u.messageId, c.clientSettings[u.clientKey]?.name ?? u.clientKey, u.sort!.title, instantNow().toString()));
    }
  };
  const chatTextCleanup = async () => {
    const c = await configOrNull();
    if (!c) return;
    if (await store.markOnce("asks_cleanup", todayOf(c))) {
      const n = await store.purgeChatText({ olderThan: instantNow().subtract({ hours: 24 * UNMATCHED_DAYS }).toString() });
      log({ source: "plan", op: "asks_cleanup", count: n });
    }
  };
  // CV-1: my own notices from Conversations: one reminder when a promise of mine that needs a DevOps item has waited
  // a working day (the shared job marks it), and a quiet note when a teammate took one of mine over. Each goes once.
  const conversationsTick = async () => {
    const c = await configOrNull();
    const port = liveCtx.requests;
    const store2 = port?.conversations;
    if (!c || !port || !store2) return;
    const rc = await requestContext(liveCtx);
    const me = await rc.me();
    if (!me) return;
    const chats = await visibleChats(port.teams.viewer(me), await rc.followed().catch(() => null));
    const ids = chats.map((x) => x.chatId);
    const name = (k: string) => c.clientSettings[k]?.name ?? k;
    const at = instantNow().toString();
    if (notifier.allows("commitment_item")) {
      for (const k of await store2.viewer(me).commitmentsBy(ids)) {
        if (k.state !== "open" || !k.impliesItem || !k.escalatedAt || k.remindedAt) continue;
        await store2.updateCommitment(k.id, { remindedAt: at });
        await send(notices.commitmentItem(k.id, name(k.clientKey), k.what, at));
      }
    }
    if (notifier.allows("taken_over")) {
      for (const chatId of ids) {
        for (const k of await store2.commitmentsInChat(chatId)) {
          if (!k.takenFrom || k.takenFrom.toLowerCase() !== me.toLowerCase() || !k.takenAt) continue;
          if (Date.parse(at) - Date.parse(k.takenAt) > 3 * 86_400_000) continue;
          if (await store.markOnce(`taken_over_notice:${k.id}`, k.takenAt)) await send(notices.takenOver(k.id, k.whoName.split(/\s+/)[0] || "A teammate", k.what, at));
        }
      }
    }
    // Part 0: conversations handed to me, and new messages on the ones I have (the last 3 days; each once).
    const since = Temporal.Instant.from(at).subtract({ hours: 72 }).toString();
    const view = store2.viewer(me);
    const titleOf = async (id: number) => (await view.conversation(id))?.title ?? "A conversation";
    for (const e of await view.handedToMe(since)) {
      if (e.byUser?.toLowerCase() === me.toLowerCase()) continue;
      if (e.kind === "reopen") {
        if (notifier.allows("conversation_activity") && (await store.markOnce("conversation_reopened_notice", String(e.id)))) await send(notices.conversationActivity(`conversation_reopened:${e.id}`, e.note ?? "Reopened", await titleOf(e.conversationId), at));
      } else if (notifier.allows("conversation_given") && (await store.markOnce("conversation_given_notice", String(e.id)))) await send(notices.conversationGiven(e.id, e.byName.split(/\s+/)[0] || "A teammate", await titleOf(e.conversationId), e.kind === "helper", at));
    }
    if (notifier.allows("conversation_activity")) {
      for (const k of await view.conversations(ids, { openOnly: true })) {
        if (k.claimedBy?.toLowerCase() !== me.toLowerCase() || !k.claimedAt || Date.parse(k.lastWorkAt) <= Date.parse(k.claimedAt) || Date.parse(k.lastWorkAt) < Date.parse(since)) continue;
        const last = (await view.placesIn([k.id])).filter((p) => p.role === "work").at(-1);
        const m = last ? await port.teams.message(last.chatId, last.messageId) : null;
        if (!m || m.senderId?.toLowerCase() === me.toLowerCase()) continue;
        if (await store.markOnce("conversation_activity_notice", `${k.id}:${k.lastWorkAt}`)) await send(notices.conversationActivity(`conversation_activity:${k.id}:${k.version}`, `${m.senderName?.split(/\s+/)[0] ?? "Someone"} wrote in one you have`, k.title, at));
      }
    }
  };
  // PV-1: a quiet note, once each, when a teammate took one of my stories with Take one (the last 3 days only).
  const takesTick = async () => {
    const takes = liveCtx.takes;
    if (!takes || !notifier.allows("story_taken")) return;
    const me = await liveCtx.signedInAs?.().catch(() => undefined);
    const emails = [me?.email, me?.upn, ...((await store.devopsIdentities()).map((i) => i.email)), ...(await myLinkedLogins(liveCtx.org, (await storedIdentity(store))?.oid))].filter((e): e is string => !!e);
    const at = instantNow();
    for (const t of await takes.from(emails, at.subtract({ hours: 72 }).toString())) {
      if (await store.markOnce(`story_taken_notice:${t.id}`, t.takenAt)) await send(notices.storyTaken(t.id, t.byName.split(/\s+/)[0] || "A teammate", t.itemId, at.toString()));
    }
  };
  // AH-1 (D664): notes from teammates' commits in Ahead: one notice per assignment, and dates moves by the same person
  // within 10 minutes as one (one commit runs in batches). The last 3 days only, once each.
  const notesTick = async () => {
    const notes = liveCtx.devopsNotes;
    if (!notes) return;
    const me = await liveCtx.signedInAs?.().catch(() => undefined);
    const emails = [me?.email, me?.upn, ...((await store.devopsIdentities()).map((i) => i.email)), ...(await myLinkedLogins(liveCtx.org, (await storedIdentity(store))?.oid))].filter((e): e is string => !!e);
    const at = instantNow();
    const first = (n: string) => n.split(/\s+/)[0] || "A teammate";
    const got = await notes.to(emails, at.subtract({ hours: 72 }).toString());
    if (notifier.allows("assigned"))
      for (const n of got.filter((x) => x.kind === "assigned"))
        if (await store.markOnce(`assigned_notice:${n.id}`, n.at)) await send(notices.assigned(`assigned:${n.id}`, first(n.byName), n.itemIds, at.toString()));
    if (!notifier.allows("dates_moved")) return;
    const groups: (typeof got)[] = [];
    for (const n of got.filter((x) => x.kind === "dates")) {
      const g = groups.find((x) => x[0]!.byName === n.byName && x[0]!.org === n.org && Date.parse(n.at) - Date.parse(x.at(-1)!.at) <= 10 * 60_000);
      if (g) g.push(n);
      else groups.push([n]);
    }
    // A group still filling (its last note under 2 minutes old) waits for the next pass.
    for (const g of groups) {
      if (at.epochMilliseconds - Date.parse(g.at(-1)!.at) < 2 * 60_000) continue;
      const ids = [...new Set(g.flatMap((n) => n.itemIds))];
      let fresh = false;
      for (const n of g) if (await store.markOnce(`dates_notice:${n.id}`, n.at)) fresh = true;
      if (fresh) await send(notices.datesMoved(`dates_moved:${g[0]!.id}`, first(g[0]!.byName), ids, at.toString()));
    }
  };
  // SW-1: work sent to me, answers on what I sent, a Must another lead's teammate can't take, asks to look and replies
  // (the last 3 days; once each through the notifier's own marks).
  const teamTick = async () => {
    if (!liveCtx.team) return;
    const at = instantNow();
    const thisWeek = mondayOf(at.toZonedDateTimeISO(who.zone).toPlainDate().toString());
    const c = await configOrNull();
    const name = (k: string) => c?.clientSettings[k]?.name ?? k;
    const first = (n: string) => n.split(/\s+/)[0] || "A teammate";
    for (const n of await teamNotices(teamCtx(liveCtx), thisWeek, at.subtract({ hours: 72 }).toString())) {
      if (!notifier.allows(n.kind)) continue;
      const now = at.toString();
      if (n.kind === "sent_to_you") await send(notices.sentToYou(n.send.id, n.send.to.id, first(n.send.by?.name ?? n.send.from.name), n.send.title, n.send.kind === "must", n.send.weekStart, now));
      else if (n.kind === "send_answered") await send(notices.sendAnswered(n.send.id, `${n.send.state}:${n.send.updatedAt}`, n.words, n.send.title, n.send.weekStart, now));
      else if (n.kind === "send_cant_lead") await send(notices.sendCantLead(n.send.id, n.send.updatedAt, first(n.send.to.name), n.send.title, n.send.reason ?? "", now));
      else if (n.kind === "look_ask") await send(notices.lookAsk(n.look.id, first(n.look.from.name), name(n.look.clientKey), now));
      else await send(notices.lookReply(n.look.id, first(n.look.to.name), name(n.look.clientKey), n.look.weekStart, now));
    }
  };
  // MC-1: a call I review, once per occurrence: its proposals are ready, or its transcript needs uploading.
  const meetingsTick = async () => {
    if (!liveCtx.meetings || !notifier.allows("meeting_review")) return;
    const r = await dispatch(liveCtx, { action: "meeting.mine", input: {} });
    if (!r.ok) return;
    const at = instantNow().toString();
    for (const n of (r.data as { nudges: MeetingNudgeView[] }).nudges)
      if (await store.markOnce(`${n.key}_notice`, n.date)) await send(notices.meetingReview(n.key, n.occurrenceId, n.kind === "upload", n.clientName, n.meeting, n.dateLabel, at));
  };
  // TB-2: the rhythm in Teams, through the same gate facts (quiet hours, PTO, focus) as every notification.
  const teamsTick = async (f: Awaited<ReturnType<typeof notifier.refresh>> | null) => {
    if (!d.teams || !f) return;
    const c = await configOrNull();
    if (!c?.notify.teamsMessages) return;
    await d.teams.tick({ config: c, inHours: f.inHours, pto: f.pto, focusRunning: f.focusRunning });
  };
  /** ENV-1: the parts this pass may run (production: all of them; elsewhere the policy's, with the person's opt-in). */
  // Production runs every part whatever the switch says, so it reads no settings for this (as before ENV-1).
  const parts = async () => partsFor(d.policy, d.policy.production ? false : !!(await configOrNull().catch(() => null))?.notify.fromTestSite);
  /** ENV-1: whether this person may get notices here (the focus timer's meeting warnings ask it too). */
  const noticesHere = async () => (await parts()).fast.includes("held");
  const tick = async () => {
    const allowed = new Set<string>((await parts()).slow);
    // The gate's facts (settings, hours, PTO from Dataverse) only when a part that uses them may run.
    const facts = SLOW_PARTS.some(([p, n]) => allowed.has(p) && (n === "notices" || n === "teams_rhythm")) ? await notifier.refresh().catch(() => null) : null;
    const slow: Record<SlowPart, () => Promise<unknown>> = {
      teams_rhythm: () => teamsTick(facts).catch(() => log({ source: "server", op: "teams_rhythm", kind: "failed" })),
      day_reminders: () => dayReminders(),
      workday_notices: () => workdayNotices().catch(() => log({ source: "plan", op: "notify", kind: "failed" })),
      vm_notice: () => vmTick().catch(() => log({ source: "azure", op: "vm_tick", kind: "failed" })),
      urgent_asks: () => asksTick().catch(() => log({ source: "plan", op: "asks_tick", kind: "failed" })),
      chat_text_cleanup: () => chatTextCleanup().catch(() => log({ source: "plan", op: "asks_tick", kind: "failed" })),
      conversation_notices: () => conversationsTick().catch(() => log({ source: "plan", op: "conversations_tick", kind: "failed" })),
      takes: () => takesTick().catch(() => log({ source: "plan", op: "takes_tick", kind: "failed" })),
      notes: () => notesTick().catch(() => log({ source: "plan", op: "notes_tick", kind: "failed" })),
      team: () => teamTick().catch(() => log({ source: "plan", op: "team_tick", kind: "failed" })),
      meetings: () => meetingsTick().catch(() => log({ source: "plan", op: "meetings_tick", kind: "failed" })),
    };
    for (const [part] of SLOW_PARTS) if (allowed.has(part)) await slow[part]();
  };

  // The focus timer (step 6c): ends sessions on time and warns 5 minutes ahead, window open or not.
  const timerCtx = () => ({ plan: store, config: configOrNull, now: () => instantNow().toString(), media });
  const timerTick = () =>
    checkTimer({
      plan: store,
      now: () => instantNow(),
      endSound: async () => (await configOrNull())?.plan.endSound ?? false,
      // Through the notifier (its switch); the buttons come back here, where the session is checked. ENV-1: a meeting
      // warning is a timed reminder, so on a test site only for someone who switched them on; the end of the session
      // the person started here always shows (no push without the switch).
      notify: async (n) =>
        n.kind === "meeting" && !(await noticesHere())
          ? null
          : new Promise((resolve) => {
          void track(notifier.offer(n, (key) => resolve(key || null))).then((g) => g !== "send" && resolve(null), () => resolve(null));
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
    if (!(await notifier.held()).length || (await focusRunning())) return;
    await notifier.refresh();
    const n = await notifier.flush();
    if (n) log({ source: "plan", op: "notify", kind: "held_delivered", count: n });
  };
  // Fresher warnings (step 6d): while a timer runs, reload today's calendars every 5 minutes (their own cache
  // decides whether that is a live call) and recompute today's warning points.
  let lastCalendar: number | null = null;
  const warningsTick = async () => {
    const s = (await store.getState<TimerState>(TIMER_KEY));
    const t = Date.now();
    if (!s?.runningSince) return void (lastCalendar = null);
    if (!calendarRefreshDue(s, lastCalendar, t)) return;
    lastCalendar = t;
    void refreshTodayWarnings({ loadConfig, makeOutlook: liveCtx.makeOutlook, makeGoogle: liveCtx.makeGoogle, ...(liveCtx.linkCalendars ? { linkCalendars: liveCtx.linkCalendars } : {}), plan: store, now: () => instantNow().toString() })
      .then((n) => n !== null && log({ source: "plan", op: "warnings", kind: "refreshed", count: n }))
      .catch(() => log({ source: "plan", op: "warnings", kind: "failed" }));
  };
  /** Every 5 seconds: the timer, meeting warnings, held notices after focus, handled ones closed, Teams status. */
  const fast = async () => {
    const allowed = new Set<string>((await parts()).fast);
    const parts2: Record<FastPart, () => Promise<unknown>> = {
      timer: () => timerTick(),
      warnings: () => warningsTick().catch(() => log({ source: "plan", op: "warnings", kind: "failed" })),
      held: () => flushHeld().catch(() => log({ source: "plan", op: "notify", kind: "failed" })),
      // Q91: close notifications on screen whose occasion was handled (the day planned, the follow-up closed...).
      sweep: async () => void (notifier.onScreen().length && (await notifier.sweep().catch(() => log({ source: "plan", op: "notify", kind: "failed" })))),
      // Step 16.3: my Teams status follows focus (set, refreshed on +15, cleared however the session ends, even after a
      // restart). Only while a timer exists or a status FocusTime set is still to clear. ENV-1: production only.
      teams_status: async () => {
        if ((await store.getState(TIMER_KEY)) || (await store.accountState<TeamsStatusState>(TEAMS_STATUS_KEY))?.set)
          await presenceContext(liveCtx).then(syncTeamsStatus).catch(() => log({ source: "outlook", op: "teams_status", kind: "failed" }));
      },
    };
    for (const [part] of FAST_PARTS) if (allowed.has(part)) await parts2[part]();
  };
  /** A3, the idle rule: the next moment this person's passes could do something (plan/wake.ts). */
  const wake = async (): Promise<Temporal.Instant> => {
    const c = await configOrNull();
    const timer = await store.getState<TimerState>(TIMER_KEY);
    const points = (await store.getState<{ date: string; points: WarnPoint[] }>("warn_points"))?.points ?? [];
    const running = !!timer?.runningSince && !timer.ended;
    // ENV-1: only what this person's parts may do wakes the server (outside production: no reminders unless opted in).
    const allowed = await parts();
    const may = new Set<string>([...allowed.slow, ...allowed.fast]);
    const pending = (may.has("teams_status") && !timer && !!(await store.accountState<TeamsStatusState>(TEAMS_STATUS_KEY))?.set) || (may.has("held") && !running && (await notifier.held()).length > 0);
    const p = may.has("day_reminders") ? c?.plan : undefined;
    // Shared polling: the chats' next read is the app job's wake (server/scheduler.ts), not anyone's.
    const teamsAt = d.teams && may.has("teams_rhythm") ? await d.teams.wake(c).catch(() => null) : null;
    const base = nextWake({
      now: instantNow(),
      zone: c ? userZone(c) : who.zone,
      hours: c?.week.hours ?? null,
      offsets: { reminderMinutes: p?.reminderOffsetMinutes ?? 0, checkinMinutes: p?.checkinReminderMinutes ?? 0, closeoutMinutes: p?.closeoutReminderMinutes ?? 0, weekNudges: p ? [p.weekNudgeThu, p.weekNudgeFri, p.weekNudgeMon] : [] },
      timer,
      warnPoints: points,
      pending,
    });
    // SR-1: the status nudge's Friday and Sunday times (Sunday evening is outside the hours the base counts).
    let statusAt: Temporal.Instant | null = null;
    if (c?.notify.kinds.status_report && may.has("day_reminders")) {
      const z = zonedNow(userZone(c));
      const today = z.toPlainDate().toString();
      const doneToday = await store.marked("status_notice", today);
      statusAt = nextStatusNudge(z, { ...c.notify.status, friday: true }, (x) => dayEndOf(c.week.hours, x), (o) => doneToday && o === `status_report:${today}`);
    }
    return [teamsAt, statusAt].filter((x): x is Temporal.Instant => !!x).reduce((a, b) => (Temporal.Instant.compare(a, b) <= 0 ? a : b), base);
  };
  return { fast, slow: tick, wake, settled };
}
