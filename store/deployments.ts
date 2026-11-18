// DP-3: the shared deployment store: app tables (deployments, deployment_people, deployment_notes), read and written on
// the database itself like the meeting store. Shared storage, not shared visibility: the plan store reaches it only
// through `as(personId)`, which reads and changes only deployments that person is on. A change on an older version is
// refused (never silently overwritten). Every write runs in a transaction. Nothing here logs.
import type { DeployItem } from "../plan/deploy-items.ts";
import type { DeployPerson } from "../plan/shared-deploy.ts";
import type { TodoLink } from "../plan/types.ts";
import type { Conn, Row } from "./sql/conn.ts";

export type SharedRow = {
  id: number;
  clientKey: string;
  title: string;
  startAt: string;
  endAt: string;
  zone: string;
  notes: string | null;
  links: TodoLink[] | null;
  deployItems: DeployItem[] | null;
  doneAt: string | null;
  doneBy: string | null;
  version: number;
  lastMove: { by: string; startAt: string; endAt: string; title?: string; version: number } | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  people: DeployPerson[];
};
export type NoteKind = "added" | "moved" | "removed" | "deleted";
export type DeployNote = { id: number; deploymentId: number; to: string; kind: NoteKind; byName: string; clientKey: string; startAt: string; endAt: string; at: string };

export type SharedPatch = Partial<Pick<SharedRow, "title" | "startAt" | "endAt" | "notes" | "links" | "deployItems">> & { done?: boolean };
export type NewShared = Pick<SharedRow, "clientKey" | "title" | "startAt" | "endAt" | "zone" | "notes" | "links" | "deployItems"> & { done?: boolean };

export class StaleDeployment extends Error {
  readonly current: SharedRow | null;
  constructor(current: SharedRow | null) {
    super("stale");
    this.current = current;
  }
}

