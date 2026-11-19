// ST-1: the one list of Settings' sections and settings. The rail, search, deep links (#/settings/<section>[/<setting>]),
// the command menu and the Guide read it; every setting in it renders with data-setting="<id>" in its section, and
// e2e/settings/panel-shell.test.ts checks each one is there. Adding a setting: docs/settings.md.
//
// Old section ids (before ST-1) still open: they map to their new section and, where it moved inside one, the setting.

import { DAYS_OFF_WORDS, KIND_LABEL, type NotifyKind } from "../../plan/notify.ts";
import { TEAMS_KIND_LABEL, type TeamsKind } from "../../plan/teams-rhythm.ts";

const WEEKDAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;
/**
 * SA-3: the notice kinds Reminders and notices lists under "Each kind of notice", folded, in its order. The reminders
 * (Add work, Midday check-in, Close out, Plan next week, Status report, Look ahead, Direction review) have a row each
 * in Reminders instead, with their times. The seven kinds after Deployments had no switch before SA-3.
 */
export const NOTICE_KINDS_SHOWN: readonly NotifyKind[] = ["timer", "meeting", "vm", "followups", "expiry", "asks", "meeting_review", "deployments", "story_taken", "sent_to_you", "send_answered", "send_cant_lead", "assigned", "dates_moved", "item_edited"];
/** SA-3: the reminder kinds, each a row (or, for the week's two, a part of one) in Reminders. */
export const REMINDER_KINDS: readonly NotifyKind[] = ["plan_day", "checkin", "closeout", "look_ahead", "plan_week", "status_report", "plan_ahead", "direction"];
/** SA-3: what each reminder kind is called on its row (the notice itself keeps KIND_LABEL's words). */
const REMINDER_LABEL: Partial<Record<NotifyKind, { label: string; old: readonly string[]; part?: boolean; group?: string }>> = {
  plan_day: { label: "Add work", old: ["Add work to today", "Add work reminder"] },
  checkin: { label: "Midday check-in", old: ["Check-in", "Midday check-in reminder"] },
  closeout: { label: "Close out", old: ["Close out reminder"] },
  look_ahead: { label: "Thursday and Friday, for next week", old: ["Look ahead (next week)"], part: true, group: "Plan next week" },
  plan_week: { label: "Monday, for this week", old: ["Add work to the week"], part: true, group: "Plan next week" },
  status_report: { label: "Status report", old: ["Monday's status report"] },
  plan_ahead: { label: "Look ahead", old: ["Look ahead 4 weeks"] },
  direction: { label: "Direction review", old: [] },
};
/** The Teams kinds that are a reminder's "Also in Teams", and the two that sit with the notices. */
const TEAMS_ALSO: Record<TeamsKind, { label: string; group: string; part: boolean }> = {
  brief: { label: "Morning brief", group: "Reminders", part: false },
  checkin: { label: "Midday check-in in Teams", group: "Midday check-in", part: true },
  closeout: { label: "Close out in Teams", group: "Close out", part: true },
  status: { label: "Status report in Teams", group: "Status report", part: true },
  nudges: { label: TEAMS_KIND_LABEL.nudges, group: "Each kind of notice", part: true },
  meetings: { label: `${TEAMS_KIND_LABEL.meetings} in Teams`, group: "Each kind of notice", part: true },
};

export type SettingsGroupId = "you" | "work" | "connected" | "yours";

/** SA-3: the rail's four groups, by what a person is trying to do. */
export const SETTINGS_GROUPS: readonly (readonly [SettingsGroupId, string])[] = [
  ["you", "You"],
  ["work", "Your work"],
  ["connected", "Connected"],
  ["yours", "Yours"],
];

export type SectionDef = {
  id: string;
  label: string;
  group: SettingsGroupId;
  /** One line under the title. */
  description: string;
  /** Old labels this section had, for search. */
  old?: readonly string[];
  /** SA-5: the words people use for it (search). */
  keywords?: readonly string[];
  /** Only in a demo session. */
  demoOnly?: boolean;
  /** A sub-page: not in the rail, opened from its parent, with Back. */
  parent?: string;
};

