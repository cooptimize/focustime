// ENV-1: the background policy. Production is FOCUSTIME_ENV exactly "prod" and keeps everything as before; any other
// value gets the restricted list. Every job and tick part is named in the policy, and production's lists are what they
// were before this step.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKGROUND, BACKGROUND_NAMES, backgroundPolicy, isBackgroundName, policyJobs, type BackgroundName } from "./background-policy.ts";
import { FAST_PARTS, partsFor, SLOW_PARTS } from "../server/ticks.ts";
import { MEETING_JOB } from "../server/meeting-job.ts";
import { RETENTION_JOB } from "../server/retention-job.ts";
import { STANDARDS_JOB } from "../server/standards-job.ts";
import { OWNERSHIP_BACKFILL_JOB } from "../actions/ownership-backfill.ts";

const root = join(import.meta.dirname, "..");
const ALWAYS = BACKGROUND_NAMES.filter((n) => BACKGROUND[n].outside === "always");

describe("which environment is production", () => {
  it('"prod" allows every named piece and an unnamed one', () => {
    const p = backgroundPolicy({ FOCUSTIME_ENV: "prod" });
    expect(p.production).toBe(true);
    for (const n of BACKGROUND_NAMES) expect(p.allows(n), n).toBe(true);
    expect(p.allows("something_new")).toBe(true);
    expect(p.onDemand()).toEqual([]);
    expect(p.watchPeriod).toBe(false);
  });

  for (const v of ["dev", "local", "demo", "", undefined, "Prod", "PROD", "production", "prod ", " prod", "prod\n"]) {
    it(`${JSON.stringify(v)} gets the restricted list`, () => {
      const p = backgroundPolicy(v === undefined ? {} : { FOCUSTIME_ENV: v });
      expect(p.production).toBe(false);
      expect(BACKGROUND_NAMES.filter((n) => p.allows(n))).toEqual(ALWAYS);
      expect(p.allows("something_new")).toBe(false);
      expect(p.allows("something_new", { optIn: true, inUse: true })).toBe(false);
    });
  }

  it("outside production: the never list never runs, opt_in only for the person who opted in, in_use only in use", () => {
    const p = backgroundPolicy({ FOCUSTIME_ENV: "dev" });
    const never: BackgroundName[] = ["requests_poll", "conversations_upkeep", "meeting_capture", "teams_status", "held_recheck", "vm_autostart", "coop_mailbox"];
    for (const n of never) expect(p.allows(n, { optIn: true, inUse: true }), n).toBe(false);
    for (const n of ["notices", "web_push", "teams_rhythm"] as const) {
      expect(p.allows(n), n).toBe(false);
      expect(p.allows(n, { optIn: true }), n).toBe(true);
    }
    expect(p.allows("devops_poll")).toBe(false);
    expect(p.allows("devops_poll", { inUse: true })).toBe(true);
    for (const n of ["people_refresh", "calendar_refresh", "standards_sync", "retention_purge", "maintenance", "conversation_ownership_backfill", "startup_upkeep", "focus_timer", "notice_sweep", "chat_text_cleanup"] as const) expect(p.allows(n), n).toBe(true);
  });

  it("VM-2's start and the reserved Coop mailbox are off outside production", () => {
    expect(BACKGROUND.vm_autostart.outside).toBe("never");
    expect(BACKGROUND.coop_mailbox.outside).toBe("never");
  });

  it("every entry says what it touches and does", () => {
    for (const n of BACKGROUND_NAMES) {
      const e = BACKGROUND[n];
      expect(e.what.length, n).toBeGreaterThan(10);
      expect(e.touches.length, n).toBeGreaterThan(1);
    }
  });
});

