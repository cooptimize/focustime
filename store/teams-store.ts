// Shared polling (D508 to D512): the client chats, Teams messages and Requests every follower shares. App tables (no
// person in them), read and written on the database itself, not through a person's scoped store: whether someone may
// see a chat is decided by actions (plan/requests.ts canSee), never here. Every write runs in a transaction. Nothing here
// logs; the text of a message never leaves these rows except to its own client's views.
import type { AskRule, AskStatus } from "../plan/asks.ts";
import type { AskSort, NotSorted } from "../plan/asks-ai.ts";
import type { ChatKind, ChatMember } from "../plan/chats.ts";
import type { ClientChat, Mention, PollState, Request, TeamsMessage } from "../plan/requests.ts";
import { PlanError } from "./plan-store.ts";
import type { Conn, Param, Row } from "./sql/conn.ts";

const instant = (v: unknown): string | null => (typeof v === "string" && v ? Temporal.Instant.from(v).toString() : null);
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

const toChat = (r: Row): ClientChat => ({
  chatId: r.chat_id as string,
  clientKey: r.client_key as string,
  kind: r.chat_kind as ChatKind,
  displayName: r.display_name as string,
  webUrl: (r.web_url as string | null) ?? null,
  position: Number(r.position ?? 0),
  members: json<ChatMember[] | null>(r.members_json, null),
  membersFetchedAt: instant(r.members_fetched_at),
  registeredBy: r.registered_by as string,
  registeredAt: instant(r.registered_at)!,
  readSince: instant(r.read_since)!,
  seenAt: instant(r.seen_at),
  polledAt: instant(r.polled_at),
  fetchedAt: instant(r.fetched_at),
  retryAt: instant(r.retry_at),
  failures: Number(r.failures ?? 0),
  pollState: (r.poll_state as PollState | null) ?? null,
  pollNote: (r.poll_note as string | null) ?? null,
  tokenUser: (r.token_user as string | null) ?? null,
});

const toMessage = (r: Row): TeamsMessage => ({
  chatId: r.chat_id as string,
  messageId: r.message_id as string,
  clientKey: r.client_key as string,
  senderId: (r.sender_id as string | null) ?? null,
  senderName: (r.sender_name as string | null) ?? null,
  senderTenant: (r.sender_tenant as string | null) ?? null,
  createdAt: instant(r.created_at)!,
  modifiedAt: instant(r.modified_at)!,
  html: (r.body_html as string | null) ?? null,
  text: r.body_text as string,
  hasImage: !!r.has_image,
  hasFile: !!r.has_file,
  replyToId: (r.reply_to_id as string | null) ?? null,
  mentions: json<Mention[]>(r.mentions_json, []),
  fetchedAt: instant(r.fetched_at)!,
});

