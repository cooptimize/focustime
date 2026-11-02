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
  | "devops" // a DevOps change (step 14)
  | "vm"; // my Azure VM (step 15.4)

export type ActionSpec = {
  readonly name: string;
  /** Plain words for the command menu. */
  readonly title: string;
  readonly group: "Week" | "Plan the week" | "Plan the day" | "Close out" | "Picks" | "Work items" | "Sources" | "Display" | "Time" | "Settings" | "Focus" | "Follow-ups" | "Capture" | "Timebox" | "Calendar" | "Help" | "DevOps" | "My VM";
  readonly target: ActionTarget;
  /** The key that does the same in the window, if any. */
  readonly shortcut?: string;
  readonly summary: string;
};

export const ACTIONS = [
  { name: "week.load", title: "Refresh all sources", group: "Week", target: "none", shortcut: "R", summary: "Reload focus blocks, PTO, calendars and DevOps" },
  { name: "source.status", title: "Show source status", group: "Sources", target: "none", summary: "Each source's state in one line" },
  { name: "auth.connect_microsoft", title: "Connect Outlook", group: "Sources", target: "none", summary: "Sign in with Microsoft in your browser (the same sign-in as the app's)" },
  { name: "auth.status", title: "Who's signed in", group: "Settings", target: "none", summary: "The Microsoft account Coopilot works for" },
  { name: "auth.sign_in", title: "Sign in with Microsoft", group: "Settings", target: "none", summary: "One sign-in for you, your calendar and your Azure VM (in your browser)" },
  { name: "auth.sign_out", title: "Sign out", group: "Settings", target: "none", summary: "Forget the Microsoft sign-in on this computer; the local plan stays" },
  { name: "vm.status", title: "My VM", group: "My VM", target: "none", summary: "Your VM's state and auto-shutdown time" },
  { name: "vm.find", title: "Find my VM", group: "My VM", target: "none", summary: "VMs tagged as yours (Owner tag) in every Azure subscription you can see" },
  { name: "vm.choose", title: "Choose my VM", group: "My VM", target: "vm", summary: "Confirm which VM is yours, or enter its resource ID" },
  { name: "vm.preview", title: "Start, stop or delay shutdown", group: "My VM", target: "vm", summary: "Start or stop (deallocate) your VM, or delay or skip tonight's auto-shutdown, after a preview" },
  { name: "vm.confirm", title: "Confirm a VM change", group: "My VM", target: "vm", summary: "Do the change shown in the preview, then follow it until Azure shows it" },
  { name: "vm.restore", title: "Restore auto-shutdown", group: "My VM", target: "vm", summary: "Put back the auto-shutdown schedule Coopilot changed" },
  { name: "vm.dismiss_prompt", title: "Not today (VM prompt)", group: "My VM", target: "none", summary: "Don't ask to start the VM again today" },
  { name: "vm.start_now", title: "Start my VM now", group: "My VM", target: "vm", summary: "The morning box's Start: starts your VM at once when Settings > You allows it, logged and followed until it runs" },
  { name: "notify.test", title: "Send a test notification", group: "Settings", target: "none", summary: "A desktop notification now, to check they reach you" },
  { name: "notify.sample", title: "Send a sample notification", group: "Settings", target: "none", summary: "One of each kind on request, with its buttons, for checking them (VM buttons open the VM menu)" },
  { name: "vm.log", title: "Show the Azure write log", group: "My VM", target: "none", summary: "Every start, stop and auto-shutdown change: when, the result and what it was before" },
  { name: "auth.connect_google", title: "Connect Google Calendar", group: "Sources", target: "none", summary: "Sign in to Google in your browser (read-only calendar)" },
  { name: "auth.disconnect", title: "Disconnect a calendar", group: "Sources", target: "calendar", summary: "Forget a calendar sign-in and its cached events" },
  { name: "roadmap.ahead", title: "Plan ahead", group: "Work items", target: "none", summary: "The next 12 weeks on a timeline: whole blocks per week for weeks 1 to 4, and how crowded each month after looks" },
  { name: "roadmap.set_dates", title: "Move a bar on the timeline", group: "Work items", target: "item", summary: "Keep a feature's dragged dates locally until you save them to DevOps" },
  { name: "roadmap.load", title: "Roadmap", group: "Work items", target: "none", shortcut: "3", summary: "Features and epics you own: stories done and open, who's on them, and whether they're on track for the target date" },
  { name: "weekplan.load", title: "Plan the week", group: "Plan the week", target: "week", shortcut: "W", summary: "Each client's week: musts and nice to haves from DevOps (next week by default); a past week is a review" },
  { name: "weekplan.set_feature", title: "Commit a feature to the week", group: "Plan the week", target: "feature", summary: "Give a feature a number of your blocks; 0 takes it off" },
  { name: "weekplan.place", title: "Pin to a block", group: "Plan the week", target: "feature", summary: "Pin a week item to one of its client's blocks or an Open half-day (optional, for dependencies)" },
  { name: "weekplan.add", title: "Add to the week", group: "Plan the week", target: "feature", summary: "Put a DevOps feature or story on its client's week as a must or a nice to have" },
  { name: "weekplan.set_tier", title: "Make it a must or nice to have", group: "Plan the week", target: "feature", summary: "Move a week item between Must and Nice to have; no reason needed" },
  { name: "weekplan.set_blocks", title: "Set blocks", group: "Plan the week", target: "feature", summary: "How many of the client's blocks a feature needs, in whole blocks" },
  { name: "weekplan.set_size", title: "Set story size", group: "Plan the week", target: "feature", summary: "A story's size on the week list: S, M or L" },
  { name: "weekplan.reorder", title: "Reorder the week list", group: "Plan the week", target: "feature", summary: "Change the local order of a client's musts or nice to haves, or go back to DevOps order (never written to DevOps)" },
  { name: "weekplan.remove", title: "Take off the week", group: "Plan the week", target: "feature", summary: "Take an item off its client's week list" },
  { name: "weekplan.mark_done", title: "Mark done for the week", group: "Plan the week", target: "feature", summary: "Count a week item as done here (DevOps state counts too)" },
  { name: "weekplan.headsup", title: "Heads-up: a must moves out", group: "Plan the week", target: "feature", summary: "Open a heads-up follow-up for a must dropped from a committed week" },
  { name: "weekplan.commit", title: "Commit the week", group: "Plan the week", target: "week", summary: "Commit the week's features; it stays editable and can be committed again" },
  { name: "feature.brief", title: "Copy Coop brief", group: "Plan the week", target: "feature", summary: "Markdown for Coop to propose user stories: DevOps fields only" },
  { name: "feature.mark_breakdown", title: "Mark as being broken down", group: "Plan the week", target: "feature", summary: "Local note that a feature is with Coop or the team for stories" },
  { name: "followup.ask_priorities", title: "Create follow-up: ask about priorities", group: "Plan the week", target: "week", summary: "For a client block next week with no open work assigned to you" },
  { name: "planday.start", title: "Plan the day", group: "Plan the day", target: "day", summary: "Today › Plan: turn a day's free time into committed picks (P from Today)" },
  { name: "planday.commit", title: "Commit the plan", group: "Plan the day", target: "plan", shortcut: "C", summary: "Commit the day being planned" },
  { name: "closeout.load", title: "Close out", group: "Close out", target: "day", shortcut: "E", summary: "End of day: picks done or not, resume notes, follow-ups (about 3 minutes)" },
  { name: "checkin.done", title: "Finish Check-in", group: "Close out", target: "day", summary: "Mark today's Check-in done (local); its mode shows ✓" },
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
  { name: "ui.first_launch", title: "First launch", group: "Display", target: "none", summary: "True only the first time Coopilot opens on this computer (for the welcome moment); kept in the plan store" },
  { name: "ui.set_reduce_motion", title: "Reduce motion", group: "Display", target: "none", summary: "No opening and closing animation and no moving Lumen; the still pose shows" },
  { name: "ui.set_text_size", title: "Text size", group: "Display", target: "none", shortcut: "Ctrl +", summary: "Default, Large or Larger for all text; saved in config" },
  { name: "ui.set_view_range", title: "Timelines", group: "Display", target: "range", shortcut: "V", summary: "The hours Week's rails and timelines show: business hours, 12 hours or 24 hours, for now; Settings > Display sets the default" },
  { name: "ui.set_show_personal", title: "Personal events", group: "Display", target: "none", shortcut: "G", summary: "Show or hide personal events on Week and Today; they still count in risk and free time; saved in config" },
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
  { name: "timer.deep", title: "Deep focus", group: "Focus", target: "none", summary: "Switch the running session to deep focus (Teams: Do not disturb) or back to plain focus (Busy)" },
  { name: "presence.status", title: "Teams status during focus", group: "Focus", target: "none", summary: "Whether focus sets your Teams status, what it set and until when" },
  { name: "people.photos", title: "Profile photos", group: "Focus", target: "none", summary: "Photos of me and the Cooptimizers on screen, from Microsoft; cached 7 days, initials when there is none" },
  { name: "presence.people", title: "Teammates' presence", group: "Focus", target: "none", summary: "Available, Busy, In a meeting and so on for the Cooptimizers on screen; read-only, never kept" },
  { name: "presence.log", title: "Show the Teams status log", group: "Focus", target: "none", summary: "Every time focus set or cleared your Teams status" },
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
