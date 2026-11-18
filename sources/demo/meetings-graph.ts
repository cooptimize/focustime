// MC-1c: the demo's calendar for registering a client call (Admin › Clients › <client> › Meetings). Fictional and in
// memory: nothing is read from Graph. My calendar holds one recurring Teams call a teammate organizes (Priya, at
// Cooptimize) with people from outside on it; a pasted link finds a second one Jordan organizes; and one link stands
// for Microsoft not answering, so the form's plain message can be seen. Transcripts are never read in the demo for its
// registered call (it is Upload).
//
// MC-2: my calls of the last 14 days are the demo week's meetings (sources/demo/data.ts), so Calls › Your other calls
// and the meeting menu's Review this call match what Day and Week draw. Get it from Teams answers each way Microsoft can
// (all fictional): the Northwind data model review has a transcript, the standups and the all hands have none, the
// lunch and learn isn't found, the proposal review's organizer turned transcripts off (403), and the client-organized
// ones are never asked. The same gate as the real client is asked before every transcript request.
import { HttpError } from "../calendar/http.ts";
import { MeetingRefused, type ExistsAnswer, type MeetingGate, type MeetingsClient, type SeriesCandidate } from "../graph/meetings.ts";
import type { CalendarMeeting } from "../../plan/calls.ts";
import { DEMO_PEOPLE, demoOutlook } from "./data.ts";
import { DEMO_MEETING } from "./meetings.ts";

const person = (name: string) => DEMO_PEOPLE.find((p) => p.name === name)!;
const link = (slug: string) => `https://teams.microsoft.com/l/meetup-join/19%3ademo-${slug}%40thread.v2/0`;

/** A link that stands for Microsoft not answering (503), in the demo only. */
export const DEMO_UNREACHABLE_LINK = link("unreachable");
export const DEMO_TEAMMATE_LINK = link("atlas-planning");

/** MC-2: who organizes each demo meeting for Calls (fictional; the client-side ones in their own fictional domains). */
const ORGANIZER: [RegExp, string][] = [[/nwmodel/, "priya.shah@example.com"], [/nw/, "dana.morales@northwind.example"], [/hh/, "chris.park@harborhealth.example"], [/at(ref|demo)/, "morgan.diaz@atlasfreight.example"], [/lunch/, "priya.shah@example.com"]];
const organizerOf = (id: string) => ORGANIZER.find(([re]) => re.test(id))?.[1] ?? "jordan.lee@example.com";
const callKey = (id: string) => `demo-ical-${id}`;
const callLink = (id: string) => (/^demo-nwstatus-/.test(id) ? DEMO_MEETING.joinUrl : link(`call-${id}`));

/** The demo week's meetings between two instants, as my calendar's calls (MC-2). */
function demoCalls(fromIso: string, toIso: string): CalendarMeeting[] {
  const a = Temporal.Instant.from(fromIso);
  const b = Temporal.Instant.from(toIso);
  const out: CalendarMeeting[] = [];
  const first = a.toZonedDateTimeISO("UTC").toPlainDate();
  for (let m = first.subtract({ days: first.dayOfWeek - 1 + 7 }); Temporal.PlainDate.compare(m, b.toZonedDateTimeISO("UTC").toPlainDate()) <= 0; m = m.add({ days: 7 }))
    for (const e of demoOutlook(m.toString())) {
      const id = e.id.replace(/^outlook:/, "");
      const start = e.allDay ? Temporal.PlainDate.from(e.start).toZonedDateTime("UTC").toInstant() : Temporal.Instant.from(e.start);
      const end = e.allDay ? Temporal.PlainDate.from(e.end).toZonedDateTime("UTC").toInstant() : Temporal.Instant.from(e.end);
      if (Temporal.Instant.compare(start, b) >= 0 || Temporal.Instant.compare(end, a) <= 0) continue;
      const org = organizerOf(id);
      const coop = ["you@example.com", ...(/nwmodel|lunch|prop|allhands|standup/.test(id) ? ["priya.shah@example.com", "jordan.lee@example.com"] : ["priya.shah@example.com"])];
      out.push({
        key: callKey(id), subject: e.title, startAt: start.toString(), endAt: end.toString(), isAllDay: e.allDay, isCancelled: false, isOrganizer: false,
        response: e.responseStatus === "tentative" ? "tentativelyAccepted" : "accepted", others: /standup/.test(id) ? 3 : 5, joinUrl: callLink(id), organizerEmail: org,
        homeAttendees: [...new Set([...coop, ...(org.endsWith("@example.com") ? [org] : [])])],
        // MC-4: a meeting that repeats is one series (its id without the day and the weekday's number).
        seriesKey: e.repeats ? `demo-series-${id.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/\d+$/, "")}` : null,
        allHome: /standup|allhands|lunch|prop/.test(id),
      });
    }
  return out;
}