const j = <T>(v: unknown): T | null => {
  if (typeof v !== "string" || !v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const lc = (v: string) => v.trim().toLowerCase();
const toRow = (r: Row, people: DeployPerson[]): SharedRow => ({
  id: Number(r.id),
  clientKey: String(r.client_key),
  title: String(r.title),
  startAt: String(r.start_at),
  endAt: String(r.end_at),
  zone: String(r.zone),
  notes: s(r.notes),
  links: j<TodoLink[]>(r.links),
  deployItems: j<DeployItem[]>(r.deploy_items),
  doneAt: s(r.done_at),
  doneBy: s(r.done_by),
  version: Number(r.version),
  lastMove: j<SharedRow["lastMove"]>(r.last_move),
  createdBy: String(r.created_by),
  createdAt: String(r.created_at),
  updatedBy: String(r.updated_by),
  updatedAt: String(r.updated_at),
  deletedAt: s(r.deleted_at),
  deletedBy: s(r.deleted_by),
  people,
});
const toPerson = (r: Row): DeployPerson => ({ id: String(r.person_id), name: String(r.name), addedBy: String(r.added_by), addedAt: String(r.added_at) });
const toNote = (r: Row): DeployNote => ({ id: Number(r.id), deploymentId: Number(r.deployment_id), to: String(r.to_person), kind: r.kind as NoteKind, byName: String(r.by_name), clientKey: String(r.client_key), startAt: String(r.start_at), endAt: String(r.end_at), at: String(r.at) });
const inList = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** How long a note waits for its recipient's FocusTime. */
export const DEPLOY_NOTE_DAYS = 14;

export type SharedDeployments = ReturnType<typeof sharedDeployments>;

export function sharedDeployments(conn: Conn, now: () => Temporal.Instant) {
  const at = () => now().toString();
  const peopleOf = async (ids: readonly number[]): Promise<Map<number, DeployPerson[]>> => {
    const out = new Map<number, DeployPerson[]>();
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const rows = (await conn.all(`SELECT * FROM deployment_people WHERE deployment_id IN (${inList(part.length)}) ORDER BY added_at, person_id`, [...part])) as Row[];
      for (const r of rows) {
        const id = Number(r.deployment_id);
        out.set(id, [...(out.get(id) ?? []), toPerson(r)]);
      }
    }
    return out;
  };
  const byIds = async (ids: readonly number[]): Promise<SharedRow[]> => {
    if (!ids.length) return [];
    const people = await peopleOf(ids);
    const out: SharedRow[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      for (const r of (await conn.all(`SELECT * FROM deployments WHERE id IN (${inList(part.length)})`, [...part])) as Row[]) out.push(toRow(r, people.get(Number(r.id)) ?? []));
    }
    return out;
  };
  const one = async (id: number) => (await byIds([id]))[0] ?? null;
  const note = async (d: SharedRow, to: readonly string[], kind: NoteKind, byName: string) => {
    for (const p of to) await conn.run("INSERT INTO deployment_notes (deployment_id, to_person, kind, by_name, client_key, start_at, end_at, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [d.id, p, kind, byName.slice(0, 200), d.clientKey, d.startAt, d.endAt, at()]);
  };

  /** One person's view: only the deployments they are on. Every read and change for a person goes through here. */
  function as(personId: string, myName: () => Promise<string>) {
    const me = lc(personId);
    const member = (d: SharedRow | null) => (d && !d.deletedAt && d.people.some((p) => p.id === me) ? d : null);
    /** A change on the version I saw: refused when it moved on since (someone else saved first). */
    const change = async (id: number, version: number | null, apply: (d: SharedRow) => Promise<void>): Promise<SharedRow> =>
      conn.tx(async () => {
        const d = member(await one(id));
        if (!d) throw new StaleDeployment(null);
        if (version !== null && d.version !== version) throw new StaleDeployment(d);
        await apply(d);
        const r = await conn.run("UPDATE deployments SET version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?", [me, at(), id, d.version]);
        if (!r.changes) throw new StaleDeployment(await one(id));
        return (await one(id))!;
      });
    return {
      me,
      /** The deployments I'm on now (not deleted). */
      async mine(): Promise<SharedRow[]> {
        const ids = ((await conn.all("SELECT deployment_id FROM deployment_people WHERE person_id = ?", [me])) as Row[]).map((r) => Number(r.deployment_id));
        return (await byIds(ids)).filter((d) => !d.deletedAt);
      },
      /** These ids as I may see them: only the ones I'm on and not deleted (null for each other one). */
      async seen(ids: readonly number[]): Promise<Map<number, SharedRow>> {
        return new Map((await byIds([...new Set(ids)])).filter((d) => member(d)).map((d) => [d.id, d]));
      },
      /** One I'm on, or null (not on it, deleted or gone). */
      get: async (id: number) => member(await one(id)),
      /** One I'm not on any more, as it was (a removal, a delete): for its notice and my hold only, never its content. */
      async left(id: number): Promise<{ deleted: boolean } | null> {
        const d = await one(id);
        if (!d) return { deleted: true };
        if (d.deletedAt) return { deleted: true };
        return d.people.some((p) => p.id === me) ? null : { deleted: false };
      },
      async create(n: NewShared, people: readonly { id: string; name: string }[] = []): Promise<SharedRow> {
        return conn.tx(async () => {
          const t = at();
          const r = await conn.run("INSERT INTO deployments (client_key, title, start_at, end_at, zone, notes, links, deploy_items, done_at, done_by, version, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)", [n.clientKey, n.title.slice(0, 200), n.startAt, n.endAt, n.zone, n.notes, n.links?.length ? JSON.stringify(n.links) : null, n.deployItems?.length ? JSON.stringify(n.deployItems) : null, n.done ? t : null, n.done ? me : null, me, t, me, t]);
          const id = Number(r.lastId);
          await conn.run("INSERT INTO deployment_people (deployment_id, person_id, name, added_by, added_at) VALUES (?, ?, ?, ?, ?)", [id, me, (await myName()).slice(0, 200), me, t]);
          const d = (await one(id))!;
          const added = people.filter((p) => lc(p.id) !== me);
          for (const p of added) await conn.run("INSERT INTO deployment_people (deployment_id, person_id, name, added_by, added_at) VALUES (?, ?, ?, ?, ?)", [id, lc(p.id), p.name.slice(0, 200), me, t]);
          await note(d, added.map((p) => lc(p.id)), "added", await myName());
          return (await one(id))!;
        });
      },
      /** A change to its fields (anyone on it), refused on an older version. The day or time changing tells the others. */
      update: (id: number, version: number | null, p: SharedPatch, o: { move?: boolean } = {}) =>
        change(id, version, async (d) => {
          const set: string[] = [];
          const vals: (string | number | null)[] = [];
          const put = (col: string, v: string | number | null) => (set.push(`${col} = ?`), vals.push(v));
          if (p.title !== undefined) put("title", p.title.slice(0, 200));
          if (p.startAt !== undefined) put("start_at", p.startAt);
          if (p.endAt !== undefined) put("end_at", p.endAt);
          if (p.notes !== undefined) put("notes", p.notes);
          if (p.links !== undefined) put("links", p.links?.length ? JSON.stringify(p.links) : null);
          if (p.deployItems !== undefined) put("deploy_items", p.deployItems?.length ? JSON.stringify(p.deployItems) : null);
          if (p.done !== undefined) (put("done_at", p.done ? at() : null), put("done_by", p.done ? me : null));
          const moved = (p.startAt !== undefined && p.startAt !== d.startAt) || (p.endAt !== undefined && p.endAt !== d.endAt);
          if (moved && o.move) put("last_move", JSON.stringify({ by: me, startAt: d.startAt, endAt: d.endAt, title: d.title, version: d.version + 1 }));
          if (set.length) await conn.run(`UPDATE deployments SET ${set.join(", ")} WHERE id = ?`, [...vals, id]);
          if (moved) await note({ ...d, startAt: p.startAt ?? d.startAt, endAt: p.endAt ?? d.endAt }, d.people.filter((x) => x.id !== me).map((x) => x.id), "moved", await myName());
        }),
      /** Who is on it: the whole list (anyone on it). Those added and removed are told; never the person making it. */
      setPeople: (id: number, version: number | null, people: readonly { id: string; name: string }[]) =>
        change(id, version, async (d) => {
          const want = new Map(people.map((p) => [lc(p.id), p.name] as const));
          want.set(me, d.people.find((p) => p.id === me)?.name ?? (await myName()));
          const had = new Set(d.people.map((p) => p.id));
          const t = at();
          const added = [...want.keys()].filter((k) => !had.has(k));
          const removed = [...had].filter((k) => !want.has(k));
          for (const k of added) await conn.run("INSERT INTO deployment_people (deployment_id, person_id, name, added_by, added_at) VALUES (?, ?, ?, ?, ?)", [id, k, want.get(k)!.slice(0, 200), me, t]);
          for (const k of removed) await conn.run("DELETE FROM deployment_people WHERE deployment_id = ? AND person_id = ?", [id, k]);
          await note(d, added, "added", await myName());
          await note(d, removed, "removed", await myName());
        }),
      /** Take me off: only me. The last person off deletes it. */
      async leave(id: number): Promise<{ deleted: boolean; before: SharedRow }> {
        return conn.tx(async () => {
          const d = member(await one(id));
          if (!d) throw new StaleDeployment(null);
          await conn.run("DELETE FROM deployment_people WHERE deployment_id = ? AND person_id = ?", [id, me]);
          const last = d.people.length <= 1;
          if (last) await conn.run("UPDATE deployments SET deleted_at = ?, deleted_by = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", [at(), me, me, at(), id]);
          else await conn.run("UPDATE deployments SET version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", [me, at(), id]);
          return { deleted: last, before: d };
        });
      },
      /**
       * Undo of Take me off: back on it as I was (and it back for everyone when my leaving deleted it). Only while my own
       * leaving is still its last change: never after someone else took me off, deleted it or changed it since. My name
       * is mine as the store knows it; who added me only someone on it (else me), and when never later than now.
       */
      async rejoin(id: number, was: DeployPerson): Promise<SharedRow> {
        return conn.tx(async () => {
          const d = await one(id);
          if (!d) throw new StaleDeployment(null);
          if (d.people.some((p) => p.id === me)) return d;
          if (d.updatedBy !== me || (d.deletedAt && d.deletedBy !== me)) throw new StaleDeployment(null);
          const now = at();
          const by = lc(was.addedBy);
          const addedBy = by === me || d.people.some((p) => p.id === by) ? by : me;
          const addedAt = typeof was.addedAt === "string" && !Number.isNaN(Date.parse(was.addedAt)) && was.addedAt <= now ? was.addedAt : now;
          await conn.run("INSERT INTO deployment_people (deployment_id, person_id, name, added_by, added_at) VALUES (?, ?, ?, ?, ?)", [id, me, (await myName()).slice(0, 200), addedBy, addedAt]);
          await conn.run("UPDATE deployments SET deleted_at = NULL, deleted_by = NULL, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", [me, at(), id]);
          return (await one(id))!;
        });
      },
      /** Delete for everyone on it (anyone on it). The others are told. Kept marked deleted, for Undo. */
      async remove(id: number): Promise<SharedRow> {
        return conn.tx(async () => {
          const d = member(await one(id));
          if (!d) throw new StaleDeployment(null);
          await conn.run("UPDATE deployments SET deleted_at = ?, deleted_by = ?, version = version + 1 WHERE id = ?", [at(), me, id]);
          await note(d, d.people.filter((p) => p.id !== me).map((p) => p.id), "deleted", await myName());
          return d;
        });
      },
      /** Undo of my delete: back for everyone who was on it. Their delete notices are taken back. */
      async restore(id: number): Promise<SharedRow> {
        return conn.tx(async () => {
          const d = await one(id);
          if (!d || !d.deletedAt || d.deletedBy !== me || !d.people.some((p) => p.id === me)) throw new StaleDeployment(null);
          await conn.run("UPDATE deployments SET deleted_at = NULL, deleted_by = NULL, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", [me, at(), id]);
          await conn.run("DELETE FROM deployment_notes WHERE deployment_id = ? AND kind = 'deleted'", [id]);
          return (await one(id))!;
        });
      },
      /** My notices since an instant, oldest first. */
      /** The title, for a note to me about it (so a person taken off, or one it was deleted for, is told which). */
      titleForNote: async (id: number): Promise<string | null> => {
        const r = (await conn.get("SELECT d.title FROM deployments d WHERE d.id = ? AND EXISTS (SELECT 1 FROM deployment_notes n WHERE n.deployment_id = d.id AND n.to_person = ?)", [id, me])) as Row | undefined;
        return r ? String(r.title) : null;
      },
      notes: async (since: string): Promise<DeployNote[]> => ((await conn.all("SELECT * FROM deployment_notes WHERE to_person = ? AND at > ? ORDER BY at, id", [me, since])) as Row[]).map(toNote),
    };
  }

  return {
    as,
    /**
     * A2: deleting a person's data takes them off every deployment. One that others are still on stays for them; one
     * only they were on is deleted. Returns how many they were on.
     */
    async forget(personId: string): Promise<number> {
      const me = lc(personId);
      return conn.tx(async () => {
        const ids = ((await conn.all("SELECT deployment_id FROM deployment_people WHERE person_id = ?", [me])) as Row[]).map((r) => Number(r.deployment_id));
        for (const d of await byIds(ids)) {
          await conn.run("DELETE FROM deployment_people WHERE deployment_id = ? AND person_id = ?", [d.id, me]);
          if (d.people.length <= 1) {
            await conn.run("DELETE FROM deployment_notes WHERE deployment_id = ?", [d.id]);
            await conn.run("DELETE FROM deployments WHERE id = ?", [d.id]);
          } else await conn.run("UPDATE deployments SET version = version + 1 WHERE id = ?", [d.id]);
        }
        await conn.run("DELETE FROM deployment_notes WHERE to_person = ?", [me]);
        return ids.length;
      });
    },
    /** A2: the export holds the deployments a person is on, as everyone on it sees them. */
    async of(personId: string): Promise<SharedRow[]> {
      const ids = ((await conn.all("SELECT deployment_id FROM deployment_people WHERE person_id = ?", [lc(personId)])) as Row[]).map((r) => Number(r.deployment_id));
      return (await byIds(ids)).filter((d) => !d.deletedAt);
    },
  };
}
