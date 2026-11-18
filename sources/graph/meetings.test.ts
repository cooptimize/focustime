import { describe, expect, it } from "vitest";
import { HttpError, NetworkError } from "../calendar/http.ts";
import { AuthFailure } from "../oauth/oauth.ts";
import { createMeetingsClient, graphFailureOf, MeetingRefused, transcriptFor, type MeetingGate } from "./meetings.ts";
import { createPressGrants } from "../../actions/call-press.ts";

const REG = "https://teams.microsoft.com/l/meetup-join/registered";
const OTHER = "https://teams.microsoft.com/l/meetup-join/someone-elses";

function client(gate: MeetingGate, answers: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(answers).find((k) => url.includes(k));
    const body = key ? answers[key] : { value: [] };
    return typeof body === "string" ? new Response(body, { status: 200, headers: { "content-type": "text/vtt" } }) : Response.json(body);
  }) as unknown as typeof globalThis.fetch;
  const c = createMeetingsClient({ fetch, calendarToken: async () => "cal", meetingsToken: async () => "mt", invalidate: () => {}, gate, homeDomains: ["cooptimize.example"], log: () => {} });
  return { c, calls };
}

const onlyRegistered: MeetingGate = { allowed: async (q) => q.joinUrl === REG || q.onlineMeetingId === "om-1" };

