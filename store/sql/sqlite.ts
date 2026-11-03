// A3: the SQLite driver (demo sessions, scripts, and the read side of importing a local store). node:sqlite is
// synchronous; this wraps it in the async Conn interface. One connection is shared by every request, so a transaction
// holds a lock for its length: statements from other async work wait for it instead of running inside it.
import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Conn, Param, Row, RunResult, StatementContext } from "./conn.ts";

const bind = (params: readonly Param[], ctx?: StatementContext): SQLInputValue[] => {
  const p = params.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v));
  return ctx?.uid !== undefined ? [{ uid: ctx.uid } as unknown as SQLInputValue, ...p] : p;
};

export function sqliteConn(db: DatabaseSync): Conn {
  const inside = new AsyncLocalStorage<true>();
  let chain: Promise<unknown> = Promise.resolve();
  let statements = 0;
  /** Runs f once every transaction queued before it has finished. */
  const locked = <T>(f: () => T | Promise<T>): Promise<T> => {
    const next = chain.then(f);
    chain = next.catch(() => undefined);
    return next;
  };
  const now = <T>(f: () => T): Promise<T> => {
    statements++;
    return inside.getStore() ? Promise.resolve().then(f) : locked(f);
  };
  return {
    dialect: "sqlite",
    all: (sql, params = [], ctx) => now(() => db.prepare(sql).all(...bind(params, ctx)) as Row[]),
    get: (sql, params = [], ctx) => now(() => db.prepare(sql).get(...bind(params, ctx)) as Row | undefined),
    run: (sql, params = [], ctx) =>
      now((): RunResult => {
        const r = db.prepare(sql).run(...bind(params, ctx));
        return { changes: Number(r.changes), lastId: r.lastInsertRowid ? Number(r.lastInsertRowid) : null };
      }),
    tx<T>(fn: () => Promise<T>): Promise<T> {
      if (inside.getStore()) return fn();
      return locked(async () => {
        statements++;
        db.exec("BEGIN IMMEDIATE");
        try {
          const out = await inside.run(true, fn);
          db.exec("COMMIT");
          return out;
        } catch (e) {
          if (db.isTransaction) db.exec("ROLLBACK");
          throw e;
        }
      });
    },
    inTx: () => !!inside.getStore(),
    get statements() {
      return statements;
    },
    close: async () => {
      if (db.isOpen) db.close();
    },
  };
}
