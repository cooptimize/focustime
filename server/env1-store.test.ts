// ENV-1: what a test site already holds stays. A non-production start runs only the allowed jobs (the retention purge,
// the ownership backfill, the people refresh and the rest of the "always" list) over a database holding chat messages,
// conversations and a transcript: every row is still there afterwards. And Admin › Status says it is a test site, and
// says when FOCUSTIME_REQUESTS_POLL has turned the chat poll on for a watch period.
import { describe, expect, it } from "vitest";
import { ownershipBackfillJob } from "../actions/ownership-backfill.ts";
import { backgroundPolicy } from "../config/background-policy.ts";
import { createMeetingStore } from "../store/meeting-store.ts";
import { CHAT, EVAN, LENA, NOW, world } from "../test/conversations.ts";
import { HOME_TENANT } from "../test/builders/index.ts";
import { backgroundStatusSource } from "./background-status.ts";
import { retentionJob } from "./retention-job.ts";
import { createScheduler } from "./scheduler.ts";

const REG = "11111111-1111-4111-8111-111111111111";

describe("ENV-1: a test site's start deletes nothing", () => {
  it("chat messages, conversations and transcripts are left in place", async () => {
    const w = world();
    await w.teams.addChat({ chatId: CHAT.chatId, clientKey: CHAT.clientKey, kind: "customer", displayName: CHAT.displayName, webUrl: null, members: CHAT.members, by: EVAN.userId! });
    const batch = [await w.say(CHAT, EVAN, "2026-11-04T19:10:00Z", "I will send the export notes tonight"), await w.say(CHAT, LENA, "2026-11-04T19:12:00Z", "Thanks Evan")];
    await w.run(CHAT, batch);
    const clock = () => Temporal.Instant.from(NOW);
    const meetings = createMeetingStore(w.conn, clock);
    const s = await meetings.addSeries({ clientKey: "contoso", name: "Contoso sync", role: "status", source: "automatic", detected: "automatic", organizer: "home", joinUrl: "https://teams.microsoft.com/l/meetup-join/x", eventId: "E1", registrantId: REG, weekday: 3, start: "10:00", minutes: 60, zone: "America/Chicago", interval: 1, reviewers: [REG], attendees: [] });
    const occ = await meetings.ensureOccurrence(s.id, "2026-11-04", "2026-11-04T16:00:00Z", "2026-11-04T17:00:00Z", "waiting", null);
    await meetings.saveTranscript(occ.id, [{ start: "00:00:01", speaker: "Lee Mate", text: "I'll send it Friday." }] as never, "automatic", null);

    const snapshot = async () => ({
      messages: (await w.teams.messagesBefore(CHAT.chatId, "2027-01-01T00:00:00Z", 100)).length,
      conversations: (await w.convs.allConversations()).length,
      transcript: (await meetings.transcript(occ.id))?.length ?? 0,
    });
    const before = await snapshot();
    expect(before.messages).toBe(2);
    expect(before.conversations).toBeGreaterThan(0);
    expect(before.transcript).toBe(1);

    const ran: string[] = [];
    const real = (name: string, j: { run: () => Promise<void>; wake: () => Promise<Temporal.Instant | null> }) => ({ name, run: async () => (ran.push(name), j.run()), wake: j.wake });
    const retention = retentionJob({ db: w.conn, now: clock, log: () => {}, expireChats: (olderThan) => w.teams.expire(olderThan), chatRetentionDays: async () => 14 });
    const backfill = ownershipBackfillJob({ db: w.conn, convs: w.convs, teams: w.teams, homeTenant: async () => HOME_TENANT, now: clock, log: () => {} });
    // The jobs a test site must never run would touch the stored rows here; they are dropped before they can.
    const forbidden = (name: string) => ({ name, run: async () => void ran.push(name), wake: async () => null });
    const scheduler = createScheduler({
      policy: backgroundPolicy({ FOCUSTIME_ENV: "dev" }),
      people: () => [],
      log: () => {},
      now: clock,
      jobs: [real(retention.name, retention), real(backfill.name, backfill), forbidden("meeting_capture"), forbidden("requests_poll")],
      maintenance: { everyMs: 0, run: async () => void ran.push("maintenance") },
    });
    expect(scheduler.jobNames()).toEqual(["retention_purge", "conversation_ownership_backfill"]);
    await scheduler.first();
    await scheduler.pass("slow");
    expect(ran).toEqual(expect.arrayContaining(["retention_purge", "conversation_ownership_backfill", "maintenance"]));
    expect(ran).not.toContain("meeting_capture");
    expect(ran).not.toContain("requests_poll");
    expect(await snapshot()).toEqual(before);
  });
});

describe("ENV-1: Admin › Status on a test site", () => {
  it("production adds nothing", () => {
    expect(backgroundStatusSource(backgroundPolicy({ FOCUSTIME_ENV: "prod" }))).toBeNull();
    expect(backgroundStatusSource(backgroundPolicy({ FOCUSTIME_ENV: "prod", FOCUSTIME_REQUESTS_POLL: "on" }))).toBeNull();
  });

  it("a test site has one row, listing what runs only on a button", async () => {
    const rows = await backgroundStatusSource(backgroundPolicy({ FOCUSTIME_ENV: "dev" }))!.rows();
    expect(rows.map((r) => r.label)).toEqual(["This is a test site"]);
    expect(rows[0]!.detail).toMatch(/Refresh/);
    expect(rows[0]!.detail).toMatch(/Check now/);
    expect(rows[0]!.detail).toMatch(/test/);
  });

  it("the override on: the chat poll runs and a second row says so; off: neither", async () => {
    const on = backgroundPolicy({ FOCUSTIME_ENV: "dev", FOCUSTIME_REQUESTS_POLL: "on" });
    const ran: string[] = [];
    const job = { name: "requests_poll", run: async () => void ran.push("requests_poll"), wake: async () => null };
    const s = createScheduler({ policy: on, people: () => [], log: () => {}, jobs: [job] });
    await s.pass("slow");
    expect(ran).toEqual(["requests_poll"]);
    expect((await backgroundStatusSource(on)!.rows()).map((r) => [r.label, r.state])).toEqual([["This is a test site", "idle"], ["Chat reading is on for a watch period", "warn"]]);
    const off = backgroundPolicy({ FOCUSTIME_ENV: "dev" });
    const s2 = createScheduler({ policy: off, people: () => [], log: () => {}, jobs: [job] });
    await s2.pass("slow");
    expect(ran).toEqual(["requests_poll"]);
    expect((await backgroundStatusSource(off)!.rows()).map((r) => r.label)).toEqual(["This is a test site"]);
  });
});
