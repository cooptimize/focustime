// HK-4: the retention purge deletes rows past their rule and keeps rows inside it, for everyone at once; it runs
// once a day however many schedulers (replicas) run it; and a failed run gives its claim back.
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../log/logger.ts";
import { createScheduler } from "../server/scheduler.ts";
import { retentionJob } from "../server/retention-job.ts";
import { forEachDriver } from "../test/db.ts";
import { createAccountStore } from "./accounts.ts";
import { purgeRetention } from "./retention.ts";
import { scopedDb } from "./scope.ts";
import type { Conn } from "./sql/conn.ts";

const NOW = Temporal.Instant.from("2026-11-20T12:00:00Z");
const ago = (h: number) => NOW.subtract({ minutes: Math.round(h * 60) }).toString();
const D = 24;

await forEachDriver("retention purge", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    const accounts = createAccountStore(db, () => NOW);
    for (const id of ["ana", "ben"]) await accounts.users.signedIn({ id, tenantId: "t", upn: `${id}@cooptimize.example`, displayName: id, email: `${id}@cooptimize.example` });
    return db;
  }
  async function seed(db: Conn, id: string) {
    const s = scopedDb(db, id, () => "UTC");
    for (const [at, text] of [[ago(31 * D), "old"], [ago(29 * D), "recent"]] as const) await s.run("INSERT INTO assistant_turns (at, channel, role, text) VALUES (?, 'panel', 'me', ?)", at, text);
    const p = (state: string, created: number, expires: number, done: number | null) =>
      s.run("INSERT INTO assistant_proposals (action, input_json, view_json, snapshot_json, state, created_at, expires_at, done_at) VALUES ('pick.move', '{}', '{}', '{}', ?, ?, ?, ?)", state, ago(created), ago(expires), done === null ? null : ago(done));
    await p("open", 2 * D, 2 * D - 0.25, null); // expired over a day ago: goes
    await p("open", 0.1, -0.15, null); // open now: stays
    await p("confirmed", 3 * D, 3 * D, 2 * D); // settled two days ago: goes
    await p("confirmed", 0.5, 0.25, 0.4); // settled minutes ago: stays
    for (const [h, hash] of [[25, "a".repeat(64)], [2, "b".repeat(64)]] as const) await s.run("INSERT INTO teams_bot_seen (activity_hash, seen_at) VALUES (?, ?)", hash, ago(h));
    const card = (pid: string, state: string, updated: number, expires: number) =>
      s.run("INSERT INTO teams_bot_cards (proposal_id, title, state, expires_at, created_at, updated_at) VALUES (?, 'Move a to-do', ?, ?, ?, ?)", pid, state, ago(expires), ago(updated), ago(updated));
    await card("p1", "done", 8 * D, 8 * D); // settled 8 days ago: goes
    await card("p2", "done", 6 * D, 6 * D); // settled 6 days ago: stays
    await card("p3", "open", 8 * D, 8 * D); // open, expired 8 days ago: goes
    await card("p4", "open", 0.1, -0.15); // open now: stays
  }
  const count = async (db: Conn, sql: string) => Number(((await db.get(sql)) as { n: number }).n);

  describe("rules", () => {
    it("deletes rows past retention for every person and keeps the rows inside it", async () => {
      const db = await setup();
      await seed(db, "ana");
      await seed(db, "ben");
      for (const [h, email] of [[15 * D, "old@cooptimize.example"], [13 * D, "new@cooptimize.example"]] as const)
        await db.run("INSERT INTO devops_takes (client_key, org, item_id, from_email, by_name, taken_at) VALUES ('contoso', 'contoso', 1, ?, 'Ana', ?)", [email, ago(h)]);
      const { counts, failed } = await purgeRetention(db, NOW);
      expect(failed).toEqual([]);
      expect(counts).toMatchObject({ assistant_turns: 2, assistant_proposals: 4, teams_bot_seen: 2, teams_bot_cards: 4, devops_takes: 1 });
      for (const id of ["ana", "ben"]) {
        const s = scopedDb(db, id, () => "UTC");
        expect((await s.all("SELECT text FROM assistant_turns")).map((r) => r.text)).toEqual(["recent"]);
        expect((await s.all("SELECT state FROM assistant_proposals ORDER BY id")).map((r) => r.state)).toEqual(["open", "confirmed"]);
        expect((await s.all("SELECT activity_hash FROM teams_bot_seen")).map((r) => r.activity_hash)).toEqual(["b".repeat(64)]);
        expect((await s.all("SELECT proposal_id FROM teams_bot_cards ORDER BY proposal_id")).map((r) => r.proposal_id)).toEqual(["p2", "p4"]);
      }
      expect(await count(db, "SELECT COUNT(*) AS n FROM devops_takes")).toBe(1);
      // A second run the same day finds nothing more.
      expect(Object.values((await purgeRetention(db, NOW)).counts).every((n) => n === 0)).toBe(true);
    });
  });

  describe("the job", () => {
    it("runs once a day with two schedulers on one database, logging counts only", async () => {
      const db = await setup();
      await seed(db, "ana");
      const logs: LogRecord[] = [];
      const log = (r: LogRecord) => void logs.push(r);
      const expired: string[] = [];
      const job = () => retentionJob({ db, now: () => NOW, log, expireChats: async (t) => (expired.push(t), 3), chatRetentionDays: async () => 14 });
      const a = createScheduler({ people: () => [], log, jobs: [job()], now: () => NOW });
      const b = createScheduler({ people: () => [], log, jobs: [job()], now: () => NOW });
      await Promise.all([a.pass("slow"), b.pass("slow")]);
      await Promise.all([a.pass("slow"), b.pass("slow")]);
      const done = logs.filter((r) => r.op === "retention_purge" && r.kind === "done");
      expect(done).toHaveLength(1);
      expect(expired).toEqual([NOW.subtract({ hours: 14 * D }).toString()]);
      expect(logs).toContainEqual({ source: "plan", op: "retention_purge", kind: "assistant_turns", count: 1 });
      expect(logs).toContainEqual({ source: "plan", op: "retention_purge", kind: "teams_messages", count: 3 });
      expect(JSON.stringify(logs)).not.toMatch(/old|ana|pick\.move|Move a to-do/);
      const claims = await db.all("SELECT job, period, done_at, counts_json FROM job_claims");
      expect(claims).toEqual([expect.objectContaining({ job: "retention_purge", period: "2026-11-20", done_at: NOW.toString() })]);
    });

    it("sleeps until the next UTC midnight once the day is done; a failed run gives back its claim and tries again in an hour", async () => {
      const db = await setup();
      let now = NOW;
      const logs: LogRecord[] = [];
      let fail = true;
      const boom = { name: "boom", table: "x", keep: "", source: "", run: async () => { if (fail) throw new Error("x"); return 0; } };
      const job = retentionJob({ db, now: () => now, log: (r) => void logs.push(r), rules: [boom] });
      // A rule that throws is reported and the run still completes.
      await job.run();
      expect(logs.map((r) => r.kind)).toEqual(["done_with_failures", "boom_failed"]);
      expect((await job.wake())?.toString()).toBe("2026-11-21T00:00:00Z");
      // The next day the finish fails after the claim: the claim goes back, and the next try is an hour on.
      now = Temporal.Instant.from("2026-11-21T01:00:00Z");
      fail = false;
      const flaky: Conn = Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
        run: (sql: string, params?: readonly unknown[]) => (/^UPDATE job_claims/.test(sql) ? Promise.reject(new Error("down")) : db.run(sql, params as never)),
      });
      const again = retentionJob({ db: flaky, now: () => now, log: (r) => void logs.push(r), rules: [boom] });
      await again.run();
      expect(logs.at(-1)?.kind).toBe("failed");
      expect(await db.all("SELECT period FROM job_claims WHERE period = '2026-11-21'")).toEqual([]);
      expect((await again.wake())?.toString()).toBe("2026-11-21T02:00:00Z");
      await again.run(); // inside the hour: nothing
      expect(logs.at(-1)?.kind).toBe("failed");
    });
  });
});
