// CV-1: the shared conversation store: conversations, each message's place, commitments, suggested DevOps updates,
// the per-chat daily AI count and the pipeline's own AI request log. App tables (no person in them), read and written
// on the database itself like the Teams store (D514). Shared storage, not shared visibility (D521): anything done for
// a person goes through `viewer(userId)`, which reaches only the chats whose cached member list has that person now;
// following the client is checked on top, in actions. The unscoped methods are for the poll job, the backfill and
// expiry only. Every write runs in a transaction. Nothing here logs; message text never comes through here.
import type { AiLogEntry } from "../ai/types.ts";
import { COMMITMENT_STATES, CONVERSATION_STATUSES, MESSAGE_ROLES, type Commitment, type ConversationMerge, type CommitmentState, type Conversation, type ConversationStatus, type ItemChange, type MessagePlace, type MessageRole, type Participant, type Suggestion } from "../plan/conversations.ts";
import { isMember } from "../plan/requests.ts";
import { PlanError } from "./plan-store.ts";
import type { Conn, Param, Row } from "./sql/conn.ts";
import type { TeamsStore } from "./teams-store.ts";

const instant = (v: unknown): string | null => (typeof v === "string" && v ? Temporal.Instant.from(v).toString() : null);
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const inList = (xs: readonly (string | number)[]): [string, Param[]] => (xs.length ? [xs.map(() => "?").join(", "), [...xs]] : ["NULL", []]);

const toConversation = (r: Row): Conversation => ({
  id: Number(r.id),
  chatId: r.chat_id as string,
  clientKey: r.client_key as string,
  title: r.title as string,
  summary: (r.summary as string | null) ?? "",
  status: r.status as ConversationStatus,
  ownerId: (r.owner_id as string | null) ?? null,
  participants: json<Participant[]>(r.participants_json, []),
  firstAt: instant(r.first_at)!,
  lastAt: instant(r.last_at)!,
  lastWorkAt: instant(r.last_work_at)!,
  windDown: !!r.wind_down,
  itemId: num(r.item_id),
  itemUrl: (r.item_url as string | null) ?? null,
  itemTitle: (r.item_title as string | null) ?? null,
  closedBy: (r.closed_by as string | null) ?? null,
  closedAt: instant(r.closed_at),
  closeReason: (r.close_reason as string | null) ?? null,
  version: Number(r.version ?? 1),
  changeNote: (r.change_note as string | null) ?? null,
  itemChange: r.item_change_kind ? { kind: r.item_change_kind as ItemChange, note: (r.item_change_note as string | null) ?? "", at: instant(r.item_change_at) ?? instant(r.updated_at)!, scope: !!r.item_change_scope } : null,
  likelyItem: num(r.likely_item),
  mergedInto: num(r.merged_into),
  mentions: json<string[]>(r.mentions_json, []),
  createdAt: instant(r.created_at)!,
  updatedAt: instant(r.updated_at)!,
});

const toPlace = (r: Row): MessagePlace => ({
  chatId: r.chat_id as string,
  messageId: r.message_id as string,
  conversationId: num(r.conversation_id),
  role: r.role as MessageRole,
  reason: (r.reason as string | null) ?? null,
  placedBy: r.placed_by as MessagePlace["placedBy"],
  at: instant(r.at)!,
});

const toCommitment = (r: Row): Commitment => ({
  id: Number(r.id),
  conversationId: num(r.conversation_id),
  chatId: r.chat_id as string,
  clientKey: r.client_key as string,
  whoId: (r.who_id as string | null) ?? null,
  whoName: r.who_name as string,
  toId: (r.to_id as string | null) ?? null,
  toName: (r.to_name as string | null) ?? null,
  what: r.what as string,
  dueAt: instant(r.due_at),
  dueDate: (r.due_date as string | null) ?? null,
  impliesItem: !!r.implies_item,
  state: r.state as CommitmentState,
  messageIds: json<string[]>(r.message_ids_json, []),
  followUpId: num(r.follow_up_id),
  itemId: num(r.item_id),
  itemUrl: (r.item_url as string | null) ?? null,
  itemTitle: (r.item_title as string | null) ?? null,
  onToday: (r.on_today as string | null) ?? null,
  remindedAt: instant(r.reminded_at),
  escalatedAt: instant(r.escalated_at),
  takenBy: (r.taken_by as string | null) ?? null,
  takenFrom: (r.taken_from as string | null) ?? null,
  takenAt: instant(r.taken_at),
  reason: (r.reason as string | null) ?? null,
  draft: json<Commitment["draft"]>(r.draft_json, null),
  closeHow: (r.close_how as Commitment["closeHow"] | undefined) ?? null,
  closeNote: (r.close_note as string | null | undefined) ?? null,
  createdAt: instant(r.created_at)!,
  updatedAt: instant(r.updated_at)!,
});

const toMerge = (r: Row): ConversationMerge => ({
  id: Number(r.id),
  intoId: Number(r.into_id),
  fromId: Number(r.from_id),
  byUser: r.by_user as string,
  at: instant(r.at)!,
  moved: json<ConversationMerge["moved"]>(r.moved_json, { messageIds: [], commitmentIds: [], suggestionIds: [] }),
  before: json<ConversationMerge["before"]>(r.before_json, null as never),
  afterSummary: (r.after_summary as string | null) ?? null,
  undoneAt: instant(r.undone_at),
});

