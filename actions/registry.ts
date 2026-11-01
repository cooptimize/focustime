// Every named action, in one list (step 6, D101). The dispatcher accepts exactly these names (checked at compile
// time by an exhaustive switch), and the command menu is built from this list, so a new action shows up in
// both. This is also the allowlist the chat panel will use later. Pure data, no imports with side effects.

/** What an action works on, so the command menu knows what to ask for. */
export type ActionTarget =
  | "none" // runs as is
  | "day" // a date (the selected or planned day)
  | "plan" // the day being planned
  | "pick" // one pick
  | "item" // one DevOps work item of a client
  | "portfolio" // an epic or feature with no children yet
  | "calendar" // Outlook or Google
  | "theme" // one of the themes
  | "range" // one of the view ranges
  | "unavailable" // one unavailable time
  | "flex" // one flex session
  | "loop" // one loop
  | "borrowed" // one borrowed time record
  | "feature" // a feature on Plan the week
  | "week" // a week (its Monday)
  | "capture" // one capture in the inbox
  | "note"; // one note

export type ActionSpec = {
  readonly name: string;
  /** Plain words for the command menu. */
  readonly title: string;
  readonly group: "Week" | "Plan the week" | "Plan the day" | "Close out" | "Picks" | "Work items" | "Sources" | "Display" | "Time" | "Settings" | "Focus" | "Loops" | "Capture";
  readonly target: ActionTarget;
  /** The key that does the same in the window, if any. */
  readonly shortcut?: string;
  readonly summary: string;
};

