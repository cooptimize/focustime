// ST-1: the one list of Settings' sections and settings. The rail, search, deep links (#/settings/<section>[/<setting>]),
// the command menu and the Guide read it; every setting in it renders with data-setting="<id>" in its section, and
// e2e/settings-shell.test.ts checks each one is there. Adding a setting: docs/settings.md.
//
// Old section ids (before ST-1) still open: they map to their new section and, where it moved inside one, the setting.

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
  { id: "planning", label: "Today and Week", group: "planning", description: "How to-dos, rituals, timeboxes, help sessions and risk work when you plan.", old: ["Planning", "Risk rules"] },
  { id: "focus", label: "Focus", group: "planning", description: "The focus timer, your Teams status while you focus, sounds and music." },
  { id: "ahead", label: "Ahead", group: "planning", description: "When Backlog calls an item stale, and when a feature reads Stalled or Watch.", old: ["Roadmap"] },
  { id: "clients", label: "Clients", group: "clients", description: "The clients FocusTime follows for you, and how each one shows." },
  { id: "client", label: "Client", group: "clients", description: "How this client shows for you, and what comes from Dataverse and your admin.", parent: "clients" },
  { id: "chats", label: "Client chats", group: "clients", description: "Your phrases for requests and promises, and how each client chat is read.", old: ["Requests", "Asks"] },
  { id: "connections", label: "Accounts and calendars", group: "connections", description: "Your sources, Microsoft permissions, your VM, Teams and Send feedback.", old: ["Connections", "My VM"] },
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
};

