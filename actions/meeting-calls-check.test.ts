// MC-4: which calls on my own calendar have a transcript in Teams. The Graph client's gate lets the "exists" purpose
// through only for one check's own calls, and never a transcript's text; the check asks Teams only for Teams meetings
// organized at Cooptimize that nobody asked FocusTime to read, at most CHECK_CAP at a time, in batches of 20; its
// answers are held in memory 15 minutes and are each call's key and yes, no, off or unchecked, nothing else; nothing
// is stored and the log has counts only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKGROUND } from "../config/background-policy.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { createMeetingsClient, MeetingRefused, type GateQuery } from "../sources/graph/meetings.ts";
import { createMeetingStore } from "../store/meeting-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { CHECK_CAP, createExistsGrants, createExistsHold } from "./call-exists.ts";
import { createPressGrants } from "./call-press.ts";
import { meetingAction, type MeetingContext } from "./meeting-actions.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const MATE = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-11-12T17:00:00Z";
const link = (k: string) => `https://teams.microsoft.com/l/meetup-join/19%3a${k}%40thread.v2/0`;

type Ev = { key: string; subject: string; start: string; end: string; join: string | null; organizer: string; attendees?: string[] };
const ev = (n: number, p: Partial<Ev> = {}): Ev => {
  const at = Temporal.Instant.from("2026-11-10T00:00:00Z").add({ minutes: 30 * n });
  const plain = (i: Temporal.Instant) => `${i.toString().slice(0, 19)}.0000000`;
  return { key: `ical-${n}`, subject: `Call ${n}`, start: plain(at), end: plain(at.add({ minutes: 30 })), join: link(`call-${n}`), organizer: "kat@cooptimize.example", ...p };
};

/** A pretend Graph: my calendar, and per join link whether Teams has a transcript ("off": the tenant's setting). */
function fakeGraph(events: Ev[], has: (join: string) => boolean | "off" | "fail") {
  const sent: { method: string; url: string; body?: string }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ method: init?.method ?? "GET", url, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/me/calendarView")) {
      return ok({
        value: events.map((e) => ({
          iCalUId: e.key, subject: e.subject, start: { dateTime: e.start }, end: { dateTime: e.end }, isAllDay: false, isCancelled: false, isOrganizer: false, responseStatus: { response: "accepted" },
          organizer: { emailAddress: { address: e.organizer } }, attendees: (e.attendees ?? ["sam@cooptimize.example", "dana@client.example"]).map((a) => ({ type: "required", emailAddress: { address: a } })), onlineMeeting: e.join ? { joinUrl: e.join } : null,
        })),
      });
    }
    if (url.endsWith("/$batch")) {
      const reqs = (JSON.parse(String(init?.body)) as { requests: { id: string; url: string }[] }).requests;
      return ok({
        responses: reqs.map((r) => {
          const filter = /JoinWebUrl eq '([^']+)'/.exec(decodeURIComponent(r.url));
          if (filter) {
            const j = filter[1]!;
            if (has(j) === "fail") return { id: r.id, status: 503, body: null };
            return { id: r.id, status: 200, body: { value: [{ id: `om-${encodeURIComponent(j)}` }] } };
          }
          const m = /onlineMeetings\/([^/]+)\/transcripts/.exec(r.url);
          const j = decodeURIComponent(decodeURIComponent(m![1]!).slice(3));
          const h = has(j);
          if (h === "off") return { id: r.id, status: 403, body: { error: { code: "Forbidden", innerError: { code: "GraphAccessToTranscriptsDisabled" } } } };
          const e = events.find((x) => x.join === j)!;
          return { id: r.id, status: 200, body: { value: h ? [{ id: "t1", createdDateTime: `${e.start.slice(0, 19)}Z` }] : [] } };
        }),
      });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

