// ENV-1: outside production, nothing happens on its own. The one place that decides, from the environment, which
// background work may run. server/main.ts computes the policy once (backgroundPolicy(process.env)) and hands it to the
// scheduler (its app jobs), to every person's ticks (their parts) and to the few on-demand paths that act differently
// on a test site (Refresh, Check now, Teams status). Nothing else reads FOCUSTIME_ENV to decide what runs.
//
// The rule. Outside production FocusTime does nothing unprompted that reaches a person (a Teams message, Web Push, a
// reminder or notice), spends AI, writes to an outside system (Teams status included) or reads a person's delegated
// data on a schedule. A person pressing a button still works and acts only for that person. Shared read-only polling
// that screens depend on (the DevOps store) runs while someone uses that deployment. Production is FOCUSTIME_ENV
// exactly "prod"; anything else, empty or missing is not, so the safe answer is the default.
//
// Every piece of background work is named in BACKGROUND. A job or tick part whose name isn't there never runs outside
// production, and background-policy.test.ts fails, so nobody adds background work without deciding. Pure: no I/O.

/** What a piece of background work does outside production. */
export type Outside =
  /** Never on its own (a person pressing a button still works). */
  | "never"
  /** Only for a person who switched "Send me reminders and Teams messages from this test site" on. */
  | "opt_in"
  /** Only while someone is using that deployment (the idle rule's active). */
  | "in_use"
  /** As in production: touches only that deployment's database, or reads shared data with the app's own access. */
  | "always";

export type BackgroundEntry = {
  /** Plain words for the docs and Admin › Status. */
  what: string;
  /** The outside system it touches ("none": only this deployment's database). */
  touches: string;
  /** reads, writes, messages a person, AI, or db (only this deployment's database). */
  effect: "reads" | "writes" | "messages" | "ai" | "db";
  /** Where it is started from: an app job on the scheduler, a part of each person's ticks, or once at server start. */
  kind: "job" | "tick" | "startup" | "reserved";
  outside: Outside;
  /** What still works on a test site when someone presses a button (shown in Admin › Status), if anything. */
  onDemand?: string;
};

export const BACKGROUND = {
  // App jobs (server/scheduler.ts).
  requests_poll: { what: "Reading registered client chats every 5 minutes, then sorting them with AI", touches: "Teams (followers' delegated Chat.Read), AI", effect: "reads", kind: "job", outside: "never", onDemand: "Refresh in the Inbox reads your own chats once, with your sign-in" },
  conversations_upkeep: { what: "Conversation upkeep after each chat read: escalation, reminders, follow-through drafts", touches: "DevOps (read), AI", effect: "ai", kind: "job", outside: "never" },
  meeting_capture: { what: "Meeting capture: laying out registered calls, looking for transcripts, the AI pass", touches: "Graph (reviewers' delegated calendars and transcripts), AI", effect: "reads", kind: "job", outside: "never", onDemand: "Check now on a registered call (Admin › Clients › Meetings) looks for its transcript once, with your sign-in" },
  devops_poll: { what: "The DevOps store: each client's items read once for everyone", touches: "DevOps (the company read PAT)", effect: "reads", kind: "job", outside: "in_use" },
  people_refresh: { what: "People, levels and client leads from Dataverse, once a day", touches: "Dataverse (the app's own access)", effect: "reads", kind: "job", outside: "always" },
  standards_sync: { what: "Cooptimize's standards from public GitHub", touches: "GitHub (public, no token)", effect: "reads", kind: "job", outside: "always" },
  retention_purge: { what: "The retention purge, once a day", touches: "none", effect: "db", kind: "job", outside: "always" },
  conversation_ownership_backfill: { what: "The one-time move of conversations to shared owners", touches: "none", effect: "db", kind: "job", outside: "always" },
  maintenance: { what: "Hard deletes after 30 days and ended sessions, hourly", touches: "none", effect: "db", kind: "job", outside: "always" },
  // Each person's ticks (server/ticks.ts).
  notices: { what: "Timed reminders and notices (plan today, check-in, close out, the week, promises, the VM, sends, notes, calls)", touches: "none (the in-app list)", effect: "messages", kind: "tick", outside: "opt_in", onDemand: "Settings › Notifications: Send a test notification and the samples" },
  web_push: { what: "Web Push to a person's devices", touches: "Web Push services", effect: "messages", kind: "tick", outside: "opt_in", onDemand: "Settings › Notifications: the test send" },
  teams_rhythm: { what: "The Teams bot's brief, check-in, close out, nudges and client calls to review", touches: "Teams (the bot, the person's 1:1 chat)", effect: "messages", kind: "tick", outside: "opt_in", onDemand: "Settings › Notifications › In Teams: Send me a test now" },
  teams_status: { what: "Teams status following the focus timer (set, refresh, clear)", touches: "Teams presence (the person's own)", effect: "writes", kind: "tick", outside: "never" },
  focus_timer: { what: "The focus timer ending on time (the person started it here)", touches: "none", effect: "db", kind: "tick", outside: "always" },
  calendar_refresh: { what: "Today's calendars reloaded every 5 minutes while a focus timer runs", touches: "Outlook, Google (the person's own, read)", effect: "reads", kind: "tick", outside: "always" },
  notice_sweep: { what: "Closing notices on screen whose occasion was handled", touches: "none", effect: "db", kind: "tick", outside: "always" },
  chat_text_cleanup: { what: "Deleting old unmatched chat message rows (AP-1), once a day", touches: "none", effect: "db", kind: "tick", outside: "always" },
  // Once at server start (server/main.ts).
  held_recheck: { what: "Re-sorting held chat messages with AI, once per build and when an admin edits a client's names", touches: "AI", effect: "ai", kind: "startup", outside: "never" },
  startup_upkeep: { what: "One-time database moves at start (team settings, Who repair, AP-1 requests, guest sessions, cancelled VM restores)", touches: "none", effect: "db", kind: "startup", outside: "always" },
  // Reserved: named now so their step decides nothing new.
  vm_autostart: { what: "VM-2: starting a person's VM in the morning (opt-in, not built yet)", touches: "Azure (the person's own VM)", effect: "writes", kind: "reserved", outside: "never" },
  coop_mailbox: { what: "The Coop DevOps mailbox answering once (not built yet)", touches: "DevOps (comments)", effect: "writes", kind: "reserved", outside: "never" },
} as const satisfies Record<string, BackgroundEntry>;