describe("Graph meetings (MC-1)", () => {
  it("refuses an unregistered meeting before any request is sent", async () => {
    const { c, calls } = client(onlyRegistered);
    await expect(c.onlineMeetingId(OTHER)).rejects.toBeInstanceOf(MeetingRefused);
    await expect(c.transcripts("om-other")).rejects.toBeInstanceOf(MeetingRefused);
    await expect(c.transcriptVtt("om-other", "t1")).rejects.toBeInstanceOf(MeetingRefused);
    expect(calls).toEqual([]);
  });

  it("reads a registered meeting's id, transcripts and text/vtt", async () => {
    const { c, calls } = client(onlyRegistered, {
      "/me/onlineMeetings?": { value: [{ id: "om-1" }] },
      "/transcripts?": { value: [{ id: "t-old", createdDateTime: "2026-11-03T16:01:00Z" }, { id: "t-new", createdDateTime: "2026-11-10T16:02:00Z" }] },
      "/content": "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>Hi</v>\n",
    });
    expect(await c.onlineMeetingId(REG)).toBe("om-1");
    const refs = await c.transcripts("om-1");
    expect(refs.map((r) => r.id)).toEqual(["t-new", "t-old"]);
    expect(await c.transcriptVtt("om-1", "t-new")).toContain("WEBVTT");
    expect(calls.every((u) => u.startsWith("https://graph.microsoft.com/v1.0/me/onlineMeetings"))).toBe(true);
    expect(calls.at(-1)).toContain("$format=text/vtt");
  });

  it("offers only weekly online series with outside people, counting them without keeping who", async () => {
    const { c } = client(onlyRegistered, {
      "/me/calendarView?": { value: [{ id: "o1", seriesMasterId: "s1", isOnlineMeeting: true, onlineMeeting: { joinUrl: REG } }, { id: "o2", seriesMasterId: "s2", isOnlineMeeting: true, onlineMeeting: { joinUrl: OTHER } }, { id: "o3", seriesMasterId: "s1", isOnlineMeeting: true, onlineMeeting: { joinUrl: REG } }] },
      "/me/events/s1?": { id: "s1", type: "seriesMaster", isOnlineMeeting: true, subject: "Contoso sync", organizer: { emailAddress: { name: "Kat", address: "kat@cooptimize.example" } }, attendees: [{ emailAddress: { address: "me@cooptimize.example" } }, { emailAddress: { address: "pm@contoso.example" } }], onlineMeeting: { joinUrl: REG }, start: { dateTime: "2026-11-03T10:00:00.0000000" }, end: { dateTime: "2026-11-03T11:00:00.0000000" }, recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"] } } },
      "/me/events/s2?": { id: "s2", type: "seriesMaster", subject: "Team only", attendees: [{ emailAddress: { address: "me@cooptimize.example" } }], onlineMeeting: { joinUrl: OTHER }, start: { dateTime: "2026-11-03T10:00:00" }, end: { dateTime: "2026-11-03T10:30:00" }, recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] } } },
    });
    const got = await c.seriesOnMyCalendar("America/New_York", "2026-11-11T12:00:00Z");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ eventId: "s1", subject: "Contoso sync", weekday: 2, start: "10:00", minutes: 60, outside: 1, homeAttendees: ["me@cooptimize.example"], organizerEmail: "kat@cooptimize.example" });
    expect(JSON.stringify(got)).not.toContain("contoso.example");
  });

  it("picks the transcript created during or after an occurrence", () => {
    const refs = [{ id: "b", createdAt: "2026-11-10T16:02:00Z", endAt: null }, { id: "a", createdAt: "2026-11-03T16:01:00Z", endAt: null }];
    expect(transcriptFor(refs, "2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z")?.id).toBe("b");
    expect(transcriptFor(refs, "2026-11-17T15:00:00Z", "2026-11-17T16:00:00Z")).toBeNull();
  });

  // MC-1c: Microsoft's docs don't say `type` or `isOnlineMeeting` can be filtered on /me/events, so candidates come from
  // the next 5 weeks' calendar view, with no $filter, each series master read once.
  it("reads the calendar view without a filter and each series master once", async () => {
    const weekly = { recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"] } }, start: { dateTime: "2026-11-03T10:00:00" }, end: { dateTime: "2026-11-03T11:00:00" }, attendees: [{ emailAddress: { address: "pm@contoso.example" } }] };
    const { c, calls } = client(onlyRegistered, {
      "/me/calendarView?": { value: [{ id: "single", onlineMeeting: { joinUrl: REG } }, { id: "x1", seriesMasterId: "offline", isOnlineMeeting: false }, { id: "x2", seriesMasterId: "master", isOnlineMeeting: true, onlineMeeting: { joinUrl: REG } }, { id: "x3", seriesMasterId: "master", isOnlineMeeting: true, onlineMeeting: { joinUrl: REG } }] },
      "/me/events/master?": { id: "master", type: "seriesMaster", isOnlineMeeting: true, subject: "Fabrikam weekly", organizer: { emailAddress: { name: "Lee", address: "lee@cooptimize.example" } }, onlineMeeting: { joinUrl: REG }, ...weekly },
    });
    expect((await c.seriesOnMyCalendar("UTC", "2026-11-11T12:00:00Z")).map((x) => x.eventId)).toEqual(["master"]);
    expect(calls.some((u) => u.includes("$filter"))).toBe(false);
    expect(calls.filter((u) => u.includes("/me/events/"))).toHaveLength(1);
  });

  it("finds a pasted link however it was copied", async () => {
    const { c } = client(onlyRegistered, {
      "/me/calendarView?": { value: [{ id: "o", seriesMasterId: "m", onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d" } }] },
      "/me/events/m?": { id: "m", type: "seriesMaster", onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d" }, recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] } }, start: { dateTime: "2026-11-03T10:00:00" }, end: { dateTime: "2026-11-03T10:30:00" } },
    });
    expect((await c.seriesByJoinUrl("https://teams.microsoft.com/l/meetup-join/19%3Ameeting_x%40thread.v2/0", "UTC", "2026-11-11T12:00:00Z"))?.eventId).toBe("m");
  });

  it("names what went wrong as one kind", () => {
    expect([new HttpError(400), new HttpError(401), new HttpError(403), new HttpError(404), new HttpError(429), new HttpError(503), new NetworkError("network")].map(graphFailureOf)).toEqual(["refused", "signin", "consent", "missing", "busy", "busy", "busy"]);
    expect(graphFailureOf(new AuthFailure("not_connected", "x"))).toBe("signin");
    expect(graphFailureOf(new AuthFailure("network", "x"))).toBe("busy");
    expect(graphFailureOf(new AuthFailure("keyring", "x"))).toBe("setup");
    expect(graphFailureOf(new Error("x"))).toBeNull();
  });

  // MC-2: the gate the hosted app builds (server/main.ts): a registered call, or this sign-in's person's open press.
  it("lets an unregistered call through only during its own person's press (MC-2)", async () => {
    const presses = createPressGrants();
    const gateFor = (userId: string): MeetingGate => ({ allowed: async (q) => presses.allowed(userId, q) || (await onlyRegistered.allowed(q)) });
    const answers = { "/me/onlineMeetings?": { value: [{ id: "om-x" }] }, "/transcripts?": { value: [{ id: "t1", createdDateTime: "2026-11-10T16:02:00Z" }] }, "/content": "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>Hi</v>\n" };
    const mine = client(gateFor("u1"), answers);
    const theirs = client(gateFor("u2"), answers);
    // No press: refused before any request, for everyone (the job never presses).
    await expect(mine.c.onlineMeetingId(OTHER)).rejects.toBeInstanceOf(MeetingRefused);
    const p = presses.open("u1", OTHER);
    expect(await mine.c.onlineMeetingId(OTHER)).toBe("om-x");
    await expect(theirs.c.onlineMeetingId(OTHER)).rejects.toBeInstanceOf(MeetingRefused);
    await expect(mine.c.transcripts("om-x")).rejects.toBeInstanceOf(MeetingRefused);
    p.meeting("om-x");
    expect((await mine.c.transcripts("om-x")).map((t) => t.id)).toEqual(["t1"]);
    expect(await mine.c.transcriptVtt("om-x", "t1")).toContain("WEBVTT");
    await expect(theirs.c.transcripts("om-x")).rejects.toBeInstanceOf(MeetingRefused);
    p.done();
    await expect(mine.c.transcriptVtt("om-x", "t1")).rejects.toBeInstanceOf(MeetingRefused);
    expect(theirs.calls).toEqual([]);
    // The registered call still passes for anyone, as before.
    expect(await theirs.c.onlineMeetingId(REG)).toBe("om-x");
  });

  it("reads my own calls of a range, and one of them again, as counts and keys only (MC-2)", async () => {
    const ev = (p: Record<string, unknown>) => ({ iCalUId: "ical-1", subject: "Contoso review", start: { dateTime: "2026-11-10T15:00:00.0000000" }, end: { dateTime: "2026-11-10T15:45:00.0000000" }, isAllDay: false, isCancelled: false, isOrganizer: false, responseStatus: { response: "accepted" }, organizer: { emailAddress: { address: "kat@cooptimize.example" } }, attendees: [{ emailAddress: { address: "me@cooptimize.example" } }, { emailAddress: { address: "pm@contoso.example" } }], onlineMeeting: { joinUrl: OTHER }, ...p });
    const { c, calls } = client(onlyRegistered, { "/me/calendarView?": { value: [ev({}), ev({ iCalUId: "ical-2", isOrganizer: true, organizer: { emailAddress: { address: "me@cooptimize.example" } }, attendees: [{ type: "resource", emailAddress: { address: "room-4@cooptimize.example" } }] })] } });
    const got = await c.recentCalls("2026-11-04T05:00:00Z", "2026-11-17T17:00:00Z");
    expect(got[0]).toMatchObject({ key: "ical-1", subject: "Contoso review", startAt: "2026-11-10T15:00:00Z", endAt: "2026-11-10T15:45:00Z", others: 2, joinUrl: OTHER, organizerEmail: "kat@cooptimize.example", homeAttendees: ["me@cooptimize.example", "kat@cooptimize.example"] });
    // My own hold: I organize it with nobody on it (a room booked on it isn't a person).
    expect(got[1]).toMatchObject({ key: "ical-2", isOrganizer: true, others: 0 });
    expect(calls.every((u) => u.startsWith("https://graph.microsoft.com/v1.0/me/calendarView?"))).toBe(true);
    expect(await c.callAt("ical-1", "2026-11-10T15:00:00Z", "2026-11-10T15:45:00Z")).toMatchObject({ key: "ical-1" });
    expect(await c.callAt("ical-9", "2026-11-10T15:00:00Z", "2026-11-10T15:45:00Z")).toBeNull();
    // Only my own calendar (/me), never another person's.
    expect(calls.some((u) => /\/users\//.test(u))).toBe(false);
  });

  it("still refuses an unregistered meeting after a teammate's registration of another", async () => {
    const { c, calls } = client(onlyRegistered);
    await expect(c.onlineMeetingId(`${REG}-x`)).rejects.toBeInstanceOf(MeetingRefused);
    expect(calls).toEqual([]);
  });
});
