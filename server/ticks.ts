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
import { requestContext } from "../actions/dispatch.ts";
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
  /** P1: this person's Web Push (their devices); absent where there is none (tests). */
  push?: PushControl;
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
    if (n.kind === "plan_day") return !(await store.day(today))?.committedAt;
    if (n.kind === "closeout") return !(await store.day(today))?.closedOutAt;
    if (n.kind === "checkin") return !!(await store.day(today))?.committedAt && !(await store.day(today))?.closedOutAt;
    if (n.kind === "plan_week" || n.kind === "look_ahead") return !(await store.weekPlan(n.route.slice("planweek:".length))).committedAt;
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
    const week = ref && (n.kind === "plan_week" || n.kind === "look_ahead") ? await store.weekPlan(ref) : null;
    const open = n.kind === "followups" ? await store.openFollowUps() : [];
    const timer = n.kind === "timer" ? await store.getState<TimerState>(TIMER_KEY) : null;
    const seen = ref && (n.kind === "plan_ahead" || n.kind === "direction") ? await store.marked(AHEAD_SEEN_MARK, ref) : false;
    return noticeDone(n, {
      committed: () => !!day?.committedAt,
      checkedIn: () => checked,
      closedOut: () => !!day?.closedOutAt,
      weekCommitted: () => !!week?.committedAt,
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
        if (d.push && !QUIET_KINDS.has(n.kind)) void configOrNull().then((c) => d.push!.send(n, c?.notify.pushDetails ?? false)).catch(() => log({ source: "server", op: "push_failed" }));
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
      committed: async (d) => !!(await store.day(d))?.committedAt,
      off: ptoOff,
      once: async (d) => (await notifier.allows("plan_day")) && (await store.markOnce("reminder", d)),
      send: () => void send(notices.planDay(todayOf(c), at)),
    }).catch(() => log({ source: "plan", op: "reminder", kind: "failed" }));
    // Check-in and Close out (step 7): once a day each.
    await checkDayReminder({
      now: () => zonedNow(who.zone),
      hours: hoursOrNull,
      due: async (n, m) => checkinReminderDue(n, m, !!(await store.day(n.toPlainDate().toString()))?.committedAt, c.plan.checkinReminderMinutes),
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
      committed: async (w) => !!(await store.weekPlan(w)).committedAt,
      off: ptoOff,
      workStart: async (d) => hoursOn(c.week.hours, d).segments[0]?.start ?? null,
      once: async (key, w) => (await notifier.allows(w === thisWeek ? "plan_week" : "look_ahead")) && (await store.markOnce(key, w)),
      send: (_body, w) => void send(notices.week(w, w === thisWeek, at)),
    }).catch(() => log({ source: "plan", op: "week_nudge", kind: "failed" }));
    // Step 17: Look ahead 4 weeks (every other Thursday, once next week is planned) and the direction review (first
    // Thursday of the month), from work start on a working day; once each; both open Roadmap › Plan ahead.
    try {
      const today = todayOf(c);
      const committedWeeks = await store.committedWeeks();
      const seenKeys = await store.markedDates(AHEAD_SEEN_MARK);
      const due = aheadRitualsDue({
        today,
        time: zonedNow(who.zone).toPlainTime().toString().slice(0, 5),
        workStart: hoursOn(c.week.hours, today).segments[0]?.start ?? null,
        pto: await ptoOff(today).catch(() => true),
        weekCommitted: (w) => committedWeeks.has(w),
        seen: (k) => seenKeys.has(k),
      });
      for (const r of due) if (notifier.allows(r.kind) && (await store.markOnce("ahead_notice", r.key))) await send(r.kind === "plan_ahead" ? notices.planAhead(r.key, at) : notices.direction(r.key, r.occasion, at));
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
  };
  // PV-1: a quiet note, once each, when a teammate took one of my stories with Take one (the last 3 days only).
  const takesTick = async () => {
    const takes = liveCtx.takes;
    if (!takes || !notifier.allows("story_taken")) return;
    const me = await liveCtx.signedInAs?.().catch(() => undefined);
    const emails = [me?.email, me?.upn, ...((await store.devopsIdentities()).map((i) => i.email))].filter((e): e is string => !!e);
    const at = instantNow();
    for (const t of await takes.from(emails, at.subtract({ hours: 72 }).toString())) {
      if (await store.markOnce(`story_taken_notice:${t.id}`, t.takenAt)) await send(notices.storyTaken(t.id, t.byName.split(/\s+/)[0] || "A teammate", t.itemId, at.toString()));
    }
  };
  const tick = async () => {
    await notifier.refresh().catch(() => null);
    await dayReminders();
    await workdayNotices().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
    await vmTick().catch(() => log({ source: "azure", op: "vm_tick", kind: "failed" }));
    await asksTick().catch(() => log({ source: "plan", op: "asks_tick", kind: "failed" }));
    await conversationsTick().catch(() => log({ source: "plan", op: "conversations_tick", kind: "failed" }));
    await takesTick().catch(() => log({ source: "plan", op: "takes_tick", kind: "failed" }));
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
    void refreshTodayWarnings({ loadConfig, makeOutlook: liveCtx.makeOutlook, makeGoogle: liveCtx.makeGoogle, plan: store, now: () => instantNow().toString() })
      .then((n) => n !== null && log({ source: "plan", op: "warnings", kind: "refreshed", count: n }))
      .catch(() => log({ source: "plan", op: "warnings", kind: "failed" }));
  };
  /** Every 5 seconds: the timer, meeting warnings, held notices after focus, handled ones closed, Teams status. */
  const fast = async () => {
    await timerTick();
    await warningsTick().catch(() => log({ source: "plan", op: "warnings", kind: "failed" }));
    await flushHeld().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
    // Q91: close notifications on screen whose occasion was handled (the day planned, the follow-up closed...).
    if (notifier.onScreen().length) await notifier.sweep().catch(() => log({ source: "plan", op: "notify", kind: "failed" }));
    // Step 16.3: my Teams status follows focus (set, refreshed on +15, cleared however the session ends, even after a
    // restart). Only while a timer exists or a status FocusTime set is still to clear.
    if ((await store.getState(TIMER_KEY)) || (await store.accountState<TeamsStatusState>(TEAMS_STATUS_KEY))?.set)
      await presenceContext(liveCtx).then(syncTeamsStatus).catch(() => log({ source: "outlook", op: "teams_status", kind: "failed" }));
  };
  /** A3, the idle rule: the next moment this person's passes could do something (plan/wake.ts). */
  const wake = async (): Promise<Temporal.Instant> => {
    const c = await configOrNull();
    const timer = await store.getState<TimerState>(TIMER_KEY);
    const points = (await store.getState<{ date: string; points: WarnPoint[] }>("warn_points"))?.points ?? [];
    const running = !!timer?.runningSince && !timer.ended;
    const pending = (!timer && !!(await store.accountState<TeamsStatusState>(TEAMS_STATUS_KEY))?.set) || (!running && (await notifier.held()).length > 0);
    const p = c?.plan;
    // Shared polling: the chats' next read is the app job's wake (server/scheduler.ts), not anyone's.
    return nextWake({
      now: instantNow(),
      zone: c ? userZone(c) : who.zone,
      hours: c?.week.hours ?? null,
      offsets: { reminderMinutes: p?.reminderOffsetMinutes ?? 0, checkinMinutes: p?.checkinReminderMinutes ?? 0, closeoutMinutes: p?.closeoutReminderMinutes ?? 0, weekNudges: p ? [p.weekNudgeThu, p.weekNudgeFri, p.weekNudgeMon] : [] },
      timer,
      warnPoints: points,
      pending,
    });
  };
  return { fast, slow: tick, wake, settled };
}
