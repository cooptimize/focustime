// MC-1c: the demo's calendar for registering a client call (Admin › Clients › <client> › Meetings). Fictional and in
// memory: nothing is read from Graph. My calendar holds one recurring Teams call a teammate organizes (Priya, at
// Cooptimize) with people from outside on it; a pasted link finds a second one Jordan organizes; and one link stands
// for Microsoft not answering, so the form's plain message can be seen. Transcripts are never read in the demo (its
// one call is Upload), so the transcript calls refuse like an unregistered meeting.
import { HttpError } from "../calendar/http.ts";
import { MeetingRefused, type MeetingsClient, type SeriesCandidate } from "../graph/meetings.ts";
import { DEMO_PEOPLE } from "./data.ts";

const person = (name: string) => DEMO_PEOPLE.find((p) => p.name === name)!;
const link = (slug: string) => `https://teams.microsoft.com/l/meetup-join/19%3ademo-${slug}%40thread.v2/0`;

/** A link that stands for Microsoft not answering (503), in the demo only. */
export const DEMO_UNREACHABLE_LINK = link("unreachable");
export const DEMO_TEAMMATE_LINK = link("atlas-planning");

export function demoMeetings(): MeetingsClient {
  const priya = person("Priya Shah");
  const jordan = person("Jordan Lee");
  const series = (zone: string): SeriesCandidate[] => [
    { eventId: "demo-harbor-weekly", subject: "Harbor Health weekly sync", organizerName: priya.name, organizerEmail: priya.email, joinUrl: link("harbor-weekly"), weekday: 2, start: "11:00", minutes: 30, zone, interval: 1, outside: 3, homeAttendees: ["you@example.com", priya.email] },
    { eventId: "demo-atlas-planning", subject: "Atlas Freight planning", organizerName: jordan.name, organizerEmail: jordan.email, joinUrl: DEMO_TEAMMATE_LINK, weekday: 4, start: "14:00", minutes: 45, zone, interval: 2, outside: 2, homeAttendees: ["you@example.com", jordan.email] },
  ];
  return {
    seriesOnMyCalendar: async (zone) => series(zone).slice(0, 1),
    series: async (eventId, zone) => series(zone).find((s) => s.eventId === eventId) ?? null,
    seriesByJoinUrl: async (joinUrl, zone) => {
      if (joinUrl === DEMO_UNREACHABLE_LINK) throw new HttpError(503);
      return series(zone).find((s) => s.joinUrl === joinUrl) ?? null;
    },
    instances: async () => [],
    onlineMeetingId: async () => {
      throw new MeetingRefused();
    },
    transcripts: async () => {
      throw new MeetingRefused();
    },
    transcriptVtt: async () => {
      throw new MeetingRefused();
    },
  };
}
