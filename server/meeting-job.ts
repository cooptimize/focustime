// MC-1: the meeting capture job, one app job on the scheduler for every registered call. Delegated only (the product
// owner, Nov 6): no app-only permission, no access policy, no change notifications. Each run:
//   1. Lays out occurrences. An Automatic call's come from the registrant's own calendar (the series' instances, so a
//      cancelled one is skipped and the Cooptimize attendees are refreshed each occurrence, stored as FocusTime user
//      ids only); an Upload call's from its stored pattern, no Graph at all. A past occurrence of an Upload call
//      asks its reviewers for the transcript.
//   2. Looks for due transcripts (Automatic only): from the end, every 15 minutes for 3 hours, then hourly to 12
//      hours, then it asks for an upload. Tokens are tried in order, the registrant's first, then the other
//      reviewers'; one refused (signed out, consent missing, 401, 403, 404) moves to the next. The transcript is read
//      as text/vtt, parsed, stored (30 days), and the AI pass runs with that person's switches and the app's cap.
// The Graph client refuses anything not registered before a request (sources/graph/meetings.ts). Logs keep counts
// and outcomes: never a meeting name, link, id, person or transcript text. The idle rule (D431): its wake is the
// soonest due check or occurrence end, known from its last run and held in memory.
import type { AiService } from "../ai/service.ts";
import type { CaptureContext, MeetingUser } from "../actions/meeting-actions.ts";
import { runPass } from "../actions/meeting-actions.ts";
import type { Logger } from "../log/logger.ts";
import { attendeeIds, graphReadable, nextCheck, occurrencesBetween, type LastRead, type MeetingSeries } from "../plan/meetings.ts";
import { parseVtt, TranscriptError } from "../plan/transcript.ts";
import { HttpError } from "../sources/calendar/http.ts";
import { graphFailureOf, MeetingRefused, transcriptFor, type MeetingsClient } from "../sources/graph/meetings.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import type { MeetingStore } from "../store/meeting-store.ts";

export const MEETING_JOB = "meeting_capture";
/** How often occurrences are laid out again (the due checks run every pass). */
const LAYOUT_MINUTES = 15;

export type MeetingPerson = { graph: MeetingsClient | null; ai: () => Promise<AiService | null>; capture: (clientKey: string) => Promise<CaptureContext | null> };

export type MeetingJobDeps = {
  store: MeetingStore;
  now: () => Temporal.Instant;
  log: Logger;
  /** One FocusTime user's Graph client, AI and capture context, built for a run and dropped after it. */
  person: (userId: string) => Promise<MeetingPerson | null>;
  users: () => Promise<MeetingUser[]>;
};

const refused = (e: unknown) => e instanceof AuthFailure || (e instanceof HttpError && (e.status === 401 || e.status === 403 || e.status === 404));
const order = (s: MeetingSeries) => [s.registrantId, ...s.reviewers.filter((r) => r !== s.registrantId)];
const day = (t: Temporal.Instant, zone: string) => t.toZonedDateTimeISO(zone).toPlainDate();

