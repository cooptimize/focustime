// Starts the HTTP app for a test (A2): an in-memory account store, a signed-in session, and a client that sends the
// session cookie, the CSRF header and a same-origin Origin like the page does. Test-only.
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import type { ActionContext } from "../actions/dispatch.ts";
import type { Logger } from "../log/logger.ts";
import { createAccountStore } from "../store/accounts.ts";
import { MIGRATIONS } from "../store/plan-store.ts";
import type { Conn } from "../store/sql/conn.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { onFreePort } from "../test/ports.ts";
import { createApp, type AppOptions, type SignInHooks } from "./app.ts";
import { CSRF_COOKIE, SESSION_COOKIE } from "./auth/cookies.ts";

export type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

/** A database with the app tables (users, sessions, auth_requests), for an account store. */
export function accountsDb(): Conn {
  const db = new DatabaseSync(":memory:");
  // The migration that adds users, sessions and auth_requests; the plan tables are not needed here.
  db.exec(MIGRATIONS.find((m) => m.includes("CREATE TABLE users"))!);
  return sqliteConn(db);
}

export async function startTestApp(o: {
  ctx: ActionContext | ((s: { userId: string; demo: boolean }) => ActionContext | Promise<ActionContext>);
  log?: Logger;
  distDir?: string;
  auth?: Partial<SignInHooks>;
  now?: () => Temporal.Instant;
  extra?: Partial<AppOptions>;
}) {
  const db = accountsDb();
  let clock = o.now ?? (() => Temporal.Now.instant());
  const accounts = createAccountStore(db, () => clock());
  const ctx = typeof o.ctx === "function" ? o.ctx : () => o.ctx as ActionContext;
  // The public URL (Host and Origin checks) needs the port before the app starts: a free port from the OS, and a new
  // one if another test takes it first (test/ports.ts).
  const { server, port } = await onFreePort(async (port) => {
    const server = createApp({
      publicUrl: `http://localhost:${port}`,
      log: o.log ?? (() => {}),
      accounts,
      auth: { microsoft: null, signedIn: async () => ({ refused: "refused" }), demo: null, ...o.auth },
      ctx,
      ...(o.distDir ? { distDir: o.distDir } : {}),
      ...o.extra,
    });
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => ok());
    });
    return { server, port };
  });
  const publicUrl = `http://localhost:${port}`;

  /** A browser: keeps the cookies the app sets and sends them back. */
  function browser() {
    const jar = new Map<string, string>();
    const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    function send(path: string, headers: Record<string, string> = {}, method = "GET", body?: string): Promise<Res> {
      return new Promise((resolve, reject) => {
        const h: Record<string, string> = { host: `localhost:${port}`, ...(jar.size ? { cookie: cookieHeader() } : {}), ...headers };
        if (body) h["content-length"] = String(Buffer.byteLength(body));
        const req = request({ host: "127.0.0.1", port, path, method, headers: h }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            const set = res.headers["set-cookie"] ?? [];
            for (const c of set) {
              const [pair, ...attrs] = c.split(";");
              const i = pair!.indexOf("=");
              const name = pair!.slice(0, i);
              const value = pair!.slice(i + 1);
              if (attrs.some((a) => a.trim().toLowerCase() === "max-age=0")) jar.delete(name);
              else jar.set(name, value);
            }
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data });
          });
        });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
      });
    }
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      send(path, { origin: publicUrl, "content-type": "application/json", "x-csrf": jar.get(CSRF_COOKIE) ?? "", ...headers }, "POST", JSON.stringify(body));
    const action = (action: string, input: unknown = {}, headers: Record<string, string> = {}) => post("/api/action", { action, input }, headers);
    /** Signs this browser in as `userId` directly (the session the sign-in route would make). */
    const signIn = async (userId: string, demo = false) => {
      const s = (await accounts.sessions.create(userId, { demo }));
      jar.set(SESSION_COOKIE, s.cookie);
      jar.set(CSRF_COOKIE, s.csrf);
      return s;
    };
    return { send, post, action, signIn, jar };
  }

  return {
    port,
    publicUrl,
    accounts,
    db,
    browser,
    setClock: (f: () => Temporal.Instant) => void (clock = f),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