async function setup(events: Ev[], has: (join: string) => boolean | "off" | "fail" = () => true) {
  const db = sqliteDb();
  await addUsers(db.conn, ME, MATE);
  const meetings = createMeetingStore(db.conn, () => Temporal.Instant.from(NOW));
  const cfg = parseConfig(`${STARTER_TOML.replace('my_email = ""', 'my_email = "sam@cooptimize.example"')}\n[clients.contoso]\nname = "Contoso"\n`);
  if (!cfg.ok) throw new Error("config");
  const grants = createExistsGrants();
  const press = createPressGrants();
  const hold = createExistsHold();
  const g = fakeGraph(events, has);
  const asked: GateQuery[] = [];
  const logs: LogRecord[] = [];
  const client = (who: string) =>
    createMeetingsClient({
      fetch: g.fetch, calendarToken: async () => "cal", meetingsToken: async () => "mtg", invalidate: () => {}, homeDomains: ["cooptimize.example"], log: (r) => void logs.push(r as LogRecord),
      gate: { allowed: async (q) => (asked.push(q), q.purpose === "exists" ? grants.allowed(who, q) : press.allowed(who, q)) },
    });
  const ctxAs = (me: string): MeetingContext =>
    ({
      meetings, conversations: undefined, plan: planStoreOn(db.conn, { now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC"), userId: me }),
      me: async () => me, isAdmin: async () => false, config: async () => cfg.config, now: () => NOW, homeDomains: async () => ["cooptimize.example"],
      graph: () => client(me), users: async () => [], client: async () => null, leads: async () => [], capture: async () => null, ai: async () => null, canWrite: async () => false,
      log: (r: LogRecord) => logs.push(r), press, exists: { grants, hold },
    }) as unknown as MeetingContext;
  const check = async (input: Record<string, unknown> = {}, me = ME) => {
    const r = await meetingAction(ctxAs(me), "meeting.calls_check", input);
    if (!r.ok) throw new Error(r.error);
    return r.data as { answers: Record<string, string>; yes: number; unchecked: number; off: boolean; failed: boolean };
  };
  return { db, meetings, g, asked, logs, grants, press, client, check };
}

describe("MC-4: the gate's purpose \"exists\"", () => {
  it("lets through only the online meeting of a check's own link and its transcripts' ids and times, never a transcript's text", async () => {
    const t = await setup([ev(1)]);
    const grant = t.grants.open(ME, [link("call-1")]);
    const c = t.client(ME);
    const got = await c.transcriptsExist([{ key: "ical-1", joinUrl: link("call-1"), startAt: "2026-11-10T00:30:00Z", endAt: "2026-11-10T01:00:00Z" }]);
    expect([...got]).toEqual([["ical-1", "yes"]]);
    // Only the two kinds of request went, both in batches; every one was asked of the gate as "exists".
    const urls = t.g.sent.flatMap((s) => (s.body ? (JSON.parse(s.body) as { requests: { url: string }[] }).requests.map((r) => r.url) : [s.url]));
    expect(urls.every((u) => /^\/me\/onlineMeetings\?\$filter=JoinWebUrl/.test(u) || /^\/me\/onlineMeetings\/[^/]+\/transcripts\?\$select=id,createdDateTime$/.test(u))).toBe(true);
    expect(urls.some((u) => /content/.test(u))).toBe(false);
    expect(t.asked.every((q) => q.purpose === "exists")).toBe(true);
    // The same check can't read a transcript's text, or any call's online meeting for reading.
    const before = t.g.sent.length;
    await expect(c.transcriptVtt("om-x", "t1")).rejects.toBeInstanceOf(MeetingRefused);
    await expect(c.onlineMeetingId(link("call-1"))).rejects.toBeInstanceOf(MeetingRefused);
    await expect(c.transcripts("om-x")).rejects.toBeInstanceOf(MeetingRefused);
    expect(t.g.sent.length).toBe(before);
    grant.done();
  });

  it("refuses before any request a link the check didn't take, another person's check, and anything once the check is over", async () => {
    const t = await setup([ev(1), ev(2)]);
    const grant = t.grants.open(ME, [link("call-1")]);
    const ask = (j: string) => [{ key: "k", joinUrl: j, startAt: "2026-11-11T08:00:00Z", endAt: "2026-11-11T08:30:00Z" }];
    await expect(t.client(ME).transcriptsExist(ask(link("call-2")))).rejects.toBeInstanceOf(MeetingRefused);
    await expect(t.client(MATE).transcriptsExist(ask(link("call-1")))).rejects.toBeInstanceOf(MeetingRefused);
    grant.done();
    await expect(t.client(ME).transcriptsExist(ask(link("call-1")))).rejects.toBeInstanceOf(MeetingRefused);
    expect(t.g.sent).toEqual([]);
  });

  it("a Review's press still reads as before, and the exists allowance never stands in for one", async () => {
    const t = await setup([ev(1)]);
    t.grants.open(ME, [link("call-1")]);
    expect(t.press.allowed(ME, { joinUrl: link("call-1") })).toBe(false);
    const p = t.press.open(ME, link("call-1"));
    expect(t.press.allowed(ME, { joinUrl: link("call-1") })).toBe(true);
    expect(t.grants.allowed(ME, { joinUrl: link("call-1") })).toBe(false);
    p.done();
  });
});

describe("MC-4: meeting.calls_check", () => {
  it("asks only Teams meetings organized at Cooptimize that nobody asked FocusTime to read, and answers yes or no by key", async () => {
    const t = await setup([ev(1), ev(2), ev(3, { organizer: "dana@client.example" }), ev(4, { join: null })], (j) => j === link("call-1"));
    const r = await t.check();
    expect(r.answers).toEqual({ "ical-1": "yes", "ical-2": "no" });
    expect(r).toMatchObject({ yes: 1, unchecked: 0, off: false, failed: false });
    const batchUrls = t.g.sent.filter((s) => s.body).flatMap((s) => (JSON.parse(s.body!) as { requests: { url: string }[] }).requests.map((x) => decodeURIComponent(x.url)));
    expect(batchUrls.some((u) => u.includes("call-3"))).toBe(false);
  });

  it("holds answers 15 minutes in memory (a second opening asks nothing), and Refresh asks again", async () => {
    const t = await setup([ev(1)]);
    await t.check();
    const n = t.g.sent.filter((s) => s.body).length;
    expect(n).toBe(2);
    expect((await t.check()).answers).toEqual({ "ical-1": "yes" });
    expect(t.g.sent.filter((s) => s.body).length).toBe(n);
    await t.check({ refresh: true });
    expect(t.g.sent.filter((s) => s.body).length).toBe(n + 2);
  });

  it("asks at most CHECK_CAP calls a press, in batches of 20, and says the rest weren't checked; Check more asks the next ones", async () => {
    const t = await setup(Array.from({ length: CHECK_CAP + 5 }, (_x, i) => ev(i)));
    const r = await t.check();
    expect(r.unchecked).toBe(5);
    expect(Object.values(r.answers).filter((v) => v === "yes").length).toBe(CHECK_CAP);
    for (const s of t.g.sent.filter((x) => x.body)) expect((JSON.parse(s.body!) as { requests: unknown[] }).requests.length).toBeLessThanOrEqual(20);
    expect((await t.check({ more: true })).unchecked).toBe(0);
  });

  it("says the tenant's setting is off when Microsoft says so, and a failed request is not checked (nothing held)", async () => {
    const off = await setup([ev(1)], () => "off");
    expect(await off.check()).toMatchObject({ answers: { "ical-1": "off" }, off: true });
    const bad = await setup([ev(1), ev(2)], (j) => (j === link("call-1") ? "fail" : true));
    const r = await bad.check();
    expect(r).toMatchObject({ answers: { "ical-1": "unchecked", "ical-2": "yes" }, failed: true });
    expect((await bad.check()).answers["ical-1"]).toBe("unchecked");
  });

  it("keeps nothing: no row in the store, and the log has counts and outcomes, never a name, a key or a link", async () => {
    const t = await setup([ev(1, { subject: "Secret client strategy" })]);
    const tables = async () => (await t.db.conn.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map((x) => String(x.name));
    const count = async () => {
      let n = 0;
      for (const tb of await tables()) n += Number((await t.db.conn.get(`SELECT count(*) AS n FROM ${tb}`))?.n ?? 0);
      return n;
    };
    const before = await count();
    await t.check();
    expect(await count()).toBe(before);
    const said = JSON.stringify(t.logs);
    for (const s of ["Secret", "ical-1", "call-1", "om-", "teams.microsoft.com"]) expect(said).not.toContain(s);
    expect(t.logs.find((l) => l.op === "meeting_calls_check")).toMatchObject({ count: 1, kind: "ok" });
  });
});

// TEST 2: the check runs only from Calls' own opening and Refresh: a source read. No job, tick, assistant, Teams bot or
// background-policy entry starts it, and the page is the only caller.
describe("MC-4: who can start the check", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
  const all = ["actions", "assistant", "server", "ui", "plan", "sources", "config", "store", "host"].flatMap(files);
  const uses = all.filter((f) => readFileSync(f, "utf8").includes("calls_check"));

  it("is named only by its action, its registry and menu lines, the dispatcher and Calls' page", () => {
    expect(uses.sort()).toEqual(["actions/dispatch.ts", "actions/meeting-actions.ts", "actions/registry.ts", "plan/call-list.ts", "ui/meetings/Meetings.tsx", "ui/menu.ts"]);
    // plan/call-list.ts only mentions it in a comment.
    expect(readFileSync("plan/call-list.ts", "utf8").split("\n").filter((l) => l.includes("calls_check")).every((l) => l.trim().startsWith("//"))).toBe(true);
  });

  it("the page asks only once my calendar's calls are read, on Refresh, Check again and Check more", () => {
    const page = readFileSync("ui/meetings/Meetings.tsx", "utf8");
    expect(page.match(/"meeting\.calls_check"/g)).toHaveLength(1);
    const callers = [...page.matchAll(/runCheck\(([^)]*)\)/g)].map((m) => m[1]);
    expect(callers.sort()).toEqual(["", "{ more: true }", "{ refresh: true }", "{ refresh: true }"]);
    // The command menu only opens Calls.
    expect(readFileSync("ui/menu.ts", "utf8")).toMatch(/case "meeting\.calls_check":[\s\S]*?setView\("meetings"\)/);
  });

  it("isn't background work, isn't the assistant's and isn't the bot's", () => {
    expect(JSON.stringify(BACKGROUND)).not.toMatch(/transcript.*exist|calls_check|call_exists/i);
    for (const f of all.filter((x) => /^(assistant|server\/teams|server\/scheduler|server\/jobs)/.test(x))) expect(readFileSync(f, "utf8"), f).not.toMatch(/calls_check|transcriptsExist|createExistsGrants\(\)\.open/);
    // transcriptsExist is called only by the check itself.
    expect(all.filter((f) => readFileSync(f, "utf8").includes("transcriptsExist(")).sort()).toEqual(["actions/meeting-actions.ts", "sources/graph/meetings.ts"]);
  });
});
