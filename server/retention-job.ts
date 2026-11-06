// HK-4: the retention purge as one app job on the scheduler (server/scheduler.ts jobs): once per UTC day, claimed in
// job_claims so it runs once however many replicas or restarts, then every rule in store/retention.ts, and the stored
// chat messages past the team's Rule (conv.retention_days, 14 by default), which the shared poll otherwise expires only
// after a poll (so never where polling is on demand). Logs counts per rule, never content or people. The idle rule
// (D431): its wake is the next UTC midnight once today is done, held in memory, so a sleeping server reads nothing
// for it; a failed run gives back its claim and tries again in an hour.
import type { Logger } from "../log/logger.ts";
import { claimPeriod, finishPeriod, purgeRetention, releasePeriod, RETENTION_RULES, type RetentionRule } from "../store/retention.ts";
import type { Conn } from "../store/sql/conn.ts";

export const RETENTION_JOB = "retention_purge";
const RETRY_HOURS = 1;

export type RetentionJobDeps = {
  db: Conn;
  now: () => Temporal.Instant;
  log: Logger;
  /** Stored chat messages older than this go (the teams store's expire, which keeps a Request's, a promise's and a conversation's). */
  expireChats?: (olderThan: string) => Promise<number>;
  /** The Rule conv.retention_days. */
  chatRetentionDays?: () => Promise<number>;
  rules?: readonly RetentionRule[];
};

const dayOf = (t: Temporal.Instant) => t.toZonedDateTimeISO("UTC").toPlainDate().toString();
const nextMidnight = (t: Temporal.Instant) => t.toZonedDateTimeISO("UTC").toPlainDate().add({ days: 1 }).toZonedDateTime("UTC").toInstant();

export function retentionJob(d: RetentionJobDeps) {
  /** The UTC day this server knows is done (here or by another replica). */
  let doneDay: string | null = null;
  let retryAt: Temporal.Instant | null = null;

  async function run(): Promise<void> {
    const now = d.now();
    const day = dayOf(now);
    if (doneDay === day) return;
    if (retryAt && Temporal.Instant.compare(now, retryAt) < 0) return;
    if (!(await claimPeriod(d.db, RETENTION_JOB, day, now))) {
      // Another replica (or this one before a restart) has it.
      doneDay = day;
      return;
    }
    try {
      const { counts, failed } = await purgeRetention(d.db, now, d.rules ?? RETENTION_RULES);
      if (d.expireChats && d.chatRetentionDays) {
        try {
          const keep = await d.chatRetentionDays();
          counts.teams_messages = await d.expireChats(now.subtract({ hours: 24 * keep }).toString());
        } catch {
          failed.push("teams_messages");
        }
      }
      await finishPeriod(d.db, RETENTION_JOB, day, d.now(), counts);
      for (const [rule, n] of Object.entries(counts)) if (n) d.log({ source: "plan", op: "retention_purge", kind: rule, count: n });
      d.log({ source: "plan", op: "retention_purge", kind: failed.length ? "done_with_failures" : "done", count: Object.values(counts).reduce((a, b) => a + b, 0) });
      for (const f of failed) d.log({ source: "plan", op: "retention_purge", kind: `${f}_failed` });
      doneDay = day;
      retryAt = null;
    } catch {
      await releasePeriod(d.db, RETENTION_JOB, day).catch(() => undefined);
      retryAt = now.add({ hours: RETRY_HOURS });
      d.log({ source: "plan", op: "retention_purge", kind: "failed" });
    }
  }

  async function wake(): Promise<Temporal.Instant | null> {
    const now = d.now();
    if (doneDay === dayOf(now)) return nextMidnight(now);
    return retryAt && Temporal.Instant.compare(retryAt, now) > 0 ? retryAt : now;
  }

  return { name: RETENTION_JOB, run, wake };
}