export type BackgroundName = keyof typeof BACKGROUND;
export const BACKGROUND_NAMES = Object.keys(BACKGROUND) as BackgroundName[];

export const isBackgroundName = (n: string): n is BackgroundName => Object.hasOwn(BACKGROUND, n);

/** Production is FOCUSTIME_ENV exactly "prod": not "Prod", "production" or "prod ". */
export const isProduction = (env: Record<string, string | undefined>): boolean => env.FOCUSTIME_ENV === "prod";

export type BackgroundPolicy = {
  production: boolean;
  /**
   * Whether a named piece of work may run now. `optIn`: the person switched "Send me reminders and Teams messages from
   * this test site" on (opt_in work only). `inUse`: someone is using this deployment (in_use work only). An unnamed
   * piece never runs outside production.
   */
  allows: (name: string, o?: { optIn?: boolean; inUse?: boolean }) => boolean;
  /** FOCUSTIME_REQUESTS_POLL=on outside production: a declared watch period (Admin › Status says so). */
  watchPeriod: boolean;
  /** What runs only when someone presses a button here (Admin › Status's "This is a test site"); empty in production. */
  onDemand: () => string[];
};

/** The policy from the environment, computed once at start. */
export function backgroundPolicy(env: Record<string, string | undefined>): BackgroundPolicy {
  const production = isProduction(env);
  // D514: the chat poll's own override, kept for a declared watch period. Production: on unless "off" (as before).
  // Elsewhere: off unless exactly "on".
  const pollOverride = env.FOCUSTIME_REQUESTS_POLL?.trim().toLowerCase() ?? "";
  const pollOn = production ? (pollOverride || "on") === "on" : pollOverride === "on";
  const allows = (name: string, o: { optIn?: boolean; inUse?: boolean } = {}): boolean => {
    // The chat poll and its upkeep follow the override in both environments (production is unchanged).
    if (name === "requests_poll" || name === "conversations_upkeep") return pollOn;
    if (production) return true;
    if (!isBackgroundName(name)) return false;
    const e: BackgroundEntry = BACKGROUND[name];
    if (e.outside === "always") return true;
    if (e.outside === "in_use") return !!o.inUse;
    if (e.outside === "opt_in") return !!o.optIn;
    return false;
  };
  return {
    production,
    allows,
    watchPeriod: !production && pollOn,
    onDemand: () => (production ? [] : BACKGROUND_NAMES.flatMap((n) => (BACKGROUND[n] as BackgroundEntry).onDemand ?? [])),
  };
}

/**
 * The scheduler's app jobs this policy lets run: production keeps every one as given; elsewhere an unnamed job is
 * dropped (and reported through `dropped`), and an in_use job runs only while someone uses this deployment (its wake
 * then never wakes an idle server).
 */
export function policyJobs<J extends { name: string; run: () => Promise<void>; wake: () => Promise<Temporal.Instant | null> }>(
  p: BackgroundPolicy,
  jobs: readonly J[],
  active: () => boolean,
  dropped: (name: string) => void = () => undefined,
): J[] {
  return jobs.flatMap((j) => {
    if (p.production) return p.allows(j.name) ? [j] : [];
    if (!isBackgroundName(j.name) || !p.allows(j.name, { inUse: true })) {
      dropped(j.name);
      return [];
    }
    if (BACKGROUND[j.name].outside !== "in_use") return [j];
    return [{ ...j, run: async () => (active() ? j.run() : undefined), wake: async () => (active() ? j.wake() : null) }];
  });
}
