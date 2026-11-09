// TB-1: the bot's two user tables (store/migrations/20261109T1000_teams_bot.ts), scoped to one person by
// store/scope.ts like every plan row. The chat row is where the person's 1:1 chat with the bot is (kept for later
// steps; TB-1 sends nothing from it on its own). The card rows make Confirm safe to tap twice: `claim` moves a card
// from open to running in one UPDATE, so only one tap runs it. The seen rows (TB-1b) make a message Teams delivers
// twice, to one replica or two, answered once. Nothing here logs, and no message text is kept.
import { createHash } from "node:crypto";
import { scopedDb } from "./scope.ts";
import type { Conn, Row } from "./sql/conn.ts";

export type BotChat = { conversationId: string; serviceUrl: string; tenantId: string; botId: string; firstAt: string; seenAt: string; removedAt: string | null };
/** open: waiting for a tap. running: a tap is being handled. Settled: done, failed, expired, cancelled, replaced. */
export type CardState = "open" | "running" | "done" | "failed" | "expired" | "cancelled" | "replaced";
export const SETTLED: ReadonlySet<CardState> = new Set(["done", "failed", "expired", "cancelled", "replaced"]);
export type BotCard = { proposalId: string; activityId: string | null; title: string; state: CardState; card: unknown | null; expiresAt: string; updatedAt: string };

const MAX_ID = 100;
/** The bot's user tables: Teams addresses, card state and handled activity ids; no content. */
export const BOT_TABLES = ["teams_bot_chats", "teams_bot_cards", "teams_bot_seen", "teams_rhythm"] as const;
const short = (v: string, n: number) => {
  if (!v || v.length > n) throw new Error("Not an id");
  return v;
};

export function createTeamsBotStore(o: { db: Conn; userId: string; now: () => Temporal.Instant }) {
  const db = scopedDb(o.db, o.userId);
  const stamp = () => o.now().toString();
  const toCard = (r: Row): BotCard => ({
    proposalId: r.proposal_id as string,
    activityId: (r.activity_id as string | null) ?? null,
    title: r.title as string,
    state: r.state as CardState,
    card: typeof r.card_json === "string" && r.card_json ? (JSON.parse(r.card_json) as unknown) : null,
    expiresAt: String(r.expires_at),
    updatedAt: String(r.updated_at),
  });
  return {
    async chat(): Promise<BotChat | null> {
      const r = await db.get("SELECT conversation_id, service_url, tenant_id, bot_id, first_at, seen_at, removed_at FROM teams_bot_chats");
      if (!r) return null;
      return { conversationId: r.conversation_id as string, serviceUrl: r.service_url as string, tenantId: r.tenant_id as string, botId: r.bot_id as string, firstAt: String(r.first_at), seenAt: String(r.seen_at), removedAt: r.removed_at == null ? null : String(r.removed_at) };
    },
    /** Keeps where the person's 1:1 chat is (their first message, a later one, or an install). */
    async saveChat(c: { conversationId: string; serviceUrl: string; tenantId: string; botId: string }): Promise<void> {
      const at = stamp();
      const args = [short(c.conversationId, 400), short(c.serviceUrl, 400), short(c.tenantId, 64), short(c.botId, 200)] as const;
      await db.tx(async () => {
        const u = await db.run("UPDATE teams_bot_chats SET conversation_id = ?, service_url = ?, tenant_id = ?, bot_id = ?, seen_at = ?, removed_at = NULL", ...args, at);
        if (u.changes === 0) await db.run("INSERT INTO teams_bot_chats (conversation_id, service_url, tenant_id, bot_id, first_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)", ...args, at, at);
      });
    },
    /** They removed the app: the chat is kept as removed (nothing can be sent there). */
    async chatRemoved(): Promise<void> {
      await db.tx(async () => {
        await db.run("UPDATE teams_bot_chats SET removed_at = ? WHERE removed_at IS NULL", stamp());
      });
    },

    /** A proposal card was sent (its message id when Teams gave one). */
    async cardSent(proposalId: string, activityId: string | null, expiresAt: string, title: string): Promise<void> {
      const at = stamp();
      const t = title.trim().slice(0, 300) || "This change";
      await db.tx(async () => {
        const u = await db.run("UPDATE teams_bot_cards SET activity_id = COALESCE(?, activity_id), expires_at = ?, updated_at = ? WHERE proposal_id = ?", activityId, expiresAt, at, short(proposalId, MAX_ID));
        if (u.changes === 0) await db.run("INSERT INTO teams_bot_cards (proposal_id, activity_id, title, state, expires_at, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?)", proposalId, activityId, t, expiresAt, at, at);
      });
    },
    async card(proposalId: string): Promise<BotCard | null> {
      const r = await db.get("SELECT proposal_id, activity_id, title, state, card_json, expires_at, updated_at FROM teams_bot_cards WHERE proposal_id = ?", short(proposalId, MAX_ID));
      return r ? toCard(r) : null;
    },
    /** One tap wins: true when this call moved the card from open to running. */
    async claim(proposalId: string): Promise<boolean> {
      return db.tx(async () => (await db.run("UPDATE teams_bot_cards SET state = 'running', updated_at = ? WHERE proposal_id = ? AND state = 'open'", stamp(), short(proposalId, MAX_ID))).changes === 1);
    },
    /** Back to open (a tap whose confirm couldn't be reached at all, so a later tap may try again). */
    async release(proposalId: string): Promise<void> {
      await db.tx(async () => {
        await db.run("UPDATE teams_bot_cards SET state = 'open', updated_at = ? WHERE proposal_id = ? AND state = 'running'", stamp(), short(proposalId, MAX_ID));
      });
    },
    /** TB-3: the same proposal has a new preview on this card (changed since, or Refresh): it can be tapped again. */
    async reopen(proposalId: string): Promise<boolean> {
      return db.tx(async () => (await db.run("UPDATE teams_bot_cards SET state = 'open', card_json = NULL, updated_at = ? WHERE proposal_id = ? AND state IN ('running', 'expired', 'replaced')", stamp(), short(proposalId, MAX_ID))).changes === 1);
    },
    /** The card's final state and the card that shows it. */
    async settle(proposalId: string, state: CardState, card: unknown): Promise<void> {
      await db.tx(async () => {
        await db.run("UPDATE teams_bot_cards SET state = ?, card_json = ?, updated_at = ? WHERE proposal_id = ?", state, JSON.stringify(card), stamp(), short(proposalId, MAX_ID));
      });
    },
    /**
     * TB-1b: true the first time this Teams activity id is recorded for the person (a unique insert, so of two
     * replicas handling one delivery only one gets true). Only a hash of the id is kept, for a day.
     */
    async firstSeen(activityId: string): Promise<boolean> {
      const at = o.now();
      const hash = createHash("sha256").update(activityId).digest("hex");
      return db.tx(async () => {
        const r = await db.run("INSERT INTO teams_bot_seen (activity_hash, seen_at) VALUES (?, ?) ON CONFLICT (activity_hash) DO NOTHING", hash, at.toString());
        await db.run("DELETE FROM teams_bot_seen WHERE seen_at < ?", at.subtract({ hours: 24 }).toString());
        return r.changes === 1;
      });
    },
    /** TB-1b: everything the bot keeps for the person (Delete my data removes it at once). */
    async forget(): Promise<void> {
      await db.tx(async () => {
        for (const t of BOT_TABLES) await db.run(`DELETE FROM ${t}`);
      });
    },
  };
}
export type TeamsBotStore = ReturnType<typeof createTeamsBotStore>;