// SA-3: eleven sections in four groups. The ids are the ones each section had (its address is unchanged); four
// sections went into others and their ids land there (OLD_SECTIONS).
export const SECTIONS: readonly SectionDef[] = [
  { id: "you", label: "Profile", group: "you", description: "Who is signed in, your level, and first-run setup.", old: ["You", "Setup"] },
  { id: "hours", label: "Working hours", group: "you", description: "Your hours, lunch and time zone, one-day changes and standing blocks.", old: ["Standing blocks", "Day shape"], keywords: ["schedule", "work day", "hours"] },
  { id: "display", label: "Display", group: "you", description: "Theme, text size, timelines, the days Week shows, personal events and motion.", keywords: ["accessibility", "appearance", "look"] },
  { id: "notifications", label: "Reminders and notices", group: "work", description: "Where FocusTime reaches you, each reminder with its time, quiet times, and every kind of notice.", old: ["Notifications"], keywords: ["alerts", "nudges"] },
  { id: "planning", label: "Planning", group: "work", description: "How to-dos, timeboxes and DevOps updates work, with the fine tuning folded away.", old: ["Day and Week", "Today and Week", "Risk rules", "Backlog", "Roadmap", "Ahead"] },
  { id: "focus", label: "Focus", group: "work", description: "The focus timer, your Teams status while you focus, sounds and music." },
  { id: "clients", label: "Clients", group: "work", description: "The clients FocusTime follows for you, how each one shows, and what it looks for in their chats.", old: ["Client chats", "Requests", "Asks"] },
  { id: "client", label: "Client", group: "work", description: "How this client shows for you, and what comes from Dataverse and your admin.", parent: "clients" },
  { id: "connections", label: "Connections", group: "connected", description: "Microsoft, Outlook, Google, calendars by link, DevOps, Pocket, FocusTime in Teams and your VM.", old: ["Accounts and calendars", "My VM", "DevOps", "DevOps write access", "Enable DevOps writes"] },
  { id: "ai", label: "AI and assistant", group: "connected", description: "AI for FocusTime, your spend, Break down, and the assistant's history.", old: ["AI"] },
  { id: "data", label: "Your data", group: "yours", description: "What FocusTime keeps about you, what it changed in other apps, and Export, Reset or Delete.", old: ["Data", "Demo", "Activity", "Write log", "Audit log"] },
  { id: "about", label: "About", group: "yours", description: "The version, the Guide and Send feedback." },
];

export type SettingDef = {
  id: string;
  section: string;
  label: string;
  old?: readonly string[];
  keywords?: readonly string[];
  /** Shown only in the developer loop. */
  devOnly?: boolean;
  /** Shown only in a demo session. */
  demoOnly?: boolean;
  /** SA-2: the group it sits in on its page (search shows it beside the label when the label needs it). */
  group?: string;
  /** SA-2: its one help line, said on the row (what it does first). */
  help?: string;
  /** SA-2: what didn't fit in the one line, word for word, behind "More about this". */
  more?: string;
  /** SA-2: the unit beside a number ("minutes", "days"). */
  unit?: string;
  /** SA-2: the kind of choice, which decides its control (style guide section 12). */
  kind?: SettingKind;
  /** SA-2: a row of a page that search doesn't list on its own (a day of the week, one notice kind). */
  part?: boolean;
  /** PH-2: shown only on a phone. */
  phoneOnly?: boolean;
  /** SA-3: the fold it sits in, closed until opened ("Fine tuning"); a link or a search result opens it. */
  fold?: string;
};
/** SA-2: the kinds of choice; each has one control. */
export type SettingKind = "switch" | "choice" | "select" | "number" | "time" | "text" | "list" | "action" | "status";

/** SA-3: the folds a page has, and the words on each. */
export const FOLDS = { tuning: "Fine tuning", kinds: "Each kind of notice" } as const;