const toSuggestion = (r: Row): Suggestion => ({
  id: Number(r.id),
  conversationId: Number(r.conversation_id),
  itemId: Number(r.item_id),
  kind: r.kind as Suggestion["kind"],
  forUser: (r.for_user as string | null) ?? null,
  body: r.body as string,
  before: (r.before_text as string | null) ?? null,
  after: (r.after_text as string | null) ?? null,
  internal: json<string[]>(r.internal_json, []),
  ...(r.names_removed ? { namesRemoved: true } : {}),
  state: r.state as Suggestion["state"],
  writeId: num(r.write_id),
  day: r.day as string,
  createdAt: instant(r.created_at)!,
});

export type NewConversation = {
  chatId: string;
  clientKey: string;
  title: string;
  summary: string;
  participants: Participant[];
  firstAt: string;
  lastAt: string;
  lastWorkAt: string;
  ownerId?: string | null;
  likelyItem?: number | null;
  status?: ConversationStatus;
  item?: { id: number; url: string | null; title: string | null } | null;
  closed?: { by: string | null; at: string; reason: string | null } | null;
  from?: { chatId: string; messageId: string } | null;
  changeNote?: string | null;
};

export type ConversationPatch = Partial<{
  title: string;
  summary: string;
  status: ConversationStatus;
  ownerId: string | null;
  participants: Participant[];
  lastAt: string;
  lastWorkAt: string;
  windDown: boolean;
  item: { id: number; url: string | null; title: string | null } | null;
  closed: { by: string | null; at: string; reason: string | null } | null;
  changeNote: string | null;
  itemChange: { kind: ItemChange; note: string; at: string; scope: boolean } | null;
  likelyItem: number | null;
  /** GD-2: the other clients its messages name (keys). */
  mentions: string[];
}>;

export type NewCommitment = Omit<Commitment, "id" | "createdAt" | "updatedAt" | "followUpId" | "itemId" | "itemUrl" | "itemTitle" | "onToday" | "remindedAt" | "escalatedAt" | "takenBy" | "takenFrom" | "takenAt" | "state" | "draft"> & { state?: CommitmentState; fromPromise?: string | null; createdAt?: string };
export type CommitmentPatch = Partial<Pick<Commitment, "what" | "dueAt" | "dueDate" | "toId" | "toName" | "impliesItem" | "state" | "followUpId" | "itemId" | "itemUrl" | "itemTitle" | "onToday" | "remindedAt" | "escalatedAt" | "takenBy" | "takenFrom" | "takenAt" | "whoId" | "whoName" | "reason" | "messageIds" | "conversationId" | "draft" | "closeHow" | "closeNote">>;

/** What ADM-1's Admin › Status shows (counts only, never text or ids). */
export type ConversationCounts = {
  conversationsByStatus: Record<ConversationStatus, number>;
  messagesByRole: Record<MessageRole, number>;
  commitmentsByState: Record<CommitmentState, number>;
  /** AI calls per registered chat today (by the chat's display name). */
  aiCallsToday: { chatName: string; clientKey: string; calls: number }[];
};

