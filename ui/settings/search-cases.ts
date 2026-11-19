// SA-5: the 100 searches a person might type into Settings, with the place each should find first. SA-0 ran 100
// queries (docs/ux/sa0/findings.md part 7) but its list was never committed: this one starts from the 27 that part 7
// names (22 that found nothing, 5 that found the wrong place) and adds what a consultant and an admin would type for
// each section, to 100. ui/settings/search.test.ts runs them; scripts/sa5-searches.ts runs them on any branch.
//
// `expect` is the first result's id (ui/settings/search.ts `SearchResult.id`): "section:<id>", "setting:<id>",
// "client:<setting id>" (a setting on a client's page), "admin:<Admin's hit id>" or "answer:<id>" (something that isn't
// a setting). `also` lists other places that are as right. `admin: true` runs the search as an admin.

export type SearchCase = { q: string; expect: string; also?: readonly string[]; admin?: boolean; from?: "sa0-none" | "sa0-wrong" };

export const SEARCH_CASES: readonly SearchCase[] = [
  // The 22 SA-0 found nothing for.
  { q: "dark mode", expect: "setting:theme", from: "sa0-none" },
  { q: "language", expect: "answer:language", from: "sa0-none" },
  { q: "password", expect: "answer:password", from: "sa0-none" },
  { q: "vacation", expect: "setting:quiet-pto", from: "sa0-none" },
  { q: "weekend", expect: "setting:show-weekend", also: ["setting:week-days"], from: "sa0-none" },
  { q: "privacy", expect: "setting:what-we-keep", from: "sa0-none" },
  { q: "what do you keep", expect: "setting:what-we-keep", from: "sa0-none" },
  { q: "pomodoro", expect: "setting:focus-length", from: "sa0-none" },
  { q: "rename client", expect: "client:client-shown-as", from: "sa0-none" },
  { q: "unfollow", expect: "client:client-followed", from: "sa0-none" },
  { q: "auto shutdown", expect: "answer:vm-shutdown", from: "sa0-none" },
  { q: "gantt", expect: "answer:gantt", from: "sa0-none" },
  { q: "shortcuts", expect: "answer:shortcuts", from: "sa0-none" },
  { q: "keyboard", expect: "answer:shortcuts", from: "sa0-none" },
  { q: "accessibility", expect: "setting:reduce-motion", also: ["section:display"], from: "sa0-none" },
  { q: "contrast", expect: "answer:contrast", from: "sa0-none" },
  { q: "deployment", expect: "client:client-deploy", from: "sa0-none" },
  { q: "data platform", expect: "client:client-platform", from: "sa0-none" },
  { q: "code", expect: "answer:code", from: "sa0-none" },
  { q: "who can read code", expect: "answer:code", from: "sa0-none" },
  { q: "onboarding", expect: "setting:setup", from: "sa0-none" },
  { q: "estimate", expect: "setting:count-unsized", from: "sa0-none" },
  // The 5 SA-0 found the wrong place for.
  { q: "log out", expect: "setting:signed-in", from: "sa0-wrong" },
  { q: "ai", expect: "section:ai", from: "sa0-wrong" },
  { q: "admin", expect: "admin:place:admin", admin: true, from: "sa0-wrong" },
  { q: "audit", expect: "admin:part:audit", admin: true, from: "sa0-wrong" },
  { q: "push", expect: "setting:devices", from: "sa0-wrong" },
  // Profile
  { q: "sign out", expect: "setting:signed-in" },
  { q: "my email", expect: "setting:email" },
  { q: "level", expect: "setting:level" },
  { q: "run setup again", expect: "setting:setup" },
  { q: "profile photo", expect: "setting:photos" },
  // Working hours
  { q: "working hours", expect: "section:hours" },
  { q: "start time", expect: "setting:weekdays" },
  { q: "lunch", expect: "setting:lunch" },
  { q: "time zone", expect: "setting:time-zone" },
  { q: "timezone", expect: "setting:time-zone" },
  { q: "standing block", expect: "setting:standing-blocks" },
  { q: "hours for one day", expect: "setting:one-day-changes" },
  { q: "friday hours", expect: "setting:hours-fri", also: ["setting:weekdays"] },
  // Display
  { q: "theme", expect: "setting:theme" },
  { q: "light mode", expect: "setting:theme" },
  { q: "text size", expect: "setting:text-size" },
  { q: "bigger font", expect: "setting:text-size" },
  { q: "zoom", expect: "setting:text-size" },
  { q: "24 hours", expect: "setting:timelines" },
  { q: "hide personal events", expect: "setting:personal-events" },
  { q: "animation", expect: "setting:reduce-motion" },
  { q: "show friday", expect: "setting:show-friday" },
  // Reminders and notices
  { q: "notifications", expect: "section:notifications" },
  { q: "reminders", expect: "section:notifications" },
  { q: "close out", expect: "setting:notify-closeout" },
  { q: "check-in", expect: "setting:notify-checkin" },
  { q: "holiday", expect: "setting:quiet-pto" },
  { q: "quiet hours", expect: "setting:quiet" },
  { q: "notify this device", expect: "setting:devices" },
  { q: "lock screen", expect: "setting:push-details" },
  { q: "teams messages", expect: "setting:teams-messages" },
  { q: "morning brief", expect: "setting:teams-kind-brief" },
  { q: "status report", expect: "setting:notify-status-report" },
  { q: "meeting warnings", expect: "setting:notify-meeting" },
  { q: "test notification", expect: "setting:test-notification" },
  // Planning
  { q: "unsized", expect: "setting:count-unsized" },
  { q: "timebox", expect: "setting:timeboxing" },
  { q: "put on outlook", expect: "setting:outlook-default" },
  { q: "break down", expect: "setting:break-down-offered" },
  { q: "carry over", expect: "setting:carry-over" },
  { q: "at risk", expect: "setting:risk-rules" },
  { q: "help session", expect: "setting:help-length" },
  { q: "stale", expect: "setting:stale-weeks" },
  // Focus
  { q: "focus timer", expect: "setting:focus-length" },
  { q: "break length", expect: "setting:break-length" },
  { q: "brown noise", expect: "setting:sound" },
  { q: "do not disturb", expect: "setting:teams-status" },
  { q: "spotify", expect: "setting:pause-media", also: ["setting:playlists"] },
  // Clients
  { q: "clients", expect: "section:clients" },
  { q: "client color", expect: "client:client-color" },
  { q: "house style", expect: "client:client-house-style" },
  { q: "asking phrases", expect: "setting:request-phrases" },
  // Connections
  { q: "outlook", expect: "setting:sources" },
  { q: "google calendar", expect: "setting:google" },
  { q: "icloud", expect: "setting:calendar-links" },
  { q: "pat", expect: "setting:devops-write" },
  { q: "personal access token", expect: "setting:devops-write" },
  { q: "pocket", expect: "setting:pocket" },
  { q: "vm", expect: "setting:vm" },
  // AI and assistant
  { q: "assistant", expect: "section:ai" },
  { q: "ai spend", expect: "setting:ai-month" },
  { q: "voice", expect: "setting:assistant-history" },
  // Your data and About
  { q: "export", expect: "setting:export" },
  { q: "delete my data", expect: "setting:delete" },
  { q: "undo a change", expect: "setting:write-log" },
  { q: "version", expect: "setting:version" },
  // As an admin: Admin's parts, tabs and settings, under the person's own when both fit as well.
  { q: "model", expect: "admin:setting:org/ai.model", admin: true },
  // SA-5 D: the person's own line is called Allow AI too now (one name); it comes first, Admin's right after it.
  { q: "allow ai", expect: "admin:setting:client/allow_ai", also: ["setting:ai-allowed", "client:client-ai"], admin: true },
  { q: "who's set up", expect: "admin:tab:people/setup", admin: true },
  { q: "standards", expect: "admin:tab:defaults/standards", admin: true },
  { q: "positions to levels", expect: "admin:setting:org/org.position_levels", admin: true },
  { q: "code views", expect: "admin:tab:audit/code", admin: true },
  { q: "health", expect: "admin:part:health", admin: true },
];
