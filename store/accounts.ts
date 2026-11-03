// People, sessions and sign-ins in progress (A2): app-level tables in the plan store's database. A session cookie
// holds a random 256-bit id; only its SHA-256 is stored, so a copy of the database can't be replayed as a login.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Conn } from "./sql/conn.ts";

export type UserRow = {
  id: string;
  tenantId: string;
  upn: string;
  displayName: string;
  email: string | null;
  timeZone: string | null;
  createdAt: string;
  lastSignInAt: string;
  deletedAt: string | null;
};

export type Session = { userId: string; demo: boolean; csrf: string; createdAt: string; lastSeenAt: string; expiresAt: string };

/** 12 hours without a request ends a session; 7 days ends it regardless. A demo session lasts 2 hours. */
export const SESSION_IDLE_MS = 12 * 3600_000;
export const SESSION_MAX_MS = 7 * 24 * 3600_000;
export const DEMO_SESSION_MS = 2 * 3600_000;
/** A sign-in started at Microsoft or Google has 10 minutes to come back. */
export const AUTH_REQUEST_MS = 10 * 60_000;
/** last_seen_at is written at most this often (a request every few seconds needn't write every time). */
const TOUCH_MS = 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");
const token = () => randomBytes(32).toString("base64url");

type Row = Record<string, unknown>;
const toUser = (r: Row): UserRow => ({
  id: r.id as string,
  tenantId: r.tenant_id as string,
  upn: r.upn as string,
  displayName: r.display_name as string,
  email: (r.email as string | null) ?? null,
  timeZone: (r.time_zone as string | null) ?? null,
  createdAt: r.created_at as string,
  lastSignInAt: r.last_sign_in_at as string,
  deletedAt: (r.deleted_at as string | null) ?? null,
});