export const ACTIONS = [
  { name: "week.load", title: "Refresh all sources", group: "Week", target: "none", shortcut: "R", summary: "Reload focus blocks, PTO, calendars and DevOps" },
  { name: "source.status", title: "Show source status", group: "Sources", target: "none", summary: "Each source's state in one line" },
  { name: "auth.connect_microsoft", title: "Connect Outlook", group: "Sources", target: "none", summary: "Sign in to Microsoft in your browser (read-only calendar)" },
  { name: "auth.connect_google", title: "Connect Google Calendar", group: "Sources", target: "none", summary: "Sign in to Google in your browser (read-only calendar)" },
  { name: "auth.disconnect", title: "Disconnect a calendar", group: "Sources", target: "calendar", summary: "Forget a calendar sign-in and its cached events" },
  { name: "weekplan.load", title: "Plan the week", group: "Plan the week", target: "week", shortcut: "W", summary: "Each client's week: musts and nice to haves from DevOps (next week by default); a past week is a review" },
  { name: "weekplan.set_feature", title: "Commit a feature to the week", group: "Plan the week", target: "feature", summary: "Give a feature a number of your blocks; 0 takes it off" },
  { name: "weekplan.place", title: "Pin to a block", group: "Plan the week", target: "feature", summary: "Pin a week item to one of its client's blocks or an Open half-day (optional, for dependencies)" },
  { name: "weekplan.add", title: "Add to the week", group: "Plan the week", target: "feature", summary: "Put a DevOps feature or story on its client's week as a must or a nice to have" },
  { name: "weekplan.set_tier", title: "Make it a must or nice to have", group: "Plan the week", target: "feature", summary: "Move a week item between Must and Nice to have; no reason needed" },
  { name: "weekplan.set_blocks", title: "Set blocks", group: "Plan the week", target: "feature", summary: "How many of the client's blocks a week item needs, in half steps" },
  { name: "weekplan.reorder", title: "Reorder the week list", group: "Plan the week", target: "feature", summary: "Change the local order of a client's musts or nice to haves, or go back to DevOps order (never written to DevOps)" },
  { name: "weekplan.remove", title: "Take off the week", group: "Plan the week", target: "feature", summary: "Take an item off its client's week list" },
  { name: "weekplan.mark_done", title: "Mark done for the week", group: "Plan the week", target: "feature", summary: "Count a week item as done here (DevOps state counts too)" },
  { name: "weekplan.headsup", title: "Heads-up: a must moves out", group: "Plan the week", target: "feature", summary: "Open a heads-up loop for a must dropped from a committed week" },
  { name: "weekplan.commit", title: "Commit the week", group: "Plan the week", target: "week", summary: "Commit the week's features; it stays editable and can be committed again" },
  { name: "feature.brief", title: "Copy Coop brief", group: "Plan the week", target: "feature", summary: "Markdown for Coop to propose user stories: DevOps fields only" },
  { name: "feature.mark_breakdown", title: "Mark as being broken down", group: "Plan the week", target: "feature", summary: "Local note that a feature is with Coop or the team for stories" },
  { name: "loop.ask_priorities", title: "Create loop: ask about priorities", group: "Plan the week", target: "week", summary: "For a client block next week with no open work assigned to you" },
  { name: "planday.start", title: "Plan the day", group: "Plan the day", target: "day", shortcut: "P", summary: "Turn a day's free time into committed picks (I also works)" },
  { name: "planday.commit", title: "Commit the plan", group: "Plan the day", target: "plan", shortcut: "C", summary: "Commit the day being planned" },
  { name: "closeout.load", title: "Close out", group: "Close out", target: "day", shortcut: "E", summary: "End of day: picks done or not, resume notes, loops (about 3 minutes)" },
  { name: "closeout.commit", title: "Commit Close out", group: "Close out", target: "day", summary: "Mark the day closed out; it can also be done later for a past day" },
  { name: "pick.make_up", title: "I'll make it up", group: "Picks", target: "pick", summary: "Move a pick to tonight, Friday or another day and record the borrowed time" },
  { name: "note.set", title: "Write a resume note", group: "Close out", target: "none", summary: "Where you left off with a client; shown on its next block and in Plan the day" },
  { name: "borrow.pay", title: "Mark borrowed time paid", group: "Close out", target: "borrowed", summary: "By hand; done payback picks mark it paid on their own" },
  { name: "pick.add", title: "Add to the plan", group: "Picks", target: "item", summary: "Pick a work item for a half-day" },
  { name: "pick.set_size", title: "Set size", group: "Picks", target: "pick", summary: "S about 1 h, M about 2 h, L a whole block" },
  { name: "pick.move", title: "Move pick", group: "Picks", target: "pick", summary: "To AM, PM, another day or Friday" },
  { name: "pick.mark_done", title: "Mark done or not done", group: "Picks", target: "pick", summary: "Tick a pick (local only)" },
  { name: "pick.remove", title: "Drop pick", group: "Picks", target: "pick", summary: "Remove a pick from the plan" },
  { name: "draft.add_story", title: "Add a draft story", group: "Work items", target: "portfolio", summary: "A local story under an epic or feature, or under none yet" },
  { name: "ui.set_theme", title: "Change theme", group: "Display", target: "theme", summary: "Cooptimize Dark, Cooptimize Light or Neutral; saved in config" },
  { name: "ui.set_view_range", title: "Change view range", group: "Display", target: "range", shortcut: "H", summary: "Business hours, 12 hours or 24 hours; saved in config" },
  { name: "hours.set_day", title: "Set working hours for a day", group: "Time", target: "day", summary: "Other hours for one day, a split day or a lunch change" },
  { name: "hours.clear_day", title: "Use usual hours for a day", group: "Time", target: "day", summary: "Remove a day's own working hours" },
  { name: "unavailable.add", title: "Block time as unavailable", group: "Time", target: "day", summary: "Time taken from capacity like a meeting (local only)" },
  { name: "unavailable.remove", title: "Remove unavailable time", group: "Time", target: "unavailable", summary: "Give the time back" },
  { name: "flex.add", title: "Add a flex session", group: "Time", target: "day", summary: "Planned client work outside working hours (local only, no calendar write)" },
  { name: "flex.remove", title: "Remove a flex session", group: "Time", target: "flex", summary: "Only before it has ended" },
  { name: "settings.load", title: "Open Settings", group: "Settings", target: "none", shortcut: ",", summary: "Working hours, clients, connections, display and data" },
  { name: "settings.save", title: "Change a setting", group: "Settings", target: "none", summary: "Saved to the config file with a backup; applies at once" },
  { name: "secret.set", title: "Set a client secret", group: "Settings", target: "none", summary: "Masked entry straight to the keyring; never shown again" },
  { name: "plan.reset", title: "Reset local plan", group: "Settings", target: "none", summary: "Empties picks, drafts, time entries and loops after a backup; asks you to confirm" },
  { name: "timer.start", title: "Start focus timer", group: "Focus", target: "none", shortcut: "F", summary: "A plain timer, a break, or a pick from its ⋯ menu; lengths in 5-minute steps" },
  { name: "timer.pause", title: "Pause the timer", group: "Focus", target: "none", summary: "Focused time so far is kept" },
  { name: "timer.resume", title: "Resume the timer", group: "Focus", target: "none", summary: "Carry on from where it paused" },
  { name: "timer.stop", title: "Stop the timer", group: "Focus", target: "none", summary: "End the session without ticking the pick" },
  { name: "timer.extend", title: "Add 15 minutes", group: "Focus", target: "none", summary: "Keep going; after the end it runs again from now" },
  { name: "timer.done", title: "Done with this session", group: "Focus", target: "none", summary: "End the session and tick its pick done" },
  { name: "timer.next", title: "Next pick", group: "Focus", target: "none", summary: "End the session and timebox today's next planned pick" },
  { name: "playlist.open", title: "Open a focus playlist", group: "Focus", target: "none", summary: "One of your saved Spotify or YouTube playlists (Settings > Focus)" },
  { name: "media.status", title: "Check media control", group: "Focus", target: "none", summary: "Whether playerctl (pause and resume music) and the Spotify app are on this computer; read-only" },
  { name: "capture.add", title: "Quick capture", group: "Capture", target: "none", shortcut: "N", summary: "One line, saved at once (works offline); sort it into a loop, a draft story or a note" },
  { name: "capture.load", title: "Show captures and notes", group: "Capture", target: "none", summary: "The inbox of captures to sort, and notes per client (searchable)" },
  { name: "capture.route", title: "Sort a capture", group: "Capture", target: "capture", summary: "Make it a loop, a draft story or a note, or dismiss it (rules suggest one)" },
  { name: "capture.features", title: "List a client's features", group: "Capture", target: "none", summary: "Open features to put a draft story under (read-only DevOps)" },
  { name: "note.delete", title: "Delete a note", group: "Capture", target: "note", summary: "Remove one note (local only)" },
  { name: "loops.list", title: "Show loops", group: "Loops", target: "none", shortcut: "L", summary: "What you owe people: open loops, closed ones on request" },
  { name: "loop.add", title: "Add a loop", group: "Loops", target: "none", summary: "Something you owe someone: who, what, optional due date" },
  { name: "loop.close", title: "Close a loop", group: "Loops", target: "loop", summary: "Mark as told, with an optional note" },
  { name: "data.export", title: "Export the plan", group: "Settings", target: "none", summary: "Picks, drafts and time entries as JSON in ~/.local/share/coopilot/exports" },
  { name: "link.open", title: "Open in Edge", group: "Work items", target: "item", summary: "Open a work item in that client's Edge profile" },
] as const satisfies readonly ActionSpec[];

export type ActionName = (typeof ACTIONS)[number]["name"];
export const ACTION_NAMES: readonly ActionName[] = ACTIONS.map((a) => a.name);
export const isActionName = (a: unknown): a is ActionName => typeof a === "string" && (ACTION_NAMES as readonly string[]).includes(a);
export const actionSpec = (name: ActionName): ActionSpec => ACTIONS.find((a) => a.name === name)!;
