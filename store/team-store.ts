// SW-1: the team's shared records, app tables read and written on the database itself (like devops_takes): sends,
// week commitments (the published snapshot the Team view reads), client priorities and Ask <lead> to look. No
// user_id anywhere: people are their one id from cooptimizers(), lowercased. Who may read or write what is decided in
// actions/team-actions.ts (on the client, a client lead, the sender or recipient); this file only stores. Every write
// runs in a transaction. Nothing here logs.
import type { Conn, Row } from "./sql/conn.ts";

import type { Commitment, LookAsk, NewCommitment, NewSend, Priority, Send, SendState } from "../plan/team-types.ts";

export type { Commitment, LookAsk, NewCommitment, NewSend, Person, Priority, Send, SendKind, SendState } from "../plan/team-types.ts";

export type TeamStore = {
  addSend(s: NewSend): Promise<Send>;
  send(id: number): Promise<Send | null>;
  /** Sends to or from this person (as sender, passer or recipient) for these weeks. */
  sendsOf(personId: string, weeks: readonly string[]): Promise<Send[]>;
  /** Every send on these clients for a week (the Team view). */
  sendsOn(clientKeys: readonly string[], weekStart: string): Promise<Send[]>;
  setSend(id: number, s: Partial<Pick<Send, "state" | "reason" | "to" | "by">>): Promise<Send>;
  /** Waiting or accepted sends of a recipient for an item (Scheduled when it's planned). */
  sendsFor(toId: string, clientKey: string, itemId: number): Promise<Send[]>;

  /** Replaces a person's published commitments for a week (commit and re-commit). */
  publish(personId: string, weekStart: string, rows: readonly NewCommitment[], at: string): Promise<void>;
  commitments(clientKeys: readonly string[], weekStart: string): Promise<Commitment[]>;
  /** Whom has published for that week at all (committed, maybe with nothing on a client). */
  committedPeople(weekStart: string): Promise<Map<string, string>>;

  flag(p: Omit<Priority, "flaggedAt">, at: string): Promise<void>;
  unflag(clientKey: string, itemId: number): Promise<boolean>;
  priorities(clientKeys: readonly string[]): Promise<Priority[]>;

  addLook(a: Omit<LookAsk, "id" | "reply" | "repliedAt" | "createdAt">, at: string): Promise<LookAsk>;
  look(id: number): Promise<LookAsk | null>;
  reply(id: number, reply: string, at: string): Promise<LookAsk>;
  /** Asks to or from this person since an instant. */
  looksOf(personId: string, since: string): Promise<LookAsk[]>;

  /** A person's hard delete: their commitments, the sends and asks they're in. */
  forget(personId: string): Promise<void>;
};

const low = (s: string) => s.trim().toLowerCase();
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const cut = (v: string | null, n: number) => (v === null ? null : v.slice(0, n));
const qs = (n: number) => Array.from({ length: n }, () => "?").join(", ");