const toRequest = (r: Row): Request => ({
  chatId: r.chat_id as string,
  messageId: r.message_id as string,
  clientKey: r.client_key as string,
  rule: r.match_rule as AskRule,
  ruleDetail: (r.rule_detail as string | null) ?? null,
  status: r.status as AskStatus,
  itemId: r.item_id === null || r.item_id === undefined ? null : Number(r.item_id),
  itemUrl: (r.item_url as string | null) ?? null,
  itemTitle: (r.item_title as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  writeId: r.write_id === null || r.write_id === undefined ? null : Number(r.write_id),
  resolvedAt: instant(r.resolved_at),
  resolvedBy: (r.resolved_by as string | null) ?? null,
  assignee: (r.assignee as string | null) ?? null,
  createdAt: instant(r.created_at)!,
  sortStatus: (r.ai_status as Request["sortStatus"] | null) ?? null,
  sortedBy: (r.ai_by as string | null) ?? null,
  sortedAt: instant(r.ai_at),
  sort:
    r.ai_status === "sorted" && r.ai_kind
      ? {
          kind: r.ai_kind as AskSort["kind"],
          urgency: r.ai_urgency as AskSort["urgency"],
          itemType: (r.ai_item_type as AskSort["itemType"] | null) ?? null,
          title: (r.ai_title as string | null) ?? "",
          description: (r.ai_description as string | null) ?? "",
          likely: r.ai_item_id !== null && r.ai_item_id !== undefined ? { id: Number(r.ai_item_id), confidence: Number(r.ai_item_confidence ?? 0) } : null,
          reason: (r.ai_reason as string | null) ?? "",
        }
      : null,
  shown: !!r.ai_shown,
});

export type ChatChange = { at: string; byUser: string; clientKey: string; chatId: string; change: "added" | "kind" | "removed" | "migrated" };
export type PollRecord = { polledAt: string | null; seenAt?: string; fetchedAt?: string; retryAt: string | null; failures: number; state: PollState | null; note: string | null; tokenUser: string | null };

/** A list of ids as "?, ?, ?" and its params (an empty list matches nothing). */
const inList = (ids: readonly string[]): [string, Param[]] => (ids.length ? [ids.map(() => "?").join(", "), [...ids]] : ["NULL", []]);

export function createTeamsStore(db: Conn, now: () => Temporal.Instant) {
  const stamp = () => now().toString();
  const log = (byUser: string, clientKey: string, chatId: string, change: ChatChange["change"]) =>
    db.run("INSERT INTO client_chat_changes (at, by_user, client_key, chat_id, change) VALUES (?, ?, ?, ?, ?)", [stamp(), byUser, clientKey, chatId, change]);

  const store = {
    // ---- client chats ----
    async chats(): Promise<ClientChat[]> {
      return (await db.all("SELECT * FROM client_chats ORDER BY client_key, position, chat_id")).map(toChat);
    },
    async chat(chatId: string): Promise<ClientChat | null> {
      const r = await db.get("SELECT * FROM client_chats WHERE chat_id = ?", [chatId]);
      return r ? toChat(r) : null;
    },
    /** Registers a chat for a client (once; a chat belongs to one client). Reading starts now: no backfill. */
    async addChat(c: { chatId: string; clientKey: string; kind: ChatKind; displayName: string; webUrl: string | null; members: readonly ChatMember[] | null; by: string }): Promise<ClientChat> {
      return db.tx(async () => {
        const known = await store.chat(c.chatId);
        if (known && known.clientKey !== c.clientKey) throw new PlanError("That chat is already registered for another client");
        if (known) return known;
        const at = stamp();
        const position = Number((await db.get("SELECT COUNT(*) AS n FROM client_chats WHERE client_key = ?", [c.clientKey]))?.n ?? 0);
        await db.run(
          "INSERT INTO client_chats (chat_id, client_key, chat_kind, display_name, web_url, position, members_json, members_fetched_at, registered_by, registered_at, read_since, failures, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
          [c.chatId, c.clientKey, c.kind, c.displayName.slice(0, 400), c.webUrl, position, c.members ? JSON.stringify(c.members) : null, c.members ? at : null, c.by, at, at, at],
        );
        await log(c.by, c.clientKey, c.chatId, "added");
        return (await store.chat(c.chatId))!;
      });
    },
    async setKind(chatId: string, kind: ChatKind, by: string): Promise<void> {
      await db.tx(async () => {
        const c = await store.chat(chatId);
        if (!c) throw new PlanError("That chat isn't registered");
        if (c.kind === kind) return;
        await db.run("UPDATE client_chats SET chat_kind = ?, updated_at = ? WHERE chat_id = ?", [kind, stamp(), chatId]);
        await log(by, c.clientKey, chatId, "kind");
      });
    },
    /** Forgets a registered chat (its messages and Requests stay until they expire or are purged). */
    async removeChat(chatId: string, by: string): Promise<void> {
      await db.tx(async () => {
        const c = await store.chat(chatId);
        if (!c) return;
        await db.run("DELETE FROM client_chats WHERE chat_id = ?", [chatId]);
        await log(by, c.clientKey, chatId, "removed");
      });
    },
    async setMembers(chatId: string, members: readonly ChatMember[], fetchedAt: string, displayName?: string): Promise<void> {
      await db.tx(() =>
        displayName
          ? db.run("UPDATE client_chats SET members_json = ?, members_fetched_at = ?, display_name = ?, updated_at = ? WHERE chat_id = ?", [JSON.stringify(members), fetchedAt, displayName.slice(0, 400), stamp(), chatId])
          : db.run("UPDATE client_chats SET members_json = ?, members_fetched_at = ?, updated_at = ? WHERE chat_id = ?", [JSON.stringify(members), fetchedAt, stamp(), chatId]),
      );
    },
    /** One poll's outcome. The watermark and the last successful fetch change only when given (a failure keeps them). */
    async recordPoll(chatId: string, p: PollRecord): Promise<void> {
      const sets = ["polled_at = ?", "retry_at = ?", "failures = ?", "poll_state = ?", "poll_note = ?", "token_user = ?", "updated_at = ?"];
      const params: Param[] = [p.polledAt, p.retryAt, p.failures, p.state, p.note?.slice(0, 400) ?? null, p.tokenUser, stamp()];
      if (p.seenAt) (sets.push("seen_at = ?"), params.push(p.seenAt));
      if (p.fetchedAt) (sets.push("fetched_at = ?"), params.push(p.fetchedAt));
      await db.tx(() => db.run(`UPDATE client_chats SET ${sets.join(", ")} WHERE chat_id = ?`, [...params, chatId]));
    },
    async changes(): Promise<ChatChange[]> {
      return (await db.all("SELECT at, by_user, client_key, chat_id, change FROM client_chat_changes ORDER BY id")).map((r) => ({
        at: instant(r.at)!, byUser: r.by_user as string, clientKey: r.client_key as string, chatId: r.chat_id as string, change: r.change as ChatChange["change"],
      }));
    },

    // ---- messages ----
    /**
     * Stores messages once whoever read them. A message already stored is left alone unless this copy is newer (a later
     * lastModifiedDateTime: an edit), when its body, text, attachments and mentions are replaced. Returns the new ones.
     */
    async saveMessages(ms: readonly TeamsMessage[]): Promise<{ added: TeamsMessage[]; updated: number }> {
      return db.tx(async () => {
        const added: TeamsMessage[] = [];
        let updated = 0;
        for (const m of ms) {
          const r = await db.get("SELECT modified_at FROM teams_messages WHERE chat_id = ? AND message_id = ?", [m.chatId, m.messageId]);
          if (!r) {
            await db.run(
              "INSERT INTO teams_messages (chat_id, message_id, client_key, sender_id, sender_name, sender_tenant, created_at, modified_at, body_html, body_text, has_image, has_file, reply_to_id, mentions_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [m.chatId, m.messageId, m.clientKey, m.senderId, m.senderName?.slice(0, 200) ?? null, m.senderTenant, m.createdAt, m.modifiedAt, m.html, m.text, m.hasImage ? 1 : 0, m.hasFile ? 1 : 0, m.replyToId, m.mentions.length ? JSON.stringify(m.mentions) : null, m.fetchedAt],
            );
            added.push(m);
          } else if (Date.parse(m.modifiedAt) > Date.parse(instant(r.modified_at)!)) {
            await db.run(
              "UPDATE teams_messages SET modified_at = ?, body_html = ?, body_text = ?, has_image = ?, has_file = ?, mentions_json = ?, fetched_at = ? WHERE chat_id = ? AND message_id = ?",
              [m.modifiedAt, m.html, m.text, m.hasImage ? 1 : 0, m.hasFile ? 1 : 0, m.mentions.length ? JSON.stringify(m.mentions) : null, m.fetchedAt, m.chatId, m.messageId],
            );
            updated++;
          }
        }
        return { added, updated };
      });
    },
    async message(chatId: string, messageId: string): Promise<TeamsMessage | null> {
      const r = await db.get("SELECT * FROM teams_messages WHERE chat_id = ? AND message_id = ?", [chatId, messageId]);
      return r ? toMessage(r) : null;
    },
    /** The n messages of a chat before a time, oldest first (Show context, the AI's earlier messages). */
    async messagesBefore(chatId: string, beforeIso: string, n: number): Promise<TeamsMessage[]> {
      const rows = await db.all(
        db.dialect === "sqlserver"
          ? `SELECT TOP (${Math.max(0, Math.floor(n))}) * FROM teams_messages WHERE chat_id = ? AND created_at < ? ORDER BY created_at DESC`
          : `SELECT * FROM teams_messages WHERE chat_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ${Math.max(0, Math.floor(n))}`,
        [chatId, beforeIso],
      );
      return rows.map(toMessage).reverse();
    },
    /**
     * Unmatched messages created before `olderThan`: deleted, unless a Request or someone's promise refers to them. A
     * Request the AI hid as needing nothing (open, not shown anyway) goes with its message under the same rule (AP-2).
     */
    async expire(olderThan: string): Promise<number> {
      return db.tx(async () => {
        await db.run("DELETE FROM requests WHERE created_at < ? AND status = 'open' AND ai_status = 'sorted' AND ai_kind = 'none' AND ai_shown = 0", [olderThan]);
        return (await db.run(
        `DELETE FROM teams_messages WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.chat_id = teams_messages.chat_id AND r.message_id = teams_messages.message_id)
           AND NOT EXISTS (SELECT 1 FROM promises p WHERE p.chat_id = teams_messages.chat_id AND (p.message_id = teams_messages.message_id OR p.answers_message_id = teams_messages.message_id))`,
        [olderThan],
      )).changes;
      });
    },
    /** Delete stored messages for a client: every message that isn't a Request's, now. */
    async purgeClient(clientKey: string): Promise<number> {
      return db.tx(async () => (await db.run(
        "DELETE FROM teams_messages WHERE client_key = ? AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.chat_id = teams_messages.chat_id AND r.message_id = teams_messages.message_id)",
        [clientKey],
      )).changes);
    },

    // ---- requests ----
    /** A message the rules matched becomes an open Request (once). */
    async addRequest(a: { chatId: string; messageId: string; clientKey: string; rule: AskRule; ruleDetail: string | null; at: string }): Promise<boolean> {
      return db.tx(async () => {
        if (await db.get("SELECT 1 AS x FROM requests WHERE chat_id = ? AND message_id = ?", [a.chatId, a.messageId])) return false;
        const t = stamp();
        await db.run("INSERT INTO requests (chat_id, message_id, client_key, match_rule, rule_detail, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)", [a.chatId, a.messageId, a.clientKey, a.rule, a.ruleDetail?.slice(0, 100) ?? null, a.at, t]);
        return true;
      });
    },
    async request(chatId: string, messageId: string): Promise<Request | null> {
      const r = await db.get("SELECT * FROM requests WHERE chat_id = ? AND message_id = ?", [chatId, messageId]);
      return r ? toRequest(r) : null;
    },
    /** The Requests of these chats (the caller decides which chats a person may see). */
    async requests(chatIds: readonly string[]): Promise<Request[]> {
      const [list, params] = inList(chatIds);
      return (await db.all(`SELECT * FROM requests WHERE chat_id IN (${list}) ORDER BY created_at DESC, message_id`, params)).map(toRequest);
    },
    /** A shared resolution (or back to open), by whoever did it. */
    async resolveRequest(chatId: string, messageId: string, r: { status: AskStatus; by: string; itemId?: number | null; itemUrl?: string | null; itemTitle?: string | null; note?: string | null; writeId?: number | null }): Promise<Request> {
      return db.tx(async () => {
        const cur = await store.request(chatId, messageId);
        if (!cur) throw new PlanError("No such request");
        const open = r.status === "open";
        const t = stamp();
        await db.run(
          "UPDATE requests SET status = ?, item_id = ?, item_url = ?, item_title = ?, note = ?, write_id = ?, resolved_at = ?, resolved_by = ?, updated_at = ? WHERE chat_id = ? AND message_id = ?",
          [r.status, open ? null : (r.itemId ?? null), open ? null : (r.itemUrl ?? null), open ? null : (r.itemTitle?.slice(0, 400) ?? null), open ? null : (r.note?.slice(0, 1000) ?? null), open ? null : (r.writeId ?? null), open ? null : t, open ? null : r.by, t, chatId, messageId],
        );
        return (await store.request(chatId, messageId))!;
      });
    },
    /** The AI's sort (or why not), saved once on the shared row, with whose settings sorted it. */
    async setSort(chatId: string, messageId: string, status: "sorted" | NotSorted, sort: AskSort | null, by: string | null): Promise<void> {
      if (status === "sorted" && !sort) throw new PlanError("A sorted request needs its sort");
      const v = status === "sorted" ? sort : null;
      const t = stamp();
      await db.tx(() => db.run(
        "UPDATE requests SET ai_status = ?, ai_at = ?, ai_by = ?, ai_kind = ?, ai_urgency = ?, ai_item_type = ?, ai_title = ?, ai_description = ?, ai_item_id = ?, ai_item_confidence = ?, ai_reason = ?, updated_at = ? WHERE chat_id = ? AND message_id = ?",
        [status.slice(0, 40), t, by, v?.kind ?? null, v?.urgency ?? null, v?.itemType ?? null, v?.title.slice(0, 200) ?? null, v?.description.slice(0, 2000) ?? null, v?.likely?.id ?? null, v?.likely?.confidence ?? null, v?.reason.slice(0, 400) ?? null, t, chatId, messageId],
      ));
    },
    async setShown(chatId: string, messageId: string, shown: boolean): Promise<void> {
      await db.tx(() => db.run("UPDATE requests SET ai_shown = ?, updated_at = ? WHERE chat_id = ? AND message_id = ?", [shown ? 1 : 0, stamp(), chatId, messageId]));
    },
  };
  return store;
}

export type TeamsStore = ReturnType<typeof createTeamsStore>;