// One row per setting or status a person looks for. `id` is unique across Settings (it is the deep link's last part).
// SA-2: the label here is the one name: the page, search, links and the Undo message all read it. `part` rows are a
// setting's own rows (a weekday, one notice kind): on the page, found by search with their group beside them.
// SA-3: ids, stored keys and defaults are main's (ui/settings/stored-keys.test.ts); sections, groups and folds moved.
export const SETTINGS: readonly SettingDef[] = [
  // Profile
  { id: "signed-in", section: "you", label: "Signed in", kind: "action", keywords: ["sign out", "sign in", "account", "microsoft", "log out", "logout", "log in", "switch account"] },
  { id: "photos", section: "you", label: "Profile photos", old: ["Photos"], kind: "status", keywords: ["profile photo"] },
  { id: "email", section: "you", label: "Email", old: ["Email when signed out"], kind: "status", keywords: ["email address"] },
  { id: "level", section: "you", label: "Your level", kind: "status", keywords: ["guidance", "consultant", "senior", "lead"] },
  // SA-3: shown only to admins, and to nobody on production.
  { id: "dataverse-user", section: "you", label: "Dataverse user", kind: "status" },
  { id: "environment", section: "you", label: "Dataverse environment", old: ["Environment"], kind: "status" },
  { id: "setup", section: "you", label: "Setup", old: ["Run setup again", "Finish setup", "Start over"], kind: "action", keywords: ["first run", "onboarding"] },
  // Working hours
  { id: "weekdays", section: "hours", label: "Hours per day", old: ["Working hours", "Day shape"], kind: "text", keywords: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "evening", "start time", "end time", "day starts", "day ends"] },
  ...WEEKDAYS.map(([k, label]) => ({ id: `hours-${k}`, section: "hours", label, group: "Hours per day", kind: "text" as const, part: true })),
  { id: "lunch", section: "hours", label: "Lunch", kind: "text" },
  { id: "time-zone", section: "hours", label: "Time zone", kind: "text", keywords: ["zone", "timezone"] },
  { id: "one-day-changes", section: "hours", label: "One-day changes", kind: "list", keywords: ["override", "usual hours", "today's hours", "one day", "leave early", "start late"] },
  { id: "standing-blocks", section: "hours", label: "Standing blocks", kind: "list", keywords: ["internal", "focus block"] },
  // Display
  { id: "theme", section: "display", label: "Theme", kind: "choice", keywords: ["dark", "light", "neutral", "dark mode"] },
  { id: "text-size", section: "display", label: "Text size", kind: "choice", keywords: ["font", "font size", "larger", "bigger", "smaller", "zoom"] },
  { id: "timelines", section: "display", label: "Timelines", kind: "choice", keywords: ["business hours", "12 hours", "24 hours", "view range"] },
  { id: "week-days", section: "display", label: "Days on Week", kind: "switch", keywords: ["friday", "weekend", "saturday", "sunday"] },
  { id: "show-friday", section: "display", label: "Show the catch-up day", old: ["Show Friday"], group: "Days on Week", kind: "switch", part: true },
  { id: "show-weekend", section: "display", label: "Weekend days", old: ["Show weekend", "Show the weekend", "Every weekend day"], group: "Days on Week", kind: "choice", part: true },
  { id: "personal-events", section: "display", label: "Show personal events", old: ["Personal events"], kind: "switch", keywords: ["google", "hide", "private events"] },
  // PH-2: only on a phone (the computer's Day switch is Cards or Timeline in Day's header).
  { id: "day-timeline", section: "display", label: "Show Day as a timeline", kind: "switch", phoneOnly: true, keywords: ["timeline", "phone", "cards", "timebox"] },
  { id: "reduce-motion", section: "display", label: "Reduce motion", old: ["Motion"], kind: "switch", keywords: ["animation", "loader", "accessibility"] },
  // Reminders and notices (SA-3: was Notifications, with Day and Week's reminder times, week nudges and rituals)
  { id: "test-site", section: "notifications", label: "This test site", group: "This test site", kind: "status", part: true },
  { id: "from-test-site", section: "notifications", label: "Send me reminders and Teams messages from this test site", old: ["From this test site"], group: "This test site", kind: "switch" },
  { id: "devices", section: "notifications", label: "Devices that get notifications", old: ["Notify this device"], group: "On this device", kind: "list", keywords: ["push", "phone", "iphone", "devices"] },
  { id: "push-details", section: "notifications", label: "Show details in notifications", old: ["Show details"], group: "On this device", kind: "switch", keywords: ["lock screen"] },
  { id: "test-notification", section: "notifications", label: "Send a test notification", group: "On this device", kind: "action" },
  { id: "teams-messages", section: "notifications", label: "Let FocusTime message me in Teams", old: ["Messages in Teams"], group: "In Teams", kind: "switch", keywords: ["bot", "teams"] },
  { id: "teams-kind-friday", section: "notifications", label: "Also on Fridays", old: ["Also on Fridays (catch-up)"], group: "In Teams", kind: "switch", keywords: ["catch-up", "friday"] },
  { id: "teams-kinds", section: "notifications", label: "Send a test in Teams", old: ["What FocusTime sends in Teams", "Send me a test now"], group: "In Teams", kind: "action", keywords: ["morning brief", "midday check-in", "close out", "nudges", "test"] },
  { id: "teams-kind-brief", section: "notifications", label: TEAMS_ALSO.brief.label, group: "Reminders", kind: "switch", keywords: ["teams", "morning"] },
  ...REMINDER_KINDS.map((k) => {
    const r = REMINDER_LABEL[k]!;
    return { id: `notify-${k.replace(/_/g, "-")}`, section: "notifications", label: r.label, old: r.old, group: r.group ?? "Reminders", kind: "switch" as const, ...(r.part ? { part: true } : {}) };
  }),
  { id: "plan-reminder", section: "notifications", label: "Add work at", old: ["Add work reminder", "Reminder", "Plan today reminder"], group: "Add work", kind: "number", unit: "minutes after the day starts", part: true, keywords: ["minutes after the day starts"] },
  { id: "checkin-reminder", section: "notifications", label: "Midday check-in at", old: ["Midday check-in reminder", "Check-in reminder"], group: "Midday check-in", kind: "number", unit: "minutes after lunch", part: true },
  { id: "closeout-reminder", section: "notifications", label: "Close out at", old: ["Close out reminder"], group: "Close out", kind: "number", unit: "minutes before the day ends", part: true },
  { id: "week-nudges", section: "notifications", label: "Plan next week", old: ["Week nudges", "Thursday nudge", "Friday nudge", "Monday nudge", "Plan the week nudges"], group: "Reminders", kind: "time", keywords: ["thursday", "friday", "monday"] },
  ...(["thu", "fri", "mon"] as const).map((d) => ({ id: `nudge-${d}`, section: "notifications", label: `${({ thu: "Thursday", fri: "Friday", mon: "Monday" } as const)[d]} at`, old: [`${({ thu: "Thursday", fri: "Friday", mon: "Monday" } as const)[d]} nudge at`], group: "Plan next week", kind: "time" as const, part: true })),
  { id: "status-report-times", section: "notifications", label: "Status report times", group: "Status report", kind: "time", part: true, keywords: ["friday", "sunday", "monday report"] },
  { id: "rituals", section: "notifications", label: "Look-ahead rituals", old: ["Plan ahead rituals", "Look ahead 4 weeks"], group: "Reminders", kind: "status", part: true },
  ...(["checkin", "closeout", "status"] as const).map((k) => ({ id: `teams-kind-${k}`, section: "notifications", label: TEAMS_ALSO[k].label, old: [`Teams ${TEAMS_KIND_LABEL[k]}`], group: TEAMS_ALSO[k].group, kind: "switch" as const, part: true, keywords: ["teams", "also in teams"] })),
  { id: "quiet", section: "notifications", label: "Quiet outside my working hours", old: ["Quiet hours", "Quiet", "Outside working hours", "Never quiet"], group: "Quiet", kind: "switch", keywords: ["outside working hours", "never quiet"] },
  { id: "quiet-pto", section: "notifications", label: DAYS_OFF_WORDS.label, old: ["Days off", "Quiet on PTO days"], group: "Quiet", kind: "switch", keywords: ["pto", "holiday", "holidays", "time off", "vacation"] },
  { id: "urgent-during-focus", section: "notifications", label: "Let urgent requests through while I focus", old: ["Let urgent requests through during focus", "Urgent requests during focus", "Let urgent asks through", "Let urgent requests through"], group: "Quiet", kind: "switch" },
  { id: "kinds", section: "notifications", label: "Each kind of notice", old: ["What to notify me about"], kind: "switch", keywords: ["timer", "meeting", "follow-ups", "promises", "expiry", "vm", "notifications"] },
  ...NOTICE_KINDS_SHOWN.map((k) => ({ id: `notify-${k.replace(/_/g, "-")}`, section: "notifications", label: KIND_LABEL[k], group: FOLDS.kinds, fold: FOLDS.kinds, kind: "switch" as const, part: true })),
  ...(["nudges", "meetings"] as const).map((k) => ({ id: `teams-kind-${k}`, section: "notifications", label: TEAMS_ALSO[k].label, group: FOLDS.kinds, fold: FOLDS.kinds, kind: "switch" as const, part: true, keywords: ["teams"] })),
  // Planning (SA-3: was Day and Week, with Backlog's three numbers in Fine tuning)
  { id: "count-unsized", section: "planning", label: "Count unsized work as", old: ["Unsized", "Size? hours"], kind: "choice", keywords: ["estimate"] },
  { id: "suggest-empty-blocks", section: "planning", label: "Suggest work for empty blocks", old: ["Suggest"], kind: "switch", keywords: ["suggestions", "suggested", "keep all", "clear"] },
  { id: "devops-on-done", section: "planning", label: "When I tick a story", kind: "choice", keywords: ["devops update", "mark done", "ask to update devops", "wrap it up", "when I check off a to-do", "skip devops"] },
  { id: "progress-offer", section: "planning", label: "Offer DevOps updates at the end of the day", old: ["Offer DevOps updates at end of day", "Offer"], kind: "switch" },
  { id: "break-down-offered", section: "planning", label: "Offer Break down on features that need stories", old: ["Offer Break down", "Break down", "Draft stories"], kind: "switch" },
  { id: "readiness-nudges", section: "planning", label: "Show Needs attention nudges", old: ["Needs attention nudges", "Readiness nudges"], kind: "switch", keywords: ["flags"] },
  { id: "timeboxing", section: "planning", label: "Use timeboxing", old: ["Timeboxes"], group: "Timeboxes", kind: "switch" },
  { id: "outlook-default", section: "planning", label: "Put new timeboxes on Outlook", old: ["Put on Outlook", "Put timeboxes on Outlook"], group: "Timeboxes", kind: "switch" },
  { id: "confirm-own", section: "planning", label: "Ask before changing my own timebox events", old: ["Changes to my own timebox events", "Don't ask again for my own timeboxes"], group: "Timeboxes", kind: "switch" },
  { id: "shortest-useful-time", section: "planning", label: "Shortest useful time per size", group: FOLDS.tuning, fold: FOLDS.tuning, kind: "number", keywords: ["timebox my day", "minimum"] },
  ...(["S", "M", "L"] as const).map((z) => ({ id: `shortest-${z.toLowerCase()}`, section: "planning", label: `Shortest useful time for ${z}`, old: [`Shortest useful time, ${z}`], group: "Shortest useful time per size", fold: FOLDS.tuning, kind: "number" as const, unit: "minutes", part: true })),
  { id: "carry-over", section: "planning", label: "Carry over unfinished to-dos from the last", old: ["Carry-over", "Carry-over (days back)"], group: FOLDS.tuning, fold: FOLDS.tuning, kind: "number", unit: "days", keywords: ["unfinished"] },
  { id: "risk-rules", section: "planning", label: "At-risk blocks", old: ["Risk rules"], group: FOLDS.tuning, fold: FOLDS.tuning, kind: "number", keywords: ["meetings", "risk"] },
  { id: "risk-watch", section: "planning", label: "Watch at", group: "At-risk blocks", fold: FOLDS.tuning, kind: "number", unit: "minutes of meetings", part: true },
  { id: "risk-at-risk", section: "planning", label: "At risk at", group: "At-risk blocks", fold: FOLDS.tuning, kind: "number", unit: "minutes of meetings", part: true },
  { id: "risk-window", section: "planning", label: "Shortest useful focus window", group: "At-risk blocks", fold: FOLDS.tuning, kind: "number", unit: "minutes", part: true },
  { id: "help-length", section: "planning", label: "Help session length", old: ["Default length", "Help sessions"], group: "Help sessions", fold: FOLDS.tuning, kind: "select", keywords: ["ask to collaborate"] },
  { id: "help-teams", section: "planning", label: "Add a Teams meeting to help sessions", old: ["Teams meeting", "Teams meeting for help sessions"], group: "Help sessions", fold: FOLDS.tuning, kind: "switch" },
  { id: "help-days", section: "planning", label: "Days to search for help", old: ["Days to search"], group: "Help sessions", fold: FOLDS.tuning, kind: "number", unit: "days" },
  { id: "exclude", section: "planning", label: "People I exclude", old: ["People to exclude"], group: "Help sessions", fold: FOLDS.tuning, kind: "list", keywords: ["helpers", "who"] },
  { id: "never-suggested", section: "planning", label: "Never suggested, for everyone", group: "Help sessions", fold: FOLDS.tuning, kind: "status" },
  { id: "invite-domains", section: "planning", label: "Invites go only to", group: "Help sessions", fold: FOLDS.tuning, kind: "status", keywords: ["domains"] },
  { id: "stale-weeks", section: "planning", label: "Stale after", old: ["Stale after (weeks)"], group: "Backlog", fold: FOLDS.tuning, kind: "number", unit: "weeks", keywords: ["backlog"] },
  { id: "stalled-days", section: "planning", label: "Stalled after", old: ["Stalled after (days)"], group: "Backlog", fold: FOLDS.tuning, kind: "number", unit: "days" },
  { id: "watch-weeks", section: "planning", label: "Watch within", old: ["Watch within (weeks)"], group: "Backlog", fold: FOLDS.tuning, kind: "number", unit: "weeks", keywords: ["forecast"] },
  // Focus
  { id: "focus-length", section: "focus", label: "Focus length", old: ["Focus length (minutes)"], group: "Focus timer", kind: "number", unit: "minutes", keywords: ["timer", "minutes", "pomodoro"] },
  { id: "break-length", section: "focus", label: "Break length", old: ["Break length (minutes)"], group: "Focus timer", kind: "number", unit: "minutes" },
  { id: "end-sound", section: "focus", label: "Play a sound when focus or a break ends", old: ["End sound", "Play a sound"], group: "Focus timer", kind: "switch", keywords: ["end sound"] },
  { id: "teams-status", section: "focus", label: "Set my Teams status while I focus", old: ["Set Teams status during focus", "Teams status"], group: "Teams status", kind: "switch", keywords: ["busy", "do not disturb", "presence"] },
  { id: "plain-focus-status", section: "focus", label: "Plain focus sets my status to", old: ["Plain focus sets"], group: "Teams status", kind: "choice", keywords: ["busy"] },
  { id: "sound", section: "focus", label: "Default sound", group: "Sound while focusing", kind: "select", keywords: ["brown", "pink", "rain", "binaural", "noise"] },
  { id: "volume", section: "focus", label: "Volume", group: "Sound while focusing", kind: "number" },
  { id: "fade", section: "focus", label: "Fade in and out", old: ["Fade"], group: "Sound while focusing", kind: "number", unit: "seconds" },
  { id: "on-break", section: "focus", label: "When a break starts", group: "Sound while focusing", kind: "choice", keywords: ["chime", "silence"] },
  { id: "pause-media", section: "focus", label: "Pause music when focus ends", old: ["Pause and resume music", "Pause music"], group: "Music players", kind: "switch", keywords: ["spotify", "player"] },
  { id: "playlists", section: "focus", label: "Playlists", kind: "list", keywords: ["spotify", "youtube", "music"] },
  // Clients (SA-3: with Client chats' phrases and the chats FocusTime reads)
  { id: "client-list", section: "clients", label: "Your clients", kind: "list", keywords: ["clients list", "followed clients"] },
  { id: "follow-grace", section: "clients", label: "Keep following after focus time ends", old: ["Keep following", "Clients followed"], kind: "number", unit: "days", keywords: ["grace days"] },
  // A client's own page (#/settings/client/<key>): not searched on its own (it needs the client), named once here.
  { id: "client-nickname", section: "client", label: "Dataverse nickname", kind: "status", part: true, keywords: ["nickname"] },
  { id: "client-identity", section: "client", label: "Your DevOps identity", kind: "status", part: true },
  { id: "client-shown-as", section: "client", label: "Shown as", kind: "text", part: true, keywords: ["rename client", "rename", "client name", "display name"] },
  { id: "client-color", section: "client", label: "Color", kind: "choice", part: true, keywords: ["colour", "client color"] },
  { id: "client-followed", section: "client", label: "Keep following", old: ["Followed"], kind: "switch", part: true, keywords: ["unfollow", "stop following", "follow"] },
  { id: "client-open-states", section: "client", label: "States treated as open", kind: "status", part: true },
  { id: "client-writes", section: "client", label: "DevOps writes", kind: "status", part: true, keywords: ["write access"] },
  { id: "client-chats", section: "client", label: "Client chats", kind: "list", part: true, keywords: ["teams chat", "delivery chat"] },
  { id: "client-ai", section: "client", label: "AI for this client", kind: "status", part: true },
  { id: "client-platform", section: "client", label: "Data platform", kind: "choice", part: true, keywords: ["fabric", "deployments"] },
  { id: "client-deploy", section: "client", label: "Deployment items", kind: "list", part: true, keywords: ["deployment", "deploy", "release"] },
  { id: "client-house-style", section: "client", label: "House style for Break down", kind: "status", part: true, keywords: ["how stories are split"] },
  { id: "team-phrases", section: "clients", label: "Team phrases", group: "What FocusTime looks for in chats", kind: "status" },
  { id: "team-request-phrases", section: "clients", label: "Team asking phrases", group: "What FocusTime looks for in chats", kind: "status", part: true },
  { id: "team-ack-phrases", section: "clients", label: "Team acknowledgements", group: "What FocusTime looks for in chats", kind: "status", part: true },
  { id: "team-promise-phrases", section: "clients", label: "Team promise phrases", group: "What FocusTime looks for in chats", kind: "status", part: true },
  { id: "request-phrases", section: "clients", label: "My asking phrases", old: ["My request phrases", "Requests"], group: "What FocusTime looks for in chats", kind: "text" },
  { id: "ack-phrases", section: "clients", label: "My acknowledgements", old: ["Acknowledgements"], group: "What FocusTime looks for in chats", kind: "text" },
  { id: "promise-phrases", section: "clients", label: "My promise phrases", old: ["Promise phrases"], group: "What FocusTime looks for in chats", kind: "text" },
  { id: "chats-read", section: "clients", label: "Client chats FocusTime reads", old: ["Client chats read for requests"], group: "Chats FocusTime reads", kind: "status", keywords: ["polling", "reconnect"] },
  // Connections (SA-3: was Accounts and calendars, with DevOps)
  { id: "sources", section: "connections", label: "Microsoft and Outlook", old: ["Sources"], group: "Microsoft and Outlook", kind: "status", keywords: ["dataverse", "outlook", "google", "calendar", "connect", "reconnect", "disconnect", "retry", "pto"] },
  { id: "google", section: "connections", label: "Google", group: "Google", kind: "status", keywords: ["google calendar", "personal", "connect google"] },
  { id: "outlook-changes", section: "connections", label: "Outlook calendar changes", group: "Outlook calendar changes", kind: "status", keywords: ["calendars.readwrite", "write"] },
  { id: "permissions", section: "connections", label: "Microsoft permissions", group: "Microsoft and Outlook", kind: "status", keywords: ["consent", "scopes", "chat.read"] },
  { id: "calendar-links", section: "connections", label: "Calendars added by link", old: ["Add a calendar by link"], group: "Calendars added by link", kind: "list", keywords: ["ics", "ical", "webcal", "subscribe", "icloud", "apple", "school", "busy only", "replace link"] },
  { id: "devops-read", section: "connections", label: "DevOps per client", old: ["Reading"], group: "DevOps", kind: "status", keywords: ["live", "cached", "pat problem"] },
  { id: "devops-write", section: "connections", label: "DevOps write access", old: ["Write access"], group: "DevOps", kind: "action", keywords: ["pat", "personal access token"] },
  { id: "find-item", section: "connections", label: "Find an item", group: "DevOps", kind: "action", keywords: ["missing item", "why isn't it showing", "not showing", "item number", "scope", "area"] },
  { id: "pocket", section: "connections", label: "Pocket recorder", group: "Pocket recorder", kind: "action", keywords: ["pocket", "recorder", "recording", "api key", "transcript"] },
  { id: "teams-app", section: "connections", label: "FocusTime in Teams", group: "FocusTime in Teams", kind: "status", keywords: ["bot", "teams"] },
  { id: "vm", section: "connections", label: "My VM", group: "My VM", kind: "action", keywords: ["azure", "find my vm", "resource id", "virtual machine"] },
  { id: "vm-start", section: "connections", label: "Start without a preview", old: ["Start my VM without asking", "Start right away"], group: "My VM", kind: "switch" },
  { id: "vm-autostart", section: "connections", label: "Start my VM before my day", group: "My VM", kind: "switch", keywords: ["auto-start", "auto start", "automatically", "before work"] },
  // AI and assistant
  { id: "ai-team", section: "ai", label: "AI for FocusTime", kind: "status", keywords: ["allowed for", "monthly limit", "admin"] },
  { id: "ai-allowed", section: "ai", label: "Allowed for", group: "AI for FocusTime", kind: "status", part: true },
  { id: "ai-limit", section: "ai", label: "Your monthly limit", group: "AI for FocusTime", kind: "status", part: true },
  { id: "ai-month", section: "ai", label: "This month's AI spend", old: ["This month"], kind: "status", keywords: ["cost", "budget", "cap"] },
  { id: "draft-months", section: "ai", label: "Break down looks back", old: ["Break down looks back (months)"], kind: "number", unit: "months" },
  { id: "ai-test", section: "ai", label: "Test AI", kind: "action" },
  { id: "ai-sent", section: "ai", label: "What is sent to AI", old: ["What is sent"], kind: "status" },
  { id: "ai-log", section: "ai", label: "Last 20 AI requests", old: ["Last 20 requests"], kind: "status" },
  { id: "assistant-history", section: "ai", label: "Assistant history", kind: "action", keywords: ["clear", "ask", "voice", "push to talk", "chat history"] },
  // Your data (SA-3: with Activity's five logs)
  { id: "what-we-keep", section: "data", label: "What FocusTime keeps about you", kind: "status", keywords: ["privacy", "what do you keep", "retention", "how long", "kept"] },
  { id: "write-log", section: "data", label: "Outlook write log", old: ["Write log", "Activity"], group: "What FocusTime changed in other apps", kind: "status", keywords: ["undo", "retry", "timebox"] },
  { id: "devops-log", section: "data", label: "DevOps write log", group: "What FocusTime changed in other apps", kind: "status" },
  { id: "azure-log", section: "data", label: "Azure write log", group: "What FocusTime changed in other apps", kind: "status", keywords: ["vm"] },
  { id: "teams-log", section: "data", label: "Teams status log", group: "What FocusTime changed in other apps", kind: "status", keywords: ["presence"] },
  { id: "loop-log", section: "data", label: "Close the loop sends", group: "What FocusTime changed in other apps", kind: "status", keywords: ["promise", "sent", "email", "teams message"] },
  { id: "export", section: "data", label: "Export my data", kind: "action", keywords: ["download", "json", "backup", "copy of my data"] },
  { id: "reset-plan", section: "data", label: "Reset my plan", kind: "action" },
  { id: "delete", section: "data", label: "Delete my data", kind: "action", keywords: ["delete account", "remove my data", "forget me"] },
  { id: "diagnostics", section: "data", label: "Diagnostics", kind: "action", keywords: ["promises check", "chatter"] },
  { id: "demo-mode", section: "data", label: "Show demo data", old: ["Demo mode"], group: "Demo", kind: "switch", devOnly: true },
  { id: "demo-reset", section: "data", label: "Reset demo", old: ["Demo"], group: "Demo", kind: "action", demoOnly: true },
  { id: "demo-be", section: "data", label: "Use the demo as", group: "Demo", kind: "select", demoOnly: true, keywords: ["teammate", "person"] },
  // About (SA-3: with Send feedback)
  { id: "version", section: "about", label: "Version", kind: "status" },
  { id: "guide", section: "about", label: "Guide", old: ["Open the Guide"], kind: "action", keywords: ["help", "how to", "manual"] },
  { id: "feedback", section: "about", label: "Send feedback", kind: "status" },
  { id: "style-guide", section: "about", label: "Style guide", old: ["Open the style guide"], kind: "action", keywords: ["tokens"], devOnly: true },
];

