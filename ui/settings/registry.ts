// ST-1: the one list of Settings' sections and settings. The rail, search, deep links (#/settings/<section>[/<setting>]),
// the command menu and the Guide read it; every setting in it renders with data-setting="<id>" in its section, and
// e2e/settings/panel-shell.test.ts checks each one is there. Adding a setting: docs/settings.md.
//
// Old section ids (before ST-1) still open: they map to their new section and, where it moved inside one, the setting.

import { DAYS_OFF_WORDS, KIND_LABEL, RITUAL_KINDS, type NotifyKind } from "../../plan/notify.ts";
import { TEAMS_KIND_LABEL } from "../../plan/teams-rhythm.ts";

const WEEKDAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;
/** The notice kinds Settings › Notifications lists, in its order, with the group each sits in. */
export const NOTIFY_SHOWN: readonly (readonly [NotifyKind, string])[] = [
  ...RITUAL_KINDS.map((k) => [k, "Ritual reminders"] as const),
  ["timer", "While you focus"], ["meeting", "While you focus"],
  ["vm", "Other"], ["followups", "Other"], ["expiry", "Other"], ["asks", "Other"],
  ["status_report", "Monday's status report"], ["meeting_review", "Client calls"], ["deployments", "Deployments"],
];
const TEAMS_SHOWN = [...Object.entries(TEAMS_KIND_LABEL), ["friday", "Also on Fridays (catch-up)"]] as const;

export type SettingsGroupId = "you" | "planning" | "clients" | "connections" | "data";

export const SETTINGS_GROUPS: readonly (readonly [SettingsGroupId, string])[] = [
  ["you", "You"],
  ["planning", "Planning"],
  ["clients", "Clients"],
  ["connections", "Connections"],
  ["data", "Data"],
];

export type SectionDef = {
  id: string;
  label: string;
  group: SettingsGroupId;
  /** One line under the title. */
  description: string;
  /** Old labels this section had, for search. */
  old?: readonly string[];
  /** P1: laid out for a big screen; read-only on the phone. */
  phoneReadOnly?: boolean;
  /** Only in a demo session. */
  demoOnly?: boolean;
  /** A sub-page: not in the rail, opened from its parent, with Back. */
  parent?: string;
};

export const SECTIONS: readonly SectionDef[] = [
  { id: "you", label: "Profile", group: "you", description: "Who is signed in, where your details come from, and first-run setup.", old: ["You", "Setup"] },
  { id: "hours", label: "Working hours", group: "you", description: "Your hours, lunch and time zone, one-day changes and standing blocks.", old: ["Standing blocks", "Day shape"], phoneReadOnly: true },
  { id: "notifications", label: "Notifications", group: "you", description: "What FocusTime tells you, when it stays quiet, and on which devices and in Teams." },
  { id: "display", label: "Display", group: "you", description: "Theme, text size, timelines, personal events and motion." },
  { id: "planning", label: "Day and Week", group: "planning", description: "How to-dos, rituals, timeboxes, help sessions and risk work when you plan.", old: ["Today and Week", "Planning", "Risk rules"] },
  { id: "focus", label: "Focus", group: "planning", description: "The focus timer, your Teams status while you focus, sounds and music." },
  { id: "ahead", label: "Backlog", group: "planning", description: "When Backlog calls an item stale, and when a feature reads Stalled or Watch.", old: ["Roadmap", "Ahead"] },
  { id: "clients", label: "Clients", group: "clients", description: "The clients FocusTime follows for you, and how each one shows." },
  { id: "client", label: "Client", group: "clients", description: "How this client shows for you, and what comes from Dataverse and your admin.", parent: "clients" },
  { id: "chats", label: "Client chats", group: "clients", description: "Your phrases for what clients ask and what you promise, and how each client chat is read.", old: ["Requests", "Asks"] },
  { id: "connections", label: "Accounts and calendars", group: "connections", description: "Your sources, your Pocket recorder, Microsoft permissions, your VM, Teams and Send feedback.", old: ["Connections", "My VM"] },
  { id: "devops", label: "DevOps", group: "connections", description: "Each client's DevOps read status and your write access.", old: ["DevOps write access", "Enable DevOps writes"], phoneReadOnly: true },
  { id: "ai", label: "AI and assistant", group: "connections", description: "AI for FocusTime, your spend, Break down, and the assistant's history.", old: ["AI"] },
  { id: "activity", label: "Activity", group: "data", description: "Every change FocusTime made in other apps, with Undo and Retry.", old: ["Write log", "Audit log"], phoneReadOnly: true },
  { id: "data", label: "Your data", group: "data", description: "Export, reset or delete what FocusTime keeps for you, diagnostics, and demo mode.", old: ["Data", "Demo"] },
  { id: "about", label: "About", group: "data", description: "The version, the Guide and the style guide." },
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
};
/** SA-2: the kinds of choice; each has one control. */
export type SettingKind = "switch" | "choice" | "select" | "number" | "time" | "text" | "list" | "action" | "status";