export function createAccountStore(db: Conn, now: () => Temporal.Instant) {
  const at = () => now().toString();

  const users = {
    async get(id: string): Promise<UserRow | null> {
      const r = (await db.get("SELECT * FROM users WHERE id = ?", [id])) as Row | undefined;
      return r ? toUser(r) : null;
    },
    /** Every person who has signed in (deleted ones included, with deletedAt set). */
    async all(): Promise<UserRow[]> {
      return ((await db.all("SELECT * FROM users ORDER BY created_at, id")) as Row[]).map(toUser);
    },
    async count(): Promise<number> {
      return ((await db.get("SELECT COUNT(*) AS n FROM users")) as { n: number }).n;
    },
    /** A sign-in: creates the person (first time) or updates their name and addresses. Returns the row and whether it is new. */
    async signedIn(u: { id: string; tenantId: string; upn: string; displayName: string; email: string | null }): Promise<{ user: UserRow; created: boolean }> {
      const t = at();
      const prev = await users.get(u.id);
      if (!prev) {
        (await db.run("INSERT INTO users (id, tenant_id, upn, display_name, email, time_zone, created_at, last_sign_in_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)", [u.id, u.tenantId, u.upn, u.displayName, u.email, t, t]));
      } else {
        (await db.run("UPDATE users SET tenant_id = ?, upn = ?, display_name = ?, email = ?, last_sign_in_at = ? WHERE id = ?", [u.tenantId, u.upn, u.displayName, u.email, t, u.id]));
      }
      return { user: (await users.get(u.id))!, created: !prev };
    },
    async setTimeZone(id: string, zone: string): Promise<void> {
      (await db.run("UPDATE users SET time_zone = ? WHERE id = ?", [zone, id]));
    },
    async setDeleted(id: string, deletedAt: string | null): Promise<void> {
      (await db.run("UPDATE users SET deleted_at = ? WHERE id = ?", [deletedAt, id]));
    },
    async remove(id: string): Promise<void> {
      (await db.run("DELETE FROM users WHERE id = ?", [id]));
    },
  };

  const sessions = {
    /** A new session: the cookie value (returned once, never stored) and its CSRF token. */
    async create(userId: string, opts: { demo?: boolean } = {}): Promise<{ cookie: string; csrf: string; session: Session }> {
      const cookie = token();
      const csrf = token();
      const t = now();
      const expires = t.add({ milliseconds: opts.demo ? DEMO_SESSION_MS : SESSION_MAX_MS }).toString();
      (await db.run("INSERT INTO sessions (id, user_id, demo, csrf, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [sha256(cookie), userId, opts.demo ? 1 : 0, csrf, t.toString(), t.toString(), expires]));
      return { cookie, csrf, session: { userId, demo: !!opts.demo, csrf, createdAt: t.toString(), lastSeenAt: t.toString(), expiresAt: expires } };
    },
    /** The live session for a cookie value, its last-seen time moved on; null (and the row removed) when it has ended. */
    async resolve(cookie: string | undefined): Promise<Session | null> {
      if (!cookie || cookie.length > 128) return null;
      const id = sha256(cookie);
      const r = (await db.get("SELECT * FROM sessions WHERE id = ?", [id])) as Row | undefined;
      if (!r) return null;
      const t = now();
      const s: Session = { userId: r.user_id as string, demo: r.demo === 1 || r.demo === true, csrf: r.csrf as string, createdAt: r.created_at as string, lastSeenAt: r.last_seen_at as string, expiresAt: r.expires_at as string };
      const idleEnd = Temporal.Instant.from(s.lastSeenAt).add({ milliseconds: SESSION_IDLE_MS });
      if (Temporal.Instant.compare(t, Temporal.Instant.from(s.expiresAt)) >= 0 || Temporal.Instant.compare(t, idleEnd) >= 0) {
        (await db.run("DELETE FROM sessions WHERE id = ?", [id]));
        return null;
      }
      if (t.epochMilliseconds - Temporal.Instant.from(s.lastSeenAt).epochMilliseconds >= TOUCH_MS) {
        (await db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [t.toString(), id]));
        s.lastSeenAt = t.toString();
      }
      return s;
    },
    async end(cookie: string | undefined): Promise<void> {
      if (cookie) (await db.run("DELETE FROM sessions WHERE id = ?", [sha256(cookie)]));
    },
    async endAllFor(userId: string): Promise<void> {
      (await db.run("DELETE FROM sessions WHERE user_id = ?", [userId]));
    },
    /** Removes ended sessions; returns how many. */
    async sweep(): Promise<number> {
      const t = now();
      const idle = t.subtract({ milliseconds: SESSION_IDLE_MS }).toString();
      return ((await db.run("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?", [t.toString(), idle])).changes);
    },
    /** Whether a request's CSRF header is this session's token (constant time). */
    csrfOk(s: Session, offered: string | undefined): boolean {
      if (!offered) return false;
      const a = Buffer.from(offered);
      const b = Buffer.from(s.csrf);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };

  const authRequests = {
    async put(kind: "microsoft" | "google", p: { state: string; nonce: string; verifier: string }, userId: string | null = null): Promise<void> {
      const old = now().subtract({ milliseconds: AUTH_REQUEST_MS }).toString();
      (await db.run("DELETE FROM auth_requests WHERE created_at <= ?", [old]));
      (await db.run("INSERT INTO auth_requests (state, kind, nonce, verifier, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", [sha256(p.state), kind, p.nonce, p.verifier, userId, at()]));
    },
    /** The sign-in this state belongs to, taken once (removed); null when unknown, of another kind or too old. */
    async take(kind: "microsoft" | "google", state: string | null): Promise<{ state: string; nonce: string; verifier: string; userId: string | null } | null> {
      if (!state || state.length > 256) return null;
      const id = sha256(state);
      const r = (await db.get("SELECT * FROM auth_requests WHERE state = ?", [id])) as Row | undefined;
      if (!r) return null;
      (await db.run("DELETE FROM auth_requests WHERE state = ?", [id]));
      const fresh = now().epochMilliseconds - Temporal.Instant.from(r.created_at as string).epochMilliseconds < AUTH_REQUEST_MS;
      if (r.kind !== kind || !fresh) return null;
      return { state, nonce: r.nonce as string, verifier: r.verifier as string, userId: (r.user_id as string | null) ?? null };
    },
  };

  return { users, sessions, authRequests };
}

export type AccountStore = ReturnType<typeof createAccountStore>;
