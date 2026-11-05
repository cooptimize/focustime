// A3: the one interface the plan store talks to, with two drivers behind it: SQL Server (store/sql/sqlserver.ts: Azure
// SQL in the hosted app, a local container for development and tests) and SQLite (store/sql/sqlite.ts: the demo, and
// the read side of the one-time import of a local store). Everything is async (mssql is), statements take positional
// `?` parameters plus the person's `$uid` (bound by store/scope.ts, never by a caller), and a transaction is carried
// through async calls (AsyncLocalStorage), so code that runs inside `tx` joins it without passing a handle around.
//
// The store writes its SQL once, in the common subset of the two dialects. The few SQLite forms the store relies on
// (ON CONFLICT upserts, LIMIT, `$uid`) are rewritten for SQL Server by store/sql/tsql.ts.

/** CV-2: bytes (an image) go as a Uint8Array: BLOB in SQLite, varbinary in SQL Server. */
export type Param = null | number | string | boolean | Uint8Array;
export type Row = Record<string, unknown>;
export type RunResult = { changes: number; lastId: number | null };
export type Dialect = "sqlite" | "sqlserver";

/** What the scoping layer passes with a statement: the person, and the table the statement reads (for decoding). */
export type StatementContext = {
  uid?: string;
  table?: string | null;
  zone?: string;
  /** An INSERT that gives the identity id itself (the import keeping ids). SQL Server: IDENTITY_INSERT for this statement. */
  keepIds?: boolean;
};

export interface Conn {
  readonly dialect: Dialect;
  all(sql: string, params?: readonly Param[], ctx?: StatementContext): Promise<Row[]>;
  get(sql: string, params?: readonly Param[], ctx?: StatementContext): Promise<Row | undefined>;
  run(sql: string, params?: readonly Param[], ctx?: StatementContext): Promise<RunResult>;
  /** Runs `fn` in one transaction (joined when one is already open on this connection); rolled back when it throws. */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  /** Whether a transaction is open in this async context. */
  inTx(): boolean;
  /** Statements sent to the database since the connection opened (the idle rule's test counts these). */
  readonly statements: number;
  close(): Promise<void>;
}