// One row per setting or status a person looks for. `id` is unique across Settings (it is the deep link's last part).
export const SETTINGS: readonly SettingDef[] = [
  // Profile
  { id: "signed-in", section: "you", label: "Signed in", keywords: ["sign out", "sign in", "account", "microsoft"] },
  { id: "photos", section: "you", label: "Photos", keywords: ["profile photo"] },
  { id: "email", section: "you", label: "Email", old: ["Email when signed out"] },
  { id: "dataverse-user", section: "you", label: "Dataverse user" },
  { id: "environment", section: "you", label: "Dataverse environment", old: ["Environment"] },
  { id: "setup", section: "you", label: "Run setup again", old: ["Setup", "Finish setup", "Start over"], keywords: ["first run"] },
  // Working hours
  { id: "weekdays", section: "hours", label: "Hours per day", old: ["Working hours", "Day shape"], keywords: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "evening"] },
  { id: "lunch", section: "hours", label: "Lunch" },
  { id: "time-zone", section: "hours", label: "Time zone", keywords: ["zone", "timezone"] },
  { id: "one-day-changes", section: "hours", label: "One-day changes", keywords: ["override", "usual hours"] },
  { id: "standing-blocks", section: "hours", label: "Standing blocks", keywords: ["internal", "focus block"] },
  // Notifications
  { id: "kinds", section: "notifications", label: "What to notify me about", keywords: ["reminders", "ritual", "timer", "meeting", "follow-ups", "promises", "expiry", "vm"] },
  { id: "status-report-times", section: "notifications", label: "Status report times", keywords: ["friday", "sunday", "monday report"] },
  { id: "urgent-during-focus", section: "notifications", label: "Urgent requests during focus", old: ["Let urgent asks through"] },
  { id: "quiet", section: "notifications", label: "Quiet hours", keywords: ["outside working hours", "never quiet"] },
  { id: "quiet-pto", section: "notifications", label: "Quiet on PTO days", old: ["Days off"] },
  { id: "test-notification", section: "notifications", label: "Send a test notification" },
  { id: "devices", section: "notifications", label: "Notify this device", keywords: ["push", "phone", "iphone", "devices"] },
  { id: "push-details", section: "notifications", label: "Show details in notifications", keywords: ["lock screen"] },
  { id: "teams-messages", section: "notifications", label: "Let FocusTime message me in Teams", old: ["Messages in Teams"], keywords: ["bot", "teams"] },
  { id: "teams-kinds", section: "notifications", label: "What FocusTime sends in Teams", keywords: ["morning brief", "midday check-in", "close out", "nudges", "friday"] },
  // Display
  { id: "theme", section: "display", label: "Theme", keywords: ["dark", "light", "neutral"] },
  { id: "text-size", section: "display", label: "Text size", keywords: ["font", "larger", "zoom"] },
  { id: "timelines", section: "display", label: "Timelines", keywords: ["business hours", "12 hours", "24 hours", "view range"] },
  { id: "personal-events", section: "display", label: "Show personal events", old: ["Personal events"], keywords: ["google"] },
  { id: "reduce-motion", section: "display", label: "Reduce motion", old: ["Motion"], keywords: ["animation", "lumen"] },
  // Today and Week
  { id: "level", section: "planning", label: "Your level", keywords: ["guidance", "consultant", "senior", "lead"] },
  { id: "plan-share", section: "planning", label: "Plan up to (% of free time)", old: ["Plan up to"], keywords: ["over line", "guidance"] },
  { id: "break-down-offered", section: "planning", label: "Offer Break down", old: ["Break down", "Draft stories"] },
  { id: "readiness-nudges", section: "planning", label: "Readiness nudges", keywords: ["flags"] },
  { id: "shortest-useful-time", section: "planning", label: "Shortest useful time per size", old: ["Shortest useful time, S", "Shortest useful time, M", "Shortest useful time, L"], keywords: ["timebox my day", "minimum"] },
  { id: "carry-over", section: "planning", label: "Carry-over (days back)", old: ["Carry-over"], keywords: ["unfinished"] },
  { id: "plan-reminder", section: "planning", label: "Plan today reminder", old: ["Reminder"], keywords: ["minutes after the day starts"] },
  { id: "devops-on-done", section: "planning", label: "When I check off a to-do", keywords: ["devops update", "mark done", "ask to update devops"] },
  { id: "checkin-reminder", section: "planning", label: "Midday check-in reminder", old: ["Check-in reminder"] },
  { id: "closeout-reminder", section: "planning", label: "Close out reminder" },
  { id: "week-nudges", section: "planning", label: "Plan the week nudges", old: ["Thursday nudge", "Friday nudge", "Monday nudge"] },
  { id: "rituals", section: "planning", label: "Plan ahead rituals", old: ["Look ahead 4 weeks", "Direction review"] },
  { id: "timeboxing", section: "planning", label: "Use timeboxing", old: ["Timeboxes"] },
  { id: "outlook-default", section: "planning", label: "Put timeboxes on Outlook", old: ["Put on Outlook"] },
  { id: "confirm-own", section: "planning", label: "Ask before changing my own timebox events", old: ["Changes to my own timebox events", "Don't ask again for my own timeboxes"] },
  { id: "help-length", section: "planning", label: "Help session length", old: ["Default length", "Help sessions"], keywords: ["ask to collaborate", "needs help from"] },
  { id: "help-teams", section: "planning", label: "Teams meeting for help sessions", old: ["Teams meeting"] },
  { id: "help-days", section: "planning", label: "Days to search for help", old: ["Days to search"] },
  { id: "never-suggested", section: "planning", label: "Never suggested, for everyone" },
  { id: "exclude", section: "planning", label: "People I exclude", old: ["People to exclude"], keywords: ["helpers", "who"] },
  { id: "invite-domains", section: "planning", label: "Invites go only to", keywords: ["domains"] },
  { id: "risk-rules", section: "planning", label: "At-risk blocks", old: ["Risk rules", "Watch at", "At risk at", "Shortest useful focus window"], keywords: ["meetings", "risk"] },
  // Focus
  { id: "focus-length", section: "focus", label: "Focus length", keywords: ["timer", "minutes"] },
  { id: "break-length", section: "focus", label: "Break length" },
  { id: "end-sound", section: "focus", label: "End sound", keywords: ["play a sound"] },
  { id: "teams-status", section: "focus", label: "Set Teams status during focus", old: ["Teams status"], keywords: ["busy", "do not disturb", "presence"] },
  { id: "plain-focus-status", section: "focus", label: "Plain focus sets", keywords: ["busy"] },
  { id: "sound", section: "focus", label: "Default sound", keywords: ["brown", "pink", "rain", "binaural", "noise"] },
  { id: "volume", section: "focus", label: "Volume" },
  { id: "fade", section: "focus", label: "Fade in and out", old: ["Fade"] },
  { id: "on-break", section: "focus", label: "When a break starts", keywords: ["chime", "silence"] },
  { id: "pause-media", section: "focus", label: "Pause and resume music", old: ["Pause music"], keywords: ["spotify", "player"] },
  { id: "playlists", section: "focus", label: "Playlists", keywords: ["spotify", "youtube", "music"] },
  // Ahead
  { id: "stale-weeks", section: "ahead", label: "Stale after (weeks)", old: ["Stale after"], keywords: ["backlog"] },
  { id: "stalled-days", section: "ahead", label: "Stalled after (days)", old: ["Stalled after"], keywords: ["roadmap"] },
  { id: "watch-weeks", section: "ahead", label: "Watch within (weeks)", old: ["Watch within"], keywords: ["forecast"] },
  // Clients
  { id: "follow-grace", section: "clients", label: "Keep following after focus time ends", old: ["Keep following", "Clients followed"], keywords: ["grace days"] },
  { id: "client-list", section: "clients", label: "Your clients", keywords: ["color", "shown as", "name", "keep following", "house style", "delivery chats"] },
  // Client chats
  { id: "request-phrases", section: "chats", label: "My request phrases", old: ["Request phrases", "Requests"] },
  { id: "ack-phrases", section: "chats", label: "My acknowledgements", old: ["Acknowledgements"] },
  { id: "promise-phrases", section: "chats", label: "My promise phrases", old: ["Promise phrases"] },
  { id: "team-phrases", section: "chats", label: "Team phrases" },
  { id: "chats-read", section: "chats", label: "Client chats read for requests", keywords: ["polling", "reconnect", "delivery chats"] },
  // Accounts and calendars
  { id: "sources", section: "connections", label: "Sources", keywords: ["dataverse", "outlook", "google", "calendar", "connect", "reconnect", "disconnect", "retry"] },
  { id: "outlook-changes", section: "connections", label: "Outlook calendar changes", keywords: ["calendars.readwrite", "write"] },
  { id: "permissions", section: "connections", label: "Microsoft permissions", keywords: ["consent", "scopes", "chat.read"] },
  { id: "vm", section: "connections", label: "My VM", keywords: ["azure", "find my vm", "resource id"] },
  { id: "vm-start", section: "connections", label: "Start my VM without asking" },
  { id: "teams-app", section: "connections", label: "FocusTime in Teams", keywords: ["bot", "teams"] },
  { id: "feedback", section: "connections", label: "Send feedback" },
  // DevOps
  { id: "devops-read", section: "devops", label: "DevOps per client", keywords: ["live", "cached", "pat problem"] },
  { id: "devops-write", section: "devops", label: "DevOps write access", old: ["Enable DevOps writes", "Write access"], keywords: ["pat", "personal access token"] },
  // AI and assistant
  { id: "ai-team", section: "ai", label: "AI for FocusTime", keywords: ["allowed for", "monthly limit", "admin"] },
  { id: "ai-month", section: "ai", label: "This month's AI spend", keywords: ["cost", "budget", "cap"] },
  { id: "draft-months", section: "ai", label: "Break down looks back (months)", old: ["Break down looks back"] },
  { id: "ai-test", section: "ai", label: "Test AI" },
  { id: "ai-sent", section: "ai", label: "What is sent to AI", old: ["What is sent"] },
  { id: "ai-log", section: "ai", label: "Last 20 AI requests", old: ["Last 20 requests"] },
  { id: "assistant-history", section: "ai", label: "Assistant history", keywords: ["clear", "ask", "voice", "push-to-talk"] },
  // Activity
  { id: "write-log", section: "activity", label: "Outlook write log", old: ["Write log"], keywords: ["undo", "retry", "timebox"] },
  { id: "devops-log", section: "activity", label: "DevOps write log" },
  { id: "azure-log", section: "activity", label: "Azure write log", keywords: ["vm"] },
  { id: "teams-log", section: "activity", label: "Teams status log", keywords: ["presence"] },
  // Your data
  { id: "export", section: "data", label: "Export my data", keywords: ["download", "json"] },
  { id: "reset-plan", section: "data", label: "Reset my plan" },
  { id: "delete", section: "data", label: "Delete my data" },
  { id: "diagnostics", section: "data", label: "Diagnostics", keywords: ["promises check", "chatter"] },
  { id: "demo-mode", section: "data", label: "Show demo data", old: ["Demo mode"], devOnly: true },
  { id: "demo-reset", section: "data", label: "Reset demo", old: ["Demo"], demoOnly: true },
  // About
  { id: "version", section: "about", label: "Version" },
  { id: "guide", section: "about", label: "Open the Guide", keywords: ["help"] },
  { id: "style-guide", section: "about", label: "Style guide", keywords: ["tokens"], devOnly: true },
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

/** Where an address's section and setting open: old ids mapped, unknown ones null. */
export function resolveSettings(section: string, setting?: string | null): { section: string; setting: string | null } | null {
  const old = OLD_SECTIONS[section];
  if (old) return { section: old.section, setting: setting ?? old.setting ?? null };
  if (!sectionOf(section)) return null;
  return { section, setting: setting ?? null };
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
    if (!shown(s) || (d.devOnly && !opts.dev) || (d.demoOnly && !opts.demo)) continue;
    const old = d.old?.find(has);
    const score = has(d.label) ? 0 : old ? 1 : d.keywords?.some(has) || has(`${d.label} ${s!.label} ${(d.keywords ?? []).join(" ")}`) ? 2 : -1;
    if (score < 0) continue;
    hits.push({ section: d.section, setting: d.id, label: d.label, where: s!.label, matched: score === 1 ? old! : null, score });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, opts.limit ?? 12).map(({ score: _s, ...h }) => h);
}

export const groupLabel = (g: SettingsGroupId) => SETTINGS_GROUPS.find(([id]) => id === g)![1];

/** The address of a section, or of one setting in it. */
export const settingsHref = (section: string, setting?: string | null) => `#/settings/${section}${setting ? `/${setting}` : ""}`;
