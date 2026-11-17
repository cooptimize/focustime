// MC-1: Northwind's weekly status call in the demo. Registered by the demo's person (an admin of the demo) with a
// pasted join link, as Upload, with me and Priya as Cooptimize attendees; the latest call's transcript is uploaded through
// the app's own upload, so the AI pass (the demo's sample answer) makes the proposals: a gap, three commitments and two
// comments, ready on the review screen. Attendees are written directly, as only a calendar read sets them.
import { meetingContext } from "../../../actions/dispatch.ts";
import { uploadTranscript } from "../../../actions/meeting-actions.ts";
import { DEMO_PEOPLE } from "../data.ts";
import { DEMO_MEETING, demoMeetingVtt } from "../meetings.ts";
import type { DemoSeed } from "./types.ts";

const PRIYA = DEMO_PEOPLE.find((p) => p.name === "Priya Shah")!;

export const meetingsSeed: DemoSeed = {
  name: "meetings",
  owner: "MC-1",
  seed: async ({ ctx, run, today, zone, ago, me }) => {
    const store = ctx.meetings?.store;
    if (!store) throw new Error("demo seed: the demo's meeting store isn't there");
    // MC-1d: the call is the demo calendar's "Northwind weekly status" (Monday 13:00 to 13:30), so its meeting on Day and
    // Week is the call's door; the transcript is the latest such call that has ended (today's once it is over).
    const day = Temporal.PlainDate.from(today);
    let call = day.subtract({ days: (day.dayOfWeek - DEMO_MEETING.weekday + 7) % 7 });
    const ends = (d: Temporal.PlainDate) => d.toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from(DEMO_MEETING.start).add({ minutes: DEMO_MEETING.minutes }) }).toInstant();
    if (Temporal.Instant.compare(ends(call), Temporal.Instant.from(ago(0))) > 0) call = call.subtract({ days: 7 });
    const callDay = call.toString();
    const r = await run("meeting.register", { clientKey: DEMO_MEETING.clientKey, role: "status", joinUrl: DEMO_MEETING.joinUrl, name: DEMO_MEETING.name, source: "upload", weekday: DEMO_MEETING.weekday, start: DEMO_MEETING.start, minutes: DEMO_MEETING.minutes, reviewers: [me.id, PRIYA.aadId] });
    const seriesId = (r.meeting as { id: number }).id;
    await store.updateSeries(seriesId, { attendees: [me.id.toLowerCase(), PRIYA.aadId.toLowerCase()] });
    const up = await uploadTranscript(await meetingContext(ctx), { seriesId, date: callDay, name: "Northwind weekly status call.vtt", bytes: new TextEncoder().encode(demoMeetingVtt()) });
    if (!up.ok) throw new Error(`demo seed meeting upload: ${up.error}`);
  },
};
