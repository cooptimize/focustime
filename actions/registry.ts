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
  | "calendar"; // Outlook or Google

export type ActionSpec = {
  readonly name: string;
  /** Plain words for the command menu. */
  readonly title: string;
  readonly group: "Week" | "Plan the day" | "Picks" | "Work items" | "Sources";
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
  { name: "planday.start", title: "Plan the day", group: "Plan the day", target: "day", shortcut: "P", summary: "Turn a day's free time into committed picks (I also works)" },
  { name: "planday.commit", title: "Commit the plan", group: "Plan the day", target: "plan", shortcut: "C", summary: "Commit the day being planned" },
  { name: "pick.add", title: "Add to the plan", group: "Picks", target: "item", summary: "Pick a work item for a half-day" },
  { name: "pick.set_size", title: "Set size", group: "Picks", target: "pick", summary: "S about 1 h, M about 2 h, L a whole block" },
  { name: "pick.move", title: "Move pick", group: "Picks", target: "pick", summary: "To AM, PM, another day or Friday" },
  { name: "pick.mark_done", title: "Mark done or not done", group: "Picks", target: "pick", summary: "Tick a pick (local only)" },
  { name: "pick.remove", title: "Drop pick", group: "Picks", target: "pick", summary: "Remove a pick from the plan" },
  { name: "draft.add_story", title: "Add a draft story", group: "Work items", target: "portfolio", summary: "A local story under an epic or feature with no children" },
  { name: "link.open", title: "Open in Edge", group: "Work items", target: "item", summary: "Open a work item in that client's Edge profile" },
] as const satisfies readonly ActionSpec[];

export type ActionName = (typeof ACTIONS)[number]["name"];
export const ACTION_NAMES: readonly ActionName[] = ACTIONS.map((a) => a.name);
export const isActionName = (a: unknown): a is ActionName => typeof a === "string" && (ACTION_NAMES as readonly string[]).includes(a);
export const actionSpec = (name: ActionName): ActionSpec => ACTIONS.find((a) => a.name === name)!;