/** Section ids before ST-1 that moved: where they open now. */
export const OLD_SECTIONS: Readonly<Record<string, { section: string; setting?: string }>> = {
  standing: { section: "hours", setting: "standing-blocks" },
  risk: { section: "planning", setting: "risk-rules" },
  roadmap: { section: "planning", setting: "stale-weeks" },
  setup: { section: "you", setting: "setup" },
  demo: { section: "data", setting: "demo-reset" },
  // SA-3: the four sections that went into others land where their settings are now.
  ahead: { section: "planning", setting: "stale-weeks" },
  chats: { section: "clients", setting: "request-phrases" },
  devops: { section: "connections", setting: "devops-read" },
  activity: { section: "data", setting: "write-log" },
};

export const sectionOf = (id: string): SectionDef | undefined => SECTIONS.find((s) => s.id === id);
export const settingOf = (id: string): SettingDef | undefined => SETTINGS.find((s) => s.id === id);

/** TP-1b: settings taken out of the app (Work templates' read-only view): an old address opens its section's top. */
export const RETIRED_SETTINGS: readonly string[] = ["work-templates"];

/** Where an address's section and setting open: old ids mapped, unknown ones null. */
export function resolveSettings(section: string, setting?: string | null): { section: string; setting: string | null } | null {
  const old = OLD_SECTIONS[section];
  if (old) return moved({ section: old.section, setting: setting ?? old.setting ?? null });
  if (!sectionOf(section)) return null;
  return moved({ section, setting: setting && !RETIRED_SETTINGS.includes(setting) ? setting : null });
}

