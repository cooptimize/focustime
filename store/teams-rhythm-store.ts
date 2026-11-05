// TB-2: the claims behind the bot's own messages (store/migrations/20261111T0900_teams_rhythm.ts), scoped to one
// person by store/scope.ts like every plan row. `claim` is a unique insert: the replica whose insert lands sends, any
// other sees false and sends nothing. A claim that never got Teams' message id is lost, never sent again (`sweep`
// marks it and the caller logs it). The row keeps the card's own state so a tap can redraw it in place.
import { scopedDb } from "./scope.ts";
import type { Conn, Row } from "./sql/conn.ts";

/** claimed: inserted, sending. sent: Teams took it. failed: Teams refused it. skipped: nothing to say. lost: never confirmed. */
export type RhythmState = "claimed" | "sent" | "failed" | "skipped" | "lost";
export type RhythmRow = { occasion: string; kind: string; state: RhythmState; activityId: string | null; model: unknown | null; createdAt: string; updatedAt: string };

const OCCASION = /^[A-Za-z0-9_.:+-]{1,120}$/;
const occ = (o: string) => {
  if (!OCCASION.test(o)) throw new Error("Not an occasion");
  return o;
};
/** A claim older than this with no message id was lost on the way (a crash, a restart). */
export const LOST_AFTER_MINUTES = 10;

export function createTeamsRhythmStore(o: { db: Conn; userId: string; now: () => Temporal.Instant }) {
  const db = scopedDb(o.db, o.userId);
  const stamp = () => o.now().toString();
  const toRow = (r: Row): RhythmRow => ({
    occasion: r.occasion as string,
    kind: r.kind as string,
    state: r.state as RhythmState,
    activityId: (r.activity_id as string | null) ?? null,
    model: typeof r.model_json === "string" && r.model_json ? (JSON.parse(r.model_json) as unknown) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });
  return {
    /** True when this call inserted the occasion (only one caller ever gets true for it). */
    async claim(occasion: string, kind: string): Promise<boolean> {
      const at = stamp();
      return db.tx(async () => (await db.run("INSERT INTO teams_rhythm (occasion, kind, state, created_at, updated_at) VALUES (?, ?, 'claimed', ?, ?) ON CONFLICT (occasion) DO NOTHING", occ(occasion), kind.slice(0, 20), at, at)).changes === 1);
    },
    async get(occasion: string): Promise<RhythmRow | null> {
      const r = await db.get("SELECT occasion, kind, state, activity_id, model_json, created_at, updated_at FROM teams_rhythm WHERE occasion = ?", occ(occasion));
      return r ? toRow(r) : null;
    },
    /** Teams took the message: its id (to update the card) and the card's state. */
    async sent(occasion: string, activityId: string | null, model: unknown): Promise<void> {
      await db.tx(async () => {
        await db.run("UPDATE teams_rhythm SET state = 'sent', activity_id = ?, model_json = ?, updated_at = ? WHERE occasion = ?", activityId ? activityId.slice(0, 200) : null, JSON.stringify(model ?? null), stamp(), occ(occasion));
      });
    },
    async settle(occasion: string, state: Exclude<RhythmState, "claimed" | "sent">): Promise<void> {
      await db.tx(async () => {
        await db.run("UPDATE teams_rhythm SET state = ?, updated_at = ? WHERE occasion = ?", state, stamp(), occ(occasion));
      });
    },
    /** The card's new state after a tap (the message id stays). */
    async setModel(occasion: string, model: unknown): Promise<void> {
      await db.tx(async () => {
        await db.run("UPDATE teams_rhythm SET model_json = ?, updated_at = ? WHERE occasion = ?", JSON.stringify(model ?? null), stamp(), occ(occasion));
      });
    },
    /** Occasions claimed since an instant (any state: claimed once is never sent again). */
    async occasions(since: string): Promise<Set<string>> {
      return new Set(((await db.all("SELECT occasion FROM teams_rhythm WHERE created_at >= ?", since)) as Row[]).map((r) => r.occasion as string));
    },
    /** When the last nudge card went out, or null. */
    async lastSent(kind: string): Promise<string | null> {
      const r = await db.get("SELECT MAX(created_at) AS at FROM teams_rhythm WHERE kind = ? AND state = 'sent'", kind);
      return r?.at ? String(r.at) : null;
    },
    /** Claims that never reached Teams become lost (counted for the log); rows older than 30 days go. */
    async sweep(): Promise<{ lost: number; removed: number }> {
      const now = o.now();
      return db.tx(async () => {
        const lost = (await db.run("UPDATE teams_rhythm SET state = 'lost', updated_at = ? WHERE state = 'claimed' AND created_at < ?", now.toString(), now.subtract({ minutes: LOST_AFTER_MINUTES }).toString())).changes;
        const removed = (await db.run("DELETE FROM teams_rhythm WHERE created_at < ?", now.subtract({ hours: 24 * 30 }).toString())).changes;
        return { lost, removed };
      });
    },
  };
}
export type TeamsRhythmStore = ReturnType<typeof createTeamsRhythmStore>;