export function meetingJob(d: MeetingJobDeps) {
  let laidOutAt: Temporal.Instant | null = null;
  let wakeAt: Temporal.Instant | null = null;

  /** The people of a series in token order, built once per run. */
  function people() {
    const cache = new Map<string, Promise<MeetingPerson | null>>();
    return (uid: string) => cache.get(uid) ?? cache.set(uid, d.person(uid).catch(() => null)).get(uid)!;
  }

  async function layout(series: readonly MeetingSeries[], who: ReturnType<typeof people>, now: Temporal.Instant): Promise<void> {
    const users = await d.users().catch((): MeetingUser[] => []);
    for (const s of series) {
      const from = day(now, s.zone).subtract({ days: 2 });
      const to = day(now, s.zone).add({ days: 1 });
      try {
        if (graphReadable(s) && s.eventId) {
          let done = false;
          let why: string | null = null;
          // Only the registrant's calendar has the series' event id (event ids are per mailbox).
          for (const uid of [s.registrantId]) {
            const p = await who(uid);
            if (!p?.graph) {
              why = "signin";
              continue;
            }
            try {
              const xs = await p.graph.instances(s.eventId, from.toString(), to.add({ days: 1 }).toString());
              for (const x of xs.filter((i) => !i.cancelled)) {
                const date = Temporal.Instant.from(x.startAt).toZonedDateTimeISO(s.zone).toPlainDate().toString();
                await d.store.ensureOccurrence(s.id, date, x.startAt, x.endAt, "waiting", nextCheck(x.endAt, now.toString()));
                const fresh = attendeeIds(x.homeAttendees.map((email) => ({ email })), users);
                if (fresh.length && fresh.join() !== s.attendees.join()) await d.store.updateSeries(s.id, { attendees: fresh });
              }
              done = true;
              break;
            } catch (e) {
              if (!refused(e)) throw e;
              why = graphFailureOf(e);
            }
          }
          if (!done) {
            // MC-1c: the registrant's calendar can't be read (signed out, consent): lay the call out from its stored
            // pattern so the other reviewers' sign-ins are still tried for the transcript. Never when the series isn't
            // there (404: deleted, ended or re-created), which would ask for uploads of calls that never happened.
            d.log({ source: "plan", op: "meeting_layout", kind: why === "missing" ? "missing" : "no_token" });
            if (why === "signin" || why === "consent") for (const x of occurrencesBetween(s, from.toString(), to.toString())) await d.store.ensureOccurrence(s.id, x.date, x.startAt, x.endAt, "waiting", nextCheck(x.endAt, now.toString()));
          }
        } else {
          for (const x of occurrencesBetween(s, from.toString(), to.toString())) {
            if (Date.parse(x.endAt) > now.epochMilliseconds) continue;
            await d.store.ensureOccurrence(s.id, x.date, x.startAt, x.endAt, "needs_upload", null);
          }
        }
      } catch (e) {
        d.log({ source: "plan", op: "meeting_layout", kind: graphFailureOf(e) ?? "failed" });
      }
    }
  }

  async function check(series: readonly MeetingSeries[], who: ReturnType<typeof people>, now: Temporal.Instant): Promise<void> {
    for (const occ of await d.store.dueChecks(now.toString())) {
      const s = series.find((x) => x.id === occ.seriesId);
      if (!s || !graphReadable(s)) {
        await d.store.updateOccurrence(occ.id, { state: "needs_upload", nextCheckAt: null });
        continue;
      }
      if (Date.parse(occ.endAt) > now.epochMilliseconds) {
        await d.store.updateOccurrence(occ.id, { nextCheckAt: nextCheck(occ.endAt, now.toString()) });
        continue;
      }
      let outcome: LastRead["kind"] = "no_token";
      let by: string | null = null;
      // MC-1c: why each person's sign-in couldn't read it; the first one tried is what Admin's line says.
      let first: { kind: "no_token" | "consent" | "missing"; by: string } | null = null;
      const note = (kind: "no_token" | "consent" | "missing", uid: string) => void (first ??= { kind, by: uid });
      for (const uid of order(s)) {
        const p = await who(uid);
        if (!p?.graph) {
          note("no_token", uid);
          continue;
        }
        try {
          let meetingId = s.onlineMeetingId;
          if (!meetingId) {
            meetingId = await p.graph.onlineMeetingId(s.joinUrl);
            if (!meetingId) throw new HttpError(404);
            await d.store.updateSeries(s.id, { onlineMeetingId: meetingId });
            s.onlineMeetingId = meetingId;
          }
          const ref = transcriptFor(await p.graph.transcripts(meetingId), occ.startAt, occ.endAt);
          by = uid;
          if (!ref) {
            outcome = "not_yet";
            break;
          }
          await d.store.updateOccurrence(occ.id, { state: "fetching" });
          const lines = parseVtt(await p.graph.transcriptVtt(meetingId, ref.id));
          await d.store.saveTranscript(occ.id, lines, "automatic", null);
          await d.store.updateOccurrence(occ.id, { lastRead: { kind: "found", by: uid, at: now.toString() } });
          await runPass({ store: d.store, ai: p.ai, capture: p.capture, users: d.users, log: d.log }, s, (await d.store.occurrence(occ.id))!, lines);
          outcome = "found";
          break;
        } catch (e) {
          if (e instanceof MeetingRefused) {
            outcome = "failed";
            break;
          }
          if (refused(e)) {
            const k = graphFailureOf(e);
            note(k === "consent" ? "consent" : k === "missing" ? "missing" : "no_token", uid);
            continue;
          }
          by = uid;
          // MC-1c: throttled, Microsoft down or unreachable is "busy" (looked at again on schedule), not "no transcript".
          outcome = e instanceof TranscriptError ? "failed" : graphFailureOf(e) === "busy" ? "busy" : "not_yet";
          if (outcome === "failed") await d.store.updateOccurrence(occ.id, { state: "needs_upload", nextCheckAt: null });
          break;
        }
      }
      // Who has to sign in again when nobody's sign-in could: the registrant (theirs is tried first).
      if (outcome === "no_token" && first) await d.store.updateOccurrence(occ.id, { lastRead: { kind: first.kind, by: first.by, at: now.toString() } });
      else if (outcome !== "found") await d.store.updateOccurrence(occ.id, { lastRead: { kind: outcome, by: outcome === "no_token" ? s.registrantId : by, at: now.toString() } });
      if (outcome === "not_yet" || outcome === "no_token" || outcome === "busy") {
        const next = nextCheck(occ.endAt, now.toString());
        await d.store.updateOccurrence(occ.id, next ? { state: "waiting", nextCheckAt: next, checks: occ.checks + 1 } : { state: "needs_upload", nextCheckAt: null, checks: occ.checks + 1 });
      }
      d.log({ source: "plan", op: "meeting_check", kind: outcome });
    }
  }

  async function run(): Promise<void> {
    const now = d.now();
    const series = await d.store.allSeries();
    if (!series.length) {
      wakeAt = null;
      return;
    }
    const who = people();
    if (!laidOutAt || now.since(laidOutAt).total("minutes") >= LAYOUT_MINUTES) {
      await layout(series, who, now);
      laidOutAt = now;
    }
    await check(series, who, now);
    // The wake: the soonest due check, else the next occurrence end after now (laid out on waking).
    const due = await d.store.nextDue().catch(() => null);
    const ends = series.flatMap((s) => occurrencesBetween(s, day(now, s.zone).toString(), day(now, s.zone).add({ days: 8 }).toString())).map((o) => Temporal.Instant.from(o.endAt)).filter((t) => Temporal.Instant.compare(t, now) > 0);
    const candidates = [...(due ? [Temporal.Instant.from(due)] : []), ...ends.map((t) => t.add({ minutes: 5 }))];
    wakeAt = candidates.sort(Temporal.Instant.compare)[0] ?? null;
  }

  return { name: MEETING_JOB, run, wake: async () => wakeAt };
}