/** SA-3: a setting that moved to another section opens there (#/settings/planning/plan-reminder → Reminders). */
function moved(r: { section: string; setting: string | null }): { section: string; setting: string | null } {
  if (!r.setting || r.section === "client") return r;
  const d = settingOf(r.setting);
  return d && d.section !== r.section && d.section !== "client" ? { section: d.section, setting: d.id } : r;
}

/**
 * SA-5: things people look for in Settings that aren't settings: where they are, or that FocusTime doesn't have them.
 * Search answers them with `text` (and `href` or a Settings place to open, when there is one). Pointers name only
 * places a person can see (ui/places.ts checks them).
 */
export type NotSetting = { id: string; label: string; keywords: readonly string[]; text: string; where?: string; href?: string; section?: string; setting?: string };
export const NOT_SETTINGS: readonly NotSetting[] = [
  { id: "password", label: "Password", keywords: ["change password", "reset password", "passcode", "two factor", "mfa"], text: "FocusTime has no password of its own: you sign in with Microsoft. Change your password where you change it for Microsoft." },
  { id: "language", label: "Language", keywords: ["english", "spanish", "french", "translate", "translation", "locale"], text: "FocusTime is in English only; there is no language to choose." },
  { id: "shortcuts", label: "Keyboard shortcuts", keywords: ["keys", "hotkeys", "keyboard", "shortcut"], text: "Not a setting: More › Keyboard shortcuts lists every key. They can't be changed." },
  { id: "vm-shutdown", label: "Your VM's shutdown time", keywords: ["auto shutdown", "auto-shutdown", "shutdown", "shut down", "turn off vm", "stop my vm"], text: "Set in Azure, on the VM's own auto-shutdown schedule. FocusTime only reads it and shows it in Connections › My VM.", section: "connections", setting: "vm" },
  { id: "gantt", label: "Gantt", keywords: ["timeline view", "gantt chart"], text: "A view, not a setting: Backlog › Gantt.", href: "#/ahead/gantt" },
  { id: "contrast", label: "High contrast", keywords: ["contrast", "high contrast", "colour blind", "color blind"], text: "FocusTime has no contrast setting of its own. Theme, Text size and Reduce motion are in Display.", section: "display", setting: "theme" },
  { id: "code", label: "Code", keywords: ["repo", "repos", "repository", "who can read code", "read code", "git"], text: "Not a setting: Code is its own tab (More › Code on a phone). It lists the clients whose code you can read.", href: "#/code" },
];

/** Where a setting is, as search shows it: its section, and its group when it has one ("Reminders and notices › Quiet"). */
export const whereOf = (d: SettingDef) => {
  const s = sectionOf(d.section)!.label;
  const path = [d.fold && d.fold !== d.group ? d.fold : null, d.group && d.group !== d.label ? d.group : null].filter(Boolean);
  return path.length ? `${s} › ${path.join(" › ")}` : s;
};

/** The address of a section, or of one setting in it. */
export const settingsHref = (section: string, setting?: string | null) => `#/settings/${section}${setting ? `/${setting}` : ""}`;
