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
  | "follow_up" // one follow-up
  | "borrowed" // one borrowed time record
  | "feature" // a feature on Plan the week
  | "week" // a week (its Monday)
  | "capture" // one capture in the inbox
  | "note" // one resume note ("where I left off")
  | "timebox" // one timebox
  | "write" // one entry in the write log
  | "event" // one calendar event (step 13)
  | "devops"; // a DevOps change (step 14)

export type ActionSpec = {
  readonly name: string;
  /** Plain words for the command menu. */
  readonly title: string;
  readonly group: "Week" | "Plan the week" | "Plan the day" | "Close out" | "Picks" | "Work items" | "Sources" | "Display" | "Time" | "Settings" | "Focus" | "Follow-ups" | "Capture" | "Timebox" | "Calendar" | "Help" | "DevOps";
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
  { name: "delivery.load", title: "Delivery", group: "Work items", target: "none", shortcut: "5", summary: "Features and epics you own: stories done and open, who's on them, and whether they're on track for the target date" },
  { name: "weekplan.load", title: "Plan the week", group: "Plan the week", target: "week", shortcut: "W", summary: "Each client's week: musts and nice to haves from DevOps (next week by default); a past week is a review" },
  { name: "weekplan.set_feature", title: "Commit a feature to the week", group: "Plan the week", target: "feature", summary: "Give a feature a number of your blocks; 0 takes it off" },
  { name: "weekplan.place", title: "Pin to a block", group: "Plan the week", target: "feature", summary: "Pin a week item to one of its client's blocks or an Open half-day (optional, for dependencies)" },
  { name: "weekplan.add", title: "Add to the week", group: "Plan the week", target: "feature", summary: "Put a DevOps feature or story on its client's week as a must or a nice to have" },
  { name: "weekplan.set_tier", title: "Make it a must or nice to have", group: "Plan the week", target: "feature", summary: "Move a week item between Must and Nice to have; no reason needed" },
  { name: "weekplan.set_blocks", title: "Set blocks", group: "Plan the week", target: "feature", summary: "How many of the client's blocks a week item needs, in half steps" },
  { name: "weekplan.reorder", title: "Reorder the week list", group: "Plan the week", target: "feature", summary: "Change the local order of a client's musts or nice to haves, or go back to DevOps order (never written to DevOps)" },
  { name: "weekplan.remove", title: "Take off the week", group: "Plan the week", target: "feature", summary: "Take an item off its client's week list" },
  { name: "weekplan.mark_done", title: "Mark done for the week", group: "Plan the week", target: "feature", summary: "Count a week item as done here (DevOps state counts too)" },
  { name: "weekplan.headsup", title: "Heads-up: a must moves out", group: "Plan the week", target: "feature", summary: "Open a heads-up follow-up for a must dropped from a committed week" },
  { name: "weekplan.commit", title: "Commit the week", group: "Plan the week", target: "week", summary: "Commit the week's features; it stays editable and can be committed again" },
  { name: "feature.brief", title: "Copy Coop brief", group: "Plan the week", target: "feature", summary: "Markdown for Coop to propose user stories: DevOps fields only" },
  { name: "feature.mark_breakdown", title: "Mark as being broken down", group: "Plan the week", target: "feature", summary: "Local note that a feature is with Coop or the team for stories" },
  { name: "followup.ask_priorities", title: "Create follow-up: ask about priorities", group: "Plan the week", target: "week", summary: "For a client block next week with no open work assigned to you" },
  { name: "planday.start", title: "Plan the day", group: "Plan the day", target: "day", shortcut: "P", summary: "Turn a day's free time into committed picks (I also works)" },
  { name: "planday.commit", title: "Commit the plan", group: "Plan the day", target: "plan", shortcut: "C", summary: "Commit the day being planned" },
  { name: "closeout.load", title: "Close out", group: "Close out", target: "day", shortcut: "E", summary: "End of day: picks done or not, resume notes, follow-ups (about 3 minutes)" },
  { name: "closeout.commit", title: "Finish Close out", group: "Close out", target: "day", summary: "Mark the day closed out; it can also be done later for a past day" },
  { name: "pick.make_up", title: "I'll make it up", group: "Picks", target: "pick", summary: "Move a pick to tonight, Friday or another day and record the borrowed time" },
  { name: "note.set", title: "Write a resume note", group: "Close out", target: "none", summary: "Where you left off with a client; shown on its next block and in Plan the day" },
  { name: "borrow.pay", title: "Mark borrowed time paid", group: "Close out", target: "borrowed", summary: "By hand; done payback picks mark it paid on their own" },
  { name: "pick.add", title: "Add to the plan", group: "Picks", target: "item", summary: "Pick a work item for a half-day" },
  { name: "pick.set_size", title: "Set size", group: "Picks", target: "pick", summary: "S about 1 h, M about 2 h, L a whole block" },
  { name: "pick.move", title: "Move pick", group: "Picks", target: "pick", summary: "To AM, PM, another day or Friday" },
  { name: "pick.mark_done", title: "Mark done or not done", group: "Picks", target: "pick", summary: "Tick a pick (local only)" },
  { name: "pick.remove", title: "Drop pick", group: "Picks", target: "pick", summary: "Remove a pick from the plan" },
  { name: "draft.add_feature", title: "Draft a feature", group: "Work items", target: "portfolio", summary: "A local feature under an epic (Plan the week), to add in DevOps" },
  { name: "draft.set_parent", title: "Choose a parent for a draft", group: "Work items", target: "portfolio", summary: "Put a draft under an open feature (or a draft feature under an epic) before creating it in DevOps" },
  { name: "draft.remove", title: "Delete a draft", group: "Work items", target: "portfolio", summary: "Delete a local draft no pick uses; DevOps isn't touched" },
  { name: "draft.update", title: "Edit a draft", group: "Work items", target: "portfolio", summary: "Title, description, acceptance criteria, client, parent, size or dates of a local draft; saved locally" },
  { name: "draft.add_story", title: "Add a draft story", group: "Work items", target: "portfolio", summary: "A local story under an epic or feature, or under none yet" },
  { name: "ui.set_theme", title: "Change theme", group: "Display", target: "theme", summary: "Cooptimize Dark, Cooptimize Light or Neutral; saved in config" },
  { name: "demo.set", title: "Demo mode", group: "Display", target: "none", summary: "Swap every source for fictional sample data to demo safely; nothing leaves Coopilot and your plan isn't touched" },
  { name: "ui.set_timelines", title: "Show timelines on cards", group: "Display", target: "none", shortcut: "V", summary: "A narrow time ruler on each card at medium widths; V switches it for now, this saves the default" },
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
  { name: "plan.reset", title: "Reset local plan", group: "Settings", target: "none", summary: "Empties picks, drafts, time entries and follow-ups after a backup; asks you to confirm" },
  { name: "timer.start", title: "Start focus timer", group: "Focus", target: "none", shortcut: "F", summary: "A plain timer, a break, or a pick from its ⋯ menu; lengths in 5-minute steps" },
  { name: "timer.pause", title: "Pause the timer", group: "Focus", target: "none", summary: "Focused time so far is kept" },
  { name: "timer.resume", title: "Resume the timer", group: "Focus", target: "none", summary: "Carry on from where it paused" },
  { name: "timer.stop", title: "Stop the timer", group: "Focus", target: "none", summary: "End the session without ticking the pick" },
  { name: "timer.extend", title: "Add 15 minutes", group: "Focus", target: "none", summary: "Keep going; after the end it runs again from now" },
  { name: "timer.done", title: "Done with this session", group: "Focus", target: "none", summary: "End the session and tick its pick done" },
  { name: "timer.next", title: "Next pick", group: "Focus", target: "none", summary: "End the session and timebox today's next planned pick" },
  { name: "playlist.open", title: "Open a focus playlist", group: "Focus", target: "none", summary: "One of your saved Spotify or YouTube playlists (Settings > Focus)" },
  { name: "media.status", title: "Check media control", group: "Focus", target: "none", summary: "Whether playerctl (pause and resume music) and the Spotify app are on this computer; read-only" },
  { name: "capture.add", title: "Quick capture", group: "Capture", target: "none", shortcut: "N", summary: "One line, saved at once (works offline); sort it into a follow-up, a draft story or a draft feature" },
  { name: "capture.load", title: "Show captures", group: "Capture", target: "none", summary: "The inbox of captures to sort into follow-ups, draft stories and draft features" },
  { name: "capture.route", title: "Sort a capture", group: "Capture", target: "capture", summary: "Make it a follow-up, a draft story or a draft feature, or dismiss it (rules suggest one)" },
  { name: "capture.features", title: "List a client's features and epics", group: "Capture", target: "none", summary: "Open features for a draft story, open epics for a draft feature (read-only DevOps)" },
  { name: "followups.list", title: "Show follow-ups", group: "Follow-ups", target: "none", shortcut: "L", summary: "What you owe people: overdue and due soon first; closed ones on request" },
  { name: "followup.add", title: "Add a follow-up", group: "Follow-ups", target: "none", summary: "Something you owe someone: client, who, what, channel, optional due date" },
  { name: "followup.edit", title: "Edit a follow-up", group: "Follow-ups", target: "follow_up", summary: "Change its client, who, what, channel or due date" },
  { name: "followup.close", title: "Close the loop", group: "Follow-ups", target: "follow_up", summary: "Done: say how (Teams, email, DevOps, call) and add a note if you like" },
  { name: "followup.not_needed", title: "Not needed", group: "Follow-ups", target: "follow_up", summary: "Close it quietly; recorded as not needed, not counted as done" },
  { name: "followup.snooze", title: "Snooze a follow-up", group: "Follow-ups", target: "follow_up", summary: "Hide it until a day you choose" },
  { name: "followup.delete", title: "Delete a follow-up", group: "Follow-ups", target: "follow_up", summary: "Only for ones you added; Coopilot's own use Not needed" },
  { name: "followup.people", title: "Suggest who", group: "Follow-ups", target: "none", summary: "Cooptimizers, then people from your meetings with that client (read-only)" },
  { name: "followups.review", title: "Review heads-ups", group: "Follow-ups", target: "none", summary: "Open heads-ups the new rule wouldn't open; nothing is closed for you" },
  { name: "data.export", title: "Export the plan", group: "Settings", target: "none", summary: "Picks, drafts and time entries as JSON in ~/.local/share/coopilot/exports" },
  { name: "auth.connect_outlook_write", title: "Reconnect Outlook with calendar changes", group: "Sources", target: "none", summary: "Sign in again and allow Coopilot to create and change its own Outlook events (timeboxes)" },
  { name: "timebox.add", title: "Timebox…", group: "Timebox", target: "pick", summary: "Give a pick or item a start and length on the day's timeline (local; Outlook optional)" },
  { name: "timebox.add_many", title: "Timebox my day", group: "Timebox", target: "day", summary: "Place every planned pick without a timebox into its block's free gaps, after showing the resulting agenda" },
  { name: "timebox.update", title: "Move or resize a timebox", group: "Timebox", target: "timebox", summary: "New start or end; its Outlook event follows after a preview" },
  { name: "timebox.remove", title: "Remove a timebox", group: "Timebox", target: "timebox", summary: "Take it off the timeline; its Outlook event is removed after a preview" },
  { name: "timebox.set_outlook", title: "Put a timebox on Outlook", group: "Timebox", target: "timebox", summary: "Turn Put on Outlook on or off: a Busy event Coopilot owns, after a preview" },
  { name: "write.status", title: "Check Outlook write access", group: "Settings", target: "none", summary: "Whether Coopilot may create and change its own Outlook events" },
  { name: "write.preview", title: "Preview an Outlook change", group: "Settings", target: "timebox", summary: "What will change on Outlook, where, and who can see it, before anything is written" },
  { name: "write.confirm", title: "Confirm an Outlook change", group: "Settings", target: "write", summary: "Write the previewed change, read it back, log it" },
  { name: "write.retry", title: "Retry an Outlook change", group: "Settings", target: "write", summary: "Check and try again; never makes a duplicate" },
  { name: "write.log", title: "Show the write log", group: "Settings", target: "none", summary: "Every external write: what, where, when, the result, the prior values, and Undo" },
  { name: "timebox.resolve", title: "Choose a version", group: "Timebox", target: "timebox", summary: "A timebox changed in Coopilot and in Outlook: keep Coopilot's (then preview the change) or use Outlook's" },
  { name: "outlook.open", title: "Open in Outlook", group: "Calendar", target: "event", summary: "Open an event in Outlook on the web (meetings with others are changed there, never from Coopilot)" },
  { name: "collab.candidates", title: "Needs help from…", group: "Help", target: "item", summary: "Cooptimizers who could help with an item: on this client that day, on this client, anyone else; PTO shows as away" },
  { name: "collab.suggest", title: "Find help session times", group: "Help", target: "item", summary: "Up to 5 times when you and the people you pick are free inside everyone's working hours (free/busy only)" },
  { name: "collab.preview_invite", title: "Preview a help invite", group: "Help", target: "item", summary: "A meeting with the chosen Cooptimizers: preview names everyone who gets the invite; sent only when you confirm" },
  { name: "devops.set_write_pat", title: "Enable DevOps writes for a client", group: "DevOps", target: "none", summary: "Your own DevOps PAT for one client, checked against your DevOps identity there, kept only in the keyring" },
  { name: "devops.clear_write_pat", title: "Turn off DevOps writes for a client", group: "DevOps", target: "none", summary: "Forget that client's write PAT; everything stays read-only" },
  { name: "devops.write_status", title: "Check DevOps write access", group: "DevOps", target: "none", summary: "Which clients have a write PAT, whose it is and its expiry" },
  { name: "devops.states", title: "List an item's states", group: "DevOps", target: "item", summary: "The states of a work item's type, for Mark done in DevOps (read-only)" },
  { name: "devops.preview", title: "Preview a DevOps change", group: "DevOps", target: "devops", summary: "State, comment, create from a draft or target date: every field before and after, who it writes as, before anything is written" },
  { name: "devops.confirm", title: "Confirm a DevOps change", group: "DevOps", target: "devops", summary: "Write the previewed change (only if the item didn't change since), read it back, log it" },
  { name: "devops.retry", title: "Retry a DevOps change", group: "DevOps", target: "write", summary: "Check and try again; never writes twice" },
  { name: "devops.log", title: "Show the DevOps write log", group: "DevOps", target: "none", summary: "Every DevOps write: what, where, when, the result, the prior values, and Undo" },
  { name: "link.open", title: "Open in Edge", group: "Work items", target: "item", summary: "Open a work item in that client's Edge profile" },
] as const satisfies readonly ActionSpec[];

export type ActionName = (typeof ACTIONS)[number]["name"];
export const ACTION_NAMES: readonly ActionName[] = ACTIONS.map((a) => a.name);
export const isActionName = (a: unknown): a is ActionName => typeof a === "string" && (ACTION_NAMES as readonly string[]).includes(a);
export const actionSpec = (name: ActionName): ActionSpec => ACTIONS.find((a) => a.name === name)!;