// One row per setting or status a person looks for. `id` is unique across Settings (it is the deep link's last part).
// SA-2: the label here is the one name: the page, search, links and the Undo message all read it. `part` rows are a
// setting's own rows (a weekday, one notice kind): on the page, found by search with their group beside them.
export const SETTINGS: readonly SettingDef[] = [
  // Profile
  { id: "signed-in", section: "you", label: "Signed in", kind: "action", keywords: ["sign out", "sign in", "account", "microsoft"] },
  { id: "photos", section: "you", label: "Profile photos", old: ["Photos"], kind: "status", keywords: ["profile photo"] },
  { id: "email", section: "you", label: "Email", old: ["Email when signed out"], kind: "status" },
  { id: "dataverse-user", section: "you", label: "Dataverse user", kind: "status" },
  { id: "environment", section: "you", label: "Dataverse environment", old: ["Environment"], kind: "status" },
  { id: "setup", section: "you", label: "Setup", old: ["Run setup again", "Finish setup", "Start over"], kind: "action", keywords: ["first run"] },
  // Working hours
  { id: "weekdays", section: "hours", label: "Hours per day", old: ["Working hours", "Day shape"], kind: "text", keywords: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "evening"] },
  ...WEEKDAYS.map(([k, label]) => ({ id: `hours-${k}`, section: "hours", label, group: "Hours per day", kind: "text" as const, part: true })),
  { id: "lunch", section: "hours", label: "Lunch", kind: "text" },
  { id: "time-zone", section: "hours", label: "Time zone", kind: "text", keywords: ["zone", "timezone"] },
  { id: "one-day-changes", section: "hours", label: "One-day changes", kind: "list", keywords: ["override", "usual hours"] },
  { id: "standing-blocks", section: "hours", label: "Standing blocks", kind: "list", keywords: ["internal", "focus block"] },
  // Notifications
  { id: "test-site", section: "notifications", label: "This test site", group: "This test site", kind: "status", part: true },
  { id: "from-test-site", section: "notifications", label: "Send me reminders and Teams messages from this test site", old: ["From this test site"], group: "This test site", kind: "switch" },
  { id: "kinds", section: "notifications", label: "What to notify me about", kind: "switch", keywords: ["reminders", "ritual", "timer", "meeting", "follow-ups", "promises", "expiry", "vm"] },
  ...NOTIFY_SHOWN.map(([k, group]) => ({ id: `notify-${k.replace(/_/g, "-")}`, section: "notifications", label: KIND_LABEL[k], group, kind: "switch" as const, part: true, ...(k === "checkin" ? { old: ["Check-in"] } : {}) })),
  { id: "status-report-times", section: "notifications", label: "Status report times", group: "Timing", kind: "time", keywords: ["friday", "sunday", "monday report"] },
  { id: "urgent-during-focus", section: "notifications", label: "Let urgent requests through during focus", old: ["Urgent requests during focus", "Let urgent asks through", "Let urgent requests through"], group: "Timing", kind: "switch" },
  { id: "quiet", section: "notifications", label: "Quiet hours", old: ["Quiet"], group: "Quiet hours", kind: "choice", keywords: ["outside working hours", "never quiet"] },
  { id: "quiet-pto", section: "notifications", label: DAYS_OFF_WORDS.label, old: ["Days off", "Quiet on PTO days"], group: "Quiet hours", kind: "switch", keywords: ["pto", "holiday", "holidays", "time off"] },
  { id: "test-notification", section: "notifications", label: "Send a test notification", group: "Test", kind: "action" },
  { id: "devices", section: "notifications", label: "Devices that get notifications", old: ["Notify this device"], group: "On your devices", kind: "list", keywords: ["push", "phone", "iphone", "devices"] },
  { id: "push-details", section: "notifications", label: "Show details in notifications", old: ["Show details"], group: "On your devices", kind: "switch", keywords: ["lock screen"] },
  { id: "teams-messages", section: "notifications", label: "Let FocusTime message me in Teams", old: ["Messages in Teams"], group: "In Teams", kind: "switch", keywords: ["bot", "teams"] },
  { id: "teams-kinds", section: "notifications", label: "What FocusTime sends in Teams", group: "In Teams", kind: "switch", keywords: ["morning brief", "midday check-in", "close out", "nudges", "friday"] },
  ...TEAMS_SHOWN.map(([k, label]) => ({ id: `teams-kind-${k}`, section: "notifications", label, group: "What FocusTime sends", kind: "switch" as const, part: true })),
  // Display
  { id: "theme", section: "display", label: "Theme", kind: "choice", keywords: ["dark", "light", "neutral"] },
  { id: "text-size", section: "display", label: "Text size", kind: "choice", keywords: ["font", "larger", "zoom"] },
  { id: "timelines", section: "display", label: "Timelines", kind: "choice", keywords: ["business hours", "12 hours", "24 hours", "view range"] },
  { id: "personal-events", section: "display", label: "Show personal events", old: ["Personal events"], kind: "switch", keywords: ["google"] },
  { id: "week-days", section: "display", label: "Days on Week", kind: "switch", keywords: ["friday", "weekend", "saturday", "sunday"] },
  { id: "show-friday", section: "display", label: "Show the catch-up day", old: ["Show Friday"], group: "Days on Week", kind: "switch", part: true },
  { id: "show-weekend", section: "display", label: "Show the weekend", old: ["Show weekend"], group: "Days on Week", kind: "switch", part: true },
  { id: "reduce-motion", section: "display", label: "Reduce motion", old: ["Motion"], kind: "switch", keywords: ["animation", "loader"] },
  // Day and Week
  { id: "level", section: "planning", label: "Your level", group: "Guidance", kind: "status", keywords: ["guidance", "consultant", "senior", "lead"] },
  { id: "break-down-offered", section: "planning", label: "Offer Break down on features that need stories", old: ["Offer Break down", "Break down", "Draft stories"], group: "Guidance", kind: "switch" },
  { id: "readiness-nudges", section: "planning", label: "Show Needs attention nudges", old: ["Needs attention nudges", "Readiness nudges"], group: "Guidance", kind: "switch", keywords: ["flags"] },
  { id: "count-unsized", section: "planning", label: "Count unsized work as", old: ["Unsized", "Size? hours"], group: "To-dos", kind: "choice" },
  { id: "shortest-useful-time", section: "planning", label: "Shortest useful time per size", group: "To-dos", kind: "number", keywords: ["timebox my day", "minimum"] },
  ...(["S", "M", "L"] as const).map((z) => ({ id: `shortest-${z.toLowerCase()}`, section: "planning", label: `Shortest useful time for ${z}`, old: [`Shortest useful time, ${z}`], group: "To-dos", kind: "number" as const, unit: "minutes", part: true })),
  { id: "carry-over", section: "planning", label: "Carry over unfinished to-dos from the last", old: ["Carry-over", "Carry-over (days back)"], group: "To-dos", kind: "number", unit: "days", keywords: ["unfinished"] },
  { id: "suggest-empty-blocks", section: "planning", label: "Suggest work for empty blocks", old: ["Suggest"], group: "To-dos", kind: "switch", keywords: ["suggestions", "suggested", "keep all", "clear"] },
  { id: "devops-on-done", section: "planning", label: "When I tick a story", group: "To-dos", kind: "choice", keywords: ["devops update", "mark done", "ask to update devops", "wrap it up", "when I check off a to-do", "skip devops"] },
  { id: "progress-offer", section: "planning", label: "Offer DevOps updates at the end of the day", old: ["Offer DevOps updates at end of day", "Offer"], group: "To-dos", kind: "switch" },
  { id: "plan-reminder", section: "planning", label: "Add work reminder", old: ["Reminder", "Plan today reminder"], group: "Reminders", kind: "number", unit: "minutes after the day starts", keywords: ["minutes after the day starts"] },
  { id: "checkin-reminder", section: "planning", label: "Midday check-in reminder", old: ["Check-in reminder"], group: "Reminders", kind: "number", unit: "minutes after lunch" },
  { id: "closeout-reminder", section: "planning", label: "Close out reminder", group: "Reminders", kind: "number", unit: "minutes before the day ends" },
  { id: "week-nudges", section: "planning", label: "Week nudges", old: ["Thursday nudge", "Friday nudge", "Monday nudge", "Plan the week nudges"], kind: "time" },
  ...(["thu", "fri", "mon"] as const).map((d) => ({ id: `nudge-${d}`, section: "planning", label: `${({ thu: "Thursday", fri: "Friday", mon: "Monday" } as const)[d]} nudge at`, group: "Week nudges", kind: "time" as const, part: true })),
  { id: "rituals", section: "planning", label: "Look-ahead rituals", old: ["Plan ahead rituals", "Look ahead 4 weeks", "Direction review"], kind: "status" },
  { id: "timeboxing", section: "planning", label: "Use timeboxing", old: ["Timeboxes"], group: "Timeboxes", kind: "switch" },
  { id: "outlook-default", section: "planning", label: "Put timeboxes on Outlook", old: ["Put on Outlook"], group: "Timeboxes", kind: "switch" },
  { id: "confirm-own", section: "planning", label: "Ask before changing my own timebox events", old: ["Changes to my own timebox events", "Don't ask again for my own timeboxes"], group: "Timeboxes", kind: "switch" },
  { id: "help-length", section: "planning", label: "Help session length", old: ["Default length", "Help sessions"], group: "Help sessions", kind: "select", keywords: ["ask to collaborate"] },
  { id: "help-teams", section: "planning", label: "Add a Teams meeting to help sessions", old: ["Teams meeting", "Teams meeting for help sessions"], group: "Help sessions", kind: "switch" },
  { id: "help-days", section: "planning", label: "Days to search for help", old: ["Days to search"], group: "Help sessions", kind: "number", unit: "days" },
  { id: "never-suggested", section: "planning", label: "Never suggested, for everyone", group: "Help sessions", kind: "status" },
  { id: "exclude", section: "planning", label: "People I exclude", old: ["People to exclude"], group: "Help sessions", kind: "list", keywords: ["helpers", "who"] },
  { id: "invite-domains", section: "planning", label: "Invites go only to", group: "Help sessions", kind: "status", keywords: ["domains"] },
  { id: "risk-rules", section: "planning", label: "At-risk blocks", old: ["Risk rules"], kind: "number", keywords: ["meetings", "risk"] },
  { id: "risk-watch", section: "planning", label: "Watch at", group: "At-risk blocks", kind: "number", unit: "minutes of meetings", part: true },
  { id: "risk-at-risk", section: "planning", label: "At risk at", group: "At-risk blocks", kind: "number", unit: "minutes of meetings", part: true },
  { id: "risk-window", section: "planning", label: "Shortest useful focus window", group: "At-risk blocks", kind: "number", unit: "minutes", part: true },
  // Focus
  { id: "focus-length", section: "focus", label: "Focus length", old: ["Focus length (minutes)"], group: "Focus timer", kind: "number", unit: "minutes", keywords: ["timer", "minutes"] },
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
  // Backlog
  { id: "stale-weeks", section: "ahead", label: "Stale after", old: ["Stale after (weeks)"], kind: "number", unit: "weeks", keywords: ["backlog"] },
  { id: "stalled-days", section: "ahead", label: "Stalled after", old: ["Stalled after (days)"], kind: "number", unit: "days" },
  { id: "watch-weeks", section: "ahead", label: "Watch within", old: ["Watch within (weeks)"], kind: "number", unit: "weeks", keywords: ["forecast"] },
  // Clients
  { id: "follow-grace", section: "clients", label: "Keep following after focus time ends", old: ["Keep following", "Clients followed"], kind: "number", unit: "days", keywords: ["grace days"] },
  { id: "client-list", section: "clients", label: "Your clients", kind: "list", keywords: ["color", "shown as", "name", "keep following", "house style", "client chats"] },
  // A client's own page (#/settings/client/<key>): not searched on its own (it needs the client), named once here.
  { id: "client-nickname", section: "client", label: "Dataverse nickname", kind: "status", part: true },
  { id: "client-identity", section: "client", label: "Your DevOps identity", kind: "status", part: true },
  { id: "client-shown-as", section: "client", label: "Shown as", kind: "text", part: true },
  { id: "client-color", section: "client", label: "Color", kind: "choice", part: true },
  { id: "client-followed", section: "client", label: "Keep following", old: ["Followed"], kind: "switch", part: true },
  { id: "client-open-states", section: "client", label: "States treated as open", kind: "status", part: true },
  { id: "client-writes", section: "client", label: "DevOps writes", kind: "status", part: true },
  { id: "client-chats", section: "client", label: "Client chats", kind: "list", part: true },
  { id: "client-ai", section: "client", label: "AI for this client", kind: "status", part: true },
  { id: "client-platform", section: "client", label: "Data platform", kind: "choice", part: true },
  { id: "client-deploy", section: "client", label: "Deployment items", kind: "list", part: true },
  { id: "client-house-style", section: "client", label: "House style for Break down", kind: "status", part: true },
  // Client chats
  { id: "team-phrases", section: "chats", label: "Team phrases", group: "Phrases", kind: "status" },
  { id: "team-request-phrases", section: "chats", label: "Team asking phrases", group: "Phrases", kind: "status", part: true },
  { id: "team-ack-phrases", section: "chats", label: "Team acknowledgements", group: "Phrases", kind: "status", part: true },
  { id: "team-promise-phrases", section: "chats", label: "Team promise phrases", group: "Phrases", kind: "status", part: true },
  { id: "request-phrases", section: "chats", label: "My asking phrases", old: ["My request phrases", "Requests"], group: "Phrases", kind: "text" },
  { id: "ack-phrases", section: "chats", label: "My acknowledgements", old: ["Acknowledgements"], group: "Phrases", kind: "text" },
  { id: "promise-phrases", section: "chats", label: "My promise phrases", old: ["Promise phrases"], group: "Phrases", kind: "text" },
  { id: "chats-read", section: "chats", label: "Client chats FocusTime reads", old: ["Client chats read for requests"], kind: "status", keywords: ["polling", "reconnect"] },
  // Accounts and calendars
  { id: "sources", section: "connections", label: "Sources", kind: "status", keywords: ["dataverse", "outlook", "google", "calendar", "connect", "reconnect", "disconnect", "retry"] },
  { id: "calendar-links", section: "connections", label: "Calendars added by link", old: ["Add a calendar by link"], kind: "list", keywords: ["ics", "ical", "webcal", "subscribe", "icloud", "apple", "school", "busy only", "replace link"] },
  { id: "pocket", section: "connections", label: "Pocket recorder", kind: "action", keywords: ["pocket", "recorder", "recording", "api key", "transcript"] },
  { id: "outlook-changes", section: "connections", label: "Outlook calendar changes", kind: "status", keywords: ["calendars.readwrite", "write"] },
  { id: "permissions", section: "connections", label: "Microsoft permissions", kind: "status", keywords: ["consent", "scopes", "chat.read"] },
  { id: "vm", section: "connections", label: "My VM", group: "My VM", kind: "action", keywords: ["azure", "find my vm", "resource id"] },
  { id: "vm-start", section: "connections", label: "Start without a preview", old: ["Start my VM without asking", "Start right away"], group: "My VM", kind: "switch" },
  { id: "vm-autostart", section: "connections", label: "Start my VM before my day", group: "My VM", kind: "switch", keywords: ["auto-start", "auto start", "automatically", "before work"] },
  { id: "teams-app", section: "connections", label: "FocusTime in Teams", kind: "status", keywords: ["bot", "teams"] },
  { id: "feedback", section: "connections", label: "Send feedback", kind: "status" },
  // DevOps
  { id: "devops-read", section: "devops", label: "DevOps per client", old: ["Reading"], kind: "status", keywords: ["live", "cached", "pat problem"] },
  { id: "devops-write", section: "devops", label: "DevOps write access", old: ["Write access"], kind: "action", keywords: ["pat", "personal access token"] },
  { id: "find-item", section: "devops", label: "Find an item", kind: "action", keywords: ["missing item", "why isn't it showing", "not showing", "item number", "scope", "area"] },
  // AI and assistant
  { id: "ai-team", section: "ai", label: "AI for FocusTime", kind: "status", keywords: ["allowed for", "monthly limit", "admin"] },
  { id: "ai-month", section: "ai", label: "This month's AI spend", old: ["This month"], kind: "status", keywords: ["cost", "budget", "cap"] },
  { id: "draft-months", section: "ai", label: "Break down looks back", old: ["Break down looks back (months)"], kind: "number", unit: "months" },
  { id: "ai-test", section: "ai", label: "Test AI", kind: "action" },
  { id: "ai-sent", section: "ai", label: "What is sent to AI", old: ["What is sent"], kind: "status" },
  { id: "ai-log", section: "ai", label: "Last 20 AI requests", old: ["Last 20 requests"], kind: "status" },
  { id: "assistant-history", section: "ai", label: "Assistant history", group: "Assistant", kind: "action", keywords: ["clear", "ask", "voice", "push-to-talk"] },
  // Activity
  { id: "write-log", section: "activity", label: "Outlook write log", old: ["Write log"], kind: "status", keywords: ["undo", "retry", "timebox"] },
  { id: "devops-log", section: "activity", label: "DevOps write log", kind: "status" },
  { id: "azure-log", section: "activity", label: "Azure write log", kind: "status", keywords: ["vm"] },
  { id: "teams-log", section: "activity", label: "Teams status log", kind: "status", keywords: ["presence"] },
  { id: "loop-log", section: "activity", label: "Close the loop sends", kind: "status", keywords: ["promise", "sent", "email", "teams message"] },
  // Your data
  { id: "export", section: "data", label: "Export my data", kind: "action", keywords: ["download", "json"] },
  { id: "reset-plan", section: "data", label: "Reset my plan", kind: "action" },
  { id: "delete", section: "data", label: "Delete my data", kind: "action" },
  { id: "diagnostics", section: "data", label: "Diagnostics", kind: "action", keywords: ["promises check", "chatter"] },
  { id: "demo-mode", section: "data", label: "Show demo data", old: ["Demo mode"], group: "Demo", kind: "switch", devOnly: true },
  { id: "demo-reset", section: "data", label: "Reset demo", old: ["Demo"], group: "Demo", kind: "action", demoOnly: true },
  { id: "demo-be", section: "data", label: "Use the demo as", group: "Demo", kind: "select", demoOnly: true, keywords: ["teammate", "person"] },
  // About
  { id: "version", section: "about", label: "Version", kind: "status" },
  { id: "guide", section: "about", label: "Guide", old: ["Open the Guide"], kind: "action", keywords: ["help"] },
  { id: "style-guide", section: "about", label: "Style guide", old: ["Open the style guide"], kind: "action", keywords: ["tokens"], devOnly: true },
];

