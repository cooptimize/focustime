// Shared polling (D514 to D518): the client chats, Teams messages and Requests every follower shares. App tables (no
// person in them), read and written on the database itself, not through a person's scoped store. Shared storage, not
// shared visibility (D521): anything done for a person goes through `viewer(userId)`, which reaches only the chats whose
// cached member list has that person now (none read yet: nobody); following the client is checked on top, in actions.
// The unscoped methods are for the poll job and expiry only. Every write runs in a transaction. Nothing here logs; the
// text of a message never leaves these rows except to its own client's views.
import type { AskRule, AskStatus } from "../plan/asks.ts";
import type { AskSort, NotSorted } from "../plan/asks-ai.ts";
import type { ChatKind, ChatMember } from "../plan/chats.ts";
import { isMember, type ClientChat, type Mention, type PollState, type Reaction, type Request, type TeamsMessage } from "../plan/requests.ts";
import { hostedImageIds } from "../plan/sanitize.ts";
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
  readOn: r.read_on === undefined || r.read_on === null ? true : !!r.read_on,
  social: !!r.social,
});

/** CV-2: reactions as stored (null when none): at most 12, each emoji at most 16 characters. */
const reactionsJson = (rs: readonly Reaction[] | undefined): string | null => {
  const list = (rs ?? []).filter((x) => x.emoji && x.count > 0).slice(0, 12).map((x) => ({ emoji: x.emoji.slice(0, 16), count: Math.min(9999, Math.round(x.count)) }));
  return list.length ? JSON.stringify(list) : null;
};

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
  reactions: json<Reaction[]>(r.reactions_json, []),
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

export type ChatChange = { at: string; byUser: string; clientKey: string; chatId: string; change: "added" | "kind" | "removed" | "migrated" | "reading_on" | "reading_off" };
/** CV-2: one image of a stored message. CV-4: FocusTime never keeps its bytes; it is read from Teams when needed. */
export type MessageImage = { id: number; chatId: string; messageId: string; position: number; state: ImageState; reason: string | null; contentType: string | null; byteSize: number | null; attempts: number; /** CV-4: the AI's short description (at most 120 characters), only for chat members. */ description: string | null };
export type ImageState = "pending" | "ok" | "skipped" | "failed";
const IMAGE_COLS = "id, chat_id, message_id, position, state, reason, content_type, byte_size, attempts, description";
const toImage = (r: Row): MessageImage => ({
  id: Number(r.id), chatId: r.chat_id as string, messageId: r.message_id as string, position: Number(r.position), state: r.state as ImageState,
  reason: (r.reason as string | null) ?? null, contentType: (r.content_type as string | null) ?? null, byteSize: r.byte_size == null ? null : Number(r.byte_size), attempts: Number(r.attempts),
  description: (r.description as string | null) ?? null,
});
/** Images whose message is gone go with it (expiry, purge, a removed chat). */
const ORPHAN_IMAGES = "DELETE FROM teams_message_images WHERE NOT EXISTS (SELECT 1 FROM teams_messages m WHERE m.chat_id = teams_message_images.chat_id AND m.message_id = teams_message_images.message_id)";

export type PollRecord = { polledAt: string | null; seenAt?: string; fetchedAt?: string; retryAt: string | null; failures: number; state: PollState | null; note: string | null; tokenUser: string | null };

/** A list of ids as "?, ?, ?" and its params (an empty list matches nothing). */
const inList = (ids: readonly string[]): [string, Param[]] => (ids.length ? [ids.map(() => "?").join(", "), [...ids]] : ["NULL", []]);

