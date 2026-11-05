// Every timestamped migration (store/migrations/named.ts), one line each. Order here doesn't matter: the runners sort by
// name. Add a line for a new one; never edit or remove a shipped one.
import { setupState } from "./20261103T1700_setup_state.ts";
import { noticesPush } from "./20261103T2300_notices_push.ts";
import { deliveryChats } from "./20261104T0100_delivery_chats.ts";
import { asks } from "./20261104T1200_asks.ts";
import { ai } from "./20261104T1800_ai.ts";
import { itemClients } from "./20261104T1900_item_clients.ts";
import { asksAiPromises } from "./20261104T2000_asks_ai_promises.ts";
import { deliveryChatKind } from "./20261104T0400_delivery_chat_kind.ts";
import { sharedRequests } from "./20261104T2100_shared_requests.ts";
import { storyDrafts } from "./20261105T0100_story_drafts.ts";
import { admin } from "./20261105T0200_admin.ts";
import { conversations } from "./20261105T1200_conversations.ts";
import { devopsTakes } from "./20261105T1300_devops_takes.ts";
import { clientAccounts } from "./20261105T1400_client_accounts.ts";
import { devopsPoll } from "./20261105T2000_devops_poll.ts";
import { conversationMerges } from "./20261105T2100_conversation_merges.ts";
import type { NamedMigration } from "./named.ts";

export const NAMED_MIGRATIONS: readonly NamedMigration[] = [setupState, noticesPush, deliveryChats, deliveryChatKind, asks, ai, itemClients, asksAiPromises, sharedRequests, storyDrafts, admin, conversations, devopsTakes, devopsPoll, clientAccounts, conversationMerges];