describe("FOCUSTIME_REQUESTS_POLL, the watch period override", () => {
  it("on outside production: the chat poll and its upkeep run, and it is a watch period", () => {
    const p = backgroundPolicy({ FOCUSTIME_ENV: "dev", FOCUSTIME_REQUESTS_POLL: "on" });
    expect(p.allows("requests_poll")).toBe(true);
    expect(p.allows("conversations_upkeep")).toBe(true);
    expect(p.watchPeriod).toBe(true);
    // It opens the chat poll only.
    expect(p.allows("meeting_capture")).toBe(false);
    expect(p.allows("held_recheck")).toBe(false);
  });
  for (const v of ["off", "", undefined, "yes", "true"]) {
    it(`${JSON.stringify(v)} outside production: off`, () => {
      const p = backgroundPolicy({ FOCUSTIME_ENV: "dev", ...(v === undefined ? {} : { FOCUSTIME_REQUESTS_POLL: v }) });
      expect(p.allows("requests_poll")).toBe(false);
      expect(p.watchPeriod).toBe(false);
    });
  }
  it("production as before: on unless it says off", () => {
    expect(backgroundPolicy({ FOCUSTIME_ENV: "prod" }).allows("requests_poll")).toBe(true);
    expect(backgroundPolicy({ FOCUSTIME_ENV: "prod", FOCUSTIME_REQUESTS_POLL: "on" }).allows("requests_poll")).toBe(true);
    expect(backgroundPolicy({ FOCUSTIME_ENV: "prod", FOCUSTIME_REQUESTS_POLL: "off" }).allows("requests_poll")).toBe(false);
    expect(backgroundPolicy({ FOCUSTIME_ENV: "prod", FOCUSTIME_REQUESTS_POLL: "off" }).watchPeriod).toBe(false);
  });
});

// The app jobs server/main.ts hands the scheduler, in order, before ENV-1 (requests_poll last, only when polling on).
const PRE_ENV1_JOBS = ["people_refresh", "retention_purge", "conversation_ownership_backfill", "meeting_capture", "standards_sync", "devops_poll", "requests_poll"];
const job = (name: string, ran: string[]) => ({ name, run: async () => void ran.push(name), wake: async () => null });

describe("the scheduler's jobs", () => {
  it("every job server/main.ts schedules is named in the policy (a new one must be decided first)", () => {
    const src = readFileSync(join(root, "server/main.ts"), "utf8");
    const block = src.slice(src.indexOf("const scheduler = createScheduler({"), src.indexOf("people: async () =>", src.indexOf("const scheduler = createScheduler({")));
    const literal = [...block.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]!);
    const viaConst = [...block.matchAll(/name: ([a-zA-Z]+)\.name/g)].map((m) => m[1]!);
    expect(literal.length + viaConst.length + (block.includes("peopleJob,") ? 1 : 0) + (block.includes("retention,") ? 1 : 0)).toBe(PRE_ENV1_JOBS.length);
    for (const n of literal) expect(isBackgroundName(n), n).toBe(true);
    for (const n of [MEETING_JOB, RETENTION_JOB, STANDARDS_JOB, OWNERSHIP_BACKFILL_JOB, "people_refresh"]) expect(isBackgroundName(n), n).toBe(true);
    expect(src).toMatch(/policy: background,/);
  });

  it("production keeps every job, in order, the same objects", () => {
    const ran: string[] = [];
    const jobs = PRE_ENV1_JOBS.map((n) => job(n, ran));
    const kept = policyJobs(backgroundPolicy({ FOCUSTIME_ENV: "prod" }), jobs, () => false);
    expect(kept).toEqual(jobs);
    kept.forEach((j, i) => expect(j).toBe(jobs[i]));
    // An unnamed job in production runs as before.
    expect(policyJobs(backgroundPolicy({ FOCUSTIME_ENV: "prod" }), [job("new_one", ran)], () => false).map((j) => j.name)).toEqual(["new_one"]);
  });

  it("outside production: only the allowed jobs; an unnamed one is dropped and reported; DevOps only while in use", async () => {
    const ran: string[] = [];
    const dropped: string[] = [];
    let active = false;
    const kept = policyJobs(backgroundPolicy({ FOCUSTIME_ENV: "dev" }), [...PRE_ENV1_JOBS, "new_one"].map((n) => job(n, ran)), () => active, (n) => dropped.push(n));
    expect(kept.map((j) => j.name)).toEqual(["people_refresh", "retention_purge", "conversation_ownership_backfill", "standards_sync", "devops_poll"]);
    expect(dropped).toEqual(["meeting_capture", "requests_poll", "new_one"]);
    for (const j of kept) await j.run();
    expect(ran).toEqual(["people_refresh", "retention_purge", "conversation_ownership_backfill", "standards_sync"]);
    expect(await kept.find((j) => j.name === "devops_poll")!.wake()).toBeNull();
    active = true;
    await kept.find((j) => j.name === "devops_poll")!.run();
    expect(ran.at(-1)).toBe("devops_poll");
  });
});

