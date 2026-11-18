// SA-3: each Settings row's stored key and its built-in default, read from the code's own defaults. Test 1
// (ui/settings/stored-keys.test.ts) compares this with the snapshot taken on main before SA-3 moved anything
// (ui/settings/stored-keys-main.json): every id still there, each key and default unchanged. Rows with no stored value
// of their own (a status, an action, a log, a value from Dataverse or a team value) map to null.
import { DEFAULT_AZURE, DEFAULT_COLLAB, DEFAULT_PLAN, DEFAULT_TIMEBOX, DEFAULT_UI } from "../../config/schema.ts";
import { DEFAULT_ACK_PHRASES, DEFAULT_PROMISE_PHRASES, DEFAULT_REQUEST_PHRASES } from "../../plan/asks.ts";
import { DEFAULT_AHEAD } from "../../plan/backlog.ts";
import { DEFAULT_FOCUS } from "../../plan/focussound.ts";
import { DEFAULT_NOTIFY, NOTIFY_KINDS } from "../../plan/notify.ts";
import { DEFAULT_THRESHOLDS } from "../../plan/roadmap.ts";

export type Stored = { key: string; default: unknown } | null;

const n = DEFAULT_NOTIFY;
const t = n.teams;
const p = DEFAULT_PLAN;

/** id → the stored key ("[plan] carry_days") and its default. */
export const STORED: Readonly<Record<string, Stored>> = {
  "from-test-site": { key: "[notify] from_test_site", default: n.fromTestSite },
  ...Object.fromEntries(NOTIFY_KINDS.map((k) => [`notify-${k.replace(/_/g, "-")}`, { key: `[notify] ${k}`, default: n.kinds[k] }])),
  "status-report-times": { key: "[notify] status_friday_at, status_sunday, status_sunday_at", default: [n.status.fridayAt, n.status.sunday, n.status.sundayAt] },
  "urgent-during-focus": { key: "[notify] asks_through_focus", default: n.asksThroughFocus },
  quiet: { key: "[notify] quiet", default: n.quiet },
  "quiet-pto": { key: "[notify] quiet_pto", default: n.quietPto },
  "push-details": { key: "[notify] push_details", default: n.pushDetails },
  "teams-messages": { key: "[notify] teams_messages", default: n.teamsMessages },
  "teams-kind-brief": { key: "[notify] teams_brief, teams_brief_at", default: [t.brief, t.briefAt] },
  "teams-kind-checkin": { key: "[notify] teams_checkin", default: t.checkin },
  "teams-kind-closeout": { key: "[notify] teams_closeout", default: t.closeout },
  "teams-kind-nudges": { key: "[notify] teams_nudges", default: t.nudges },
  "teams-kind-status": { key: "[notify] teams_status", default: t.status },
  "teams-kind-meetings": { key: "[notify] teams_meetings", default: t.meetings },
  "teams-kind-friday": { key: "[notify] teams_friday", default: t.friday },
  theme: { key: "[ui] theme", default: DEFAULT_UI.theme },
  "text-size": { key: "[ui] text_size", default: DEFAULT_UI.textSize },
  timelines: { key: "[ui] view_range", default: DEFAULT_UI.viewRange },
  "personal-events": { key: "[ui] show_personal", default: DEFAULT_UI.showPersonal },
  "show-friday": { key: "[ui] show_catch_up_day", default: DEFAULT_UI.showCatchUpDay },
  "show-weekend": { key: "[ui] show_weekend_days", default: DEFAULT_UI.showWeekendDays },
  "day-timeline": { key: "[ui] today_timeline_phone", default: DEFAULT_UI.todayTimelinePhone },
  "reduce-motion": { key: "[ui] reduce_motion", default: DEFAULT_UI.reduceMotion },
  "break-down-offered": { key: "[guidance] draft_stories", default: "level" },
  "readiness-nudges": { key: "[guidance] readiness_nudges", default: "level" },
  "count-unsized": { key: "[plan] unsized_minutes", default: p.sizes.unsized },
  "shortest-s": { key: "[plan] min_s", default: p.minSizes.S },
  "shortest-m": { key: "[plan] min_m", default: p.minSizes.M },
  "shortest-l": { key: "[plan] min_l", default: p.minSizes.L },
  "carry-over": { key: "[plan] carry_days", default: p.carryDays },
  "suggest-empty-blocks": { key: "[plan] suggest_empty_blocks", default: p.suggest },
  "devops-on-done": { key: "[plan] devops_on_done", default: p.devopsOnDone },
  "progress-offer": { key: "[plan] devops_progress_offer", default: p.progressOffer },
  "plan-reminder": { key: "[plan] reminder_offset_minutes", default: p.reminderOffsetMinutes },
  "checkin-reminder": { key: "[plan] checkin_reminder_minutes", default: p.checkinReminderMinutes },
  "closeout-reminder": { key: "[plan] closeout_reminder_minutes", default: p.closeoutReminderMinutes },
  "nudge-thu": { key: "[plan] week_nudge_thu", default: p.weekNudgeThu },
  "nudge-fri": { key: "[plan] week_nudge_fri", default: p.weekNudgeFri },
  "nudge-mon": { key: "[plan] week_nudge_mon", default: p.weekNudgeMon },
  timeboxing: { key: "[timebox] enabled", default: DEFAULT_TIMEBOX.enabled },
  "outlook-default": { key: "[timebox] outlook_default", default: DEFAULT_TIMEBOX.outlookDefault },
  "confirm-own": { key: "[timebox] confirm_own", default: DEFAULT_TIMEBOX.confirmOwn },
  "help-length": { key: "[collab] meeting_minutes", default: DEFAULT_COLLAB.meetingMinutes },
  "help-teams": { key: "[collab] teams", default: DEFAULT_COLLAB.teams },
  "help-days": { key: "[collab] days_ahead", default: DEFAULT_COLLAB.daysAhead },
  exclude: { key: "[collab] exclude", default: DEFAULT_COLLAB.exclude },
  "risk-watch": { key: "[risk] meeting_watch_minutes", default: "starter" },
  "risk-at-risk": { key: "[risk] meeting_at_risk_minutes", default: "starter" },
  "risk-window": { key: "[risk] min_focus_window_minutes", default: "starter" },
  "focus-length": { key: "[plan] focus_minutes", default: p.focusMinutes },
  "break-length": { key: "[plan] break_minutes", default: p.breakMinutes },
  "end-sound": { key: "[plan] end_sound", default: p.endSound },
  "teams-status": { key: "[focus] teams_status", default: DEFAULT_FOCUS.teamsStatus },
  "plain-focus-status": { key: "[focus] plain_focus_status", default: DEFAULT_FOCUS.plainFocusStatus },
  sound: { key: "[focus] sound", default: DEFAULT_FOCUS.sound },
  volume: { key: "[focus] volume", default: DEFAULT_FOCUS.volume },
  fade: { key: "[focus] fade_seconds", default: DEFAULT_FOCUS.fadeSeconds },
  "on-break": { key: "[focus] on_break", default: DEFAULT_FOCUS.onBreak },
  "pause-media": { key: "[focus] pause_media", default: DEFAULT_FOCUS.pauseMedia },
  playlists: { key: "[focus] playlists", default: DEFAULT_FOCUS.playlists },
  "stale-weeks": { key: "[ahead] stale_weeks", default: DEFAULT_AHEAD.staleWeeks },
  "stalled-days": { key: "[roadmap] stalled_days", default: DEFAULT_THRESHOLDS.stalledDays },
  "watch-weeks": { key: "[roadmap] watch_weeks", default: DEFAULT_THRESHOLDS.watchWeeks },
  "follow-grace": { key: "[plan] follow_grace_days", default: p.followGraceDays },
  "client-shown-as": { key: "[clients.<key>] name", default: null },
  "client-color": { key: "[clients.<key>] color", default: "team" },
  "client-followed": { key: "[clients.<key>] follow", default: false },
  "request-phrases": { key: "[asks] request_phrases", default: DEFAULT_REQUEST_PHRASES },
  "ack-phrases": { key: "[asks] ack_phrases", default: DEFAULT_ACK_PHRASES },
  "promise-phrases": { key: "[asks] promise_phrases", default: DEFAULT_PROMISE_PHRASES },
  "vm-start": { key: "[azure] start_without_asking", default: DEFAULT_AZURE.startWithoutAsking },
  "vm-autostart": { key: "[azure] auto_start, auto_start_minutes, auto_start_off_days", default: [DEFAULT_AZURE.autoStart.on, DEFAULT_AZURE.autoStart.minutes, DEFAULT_AZURE.autoStart.offDays] },
  vm: { key: "[azure] vm", default: null },
  weekdays: { key: "[hours] weekdays", default: "starter" },
  lunch: { key: "[hours] lunch", default: "starter" },
  "time-zone": { key: "[hours] time_zone", default: "host" },
  "standing-blocks": { key: "[[standing_blocks]]", default: [] },
  "draft-months": { key: "[ai] draft_months", default: 12 },
};