/** Section ids before ST-1 that moved: where they open now. */
export const OLD_SECTIONS: Readonly<Record<string, { section: string; setting?: string }>> = {
  standing: { section: "hours", setting: "standing-blocks" },
  risk: { section: "planning", setting: "risk-rules" },
  roadmap: { section: "ahead" },
  setup: { section: "you", setting: "setup" },
  demo: { section: "data", setting: "demo-reset" },
};

export const sectionOf = (id: string): SectionDef | undefined => SECTIONS.find((s) => s.id === id);
export const settingOf = (id: string): SettingDef | undefined => SETTINGS.find((s) => s.id === id);

/** TP-1b: settings taken out of the app (Work templates' read-only view): an old address opens its section's top. */
export const RETIRED_SETTINGS: readonly string[] = ["work-templates"];

/** Where an address's section and setting open: old ids mapped, unknown ones null. */
export function resolveSettings(section: string, setting?: string | null): { section: string; setting: string | null } | null {
  const old = OLD_SECTIONS[section];
  if (old) return { section: old.section, setting: setting ?? old.setting ?? null };
  if (!sectionOf(section)) return null;
  return { section, setting: setting && !RETIRED_SETTINGS.includes(setting) ? setting : null };
}

export type SearchHit = { section: string; setting: string | null; label: string; where: string; matched: string | null };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}%]+/gu, " ").trim();

