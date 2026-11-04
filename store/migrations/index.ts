// Every timestamped migration (store/migrations/named.ts), one line each. Order here doesn't matter: the runners sort by
// name. Add a line for a new one; never edit or remove a shipped one.
import { setupState } from "./20261103T1700_setup_state.ts";
import { noticesPush } from "./20261103T2300_notices_push.ts";
import { deliveryChats } from "./20261104T0100_delivery_chats.ts";
import { deliveryChatKind } from "./20261104T0400_delivery_chat_kind.ts";
import type { NamedMigration } from "./named.ts";

export const NAMED_MIGRATIONS: readonly NamedMigration[] = [setupState, noticesPush, deliveryChats, deliveryChatKind];
