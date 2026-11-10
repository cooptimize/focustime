// CAL-1: one person's calendar links and their events (store/migrations/20261128T0900_calendar_links.ts). The link
// itself is sealed with the app's data key (store/user-secrets.ts seal, bound to the person and the link id), read back
// only by the fetcher, and never returned by list(). Every statement is scoped to the person (store/scope.ts).
import { createHash, randomBytes } from "node:crypto";
import { SecretError, type KeyProvider } from "../host/types.ts";
import type { IcsInstance } from "../sources/ics/parse.ts";
import { scopedDb } from "./scope.ts";
import type { Conn, Row } from "./sql/conn.ts";
import { open, seal } from "./user-secrets.ts";

export type LinkMode = "busy" | "titles";
export type LinkKind = "personal" | "work";

/** What may leave the store toward the UI: never the link, only its host. */
export type CalendarLink = {
  id: string;
  name: string;
  color: string;
  mode: LinkMode;
  kind: LinkKind;
  host: string;
  checkedAt: string | null;
  fetchedAt: string | null;
  failure: string | null;
  eventCount: number;
  createdAt: string;
};

export type StoredInstance = Omit<IcsInstance, "key" | "startUtc" | "endUtc"> & { key: string; linkId: string };

export const MAX_LINKS = 10;
export const LINK_ID = /^[a-f0-9]{16}$/;
const account = (id: string) => `ics-link:${id}`;
const keyOf = (k: string) => createHash("sha256").update(k).digest("hex").slice(0, 40);

