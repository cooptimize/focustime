// PK-2: a pretend Pocket, for tests and the demo. A fetch that answers only Pocket's calls FocusTime makes, from
// invented data, in the shape Pocket's docs show ({ success, data, pagination }). Nothing leaves the process. Some
// keys act out Pocket's failures, so the demo and the tests can show each one's words:
//   pk_demo_wrong   Pocket doesn't accept the key (401)
//   pk_demo_busy    Pocket is busy (429)
//   pk_demo_slow    Pocket never answers (the client's time limit ends it)
//   pk_demo_odd     Pocket answers in a shape FocusTime doesn't know
//   pk_demo_solo    every recording on the key is one person's, under an address FocusTime doesn't know
// Any other key starting pk_ is accepted.
//
// MC-2b: the list and one recording, from invented recordings placed on the demo week's calls (sources/demo/data.ts,
// in the demo's zone): one on the proposal review whose organizer turned transcripts off, one on the registered
// Northwind call a week before its kept transcript, one much longer than Harbor's sprint planning, one that goes with
// no call, and one recorded by someone else (dropped, only counted). Every word is invented. Each listed recording
// carries its transcript and summaries, as Pocket's list may, so the tests can show FocusTime never reads them there.
import { POCKET_LIST_PATH, POCKET_ORIGIN } from "../pocket/client.ts";
import { DEMO_TZ } from "./data.ts";
import { DEMO_PERSON } from "./azure.ts";

export const DEMO_POCKET_KEYS = { wrong: "pk_demo_wrong", busy: "pk_demo_busy", slow: "pk_demo_slow", odd: "pk_demo_odd", solo: "pk_demo_solo" } as const;

/** MC-2b: someone else's address on the same pretend key (an organization's key may list everyone's). */
export const DEMO_POCKET_OTHER = "sam.taylor@example.com";
/** MC-2b: the one recorder of pk_demo_solo's recordings, an address FocusTime doesn't know the demo's person by. */
export const DEMO_POCKET_SOLO = "alex.rivera@personal.example";

type Segment = { start: number; end: number; speaker: string; speakerName: string; text: string };
type Rec = { id: string; title: string; recording_at: string; duration: number; by: string; segments: Segment[] };

/** Turns into Pocket's segments: each line's start and end in seconds from the recording's start. */
function segments(turns: readonly [number, string, string][]): Segment[] {
  return turns.map(([at, speaker, text], i) => ({ start: at, end: turns[i + 1]?.[0] ?? at + 20, speaker, speakerName: speaker === "SPEAKER_0" ? "Dana" : "Guest", text }));
}

const PROPOSAL = segments([
  [0, "SPEAKER_0", "Thanks for making time. Let's walk the proposal for the reporting work."],
  [40, "SPEAKER_1", "The export file name should carry the date range, so files don't overwrite each other."],
  [95, "SPEAKER_0", "Longer term we want one reporting area for the accountants, statements and exports in one place."],
  [160, "SPEAKER_1", "I'll send you the date range filter for review by Thursday."],
  [230, "SPEAKER_0", "The CSV part of the export is on track from our side, no blockers."],
  [2700, "SPEAKER_1", "Good. That's everything on the proposal."],
]);
const WEEKLY = segments([
  [0, "SPEAKER_1", "Morning everyone. Quick round on the order history export first."],
  [30, "SPEAKER_0", "The CSV export works well for us. We decided CSV only for now, Excel can wait until next quarter."],
  [90, "SPEAKER_2", "Next step on the export: I'll add the row limit warning before we ship it."],
  [1500, "SPEAKER_0", "That's all from us this week."],
]);
/** Harbor's planning ran 10:00 to 11:00; the recorder ran from 9:40 to 11:55, with talk either side. */
const LONG = segments([
  [0, "SPEAKER_0", "Is the room booked until noon? Let me get coffee first."],
  [400, "SPEAKER_1", "Before we start, did anyone see the parking notice?"],
  [1260, "SPEAKER_0", "Let's plan the sprint. The export file name should carry the date range."],
  [2400, "SPEAKER_1", "I'll send you the date range filter for review by Thursday."],
  [4700, "SPEAKER_0", "That wraps sprint planning."],
  [5400, "SPEAKER_1", "Lunch plans after this? There's a new place on the corner."],
  [7800, "SPEAKER_0", "Okay, see you all tomorrow."],
]);
const SUPPLIER = segments([
  [0, "SPEAKER_0", "Thanks for calling about the pallet labels."],
  [60, "SPEAKER_1", "The export file name should carry the date range, so the label files don't overwrite each other."],
  [1400, "SPEAKER_0", "Great, talk next week."],
]);
const OTHER = segments([[0, "SPEAKER_0", "Someone else's invented words. FocusTime never reads them."]]);

/** An instant in the demo's zone: the week of now plus `weekOffset`, `day` (0 = Monday), a local time. */
function at(nowMs: number, weekOffset: number, day: number, hm: string): string {
  const today = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(DEMO_TZ).toPlainDate();
  const d = today.subtract({ days: today.dayOfWeek - 1 }).add({ days: 7 * weekOffset + day });
  return d.toZonedDateTime({ timeZone: DEMO_TZ, plainTime: Temporal.PlainTime.from(hm) }).toInstant().toString();
}