export function demoMeetings(gate: MeetingGate = { allowed: async () => false }): MeetingsClient {
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
    recentCalls: async (fromIso, toIso) => demoCalls(fromIso, toIso),
    callAt: async (key, startAt, endAt) => demoCalls(Temporal.Instant.from(startAt).subtract({ minutes: 1 }).toString(), Temporal.Instant.from(endAt).add({ minutes: 1 }).toString()).find((c) => c.key === key) ?? null,
    // MC-2: the online meeting is the call's own id in the demo; the gate is asked first, as the real client does.
    onlineMeetingId: async (joinUrl) => {
      if (!(await gate.allowed({ joinUrl }))) throw new MeetingRefused();
      const id = /call-(demo-[^%]+)%40/.exec(joinUrl)?.[1] ?? null;
      return id && !/lunch/.test(id) ? `om-${id}` : null;
    },
    transcripts: async (onlineMeetingId) => {
      if (!(await gate.allowed({ onlineMeetingId }))) throw new MeetingRefused();
      if (/prop/.test(onlineMeetingId)) throw new HttpError(403);
      if (!/nwmodel/.test(onlineMeetingId)) return [];
      const date = /(\d{4}-\d{2}-\d{2})$/.exec(onlineMeetingId)?.[1] ?? "2026-11-02";
      return [{ id: "t-1", createdAt: `${date}T20:02:00Z`, endAt: null }];
    },
    // MC-4: whether a call has a transcript, asked of the gate like the real client (the purpose "exists"): the data model
    // review has one, the proposal review's organizer turned them off (no), the rest have none.
    transcriptsExist: async (asks) => {
      for (const a of asks) if (!(await gate.allowed({ joinUrl: a.joinUrl, purpose: "exists" }))) throw new MeetingRefused();
      return new Map(asks.map((a): [string, ExistsAnswer] => [a.key, /call-demo-nwmodel-/.test(a.joinUrl) ? "yes" : "no"]));
    },
    transcriptVtt: async (onlineMeetingId) => {
      if (!(await gate.allowed({ onlineMeetingId }))) throw new MeetingRefused();
      return demoModelReviewVtt();
    },
  };
}

/** MC-2: the Northwind data model review's transcript, fictional, as Teams would give it. */
const MODEL_CUES: [string, string][] = [
  ["Priya Shah", "Thanks for joining. Today is the order history data model, before we build the statement."],
  ["Morgan Lee", "We keep orders for seven years, so the history table has to hold that much."],
  ["Alex Rivera", "Then we page the export. The export file name should carry the date range too."],
  ["Morgan Lee", "Agreed. We decided the statement reads from the same history table, no second copy."],
  ["Priya Shah", "I'll add the row limit warning to the export so nobody pulls seven years at once."],
  ["Morgan Lee", "The CSV export is on track from our side."],
  ["Alex Rivera", "Good. I'll write up the paging approach and share it Friday."],
];
export function demoModelReviewVtt(): string {
  const at = (s: number) => `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000`;
  return ["WEBVTT", "", ...MODEL_CUES.flatMap(([who, words], i) => [`${at(5 + i * 20)} --> ${at(5 + i * 20 + 18)}`, `<v ${who}>${words}</v>`, ""])].join("\n");
}