function baseStore(db: Conn, now: () => Temporal.Instant) {
  const stamp = () => now().toString();
  const log = (byUser: string, clientKey: string, chatId: string, change: ChatChange["change"]) =>
    db.run("INSERT INTO client_chat_changes (at, by_user, client_key, chat_id, change) VALUES (?, ?, ?, ?, ?)", [stamp(), byUser, clientKey, chatId, change]);

  /** CV-2: a message's image rows follow its body: one pending row per hosted image, the ones no longer there dropped. */
  const syncImages = async (chatId: string, messageId: string, html: string | null) => {
    const ids = hostedImageIds(html).slice(0, 20);
    const rows = await db.all("SELECT id, position, hosted_id FROM teams_message_images WHERE chat_id = ? AND message_id = ?", [chatId, messageId]);
    for (const r of rows) if (ids[Number(r.position)] !== r.hosted_id) await db.run("DELETE FROM teams_message_images WHERE id = ?", [r.id as number]);
    const kept = new Set(rows.filter((r) => ids[Number(r.position)] === r.hosted_id).map((r) => Number(r.position)));
    for (const [position, hostedId] of ids.entries())
      if (!kept.has(position)) await db.run("INSERT INTO teams_message_images (chat_id, message_id, position, hosted_id, state, attempts, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?)", [chatId, messageId, position, hostedId, stamp()]);
  };

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
    /**
     * D523: an admin's switch for whether the job reads a chat. On reads from now (no backfill: what was said while it
     * was off is never read); off stops at once and keeps what was stored. Logged with who.
     */
    async setReading(chatId: string, on: boolean, by: string): Promise<void> {
      await db.tx(async () => {
        const c = await store.chat(chatId);
        if (!c) throw new PlanError("That chat isn't registered");
        if (c.readOn === on) return;
        const t = stamp();
        if (on) await db.run("UPDATE client_chats SET read_on = 1, read_since = ?, seen_at = NULL, retry_at = NULL, failures = 0, poll_state = NULL, poll_note = NULL, updated_at = ? WHERE chat_id = ?", [t, t, chatId]);
        else await db.run("UPDATE client_chats SET read_on = 0, updated_at = ? WHERE chat_id = ?", [t, chatId]);
        await log(by, c.clientKey, chatId, on ? "reading_on" : "reading_off");
      });
    },
    /** IB-1: an admin's Social chat switch. Logged with who as a label change (the log's changes are fixed). */
    async setSocial(chatId: string, on: boolean, by: string): Promise<void> {
      await db.tx(async () => {
        const c = await store.chat(chatId);
        if (!c) throw new PlanError("That chat isn't registered");
        if (!!c.social === on) return;
        await db.run("UPDATE client_chats SET social = ?, updated_at = ? WHERE chat_id = ?", [on ? 1 : 0, stamp(), chatId]);
        await log(by, c.clientKey, chatId, "kind");
      });
    },
    /** Forgets a registered chat with its Requests and stored messages (a promise's message stays with the promise). */
    async removeChat(chatId: string, by: string): Promise<void> {
      await db.tx(async () => {
        const c = await store.chat(chatId);
        if (!c) return;
        await db.run("DELETE FROM requests WHERE chat_id = ?", [chatId]);
        // CV-1: its conversations go with it (their messages, commitments and suggestions).
        await db.run("DELETE FROM conversation_suggestions WHERE conversation_id IN (SELECT id FROM conversations WHERE chat_id = ?)", [chatId]);
        await db.run("DELETE FROM commitments WHERE chat_id = ?", [chatId]);
        await db.run("DELETE FROM conversation_messages WHERE chat_id = ?", [chatId]);
        await db.run("DELETE FROM conversations WHERE chat_id = ?", [chatId]);
        await db.run(
          `DELETE FROM teams_messages WHERE chat_id = ?
             AND NOT EXISTS (SELECT 1 FROM promises p WHERE p.chat_id = teams_messages.chat_id AND (p.message_id = teams_messages.message_id OR p.answers_message_id = teams_messages.message_id))
           AND NOT EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.chat_id = teams_messages.chat_id AND cm.message_id = teams_messages.message_id AND cm.role = 'work')`,
          [chatId],
        );
        await db.run(ORPHAN_IMAGES);
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
          const r = await db.get("SELECT modified_at, body_html FROM teams_messages WHERE chat_id = ? AND message_id = ?", [m.chatId, m.messageId]);
          if (!r) {
            await db.run(
              "INSERT INTO teams_messages (chat_id, message_id, client_key, sender_id, sender_name, sender_tenant, created_at, modified_at, body_html, body_text, has_image, has_file, reply_to_id, mentions_json, reactions_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [m.chatId, m.messageId, m.clientKey, m.senderId, m.senderName?.slice(0, 200) ?? null, m.senderTenant, m.createdAt, m.modifiedAt, m.html, m.text, m.hasImage ? 1 : 0, m.hasFile ? 1 : 0, m.replyToId, m.mentions.length ? JSON.stringify(m.mentions) : null, reactionsJson(m.reactions), m.fetchedAt],
            );
            await syncImages(m.chatId, m.messageId, m.html);
            added.push(m);
          } else if (Date.parse(m.modifiedAt) > Date.parse(instant(r.modified_at)!)) {
            await db.run(
              "UPDATE teams_messages SET modified_at = ?, body_html = ?, body_text = ?, has_image = ?, has_file = ?, mentions_json = ?, reactions_json = ?, fetched_at = ? WHERE chat_id = ? AND message_id = ?",
              [m.modifiedAt, m.html, m.text, m.hasImage ? 1 : 0, m.hasFile ? 1 : 0, m.mentions.length ? JSON.stringify(m.mentions) : null, reactionsJson(m.reactions), m.fetchedAt, m.chatId, m.messageId],
            );
            // CV-2: a new reaction changes lastModifiedDateTime too; images change only with the body.
            if ((r.body_html ?? null) !== (m.html ?? null)) await syncImages(m.chatId, m.messageId, m.html);
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
        const gone = (await db.run(
        `DELETE FROM teams_messages WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.chat_id = teams_messages.chat_id AND r.message_id = teams_messages.message_id)
           AND NOT EXISTS (SELECT 1 FROM promises p WHERE p.chat_id = teams_messages.chat_id AND (p.message_id = teams_messages.message_id OR p.answers_message_id = teams_messages.message_id))
           AND NOT EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.chat_id = teams_messages.chat_id AND cm.message_id = teams_messages.message_id AND cm.role = 'work')`,
        [olderThan],
      )).changes;
        // CV-1: the places of messages that went (chatter, acks, unsorted ones past 14 days) go with them.
        await db.run("DELETE FROM conversation_messages WHERE NOT EXISTS (SELECT 1 FROM teams_messages m WHERE m.chat_id = conversation_messages.chat_id AND m.message_id = conversation_messages.message_id)");
        await db.run(ORPHAN_IMAGES);
        return gone;
      });
    },
    /** Delete stored messages for a client: every message that isn't a Request's or a promise's, now. */
    async purgeClient(clientKey: string): Promise<number> {
      return store.purgeChats((await store.chats()).filter((c) => c.clientKey === clientKey).map((c) => c.chatId));
    },
    /** Delete stored messages of these chats: every message that isn't a Request's or a promise's, now. */
    async purgeChats(chatIds: readonly string[]): Promise<number> {
      if (!chatIds.length) return 0;
      const [list, params] = inList(chatIds);
      return db.tx(async () => {
        const gone = (await db.run(
          `DELETE FROM teams_messages WHERE chat_id IN (${list})
           AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.chat_id = teams_messages.chat_id AND r.message_id = teams_messages.message_id)
           AND NOT EXISTS (SELECT 1 FROM promises p WHERE p.chat_id = teams_messages.chat_id AND (p.message_id = teams_messages.message_id OR p.answers_message_id = teams_messages.message_id))
           AND NOT EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.chat_id = teams_messages.chat_id AND cm.message_id = teams_messages.message_id AND cm.role = 'work')`,
          params,
        )).changes;
        await db.run(ORPHAN_IMAGES);
        return gone;
      });
    },

    // ---- images (CV-2) ----
    /**
     * The image rows of these messages, made first for any stored before CV-2 (from the body they kept), in message
     * and body order. Never the bytes.
     */
    async images(chatId: string, messageIds: readonly string[]): Promise<MessageImage[]> {
      if (!messageIds.length) return [];
      const [list, params] = inList(messageIds);
      return db.tx(async () => {
        const have = new Set((await db.all(`SELECT DISTINCT message_id FROM teams_message_images WHERE chat_id = ? AND message_id IN (${list})`, [chatId, ...params])).map((r) => r.message_id as string));
        for (const r of await db.all(`SELECT message_id, body_html FROM teams_messages WHERE chat_id = ? AND has_image = 1 AND message_id IN (${list})`, [chatId, ...params]))
          if (!have.has(r.message_id as string)) await syncImages(chatId, r.message_id as string, (r.body_html as string | null) ?? null);
        return (await db.all(`SELECT ${IMAGE_COLS} FROM teams_message_images WHERE chat_id = ? AND message_id IN (${list}) ORDER BY message_id, position`, [chatId, ...params])).map(toImage);
      });
    },
    async image(id: number): Promise<MessageImage | null> {
      const r = await db.get(`SELECT ${IMAGE_COLS} FROM teams_message_images WHERE id = ?`, [id]);
      return r ? toImage(r) : null;
    },
    /** What the server needs to fetch one: its hosted content id (never sent anywhere but Graph). */
    async imageSource(id: number): Promise<{ chatId: string; messageId: string; hostedId: string } | null> {
      const r = await db.get("SELECT chat_id, message_id, hosted_id FROM teams_message_images WHERE id = ?", [id]);
      return r ? { chatId: r.chat_id as string, messageId: r.message_id as string, hostedId: r.hosted_id as string } : null;
    },
    /**
     * A read's outcome (CV-4: never the bytes): ok with the type and size read from them, or why it can't be shown.
     * A failure is counted; a later success clears it.
     */
    async setImage(id: number, r: { state: "ok"; contentType: string; byteSize: number } | { state: "skipped" | "failed"; reason: string }): Promise<void> {
      await db.tx(() =>
        r.state === "ok"
          ? db.run("UPDATE teams_message_images SET state = 'ok', reason = NULL, content_type = ?, byte_size = ?, attempts = 0, fetched_at = ? WHERE id = ?", [r.contentType, r.byteSize, stamp(), id])
          : db.run("UPDATE teams_message_images SET state = ?, reason = ?, attempts = attempts + 1, fetched_at = ? WHERE id = ?", [r.state, r.reason.slice(0, 40), stamp(), id]),
      );
    },
    /** CV-4: the AI's description of an image (cut to 120 characters); shown only to members of its chat. */
    async setImageDescription(id: number, description: string): Promise<void> {
      const d = description.replace(/\s+/g, " ").trim().slice(0, 120);
      if (!d) return;
      await db.tx(() => db.run("UPDATE teams_message_images SET description = ?, described_at = ? WHERE id = ?", [d, stamp(), id]));
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

type BaseStore = ReturnType<typeof baseStore>;

export function createTeamsStore(db: Conn, now: () => Temporal.Instant) {
  const store = baseStore(db, now);
  return { ...store, viewer: (userId: string) => viewerOf(store, userId) };
}
const noRequest = () => new PlanError("No such request");

/**
 * One person's way into the shared store (D521): only chats they are a member of now, by the cached member list.
 * Anything else reads as missing (null, [], 0) or is refused as "No such request"; every change is made as them.
 */
function viewerOf(store: BaseStore, userId: string) {
  const chat = async (chatId: string) => {
    const c = await store.chat(chatId);
    return c && isMember(c, userId) ? c : null;
  };
  const gate = async (chatId: string) => {
    if (!(await chat(chatId))) throw noRequest();
  };
  const view = {
    userId,
    async chats(): Promise<ClientChat[]> {
      return (await store.chats()).filter((c) => isMember(c, userId));
    },
    chat,
    async message(chatId: string, messageId: string): Promise<TeamsMessage | null> {
      return (await chat(chatId)) ? store.message(chatId, messageId) : null;
    },
    async messagesBefore(chatId: string, beforeIso: string, n: number): Promise<TeamsMessage[]> {
      return (await chat(chatId)) ? store.messagesBefore(chatId, beforeIso, n) : [];
    },
    async request(chatId: string, messageId: string): Promise<Request | null> {
      return (await chat(chatId)) ? store.request(chatId, messageId) : null;
    },
    /** The Requests of my chats (narrowed to these chats when given). */
    async requests(chatIds?: readonly string[]): Promise<Request[]> {
      const mine = (await view.chats()).map((c) => c.chatId).filter((id) => !chatIds || chatIds.includes(id));
      return store.requests(mine);
    },
    async resolveRequest(chatId: string, messageId: string, r: Omit<Parameters<BaseStore["resolveRequest"]>[2], "by">): Promise<Request> {
      await gate(chatId);
      return store.resolveRequest(chatId, messageId, { ...r, by: userId });
    },
    /** Sort again under my settings (`by` is always me). */
    async setSort(chatId: string, messageId: string, status: "sorted" | NotSorted, sort: AskSort | null, _by?: string | null): Promise<void> {
      await gate(chatId);
      await store.setSort(chatId, messageId, status, sort, userId);
    },
    async setShown(chatId: string, messageId: string, shown: boolean): Promise<void> {
      await gate(chatId);
      await store.setShown(chatId, messageId, shown);
    },
    /** Register a chat I'm in (with members unread, it's registered but nobody sees it until the poll reads them). */
    async addChat(c: Omit<Parameters<BaseStore["addChat"]>[0], "by">): Promise<ClientChat> {
      if (c.members && !isMember({ members: [...c.members] }, userId)) throw new PlanError("You aren't in that chat");
      return store.addChat({ ...c, by: userId });
    },
    async setKind(chatId: string, kind: ChatKind): Promise<void> {
      if (!(await chat(chatId))) throw new PlanError("That chat isn't registered");
      await store.setKind(chatId, kind, userId);
    },
    async removeChat(chatId: string): Promise<void> {
      if (!(await chat(chatId))) throw new PlanError("That chat isn't registered");
      await store.removeChat(chatId, userId);
    },
    async setReading(chatId: string, on: boolean): Promise<void> {
      if (!(await chat(chatId))) throw new PlanError("That chat isn't registered");
      await store.setReading(chatId, on, userId);
    },
    async setSocial(chatId: string, on: boolean): Promise<void> {
      if (!(await chat(chatId))) throw new PlanError("That chat isn't registered");
      await store.setSocial(chatId, on, userId);
    },
    /** CV-2: the images of messages in a chat I'm in. */
    async images(chatId: string, messageIds: readonly string[]): Promise<MessageImage[]> {
      return (await chat(chatId)) ? store.images(chatId, messageIds) : [];
    },
    /** One image, only when I'm in its chat now (else as missing). */
    async image(id: number): Promise<MessageImage | null> {
      const i = await store.image(id);
      return i && (await chat(i.chatId)) ? i : null;
    },
    /** CV-4: where to read an image in Teams, only when I'm in its chat now. */
    async imageSource(id: number): Promise<{ chatId: string; messageId: string; hostedId: string } | null> {
      const src = await store.imageSource(id);
      return src && (await chat(src.chatId)) ? src : null;
    },
    /** CV-4: what a read with my token found (type and size, or why it can't be shown); only for my chats. */
    async setImage(id: number, r: Parameters<typeof store.setImage>[1]): Promise<void> {
      const i = await store.image(id);
      if (i && (await chat(i.chatId))) await store.setImage(id, r);
    },
    /** Delete stored messages of a client's chats I'm in (Requests and promises keep theirs). */
    async purgeClient(clientKey: string): Promise<number> {
      return store.purgeChats((await view.chats()).filter((c) => c.clientKey === clientKey).map((c) => c.chatId));
    },
  };
  return view;
}

export type TeamsStore = ReturnType<typeof createTeamsStore>;
export type TeamsView = ReturnType<TeamsStore["viewer"]>;
/** What the AI sorting reads and writes: the whole store for the job, a person's view for Sort again. */
export type SortStore = Pick<TeamsView, "chat" | "message" | "messagesBefore" | "setSort">;
