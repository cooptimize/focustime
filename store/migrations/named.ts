// Timestamped migrations (S1, D458), safe for parallel work. A new schema change is a file in store/migrations named
// <UTC timestamp>_<what> (20261103T1700_setup_state), listed in index.ts. Two branches can each add one without taking
// the same number. The runners (plan-store.ts for SQLite, sql/migrate.ts for SQL Server) apply the numbered migrations
// first (SQLite's 1 to 28, SQL Server's 26 to 30: never renumbered, never edited), then every named one not yet
// applied, in name order, each in its own transaction and recorded by its full name in schema_migration_names.
// Two migrations with one prefix fail named.test.ts, so CI stops them before they reach main.

export type NamedMigration = {
  /** <yyyymmdd>T<hhmm>_<snake_case>, UTC. */
  name: string;
  sqlite: string;
  sqlserver: string;
  /** A count (SELECT ... AS n, the same in both dialects) taken in its transaction before it runs, logged as `op` (never the values). */
  count?: { op: string; sql: string };
};

export const NAME = /^(\d{8}T\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** The timestamp prefix of a migration name ("20261103T1700"), or null when the name has none. */
export const prefixOf = (name: string): string | null => NAME.exec(name)?.[1] ?? null;

/** What's wrong with a list of named migrations: bad names, bad timestamps, shared prefixes. Empty when fine. */
export function namedProblems(list: readonly Pick<NamedMigration, "name">[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const { name } of list) {
    const p = prefixOf(name);
    if (!p) {
      out.push(`${name}: not <yyyymmdd>T<hhmm>_<what>`);
      continue;
    }
    const [, y, mo, d, h, mi] = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)$/.exec(p)!.map(Number);
    if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || h! > 23 || mi! > 59 || y! < 2026) out.push(`${name}: ${p} is not a UTC time`);
    const other = seen.get(p);
    if (other) out.push(`${name} and ${other} share the prefix ${p}`);
    else seen.set(p, name);
  }
  return out;
}

/** The list in the order the runners apply it (name order), refused when it has a problem. */
export function inOrder<T extends Pick<NamedMigration, "name">>(list: readonly T[]): T[] {
  const problems = namedProblems(list);
  if (problems.length) throw new Error(`Migrations: ${problems.join("; ")}`);
  return [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The named migrations to apply, given those already recorded. A recorded name this build doesn't know is fine, even
 * one newer than its newest: migrations only add (D468), so an older build runs safely on a newer database, and
 * rolling back to the previous revision never needs the database rolled back too. `newerThanBuild` names them.
 */
export function pending<T extends Pick<NamedMigration, "name">>(list: readonly T[], applied: ReadonlySet<string>): T[] {
  return inOrder(list).filter((m) => !applied.has(m.name));
}

/** Recorded migrations newer than this build's newest (a rollback, or a newer revision migrated first). */
export function newerThanBuild(list: readonly Pick<NamedMigration, "name">[], applied: ReadonlySet<string>): string[] {
  const ordered = inOrder(list);
  const newest = ordered[ordered.length - 1]?.name ?? "";
  const known = new Set(ordered.map((m) => m.name));
  return [...applied].filter((n) => !known.has(n) && n > newest).sort();
}

export const NAMES_TABLE = "schema_migration_names";