function baseStore(db: Conn, now: () => Temporal.Instant) {
  const stamp = () => now().toString();
  const conversationById = async (id: number) => {
    const r = await db.get("SELECT * FROM conversations WHERE id = ?", [id]);
    return r ? toConversation(r) : null;
  };
  const commitmentById = async (id: number) => {
    const r = await db.get("SELECT * FROM commitments WHERE id = ?", [id]);
    return r ? toCommitment(r) : null;
  };

  const store = {
    // ---- conversations ----
    conversation: conversationById,
    async conversations(chatIds: readonly string[], o: { openOnly?: boolean } = {}): Promise<Conversation[]> {
      const [list, params] = inList(chatIds);
      const open = o.openOnly ? " AND status NOT IN ('resolved', 'closed')" : "";
      // CV-2: a conversation merged into another is kept for Undo, never listed.
      return (await db.all(`SELECT * FROM conversations WHERE chat_id IN (${list}) AND merged_into IS NULL${open} ORDER BY last_at DESC, id DESC`, params)).map(toConversation);
    },
    async fromRequest(chatId: string, messageId: string): Promise<Conversation | null> {
      const r = await db.get("SELECT * FROM conversations WHERE from_chat_id = ? AND from_message_id = ?", [chatId, messageId]);
      return r ? toConversation(r) : null;
    },
    async addConversation(c: NewConversation): Promise<Conversation> {
      if (!c.title.trim()) throw new PlanError("A conversation needs a title");
      return db.tx(async () => {
        const t = stamp();
        const r = await db.run(
          `INSERT INTO conversations (chat_id, client_key, title, summary, status, owner_id, participants_json, first_at, last_at, last_work_at, wind_down, item_id, item_url, item_title, closed_by, closed_at, close_reason, version, change_note, likely_item, from_chat_id, from_message_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          [c.chatId, c.clientKey, c.title.slice(0, 200), c.summary.slice(0, 1000), c.status ?? "new", c.ownerId ?? null, JSON.stringify(c.participants), c.firstAt, c.lastAt, c.lastWorkAt,
            c.item?.id ?? null, c.item?.url ?? null, c.item?.title?.slice(0, 400) ?? null, c.closed?.by ?? null, c.closed?.at ?? null, c.closed?.reason?.slice(0, 400) ?? null,
            c.changeNote?.slice(0, 200) ?? null, c.likelyItem ?? null, c.from?.chatId ?? null, c.from?.messageId ?? null, t, t],
        );
        return (await conversationById(r.lastId!))!;
      });
    },
    /** Changes a conversation; `bump` makes it "Updated" for everyone who saw an older version. */
    async updateConversation(id: number, p: ConversationPatch, o: { bump?: boolean } = {}): Promise<Conversation> {
      return db.tx(async () => {
        const cur = await conversationById(id);
        if (!cur) throw new PlanError("No such conversation");
        const sets: string[] = [];
        const params: Param[] = [];
        const set = (col: string, v: Param) => (sets.push(`${col} = ?`), params.push(v));
        if (p.title !== undefined) set("title", p.title.slice(0, 200));
        if (p.summary !== undefined) set("summary", p.summary.slice(0, 1000));
        if (p.status !== undefined) {
          if (!CONVERSATION_STATUSES.includes(p.status)) throw new PlanError("Not a status");
          set("status", p.status);
        }
        if (p.ownerId !== undefined) set("owner_id", p.ownerId);
        if (p.participants !== undefined) set("participants_json", JSON.stringify(p.participants));
        if (p.lastAt !== undefined) set("last_at", p.lastAt);
        if (p.lastWorkAt !== undefined) set("last_work_at", p.lastWorkAt);
        if (p.windDown !== undefined) set("wind_down", p.windDown ? 1 : 0);
        if (p.item !== undefined) (set("item_id", p.item?.id ?? null), set("item_url", p.item?.url ?? null), set("item_title", p.item?.title?.slice(0, 400) ?? null));
        if (p.closed !== undefined) (set("closed_by", p.closed?.by ?? null), set("closed_at", p.closed?.at ?? null), set("close_reason", p.closed?.reason?.slice(0, 400) ?? null));
        if (p.changeNote !== undefined) set("change_note", p.changeNote?.slice(0, 200) ?? null);
        if (p.itemChange !== undefined) (set("item_change_kind", p.itemChange?.kind ?? null), set("item_change_note", p.itemChange?.note.slice(0, 400) ?? null), set("item_change_at", p.itemChange?.at ?? null), set("item_change_scope", p.itemChange?.scope ? 1 : 0));
        if (p.likelyItem !== undefined) set("likely_item", p.likelyItem);
        if (p.mentions !== undefined) set("mentions_json", p.mentions.length ? JSON.stringify(p.mentions.slice(0, 10)) : null);
        if (o.bump) sets.push("version = version + 1");
        set("updated_at", stamp());
        await db.run(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
        return (await conversationById(id))!;
      });
    },

    // ---- CV-2: Merge into… and its Undo ----
    /**
     * Moves everything of `fromId` (its messages' places, commitments and suggestions) into `intoId`, in one
     * transaction: people joined, first and last times widened, the item carried over when the target has none, and
     * `fromId` marked merged (kept for Undo). `summary` is the new title and summary (AI or the two joined).
     */
    async merge(fromId: number, intoId: number, by: string, summary: { title: string; summary: string }): Promise<ConversationMerge> {
      return db.tx(async () => {
        const from = await conversationById(fromId);
        const into = await conversationById(intoId);
        if (!from || !into || from.mergedInto !== null || into.mergedInto !== null) throw new PlanError("No such conversation");
        if (from.id === into.id) throw new PlanError("Pick another conversation to merge into");
        if (from.chatId !== into.chatId) throw new PlanError("Merge only conversations of the same chat");
        const t = stamp();
        const messageIds = (await db.all("SELECT message_id FROM conversation_messages WHERE conversation_id = ? ORDER BY at, message_id", [fromId])).map((r) => r.message_id as string);
        const commitmentIds = (await db.all("SELECT id FROM commitments WHERE conversation_id = ? ORDER BY id", [fromId])).map((r) => Number(r.id));
        const suggestionIds = (await db.all("SELECT id FROM conversation_suggestions WHERE conversation_id = ? ORDER BY id", [fromId])).map((r) => Number(r.id));
        await db.run("UPDATE conversation_messages SET conversation_id = ?, updated_at = ? WHERE conversation_id = ?", [intoId, t, fromId]);
        await db.run("UPDATE commitments SET conversation_id = ?, updated_at = ? WHERE conversation_id = ?", [intoId, t, fromId]);
        await db.run("UPDATE conversation_suggestions SET conversation_id = ?, updated_at = ? WHERE conversation_id = ?", [intoId, t, fromId]);
        const people = [...into.participants];
        for (const p of from.participants) if (!people.some((x) => x.id.toLowerCase() === p.id.toLowerCase())) people.push(p);
        const minAt = (a: string, b: string) => (Date.parse(a) <= Date.parse(b) ? a : b);
        const maxAt = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);
        const carry = !into.itemId && from.itemId;
        await db.run(
          `UPDATE conversations SET title = ?, summary = ?, participants_json = ?, first_at = ?, last_at = ?, last_work_at = ?, owner_id = ?, item_id = ?, item_url = ?, item_title = ?, likely_item = ?, change_note = ?, version = version + 1, updated_at = ? WHERE id = ?`,
          [summary.title.slice(0, 200) || into.title, summary.summary.slice(0, 1000), JSON.stringify(people), minAt(into.firstAt, from.firstAt), maxAt(into.lastAt, from.lastAt), maxAt(into.lastWorkAt, from.lastWorkAt), into.ownerId ?? from.ownerId,
            carry ? from.itemId : into.itemId, carry ? from.itemUrl : into.itemUrl, carry ? from.itemTitle : into.itemTitle, into.likelyItem ?? from.likelyItem, `Merged with "${from.title}"`.slice(0, 200), t, intoId],
        );
        await db.run("UPDATE conversations SET merged_into = ?, version = version + 1, updated_at = ? WHERE id = ?", [intoId, t, fromId]);
        const before: ConversationMerge["before"] = {
          into: { title: into.title, summary: into.summary, participants: into.participants, firstAt: into.firstAt, lastAt: into.lastAt, lastWorkAt: into.lastWorkAt, ownerId: into.ownerId, itemId: into.itemId, itemUrl: into.itemUrl, itemTitle: into.itemTitle, likelyItem: into.likelyItem },
          from: { status: from.status, closedAt: from.closedAt, closedBy: from.closedBy, closeReason: from.closeReason },
        };
        const r = await db.run("INSERT INTO conversation_merges (into_id, from_id, by_user, at, moved_json, before_json, after_summary) VALUES (?, ?, ?, ?, ?, ?, ?)", [intoId, fromId, by, t, JSON.stringify({ messageIds, commitmentIds, suggestionIds }), JSON.stringify(before), summary.summary.slice(0, 1000)]);
        return toMerge((await db.get("SELECT * FROM conversation_merges WHERE id = ?", [r.lastId!]))!);
      });
    },
    /** IB-1 slice 4: what a merge would move out of this conversation (the same rows merge moves), as counts. */
    async contents(id: number): Promise<{ messages: number; commitments: number; suggestions: number }> {
      const count = async (table: string) => Number((await db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE conversation_id = ?`, [id]))?.n ?? 0);
      return { messages: await count("conversation_messages"), commitments: await count("commitments"), suggestions: await count("conversation_suggestions") };
    },
    async mergeRecord(id: number): Promise<ConversationMerge | null> {
      const r = await db.get("SELECT * FROM conversation_merges WHERE id = ?", [id]);
      return r ? toMerge(r) : null;
    },
    /**
     * Undo of a merge: what moved goes back (only what is still in the target), the merged one is listed again, and
     * the target's own fields return to what they were while nobody changed its summary since (new messages since the
     * merge keep it as it is now). Refused once undone.
     */
    async unmerge(id: number): Promise<ConversationMerge> {
      return db.tx(async () => {
        const m = await store.mergeRecord(id);
        if (!m) throw new PlanError("No such merge");
        if (m.undoneAt) throw new PlanError("That merge was already undone");
        const into = await conversationById(m.intoId);
        const from = await conversationById(m.fromId);
        if (!into || !from || from.mergedInto !== m.intoId) throw new PlanError("That merge can't be undone any more");
        const t = stamp();
        const [ml, mp] = inList(m.moved.messageIds);
        if (m.moved.messageIds.length) await db.run(`UPDATE conversation_messages SET conversation_id = ?, updated_at = ? WHERE conversation_id = ? AND chat_id = ? AND message_id IN (${ml})`, [m.fromId, t, m.intoId, into.chatId, ...mp]);
        const [cl, cp] = inList(m.moved.commitmentIds);
        if (m.moved.commitmentIds.length) await db.run(`UPDATE commitments SET conversation_id = ?, updated_at = ? WHERE conversation_id = ? AND id IN (${cl})`, [m.fromId, t, m.intoId, ...cp]);
        const [sl, sp] = inList(m.moved.suggestionIds);
        if (m.moved.suggestionIds.length) await db.run(`UPDATE conversation_suggestions SET conversation_id = ?, updated_at = ? WHERE conversation_id = ? AND id IN (${sl})`, [m.fromId, t, m.intoId, ...sp]);
        const b = m.before.into;
        const untouched = into.summary === (m.afterSummary ?? into.summary);
        const lastAt = untouched ? b.lastAt : into.lastAt;
        const lastWorkAt = untouched ? b.lastWorkAt : into.lastWorkAt;
        // The item the merge carried over (the target had none) goes back with its conversation.
        const carried = !b.itemId && !!from.itemId && into.itemId === from.itemId;
        const item = carried ? { id: null, url: null, title: null } : { id: into.itemId, url: into.itemUrl, title: into.itemTitle };
        await db.run(
          `UPDATE conversations SET ${untouched ? "title = ?, summary = ?, " : ""}participants_json = ?, first_at = ?, last_at = ?, last_work_at = ?, owner_id = ?, item_id = ?, item_url = ?, item_title = ?, likely_item = ?, change_note = ?, version = version + 1, updated_at = ? WHERE id = ?`,
          [...(untouched ? [b.title, b.summary] : []), JSON.stringify(untouched ? b.participants : into.participants), b.firstAt, lastAt, lastWorkAt, b.ownerId, item.id, item.url, item.title, b.likelyItem, "Merge undone", t, m.intoId],
        );
        await db.run("UPDATE conversations SET merged_into = NULL, version = version + 1, change_note = ?, updated_at = ? WHERE id = ?", ["Merge undone", t, m.fromId]);
        await db.run("UPDATE conversation_merges SET undone_at = ? WHERE id = ?", [t, id]);
        return (await store.mergeRecord(id))!;
      });
    },

    // ---- message places ----
    /** Each message's place, replaced as a whole (the pipeline, Move, Split, This is work). */
    async place(ps: readonly (Omit<MessagePlace, "placedBy"> & { placedBy: MessagePlace["placedBy"]; byUser?: string | null })[]): Promise<void> {
      if (!ps.length) return;
      await db.tx(async () => {
        const t = stamp();
        for (const p of ps) {
          if (!MESSAGE_ROLES.includes(p.role)) throw new PlanError("Not a role");
          const had = await db.get("SELECT 1 AS x FROM conversation_messages WHERE chat_id = ? AND message_id = ?", [p.chatId, p.messageId]);
          if (had) await db.run("UPDATE conversation_messages SET conversation_id = ?, role = ?, reason = ?, placed_by = ?, placed_by_user = ?, at = ?, updated_at = ? WHERE chat_id = ? AND message_id = ?", [p.conversationId, p.role, p.reason?.slice(0, 40) ?? null, p.placedBy, p.byUser ?? null, p.at, t, p.chatId, p.messageId]);
          else await db.run("INSERT INTO conversation_messages (chat_id, message_id, conversation_id, role, reason, placed_by, placed_by_user, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [p.chatId, p.messageId, p.conversationId, p.role, p.reason?.slice(0, 40) ?? null, p.placedBy, p.byUser ?? null, p.at, t]);
        }
      });
    },
    async placeOf(chatId: string, messageId: string): Promise<MessagePlace | null> {
      const r = await db.get("SELECT * FROM conversation_messages WHERE chat_id = ? AND message_id = ?", [chatId, messageId]);
      return r ? toPlace(r) : null;
    },
    async placesIn(conversationIds: readonly number[]): Promise<MessagePlace[]> {
      const [list, params] = inList(conversationIds);
      return (await db.all(`SELECT * FROM conversation_messages WHERE conversation_id IN (${list}) ORDER BY at, message_id`, params)).map(toPlace);
    },
    /** Messages of these chats in one role (chatter for "Filtered as chatter", unsorted for "Sort unsorted"). */
    async placesByRole(chatIds: readonly string[], role: MessageRole): Promise<MessagePlace[]> {
      const [list, params] = inList(chatIds);
      return (await db.all(`SELECT * FROM conversation_messages WHERE chat_id IN (${list}) AND role = ? ORDER BY at, message_id`, [...params, role])).map(toPlace);
    },

    /** DX-1 Diagnostics: these chats' places from a time on, with who placed each (counts only; never text). */
    async placesSince(chatIds: readonly string[], since: string): Promise<(MessagePlace & { byUser: string | null })[]> {
      const [list, params] = inList(chatIds);
      return (await db.all(`SELECT * FROM conversation_messages WHERE chat_id IN (${list}) AND at >= ? ORDER BY at, message_id`, [...params, since])).map((r) => ({ ...toPlace(r), byUser: (r.placed_by_user as string | null) ?? null }));
    },

    // ---- commitments ----
    commitment: commitmentById,
    async commitmentsIn(conversationIds: readonly number[]): Promise<Commitment[]> {
      const [list, params] = inList(conversationIds);
      return (await db.all(`SELECT * FROM commitments WHERE conversation_id IN (${list}) ORDER BY created_at, id`, params)).map(toCommitment);
    },
    async commitmentsInChat(chatId: string): Promise<Commitment[]> {
      return (await db.all("SELECT * FROM commitments WHERE chat_id = ? ORDER BY created_at, id", [chatId])).map(toCommitment);
    },
    /** IB-1 Waiting on: commitments made to one person in these chats (the caller decides which chats they see). */
    async commitmentsTo(toId: string, chatIds: readonly string[]): Promise<Commitment[]> {
      const [list, params] = inList(chatIds);
      return (await db.all(`SELECT * FROM commitments WHERE LOWER(to_id) = ? AND chat_id IN (${list}) ORDER BY created_at DESC, id DESC`, [toId.toLowerCase(), ...params])).map(toCommitment);
    },
    /** One person's commitments in these chats (My promises; the caller decides which chats they see). */
    async commitmentsBy(whoId: string, chatIds: readonly string[]): Promise<Commitment[]> {
      const [list, params] = inList(chatIds);
      return (await db.all(`SELECT * FROM commitments WHERE LOWER(who_id) = ? AND chat_id IN (${list}) ORDER BY created_at DESC, id DESC`, [whoId.toLowerCase(), ...params])).map(toCommitment);
    },
    /** Open commitments that imply an item and have none linked yet (the escalation job; CV-5: a linked one stays open). */
    async openItemCommitments(): Promise<Commitment[]> {
      return (await db.all("SELECT * FROM commitments WHERE state = 'open' AND implies_item = 1 AND item_id IS NULL ORDER BY created_at, id")).map(toCommitment);
    },
    async fromPromise(key: string): Promise<Commitment | null> {
      const r = await db.get("SELECT * FROM commitments WHERE from_promise = ?", [key]);
      return r ? toCommitment(r) : null;
    },
    async addCommitment(c: NewCommitment): Promise<Commitment> {
      return db.tx(async () => {
        const t = stamp();
        const r = await db.run(
          `INSERT INTO commitments (conversation_id, chat_id, client_key, who_id, who_name, to_id, to_name, what, due_at, due_date, implies_item, state, message_ids_json, reason, from_promise, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c.conversationId, c.chatId, c.clientKey, c.whoId, c.whoName.slice(0, 200), c.toId, c.toName?.slice(0, 200) ?? null, c.what.slice(0, 200), c.dueAt, c.dueDate, c.impliesItem ? 1 : 0, c.state ?? "open", JSON.stringify(c.messageIds), c.reason?.slice(0, 400) ?? null, c.fromPromise ?? null, c.createdAt ?? t, t],
        );
        return (await commitmentById(r.lastId!))!;
      });
    },
    /** CV-3b: the one-time repair: a commitment made "to" its own committer (by id or by name) has no "to". The count. */
    async clearSelfTo(): Promise<number> {
      return db.tx(async () => {
        const norm = (x: string | null) => (x ?? "").trim().replace(/\s+/g, " ").toLowerCase();
        let n = 0;
        for (const k of (await db.all("SELECT * FROM commitments WHERE to_id IS NOT NULL OR to_name IS NOT NULL")).map(toCommitment)) {
          const self = (!!k.toId && !!k.whoId && k.toId.toLowerCase() === k.whoId.toLowerCase()) || (!!norm(k.toName) && norm(k.toName) === norm(k.whoName));
          if (!self) continue;
          await db.run("UPDATE commitments SET to_id = NULL, to_name = NULL WHERE id = ?", [k.id]);
          n++;
        }
        return n;
      });
    },
    async updateCommitment(id: number, p: CommitmentPatch): Promise<Commitment> {
      return db.tx(async () => {
        if (!(await commitmentById(id))) throw new PlanError("No such commitment");
        const cols: Record<keyof CommitmentPatch, string> = {
          what: "what", dueAt: "due_at", dueDate: "due_date", toId: "to_id", toName: "to_name", impliesItem: "implies_item", state: "state", followUpId: "follow_up_id", itemId: "item_id",
          itemUrl: "item_url", itemTitle: "item_title", onToday: "on_today", remindedAt: "reminded_at", escalatedAt: "escalated_at", takenBy: "taken_by", takenFrom: "taken_from", takenAt: "taken_at", whoId: "who_id", whoName: "who_name",
          reason: "reason", messageIds: "message_ids_json", conversationId: "conversation_id", draft: "draft_json", closeHow: "close_how", closeNote: "close_note",
        };
        const sets: string[] = [];
        const params: Param[] = [];
        for (const [k, v] of Object.entries(p) as [keyof CommitmentPatch, unknown][]) {
          if (v === undefined) continue;
          if (k === "state" && !COMMITMENT_STATES.includes(v as CommitmentState)) throw new PlanError("Not a state");
          sets.push(`${cols[k]} = ?`);
          params.push(k === "impliesItem" ? (v ? 1 : 0) : k === "messageIds" ? JSON.stringify(v) : k === "draft" ? (v ? JSON.stringify(v) : null) : (v as Param));
        }
        sets.push("updated_at = ?");
        params.push(stamp());
        await db.run(`UPDATE commitments SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
        return (await commitmentById(id))!;
      });
    },

    // ---- suggestions ----
    async addSuggestion(x: Omit<Suggestion, "id" | "createdAt" | "state" | "writeId">): Promise<Suggestion> {
      return db.tx(async () => {
        const t = stamp();
        const r = await db.run(
          "INSERT INTO conversation_suggestions (conversation_id, item_id, kind, for_user, body, before_text, after_text, internal_json, names_removed, state, day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
          [x.conversationId, x.itemId, x.kind, x.forUser, x.body, x.before, x.after, x.internal.length ? JSON.stringify(x.internal) : null, x.namesRemoved ? 1 : null, x.day, t, t],
        );
        return toSuggestion((await db.get("SELECT * FROM conversation_suggestions WHERE id = ?", [r.lastId!]))!);
      });
    },
    async suggestion(id: number): Promise<Suggestion | null> {
      const r = await db.get("SELECT * FROM conversation_suggestions WHERE id = ?", [id]);
      return r ? toSuggestion(r) : null;
    },
    async suggestionsIn(conversationIds: readonly number[]): Promise<Suggestion[]> {
      const [list, params] = inList(conversationIds);
      return (await db.all(`SELECT * FROM conversation_suggestions WHERE conversation_id IN (${list}) ORDER BY created_at DESC, id DESC`, params)).map(toSuggestion);
    },
    /** Whether an item already had a suggestion today (at most one a day per item). */
    async suggestedOn(itemId: number, day: string): Promise<boolean> {
      return !!(await db.get("SELECT 1 AS x FROM conversation_suggestions WHERE item_id = ? AND day = ?", [itemId, day]));
    },
    async settleSuggestion(id: number, state: "posted" | "skipped" | "open", writeId: number | null = null): Promise<void> {
      await db.tx(() => db.run("UPDATE conversation_suggestions SET state = ?, write_id = COALESCE(?, write_id), updated_at = ? WHERE id = ?", [state, writeId, stamp(), id]));
    },

    // ---- the pipeline's AI ----
    /** One more AI call for a chat today; returns the new count. */
    async countAiCall(chatId: string, day: string): Promise<number> {
      return db.tx(async () => {
        const r = await db.get("SELECT calls FROM chat_ai_days WHERE chat_id = ? AND day = ?", [chatId, day]);
        if (r) await db.run("UPDATE chat_ai_days SET calls = calls + 1 WHERE chat_id = ? AND day = ?", [chatId, day]);
        else await db.run("INSERT INTO chat_ai_days (chat_id, day, calls) VALUES (?, ?, 1)", [chatId, day]);
        return Number(r?.calls ?? 0) + 1;
      });
    },
    async aiCalls(chatId: string, day: string): Promise<number> {
      return Number((await db.get("SELECT calls FROM chat_ai_days WHERE chat_id = ? AND day = ?", [chatId, day]))?.calls ?? 0);
    },
    /** The app's request log for the pipeline (counts, cost and outcome; never text). */
    appAiLog: {
      async add(e: AiLogEntry): Promise<void> {
        await db.tx(() => db.run("INSERT INTO app_ai_requests (at, task, client_key, model, input_tokens, output_tokens, cost_micros, latency_ms, outcome, detail, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [Temporal.Instant.from(e.at).toString(), e.task.slice(0, 64), e.clientKey?.slice(0, 100) ?? null, e.model.slice(0, 100), Math.round(e.inputTokens), Math.round(e.outputTokens), Math.round(e.costMicros), Math.round(e.latencyMs), e.outcome, e.detail?.slice(0, 40) ?? null, e.tier === "flex" ? "flex" : "standard"]));
      },
      async spentMicros(fromIso: string, toIso: string): Promise<number> {
        return Number((await db.get("SELECT COALESCE(SUM(cost_micros), 0) AS n FROM app_ai_requests WHERE at >= ? AND at < ?", [fromIso, toIso]))?.n ?? 0);
      },
      async recent(limit: number): Promise<AiLogEntry[]> {
        const n = Math.max(1, Math.min(limit, 200));
        const rows = await db.all(db.dialect === "sqlserver" ? `SELECT TOP (${n}) * FROM app_ai_requests ORDER BY id DESC` : `SELECT * FROM app_ai_requests ORDER BY id DESC LIMIT ${n}`);
        return rows.map((r) => ({ at: instant(r.at)!, task: r.task as string, clientKey: (r.client_key as string | null) ?? null, model: r.model as string, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), costMicros: Number(r.cost_micros), latencyMs: Number(r.latency_ms), outcome: r.outcome as AiLogEntry["outcome"], detail: (r.detail as string | null) ?? null, cap: "app" as const, tier: r.tier === "flex" ? "flex" as const : "standard" as const }));
      },
    },

    /** Places of messages the store no longer has (expired or purged) are dropped with them. */
    async dropOrphans(): Promise<number> {
      return db.tx(async () => (await db.run("DELETE FROM conversation_messages WHERE NOT EXISTS (SELECT 1 FROM teams_messages m WHERE m.chat_id = conversation_messages.chat_id AND m.message_id = conversation_messages.message_id)")).changes);
    },

    /** Counts for Admin › Status (ADM-1): never text, never ids. */
    async counts(day: string): Promise<ConversationCounts> {
      const by = async (sql: string, keys: readonly string[]) => {
        const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;
        for (const r of await db.all(sql)) out[r.k as string] = Number(r.n);
        return out;
      };
      const calls = await db.all("SELECT c.display_name, c.client_key, COALESCE(d.calls, 0) AS calls FROM client_chats c LEFT JOIN chat_ai_days d ON d.chat_id = c.chat_id AND d.day = ? ORDER BY c.client_key, c.position", [day]);
      return {
        conversationsByStatus: (await by("SELECT status AS k, COUNT(*) AS n FROM conversations GROUP BY status", CONVERSATION_STATUSES)) as Record<ConversationStatus, number>,
        messagesByRole: (await by("SELECT role AS k, COUNT(*) AS n FROM conversation_messages GROUP BY role", MESSAGE_ROLES)) as Record<MessageRole, number>,
        commitmentsByState: (await by("SELECT state AS k, COUNT(*) AS n FROM commitments GROUP BY state", COMMITMENT_STATES)) as Record<CommitmentState, number>,
        aiCallsToday: calls.map((r) => ({ chatName: r.display_name as string, clientKey: r.client_key as string, calls: Number(r.calls) })),
      };
    },
  };
  return store;
}

type BaseStore = ReturnType<typeof baseStore>;
const noConversation = () => new PlanError("No such conversation");

/** MC-1: commitments from a registered meeting live in a "chat" of their own, `meeting:<series id>` (no Teams chat). */
export const MEETING_CHAT = "meeting:";
export const isMeetingChat = (chatId: string) => chatId.startsWith(MEETING_CHAT);
/** MC-1: whether a person may see a meeting "chat" (a reviewer or attendee of that series); none without the meeting store. */
export type MeetingMember = (chatId: string, userId: string) => Promise<boolean>;

export function createConversationStore(db: Conn, now: () => Temporal.Instant, teams: TeamsStore, meetingMember?: MeetingMember) {
  const store = baseStore(db, now);
  return { ...store, viewer: (userId: string) => viewerOf(store, teams, userId, meetingMember) };
}

/**
 * One person's way into the shared conversations (D521): only chats they are a member of now, by the cached member
 * list. Anything else reads as missing or is refused as "No such conversation".
 */
function viewerOf(store: BaseStore, teams: TeamsStore, userId: string, meetingMember?: MeetingMember) {
  const member = async (chatId: string) => {
    if (isMeetingChat(chatId)) return meetingMember ? meetingMember(chatId, userId).catch(() => false) : false;
    const c = await teams.chat(chatId);
    return !!c && isMember(c, userId);
  };
  const gate = async (id: number) => {
    const c = await store.conversation(id);
    if (!c || !(await member(c.chatId))) throw noConversation();
    return c;
  };
  const chatsSeen = async (chatIds: readonly string[]) => {
    const out: string[] = [];
    for (const id of chatIds) if (await member(id)) out.push(id);
    return out;
  };
  return {
    userId,
    gate,
    async conversation(id: number): Promise<Conversation | null> {
      return gate(id).catch(() => null);
    },
    async conversations(chatIds: readonly string[], o: { openOnly?: boolean } = {}): Promise<Conversation[]> {
      return store.conversations(await chatsSeen(chatIds), o);
    },
    async placesIn(ids: readonly number[]): Promise<MessagePlace[]> {
      const ok: number[] = [];
      for (const id of ids) if (await this.conversation(id)) ok.push(id);
      return store.placesIn(ok);
    },
    async placesByRole(chatIds: readonly string[], role: MessageRole): Promise<MessagePlace[]> {
      return store.placesByRole(await chatsSeen(chatIds), role);
    },
    async placesSince(chatIds: readonly string[], since: string): Promise<(MessagePlace & { byUser: string | null })[]> {
      return store.placesSince(await chatsSeen(chatIds), since);
    },
    async placeOf(chatId: string, messageId: string): Promise<MessagePlace | null> {
      return (await member(chatId)) ? store.placeOf(chatId, messageId) : null;
    },
    async place(ps: Parameters<BaseStore["place"]>[0]): Promise<void> {
      for (const p of ps) if (!(await member(p.chatId))) throw noConversation();
      for (const p of ps) if (p.conversationId !== null) {
        const c = await gate(p.conversationId);
        if (c.chatId !== p.chatId) throw new PlanError("That message is in another chat");
      }
      await store.place(ps.map((p) => ({ ...p, byUser: userId })));
    },
    async updateConversation(id: number, p: ConversationPatch, o: { bump?: boolean } = {}): Promise<Conversation> {
      await gate(id);
      return store.updateConversation(id, p, o);
    },
    async addConversation(c: NewConversation): Promise<Conversation> {
      if (!(await member(c.chatId))) throw noConversation();
      return store.addConversation(c);
    },
    /** CV-2: Merge into…, by me: both conversations must be ones I see (and of the same chat, checked by the store). */
    async merge(fromId: number, intoId: number, summary: { title: string; summary: string }): Promise<ConversationMerge> {
      await gate(fromId);
      await gate(intoId);
      return store.merge(fromId, intoId, userId, summary);
    },
    /** IB-1 slice 4: the counts the merge preview shows, only for a conversation I see. */
    async contents(id: number): Promise<{ messages: number; commitments: number; suggestions: number }> {
      await gate(id);
      return store.contents(id);
    },
    async unmerge(id: number): Promise<ConversationMerge> {
      const m = await store.mergeRecord(id);
      if (!m) throw new PlanError("No such merge");
      await gate(m.intoId);
      return store.unmerge(id);
    },
    async commitmentsIn(ids: readonly number[]): Promise<Commitment[]> {
      const ok: number[] = [];
      for (const id of ids) if (await this.conversation(id)) ok.push(id);
      return store.commitmentsIn(ok);
    },
    // MC-1: a meeting commitment made by me (or to me, Waiting on) stays mine to keep or dismiss even after I'm no
    // longer on the call's invite: these queries already return only my own.
    async commitmentsBy(chatIds: readonly string[]): Promise<Commitment[]> {
      return store.commitmentsBy(userId, [...(await chatsSeen(chatIds.filter((c) => !isMeetingChat(c)))), ...chatIds.filter(isMeetingChat)]);
    },
    async commitmentsTo(chatIds: readonly string[]): Promise<Commitment[]> {
      return store.commitmentsTo(userId, [...(await chatsSeen(chatIds.filter((c) => !isMeetingChat(c)))), ...chatIds.filter(isMeetingChat)]);
    },
    async commitment(id: number): Promise<Commitment | null> {
      const c = await store.commitment(id);
      if (!c) return null;
      if (isMeetingChat(c.chatId) && ((!!c.whoId && c.whoId.toLowerCase() === userId.toLowerCase()) || (!!c.toId && c.toId.toLowerCase() === userId.toLowerCase()))) return c;
      return (await member(c.chatId)) ? c : null;
    },
    async updateCommitment(id: number, p: CommitmentPatch): Promise<Commitment> {
      if (!(await this.commitment(id))) throw new PlanError("No such commitment");
      return store.updateCommitment(id, p);
    },
    async suggestionsIn(ids: readonly number[]): Promise<Suggestion[]> {
      const ok: number[] = [];
      for (const id of ids) if (await this.conversation(id)) ok.push(id);
      return store.suggestionsIn(ok);
    },
    async suggestion(id: number): Promise<Suggestion | null> {
      const s = await store.suggestion(id);
      return s && (await this.conversation(s.conversationId)) ? s : null;
    },
    async settleSuggestion(id: number, state: "posted" | "skipped" | "open", writeId: number | null = null): Promise<void> {
      if (!(await this.suggestion(id))) throw new PlanError("No such suggestion");
      await store.settleSuggestion(id, state, writeId);
    },
  };
}

export type ConversationStore = ReturnType<typeof createConversationStore>;
export type ConversationView = ReturnType<ConversationStore["viewer"]>;