/** MC-2b: the recordings the pretend Pocket holds that have started by now, newest first. */
export function demoPocketRecordings(nowMs: number, mine: string = DEMO_PERSON.email): Rec[] {
  const all: Rec[] = [
    { id: "rec-demo-prop", title: "Proposal review", recording_at: at(nowMs, 0, 0, "10:58"), duration: 2820, by: mine, segments: PROPOSAL },
    { id: "rec-demo-weekly", title: "Northwind weekly", recording_at: at(nowMs, -1, 0, "13:01"), duration: 1740, by: mine, segments: WEEKLY },
    { id: "rec-demo-long", title: "Sprint planning", recording_at: at(nowMs, 0, 1, "09:40"), duration: 8100, by: mine, segments: LONG },
    { id: "rec-demo-carrier", title: "Call with the carrier", recording_at: at(nowMs, 0, 1, "16:30"), duration: 1500, by: mine, segments: SUPPLIER },
    { id: "rec-demo-other", title: "Someone else's recording", recording_at: at(nowMs, 0, 2, "08:00"), duration: 3600, by: DEMO_POCKET_OTHER, segments: OTHER },
  ];
  return all.filter((r) => Date.parse(r.recording_at) + r.duration * 1000 <= nowMs).sort((a, b) => b.recording_at.localeCompare(a.recording_at));
}

/** A recording as Pocket's list shows one: every field, its transcript and summaries too (FocusTime drops them). */
function listed(r: Rec) {
  return {
    id: r.id, title: r.title, recording_at: r.recording_at, duration: r.duration, language: "en", state: "completed", folder_id: null,
    created_at: r.recording_at, updated_at: r.recording_at,
    recorded_by: { user_id: `usr-${r.by.split("@")[0]}`, display_name: r.by.split("@")[0], email: r.by },
    speakers: { SPEAKER_0: { name: "Dana", speakerId: "SPEAKER_0" } },
    tags: [{ id: "tag-demo", name: "Invented tag", color: "#888888" }],
    transcript: { segments: r.segments },
    summarizations: { "sum-demo": { summary: "An invented summary FocusTime never reads." } },
    summarizations_errors: [], transcript_error: null, translation: null, translation_error: null,
  };
}

export type PocketCall = { method: string; url: string; authorized: boolean };

/** The pretend Pocket's fetch. `calls` records each request it got (without the key), for tests. */
export function createDemoPocketFetch(o: { now: () => number; calls?: PocketCall[]; mine?: string }): typeof fetch {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization") ?? "";
    o.calls?.push({ method: init?.method ?? "GET", url, authorized: auth.startsWith("Bearer pk_") });
    const u = new URL(url);
    const one = u.pathname.startsWith(`${POCKET_LIST_PATH}/`) ? u.pathname.slice(POCKET_LIST_PATH.length + 1) : null;
    if (u.origin !== POCKET_ORIGIN || (u.pathname !== POCKET_LIST_PATH && !one)) return json(404, { success: false, data: null, error: "Not found" });
    const key = auth.replace(/^Bearer /, "");
    if (!key.startsWith("pk_") || key === DEMO_POCKET_KEYS.wrong) return json(401, { success: false, data: null, error: "Invalid API key", error_code: "unauthorized" });
    if (key === DEMO_POCKET_KEYS.busy) return json(429, { success: false, data: null, error: "Too many requests", error_code: "rate_limited" });
    if (key === DEMO_POCKET_KEYS.slow)
      return new Promise<Response>((_, reject) => {
        const s = init?.signal;
        if (s?.aborted) return reject(s.reason);
        s?.addEventListener("abort", () => reject(s.reason), { once: true });
      });
    if (key === DEMO_POCKET_KEYS.odd) return json(200, { items: [], next: null });
    const solo = key === DEMO_POCKET_KEYS.solo;
    const recs = demoPocketRecordings(o.now(), solo ? DEMO_POCKET_SOLO : (o.mine ?? DEMO_PERSON.email)).filter((r) => !solo || r.by === DEMO_POCKET_SOLO);
    if (one) {
      const r = recs.find((x) => x.id === one);
      if (!r) return json(404, { success: false, data: null, error: "Recording not found", error_code: "not_found" });
      const { transcript, summarizations, ...rest } = listed(r);
      return json(200, { success: true, data: { ...rest, transcript: u.searchParams.get("include_transcript") !== "false" ? transcript : null, summarizations: u.searchParams.get("include_summarizations") !== "false" ? summarizations : null } });
    }
    const from = u.searchParams.get("start_date");
    const to = u.searchParams.get("end_date");
    const rows = recs.filter((r) => (!from || r.recording_at.slice(0, 10) >= from) && (!to || r.recording_at.slice(0, 10) <= to));
    const limit = Number(u.searchParams.get("limit") ?? 20);
    const page = Number(u.searchParams.get("page") ?? 1);
    const data = rows.slice((page - 1) * limit, page * limit).map(listed);
    return json(200, { success: true, data, pagination: { page, limit, total: rows.length, total_pages: Math.ceil(rows.length / limit), has_more: page * limit < rows.length } });
  }) as typeof fetch;
}
