// People, sessions and sign-ins in progress (A2): app-level tables in the plan store's database. A session cookie
// holds a random 256-bit id; only its SHA-256 is stored, so a copy of the database can't be replayed as a login.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

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

export function createAccountStore(db: DatabaseSync, now: () => Temporal.Instant) {
  const at = () => now().toString();

  const users = {
    get(id: string): UserRow | null {
      const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
      return r ? toUser(r) : null;
    },
    /** Every person who has signed in (deleted ones included, with deletedAt set). */
    all(): UserRow[] {
      return (db.prepare("SELECT * FROM users ORDER BY created_at, id").all() as Row[]).map(toUser);
    },
    count(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    },
    /** A sign-in: creates the person (first time) or updates their name and addresses. Returns the row and whether it is new. */
    signedIn(u: { id: string; tenantId: string; upn: string; displayName: string; email: string | null }): { user: UserRow; created: boolean } {
      const t = at();
      const prev = users.get(u.id);
      if (!prev) {
        db.prepare("INSERT INTO users (id, tenant_id, upn, display_name, email, time_zone, created_at, last_sign_in_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)").run(u.id, u.tenantId, u.upn, u.displayName, u.email, t, t);
      } else {
        db.prepare("UPDATE users SET tenant_id = ?, upn = ?, display_name = ?, email = ?, last_sign_in_at = ? WHERE id = ?").run(u.tenantId, u.upn, u.displayName, u.email, t, u.id);
      }
      return { user: users.get(u.id)!, created: !prev };
    },
    setTimeZone(id: string, zone: string): void {
      db.prepare("UPDATE users SET time_zone = ? WHERE id = ?").run(zone, id);
    },
    setDeleted(id: string, deletedAt: string | null): void {
      db.prepare("UPDATE users SET deleted_at = ? WHERE id = ?").run(deletedAt, id);
    },
    remove(id: string): void {
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
    },
  };

  const sessions = {
    /** A new session: the cookie value (returned once, never stored) and its CSRF token. */
    create(userId: string, opts: { demo?: boolean } = {}): { cookie: string; csrf: string; session: Session } {
      const cookie = token();
      const csrf = token();
      const t = now();
      const expires = t.add({ milliseconds: opts.demo ? DEMO_SESSION_MS : SESSION_MAX_MS }).toString();
      db.prepare("INSERT INTO sessions (id, user_id, demo, csrf, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(sha256(cookie), userId, opts.demo ? 1 : 0, csrf, t.toString(), t.toString(), expires);
      return { cookie, csrf, session: { userId, demo: !!opts.demo, csrf, createdAt: t.toString(), lastSeenAt: t.toString(), expiresAt: expires } };
    },
    /** The live session for a cookie value, its last-seen time moved on; null (and the row removed) when it has ended. */
    resolve(cookie: string | undefined): Session | null {
      if (!cookie || cookie.length > 128) return null;
      const id = sha256(cookie);
      const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
      if (!r) return null;
      const t = now();
      const s: Session = { userId: r.user_id as string, demo: r.demo === 1, csrf: r.csrf as string, createdAt: r.created_at as string, lastSeenAt: r.last_seen_at as string, expiresAt: r.expires_at as string };
      const idleEnd = Temporal.Instant.from(s.lastSeenAt).add({ milliseconds: SESSION_IDLE_MS });
      if (Temporal.Instant.compare(t, Temporal.Instant.from(s.expiresAt)) >= 0 || Temporal.Instant.compare(t, idleEnd) >= 0) {
        db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
        return null;
      }
      if (t.epochMilliseconds - Temporal.Instant.from(s.lastSeenAt).epochMilliseconds >= TOUCH_MS) {
        db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(t.toString(), id);
        s.lastSeenAt = t.toString();
      }
      return s;
    },
    end(cookie: string | undefined): void {
      if (cookie) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(cookie));
    },
    endAllFor(userId: string): void {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    },
    /** Removes ended sessions; returns how many. */
    sweep(): number {
      const t = now();
      const idle = t.subtract({ milliseconds: SESSION_IDLE_MS }).toString();
      return Number(db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?").run(t.toString(), idle).changes);
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
    put(kind: "microsoft" | "google", p: { state: string; nonce: string; verifier: string }, userId: string | null = null): void {
      const old = now().subtract({ milliseconds: AUTH_REQUEST_MS }).toString();
      db.prepare("DELETE FROM auth_requests WHERE created_at <= ?").run(old);
      db.prepare("INSERT INTO auth_requests (state, kind, nonce, verifier, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(sha256(p.state), kind, p.nonce, p.verifier, userId, at());
    },
    /** The sign-in this state belongs to, taken once (removed); null when unknown, of another kind or too old. */
    take(kind: "microsoft" | "google", state: string | null): { state: string; nonce: string; verifier: string; userId: string | null } | null {
      if (!state || state.length > 256) return null;
      const id = sha256(state);
      const r = db.prepare("SELECT * FROM auth_requests WHERE state = ?").get(id) as Row | undefined;
      if (!r) return null;
      db.prepare("DELETE FROM auth_requests WHERE state = ?").run(id);
      const fresh = now().epochMilliseconds - Temporal.Instant.from(r.created_at as string).epochMilliseconds < AUTH_REQUEST_MS;
      if (r.kind !== kind || !fresh) return null;
      return { state, nonce: r.nonce as string, verifier: r.verifier as string, userId: (r.user_id as string | null) ?? null };
    },
  };

  return { users, sessions, authRequests };
}

export type AccountStore = ReturnType<typeof createAccountStore>;