const toSend = (r: Row): Send => ({
  id: Number(r.id),
  clientKey: String(r.client_key),
  itemId: Number(r.item_id),
  level: r.level === "story" ? "story" : "feature",
  title: String(r.title),
  itemType: s(r.item_type),
  url: s(r.url),
  parentId: r.parent_id === null || r.parent_id === undefined ? null : Number(r.parent_id),
  weekStart: String(r.week_start),
  kind: r.kind === "must" ? "must" : "suggested",
  note: s(r.note),
  askTake: r.ask_take === 1 || r.ask_take === true || r.ask_take === "1",
  from: { id: String(r.from_id), name: String(r.from_name) },
  by: r.by_id ? { id: String(r.by_id), name: String(r.by_name ?? "") } : null,
  to: { id: String(r.to_id), name: String(r.to_name) },
  state: String(r.state) as SendState,
  reason: s(r.reason),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const toLook = (r: Row): LookAsk => ({
  id: Number(r.id),
  clientKey: String(r.client_key),
  weekStart: String(r.week_start),
  from: { id: String(r.from_id), name: String(r.from_name) },
  to: { id: String(r.to_id), name: String(r.to_name) },
  note: s(r.note),
  reply: s(r.reply),
  repliedAt: s(r.replied_at),
  createdAt: String(r.created_at),
});

export function teamStore(conn: Conn, now: () => Temporal.Instant): TeamStore {
  const stamp = () => now().toString();
  const send = async (id: number) => {
    const r = await conn.get("SELECT * FROM sends WHERE id = ?", [id]);
    return r ? toSend(r) : null;
  };
  const look = async (id: number) => {
    const r = await conn.get("SELECT * FROM look_asks WHERE id = ?", [id]);
    return r ? toLook(r) : null;
  };
  return {
    async addSend(n) {
      const at = stamp();
      const r = await conn.tx(() =>
        conn.run(
          "INSERT INTO sends (client_key, item_id, level, title, item_type, url, parent_id, week_start, kind, note, ask_take, from_id, from_name, to_id, to_name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)",
          [n.clientKey, n.itemId, n.level, n.title.slice(0, 400), cut(n.itemType, 100), cut(n.url, 1000), n.parentId, n.weekStart, n.kind, cut(n.note, 500), n.askTake ? 1 : 0, low(n.from.id), n.from.name.slice(0, 200), low(n.to.id), n.to.name.slice(0, 200), at, at],
        ),
      );
      return (await send(r.lastId!))!;
    },
    send,
    async sendsOf(personId, weeks) {
      if (!weeks.length) return [];
      const id = low(personId);
      return (await conn.all(`SELECT * FROM sends WHERE (from_id = ? OR to_id = ? OR by_id = ?) AND week_start IN (${qs(weeks.length)}) ORDER BY created_at, id`, [id, id, id, ...weeks])).map(toSend);
    },
    async sendsOn(clientKeys, weekStart) {
      if (!clientKeys.length) return [];
      return (await conn.all(`SELECT * FROM sends WHERE client_key IN (${qs(clientKeys.length)}) AND week_start = ? ORDER BY created_at, id`, [...clientKeys, weekStart])).map(toSend);
    },
    async setSend(id, p) {
      await conn.tx(async () => {
        const sets: string[] = ["updated_at = ?"];
        const args: (string | null)[] = [stamp()];
        if (p.state !== undefined) (sets.push("state = ?"), args.push(p.state));
        if (p.reason !== undefined) (sets.push("reason = ?"), args.push(cut(p.reason, 500)));
        if (p.to !== undefined) (sets.push("to_id = ?", "to_name = ?"), args.push(low(p.to.id), p.to.name.slice(0, 200)));
        if (p.by !== undefined) (sets.push("by_id = ?", "by_name = ?"), args.push(p.by ? low(p.by.id) : null, p.by ? p.by.name.slice(0, 200) : null));
        await conn.run(`UPDATE sends SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
      });
      return (await send(id))!;
    },
    async sendsFor(toId, clientKey, itemId) {
      return (await conn.all("SELECT * FROM sends WHERE to_id = ? AND client_key = ? AND item_id = ? AND state IN ('waiting', 'accepted') ORDER BY id", [low(toId), clientKey, itemId])).map(toSend);
    },

    async publish(personId, weekStart, rows, at) {
      const id = low(personId);
      await conn.tx(async () => {
        await conn.run("DELETE FROM week_commitments WHERE person_id = ? AND week_start = ?", [id, weekStart]);
        const seen = new Set<string>();
        for (const r of rows) {
          const k = `${r.clientKey}\u0000${r.itemId}`;
          if (seen.has(k)) continue;
          seen.add(k);
          await conn.run(
            "INSERT INTO week_commitments (person_id, week_start, client_key, item_id, title, item_type, url, tier, watching, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [id, weekStart, r.clientKey, r.itemId, r.title.slice(0, 400), cut(r.itemType, 100), cut(r.url, 1000), r.tier, r.watching ? 1 : 0, at],
          );
        }
        // A commit with nothing on it still says "committed": one marker row (item 0) that the views never show.
        if (!seen.size) await conn.run("INSERT INTO week_commitments (person_id, week_start, client_key, item_id, title, item_type, url, tier, watching, committed_at) VALUES (?, ?, '', 0, '', NULL, NULL, 'nice', 0, ?)", [id, weekStart, at]);
      });
    },
    async commitments(clientKeys, weekStart) {
      if (!clientKeys.length) return [];
      const rows = await conn.all(`SELECT * FROM week_commitments WHERE client_key IN (${qs(clientKeys.length)}) AND week_start = ? AND item_id > 0 ORDER BY person_id, client_key, item_id`, [...clientKeys, weekStart]);
      return rows.map((r) => ({ personId: String(r.person_id), weekStart: String(r.week_start), clientKey: String(r.client_key), itemId: Number(r.item_id), title: String(r.title), itemType: s(r.item_type), url: s(r.url), tier: r.tier === "must" ? "must" : "nice", watching: r.watching === 1 || r.watching === true || r.watching === "1", committedAt: String(r.committed_at) }));
    },
    async committedPeople(weekStart) {
      const rows = await conn.all("SELECT person_id, MAX(committed_at) AS at FROM week_commitments WHERE week_start = ? GROUP BY person_id", [weekStart]);
      return new Map(rows.map((r) => [String(r.person_id), String(r.at)]));
    },

    async flag(p, at) {
      await conn.tx(async () => {
        await conn.run("DELETE FROM client_priorities WHERE client_key = ? AND item_id = ?", [p.clientKey, p.itemId]);
        await conn.run("INSERT INTO client_priorities (client_key, item_id, title, item_type, url, note, flagged_by_id, flagged_by_name, flagged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [p.clientKey, p.itemId, p.title.slice(0, 400), cut(p.itemType, 100), cut(p.url, 1000), cut(p.note, 500), low(p.flaggedBy.id), p.flaggedBy.name.slice(0, 200), at]);
      });
    },
    async unflag(clientKey, itemId) {
      const r = await conn.tx(() => conn.run("DELETE FROM client_priorities WHERE client_key = ? AND item_id = ?", [clientKey, itemId]));
      return r.changes > 0;
    },
    async priorities(clientKeys) {
      if (!clientKeys.length) return [];
      const rows = await conn.all(`SELECT * FROM client_priorities WHERE client_key IN (${qs(clientKeys.length)}) ORDER BY client_key, flagged_at, item_id`, [...clientKeys]);
      return rows.map((r) => ({ clientKey: String(r.client_key), itemId: Number(r.item_id), title: String(r.title), itemType: s(r.item_type), url: s(r.url), note: s(r.note), flaggedBy: { id: String(r.flagged_by_id), name: String(r.flagged_by_name) }, flaggedAt: String(r.flagged_at) }));
    },

    async addLook(a, at) {
      const r = await conn.tx(() =>
        conn.run("INSERT INTO look_asks (client_key, week_start, from_id, from_name, to_id, to_name, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [a.clientKey, a.weekStart, low(a.from.id), a.from.name.slice(0, 200), low(a.to.id), a.to.name.slice(0, 200), cut(a.note, 500), at]),
      );
      return (await look(r.lastId!))!;
    },
    look,
    async reply(id, reply, at) {
      await conn.tx(() => conn.run("UPDATE look_asks SET reply = ?, replied_at = ? WHERE id = ?", [reply.slice(0, 500), at, id]));
      return (await look(id))!;
    },
    async looksOf(personId, since) {
      const id = low(personId);
      return (await conn.all("SELECT * FROM look_asks WHERE (from_id = ? OR to_id = ?) AND created_at >= ? ORDER BY created_at, id", [id, id, since])).map(toLook);
    },

    async forget(personId) {
      const id = low(personId);
      await conn.tx(async () => {
        await conn.run("DELETE FROM week_commitments WHERE person_id = ?", [id]);
        await conn.run("DELETE FROM sends WHERE from_id = ? OR to_id = ?", [id, id]);
        await conn.run("DELETE FROM look_asks WHERE from_id = ? OR to_id = ?", [id, id]);
      });
    },
  };
}
