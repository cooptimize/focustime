// DM-1: what a demo seed gets. A seed is one feature's starting data for the demo (one file per feature in this
// folder, listed once in index.ts). Seeds run in order on a fresh demo context, through the app's own actions where
// they can, so every rule applies; they write the shared demo stores (chats, conversations, the team) directly only
// where no action makes that data (it comes from Teams or another person in the hosted app). Everything is fictional.
import type { ActionContext } from "../../../actions/dispatch.ts";
import type { ConversationStore } from "../../../store/conversation-store.ts";
import type { TeamsStore } from "../../../store/teams-store.ts";
import type { TeamStore } from "../../../store/team-store.ts";

export type DemoPersonRef = { id: string; name: string; email: string };

export type DemoSeedEnv = {
  ctx: ActionContext;
  /** Runs an action as the demo's person; a failure throws (a seed that can't apply is a bug, never skipped). */
  run: (action: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  zone: string;
  /** Today in the demo's zone, and this week's Monday. */
  today: string;
  weekStart: string;
  /** Today plus n days. */
  day: (n: number) => string;
  /** This week's Monday plus n days. */
  weekDay: (n: number) => string;
  /** The last day before today with working hours that isn't PTO (last week's on a Monday). */
  lastWorkday: string;
  /** An instant n minutes before now. */
  ago: (minutes: number) => string;
  /** The demo's signed-in person (the one using the page). */
  me: DemoPersonRef;
  /** The shared demo stores (in memory, beside the plan): chats and messages, conversations, sends. */
  teams: TeamsStore;
  conversations: ConversationStore;
  team: TeamStore;
};

export type DemoSeed = {
  /** Short and unique (the README's table names each). */
  name: string;
  /** Who owns it: DM-1, or the step that added it (IB-1, AS-2, ...). */
  owner: string;
  seed: (e: DemoSeedEnv) => Promise<void>;
};
