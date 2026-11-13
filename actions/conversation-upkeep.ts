// CV-1 ran escalation ("Waiting on <Name> · 1 day", Unclaimed for leads, the reminder) and follow-through (a suggested
// DevOps comment after a conversation moved on) here, after each read of the chats. IB-4 removed both: the Inbox no
// longer chases anyone, and From chats offers Create item where a conversation needs one. The job still calls this
// (server/main.ts), so it stays, does nothing and spends no AI. The tables and columns it wrote are kept (nothing is
// dropped); what they hold still shows where it already did.
import type { AiService } from "../ai/service.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import type { TeamsStore } from "../store/teams-store.ts";
import type { TimeModel } from "../week/hours.ts";
import type { WorkItem } from "../week/types.ts";
import type { LogRecord } from "../log/logger.ts";

export type UpkeepDeps = {
  teams: TeamsStore;
  convs: ConversationStore;
  now: string;
  hoursOf: (userId: string) => Promise<{ hours: TimeModel; ptoDays: ReadonlySet<string> } | null>;
  defaultHours: TimeModel;
  items: (clientKey: string) => Promise<readonly WorkItem[] | null>;
  userByEmail: (email: string) => Promise<string | null>;
  ai: (clientKey: string) => Promise<AiService | null>;
  clientName: (clientKey: string) => Promise<string>;
  log: (r: LogRecord) => void;
};

export type UpkeepResult = { escalated: number; suggestions: number };

/** IB-4: nothing to do after a read: no escalation, no follow-through. */
export async function upkeep(_d: UpkeepDeps): Promise<UpkeepResult> {
  return { escalated: 0, suggestions: 0 };
}