export function createCalendarLinks(o: { db: Conn; userId: string; keys: KeyProvider; now: () => Temporal.Instant }) {
  const db = scopedDb(o.db, o.userId);
  const stamp = () => o.now().toString();
  const check = (id: string) => {
    if (!LINK_ID.test(id)) throw new Error("Not a calendar link id");
  };
  const view = (r: Row): CalendarLink => ({
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
    mode: r.mode as LinkMode,
    kind: r.kind as LinkKind,
    host: r.host as string,
    checkedAt: (r.checked_at as string | null) ?? null,
    fetchedAt: (r.fetched_at as string | null) ?? null,
    failure: (r.failure as string | null) ?? null,
    eventCount: Number(r.event_count ?? 0),
    createdAt: String(r.created_at),
  });
  const COLS = "id, name, color, mode, kind, host, checked_at, fetched_at, failure, event_count, created_at";

  return {
    async list(): Promise<CalendarLink[]> {
      return ((await db.all(`SELECT ${COLS} FROM calendar_links ORDER BY created_at, id`)) as Row[]).map(view);
    },
    async get(id: string): Promise<CalendarLink | null> {
      check(id);
      const r = (await db.get(`SELECT ${COLS} FROM calendar_links WHERE id = ?`, id)) as Row | undefined;
      return r ? view(r) : null;
    },
    /** The link itself, for the fetcher only. */
    async url(id: string): Promise<string> {
      check(id);
      const r = (await db.get("SELECT sealed FROM calendar_links WHERE id = ?", id)) as Row | undefined;
      if (!r) throw new SecretError("not_found");
      return open(await o.keys.dataKey(), o.userId, account(id), r.sealed as string);
    },
    /** The validators for a conditional fetch. */
    async validators(id: string): Promise<{ etag: string | null; lastModified: string | null }> {
      check(id);
      const r = (await db.get("SELECT etag, last_modified FROM calendar_links WHERE id = ?", id)) as Row | undefined;
      return { etag: (r?.etag as string | null) ?? null, lastModified: (r?.last_modified as string | null) ?? null };
    },
    /** A new link with its first events, in one transaction. Refuses an eleventh. */
    async add(l: { name: string; color: string; mode: LinkMode; kind: LinkKind; host: string; url: string; etag: string | null; lastModified: string | null }, events: IcsInstance[]): Promise<CalendarLink> {
      const id = randomBytes(8).toString("hex");
      const sealed = seal(await o.keys.dataKey(), o.userId, account(id), l.url);
      await db.tx(async () => {
        const n = (await db.get("SELECT COUNT(*) AS n FROM calendar_links")) as Row;
        if (Number(n.n) >= MAX_LINKS) throw new Error(`At most ${MAX_LINKS} calendar links; remove one first`);
        await db.run(
          "INSERT INTO calendar_links (id, name, color, mode, kind, host, sealed, etag, last_modified, checked_at, fetched_at, failure, event_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
          id, l.name, l.color, l.mode, l.kind, l.host, sealed, l.etag, l.lastModified, stamp(), stamp(), events.length, stamp(),
        );
        await writeEvents(id, l.mode, events);
      });
      return (await this.get(id))!;
    },
    /** Replace link: a new sealed URL, its events, and fresh validators. */
    async replaceUrl(id: string, l: { host: string; url: string; etag: string | null; lastModified: string | null }, events: IcsInstance[]): Promise<void> {
      check(id);
      const sealed = seal(await o.keys.dataKey(), o.userId, account(id), l.url);
      const mode = (await this.get(id))?.mode;
      if (!mode) throw new Error("No such calendar link");
      await db.tx(async () => {
        await db.run("UPDATE calendar_links SET host = ?, sealed = ?, etag = ?, last_modified = ?, checked_at = ?, fetched_at = ?, failure = NULL, event_count = ? WHERE id = ?", l.host, sealed, l.etag, l.lastModified, stamp(), stamp(), events.length, id);
        await db.run("DELETE FROM calendar_link_events WHERE link_id = ?", id);
        await writeEvents(id, mode, events);
      });
    },
    /** Name, color, how events show, personal or work. Busy only drops every stored title at once. */
    async update(id: string, p: Partial<{ name: string; color: string; mode: LinkMode; kind: LinkKind }>): Promise<boolean> {
      check(id);
      return db.tx(async () => {
        const cur = await this.get(id);
        if (!cur) return false;
        const next = { ...cur, ...p };
        await db.run("UPDATE calendar_links SET name = ?, color = ?, mode = ?, kind = ? WHERE id = ?", next.name, next.color, next.mode, next.kind, id);
        if (next.mode === "busy") await db.run("UPDATE calendar_link_events SET title = NULL WHERE link_id = ?", id);
        // Show titles needs the feed again: the next fetch reads it in full.
        if (next.mode === "titles" && cur.mode === "busy") await db.run("UPDATE calendar_links SET etag = NULL, last_modified = NULL, checked_at = NULL WHERE id = ?", id);
        return true;
      });
    },
    /** A fetch's outcome: new events (null for 304, which keeps them), or a failure kind. */
    async recordFetch(id: string, r: { events: IcsInstance[] | null; etag?: string | null; lastModified?: string | null } | { failure: string }): Promise<void> {
      check(id);
      const link = await this.get(id);
      if (!link) return;
      await db.tx(async () => {
        if ("failure" in r) {
          await db.run("UPDATE calendar_links SET checked_at = ?, failure = ? WHERE id = ?", stamp(), r.failure.slice(0, 40), id);
          return;
        }
        if (r.events === null) {
          await db.run("UPDATE calendar_links SET checked_at = ?, fetched_at = ?, failure = NULL WHERE id = ?", stamp(), stamp(), id);
          return;
        }
        await db.run("UPDATE calendar_links SET etag = ?, last_modified = ?, checked_at = ?, fetched_at = ?, failure = NULL, event_count = ? WHERE id = ?", r.etag ?? null, r.lastModified ?? null, stamp(), stamp(), r.events.length, id);
        await db.run("DELETE FROM calendar_link_events WHERE link_id = ?", id);
        await writeEvents(id, link.mode, r.events);
      });
    },
    /** Remove: the link and every stored event of it. */
    async remove(id: string): Promise<boolean> {
      check(id);
      return db.tx(async () => {
        await db.run("DELETE FROM calendar_link_events WHERE link_id = ?", id);
        return (await db.run("DELETE FROM calendar_links WHERE id = ?", id)).changes > 0;
      });
    },
    /** Events of every link overlapping [from, to) (UTC instants). */
    async eventsBetween(from: string, to: string): Promise<StoredInstance[]> {
      const rows = (await db.all("SELECT link_id, instance_key, start_at, end_at, all_day, show_as, title FROM calendar_link_events WHERE start_utc < ? AND end_utc > ? ORDER BY start_utc", to, from)) as Row[];
      return rows.map((r) => ({
        linkId: r.link_id as string,
        key: r.instance_key as string,
        start: r.start_at as string,
        end: r.end_at as string,
        allDay: !!Number(r.all_day),
        showAs: r.show_as as StoredInstance["showAs"],
        title: (r.title as string | null) ?? null,
      }));
    },
  };

  async function writeEvents(id: string, mode: LinkMode, events: IcsInstance[]) {
    const seen = new Set<string>();
    for (const e of events) {
      const k = keyOf(e.key);
      if (seen.has(k)) continue;
      seen.add(k);
      // Busy only: never a title, whatever the parser was given.
      await db.run(
        "INSERT INTO calendar_link_events (link_id, instance_key, start_at, end_at, start_utc, end_utc, all_day, show_as, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, k, e.start, e.end, e.startUtc, e.endUtc, e.allDay ? 1 : 0, e.showAs, mode === "titles" ? e.title : null,
      );
    }
  }
}

export type CalendarLinks = ReturnType<typeof createCalendarLinks>;
