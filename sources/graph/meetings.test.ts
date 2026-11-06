import { describe, expect, it } from "vitest";
import { createMeetingsClient, MeetingRefused, transcriptFor, type MeetingGate } from "./meetings.ts";

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
      "/me/events?": {
        value: [
          { id: "s1", subject: "Contoso sync", organizer: { emailAddress: { name: "Kat", address: "kat@cooptimize.example" } }, attendees: [{ emailAddress: { address: "me@cooptimize.example" } }, { emailAddress: { address: "pm@contoso.example" } }], onlineMeeting: { joinUrl: REG }, start: { dateTime: "2026-11-03T10:00:00.0000000" }, end: { dateTime: "2026-11-03T11:00:00.0000000" }, recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"] } } },
          { id: "s2", subject: "Team only", attendees: [{ emailAddress: { address: "me@cooptimize.example" } }], onlineMeeting: { joinUrl: OTHER }, start: { dateTime: "2026-11-03T10:00:00" }, end: { dateTime: "2026-11-03T10:30:00" }, recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] } } },
        ],
      },
    });
    const got = await c.seriesOnMyCalendar("America/New_York");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ eventId: "s1", subject: "Contoso sync", weekday: 2, start: "10:00", minutes: 60, outside: 1, homeAttendees: ["me@cooptimize.example"], organizerEmail: "kat@cooptimize.example" });
    expect(JSON.stringify(got)).not.toContain("contoso.example");
  });

  it("picks the transcript created during or after an occurrence", () => {
    const refs = [{ id: "b", createdAt: "2026-11-10T16:02:00Z", endAt: null }, { id: "a", createdAt: "2026-11-03T16:01:00Z", endAt: null }];
    expect(transcriptFor(refs, "2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z")?.id).toBe("b");
    expect(transcriptFor(refs, "2026-11-17T15:00:00Z", "2026-11-17T16:00:00Z")).toBeNull();
  });
});
