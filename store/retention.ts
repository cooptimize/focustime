// HK-4: the retention purge. Every documented "kept N days" rule in one list, run once a day for everyone by one app
// job (server/retention-job.ts) that claims its day in job_claims, so two replicas or a restart run it once. Each rule
// deletes by age only: never by person (no statement names a person), never anything younger than its rule, and it
// leaves alone what Delete my data (the soft delete waits 30 days for the hard delete) and Clear (at once) already
// handle. Most of these rows are also trimmed where they are written; this pass covers the quiet stretches when nobody
// writes (a rule only holds if something enforces it while nobody uses FocusTime). Counts only, never content.
import type { Conn } from "./sql/conn.ts";

/** One retention rule: what it deletes and the decision that set it (docs/architecture.md, Retention). */
export type RetentionRule = { name: string; table: string; keep: string; source: string; run: (db: Conn, now: Temporal.Instant) => Promise<number> };

const ago = (now: Temporal.Instant, hours: number) => now.subtract({ hours }).toString();
const days = (n: number) => n * 24;
const del = (sql: string, ...cuts: ((now: Temporal.Instant) => string)[]) => async (db: Conn, now: Temporal.Instant) => (await db.run(sql, cuts.map((c) => c(now)))).changes;

/** How long the purge keeps its own claim rows. */
export const CLAIM_DAYS = 30;

export const RETENTION_RULES: readonly RetentionRule[] = [
  { name: "assistant_turns", table: "assistant_turns", keep: "30 days", source: "AS-1 D758", run: del("DELETE FROM assistant_turns WHERE at < ?", (n) => ago(n, days(30))) },
  {
    name: "assistant_proposals",
    table: "assistant_proposals",
    keep: "30 days; a day after it settles or expires",
    source: "AS-1 D754, D758",
    run: del("DELETE FROM assistant_proposals WHERE created_at < ? OR (state = 'open' AND expires_at < ?) OR (state <> 'open' AND done_at < ?)", (n) => ago(n, days(30)), (n) => ago(n, 24), (n) => ago(n, 24)),
  },
  { name: "teams_bot_seen", table: "teams_bot_seen", keep: "a day", source: "TB-1b D764", run: del("DELETE FROM teams_bot_seen WHERE seen_at < ?", (n) => ago(n, 24)) },
  {
    // A settled card's result stays a week (a late tap gets it again); an open one a week past its 15-minute expiry.
    // A tap on a card that's gone answers "FocusTime doesn't know this card any more" (server/teams/bot.ts).
    name: "teams_bot_cards",
    table: "teams_bot_cards",
    keep: "a week after it settles or expires",
    source: "TB-1 D745",
    run: del("DELETE FROM teams_bot_cards WHERE updated_at < ? AND (state <> 'open' OR expires_at < ?)", (n) => ago(n, days(7)), (n) => ago(n, days(7))),
  },
  { name: "teams_rhythm", table: "teams_rhythm", keep: "30 days", source: "TB-2", run: del("DELETE FROM teams_rhythm WHERE created_at < ?", (n) => ago(n, days(30))) },
  { name: "devops_takes", table: "devops_takes", keep: "14 days", source: "PV-1 D572", run: del("DELETE FROM devops_takes WHERE taken_at < ?", (n) => ago(n, days(14))) },
  { name: "devops_notes", table: "devops_notes", keep: "14 days", source: "AH-1 D664", run: del("DELETE FROM devops_notes WHERE at < ?", (n) => ago(n, days(14))) },
  { name: "devops_changes", table: "devops_changes", keep: "30 days", source: "DV-1 D590", run: del("DELETE FROM devops_changes WHERE logged_at < ?", (n) => ago(n, days(30))) },
  {
    name: "delivery_snapshots",
    table: "delivery_snapshots",
    keep: "120 days",
    source: "step 16.2",
    run: del("DELETE FROM delivery_snapshots WHERE date < ?", (n) => n.toZonedDateTimeISO("UTC").toPlainDate().subtract({ days: 120 }).toString()),
  },
  { name: "job_claims", table: "job_claims", keep: `${CLAIM_DAYS} days`, source: "HK-4", run: del("DELETE FROM job_claims WHERE claimed_at < ?", (n) => ago(n, days(CLAIM_DAYS))) },
];

/** Runs every rule, each in its own transaction (one failing doesn't stop the others); deleted rows per rule. */
export async function purgeRetention(db: Conn, now: Temporal.Instant, rules: readonly RetentionRule[] = RETENTION_RULES): Promise<{ counts: Record<string, number>; failed: string[] }> {
  const counts: Record<string, number> = {};
  const failed: string[] = [];
  for (const r of rules) {
    try {
      counts[r.name] = await db.tx(() => r.run(db, now));
    } catch {
      failed.push(r.name);
    }
  }
  return { counts, failed };
}

/** True when this call claimed `period` for `job` (a unique insert: of two callers only one gets true). */
export async function claimPeriod(db: Conn, job: string, period: string, now: Temporal.Instant): Promise<boolean> {
  return db.tx(async () => (await db.run("INSERT INTO job_claims (job, period, claimed_at) VALUES (?, ?, ?) ON CONFLICT (job, period) DO NOTHING", [job, period, now.toString()])).changes === 1);
}

/** The claimed run finished: when, and its counts (numbers only). */
export async function finishPeriod(db: Conn, job: string, period: string, now: Temporal.Instant, counts: Record<string, number>): Promise<void> {
  await db.tx(() => db.run("UPDATE job_claims SET done_at = ?, counts_json = ? WHERE job = ? AND period = ?", [now.toString(), JSON.stringify(counts), job, period]));
}

/** A claimed run that failed gives its claim back, so a later try (here or on another replica) can take it. */
export async function releasePeriod(db: Conn, job: string, period: string): Promise<void> {
  await db.tx(() => db.run("DELETE FROM job_claims WHERE job = ? AND period = ? AND done_at IS NULL", [job, period]));
}