// Each person's tick parts, in order, before ENV-1 (server/ticks.ts's slow and fast passes).
// VM-2 merged during this step: its auto-start ran between the workday notices and the VM notice, and still does.
const PRE_ENV1_SLOW = ["teams_rhythm", "day_reminders", "workday_notices", "vm_autostart", "vm_notice", "urgent_asks", "chat_text_cleanup", "conversation_notices", "takes", "notes", "team", "meetings"];
const PRE_ENV1_FAST = ["timer", "warnings", "held", "sweep", "teams_status"];

describe("each person's tick parts", () => {
  it("are what they were before ENV-1, each under a policy name", () => {
    expect(SLOW_PARTS.map(([p]) => p)).toEqual(PRE_ENV1_SLOW);
    expect(FAST_PARTS.map(([p]) => p)).toEqual(PRE_ENV1_FAST);
    for (const [, n] of [...SLOW_PARTS, ...FAST_PARTS]) expect(isBackgroundName(n), n).toBe(true);
  });

  it("production runs every part, opted in or not", () => {
    const p = backgroundPolicy({ FOCUSTIME_ENV: "prod" });
    for (const optIn of [false, true]) expect(partsFor(p, optIn)).toEqual({ slow: PRE_ENV1_SLOW, fast: PRE_ENV1_FAST });
  });

  it("outside production: the timer, calendar refresh, sweep and cleanup; reminders and Teams messages only when opted in; never Teams status", () => {
    const p = backgroundPolicy({ FOCUSTIME_ENV: "dev" });
    expect(partsFor(p, false)).toEqual({ slow: ["chat_text_cleanup"], fast: ["timer", "warnings", "sweep"] });
    expect(partsFor(p, true)).toEqual({ slow: PRE_ENV1_SLOW.filter((x) => x !== "vm_autostart"), fast: ["timer", "warnings", "held", "sweep"] });
  });
});

describe("background work starts only from the scheduler", () => {
  const files = (dir: string): string[] =>
    readdirSync(join(root, dir)).flatMap((f) => {
      const p = join(dir, f);
      return statSync(join(root, p)).isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.includes("fakes") ? [p] : [];
    });
  it("no setInterval in the server's code but the scheduler's", () => {
    const hits = ["server", "actions", "sources", "store", "ai", "plan", "week", "config", "host"].flatMap(files).filter((p) => /\bsetInterval\(/.test(readFileSync(join(root, p), "utf8")));
    expect(hits).toEqual(["server/scheduler.ts"]);
  });
  it("every top-level start-up call in server/main.ts goes through atStart under a policy name", () => {
    const src = readFileSync(join(root, "server/main.ts"), "utf8");
    const starts = src.split("\n").filter((l) => /^(void|await) /.test(l) || /^if \([^)]*\) void /.test(l));
    expect(starts.length).toBeGreaterThan(5);
    for (const l of starts) expect(l, l).toMatch(/atStart\("([a-z_]+)"/);
    for (const m of src.matchAll(/atStart\("([a-z_]+)"/g)) expect(isBackgroundName(m[1]!), m[1]).toBe(true);
  });

  it("nothing reads FOCUSTIME_ENV to decide what runs but the policy (buildinfo only labels the build)", () => {
    const hits = ["server", "actions", "sources", "store", "ai", "plan", "week", "config", "host"].flatMap(files).filter((p) =>
      // Code only: comments may say what the policy reads.
      readFileSync(join(root, p), "utf8").split("\n").some((l) => l.includes("FOCUSTIME_ENV") && !/^\s*(\/\/|\*|\/\*)/.test(l)),
    );
    expect(hits.sort()).toEqual(["config/background-policy.ts", "server/buildinfo.ts"]);
    // The chat poll's old default from the build label is gone (the Teams app link still names the build's own app).
    expect(readFileSync(join(root, "server/main.ts"), "utf8")).not.toMatch(/build\.env === "prod" \? "on"/);
  });
});