/**
 * Settings and sections whose label, old label or keywords contain every word typed, best first: a label match before
 * an old label, before a keyword. `matched` names the old label when that is what matched.
 */
export function searchSettings(q: string, opts: { demo?: boolean; dev?: boolean; limit?: number } = {}): SearchHit[] {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  const has = (s: string) => {
    const n = norm(s);
    return words.every((w) => n.includes(w));
  };
  const hits: (SearchHit & { score: number })[] = [];
  const shown = (s: SectionDef | undefined) => !!s && (!s.demoOnly || opts.demo);
  for (const s of SECTIONS) {
    if (!shown(s) || s.parent) continue;
    const old = s.old?.find(has);
    if (has(s.label) || old) hits.push({ section: s.id, setting: null, label: s.label, where: groupLabel(s.group), matched: has(s.label) ? null : old!, score: has(s.label) ? 0 : 1 });
  }
  for (const d of SETTINGS) {
    const s = sectionOf(d.section);
    if (!shown(s) || s!.parent || (d.devOnly && !opts.dev) || (d.demoOnly && !opts.demo)) continue;
    const old = d.old?.find(has);
    const score = has(d.label) ? 0 : old ? 1 : d.keywords?.some(has) || has(`${d.label} ${s!.label} ${(d.keywords ?? []).join(" ")}`) ? 2 : -1;
    if (score < 0) continue;
    hits.push({ section: d.section, setting: d.id, label: d.label, where: whereOf(d), matched: score === 1 ? old! : null, score });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, opts.limit ?? 12).map(({ score: _s, ...h }) => h);
}

/** Where a setting is, as search shows it: its section, and its group when it has one ("Notifications › Quiet hours"). */
export const whereOf = (d: SettingDef) => {
  const s = sectionOf(d.section)!.label;
  return d.group && d.group !== d.label ? `${s} › ${d.group}` : s;
};

export const groupLabel = (g: SettingsGroupId) => SETTINGS_GROUPS.find(([id]) => id === g)![1];

/** The address of a section, or of one setting in it. */
export const settingsHref = (section: string, setting?: string | null) => `#/settings/${section}${setting ? `/${setting}` : ""}`;
