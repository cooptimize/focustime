// MC-1: the shared meeting store: registered calls, their occurrences, transcripts and proposals. App tables (no
// person in them), read and written on the database itself like the conversation store. Shared storage, not shared
// visibility: anything done for a person goes through `viewer(userId)`, which reaches only series they review or
// attend; confirming, uploading and dismissing need a reviewer. The unscoped methods are for the poll job, the admin
// registration and the retention purge only. Every write runs in a transaction. Nothing here logs; transcript text
// never leaves through here except to a viewer's own read and the AI pass.
import { canConfirm, canView, OCCURRENCE_STATES, PROPOSAL_STATES, type MeetingSeries, type Occurrence, type OccurrenceState, type Proposal, type ProposalBody, type ProposalState, type Quote, type TranscriptSource } from "../plan/meetings.ts";
import type { TranscriptLine } from "../plan/transcript.ts";
import { PlanError } from "./plan-store.ts";
import type { Conn, Param, Row } from "./sql/conn.ts";

const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

const toSeries = (r: Row): MeetingSeries => ({
  id: Number(r.id),
  clientKey: r.client_key as string,
  name: r.name as string,
  role: r.role as MeetingSeries["role"],
  source: r.source as TranscriptSource,
  detected: r.detected as TranscriptSource,
  organizer: r.organizer as MeetingSeries["organizer"],
  joinUrl: r.join_url as string,
  eventId: s(r.event_id),
  registrantId: r.registrant_id as string,
  weekday: Number(r.weekday),
  start: r.start_time as string,
  minutes: Number(r.minutes),
  zone: r.zone as string,
  interval: Number(r.interval_weeks ?? 1),
  reviewers: json<string[]>(r.reviewers_json, []),
  attendees: json<string[]>(r.attendees_json, []),
  onlineMeetingId: s(r.online_meeting_id),
  createdAt: r.created_at as string,
  removedAt: s(r.removed_at),
});

const toOccurrence = (r: Row): Occurrence => ({
  id: Number(r.id),
  seriesId: Number(r.series_id),
  date: r.day as string,
  startAt: r.start_at as string,
  endAt: r.end_at as string,
  state: r.state as OccurrenceState,
  nextCheckAt: s(r.next_check_at),
  checks: Number(r.checks ?? 0),
  transcriptFrom: (s(r.transcript_from) as TranscriptSource | null) ?? null,
  transcriptAt: s(r.transcript_at),
  aiOutcome: s(r.ai_outcome),
  dismissedBy: s(r.dismissed_by),
  reviewedBy: s(r.reviewed_by),
  updatedAt: r.updated_at as string,
});

const toProposal = (r: Row): Proposal => ({
  id: Number(r.id),
  occurrenceId: Number(r.occurrence_id),
  kind: r.kind as Proposal["kind"],
  body: json<ProposalBody>(r.body_json, null as never),
  quotes: r.quotes_json === null || r.quotes_json === undefined ? null : json<Quote[]>(r.quotes_json, []),
  state: r.state as ProposalState,
  result: json<Proposal["result"]>(r.result_json, null),
  decidedBy: s(r.decided_by),
  decidedAt: s(r.decided_at),
  createdAt: r.created_at as string,
});

export type NewSeries = Omit<MeetingSeries, "id" | "createdAt" | "removedAt" | "onlineMeetingId">;
export type SeriesPatch = Partial<Pick<MeetingSeries, "name" | "role" | "source" | "reviewers" | "attendees" | "onlineMeetingId" | "weekday" | "start" | "minutes" | "zone" | "interval">>;
export type OccurrencePatch = Partial<Pick<Occurrence, "state" | "nextCheckAt" | "checks" | "transcriptFrom" | "transcriptAt" | "aiOutcome" | "dismissedBy" | "reviewedBy">>;
export type ProposalPatch = { body?: ProposalBody; state?: ProposalState; result?: Proposal["result"]; decidedBy?: string | null; decidedAt?: string | null };

const lower = (x: string) => x.trim().toLowerCase();

function baseStore(db: Conn, now: () => Temporal.Instant) {
  const stamp = () => now().toString();
  const seriesById = async (id: number) => {
    const r = await db.get("SELECT * FROM meeting_series WHERE id = ?", [id]);
    return r ? toSeries(r) : null;
  };
  const occurrenceById = async (id: number) => {
    const r = await db.get("SELECT * FROM meeting_occurrences WHERE id = ?", [id]);
    return r ? toOccurrence(r) : null;
  };
  return {
    // ---- series ----
    series: seriesById,
    async seriesOf(clientKey: string): Promise<MeetingSeries[]> {
      return (await db.all("SELECT * FROM meeting_series WHERE client_key = ? AND removed_at IS NULL ORDER BY id", [clientKey])).map(toSeries);
    },
    async allSeries(): Promise<MeetingSeries[]> {
      return (await db.all("SELECT * FROM meeting_series WHERE removed_at IS NULL ORDER BY id")).map(toSeries);
    },
    async addSeries(x: NewSeries): Promise<MeetingSeries> {
      return db.tx(async () => {
        const t = stamp();
        const r = await db.run(
          `INSERT INTO meeting_series (client_key, name, role, source, detected, organizer, join_url, event_id, registrant_id, weekday, start_time, minutes, zone, interval_weeks, reviewers_json, attendees_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [x.clientKey, x.name.slice(0, 200), x.role, x.source, x.detected, x.organizer, x.joinUrl, x.eventId, lower(x.registrantId), x.weekday, x.start, x.minutes, x.zone, x.interval, JSON.stringify(x.reviewers.map(lower)), JSON.stringify(x.attendees.map(lower)), t, t],
        );
        return (await seriesById(r.lastId!))!;
      });
    },
    async updateSeries(id: number, p: SeriesPatch): Promise<MeetingSeries> {
      return db.tx(async () => {
        if (!(await seriesById(id))) throw new PlanError("No such meeting");
        const cols: Record<keyof SeriesPatch, string> = { name: "name", role: "role", source: "source", reviewers: "reviewers_json", attendees: "attendees_json", onlineMeetingId: "online_meeting_id", weekday: "weekday", start: "start_time", minutes: "minutes", zone: "zone", interval: "interval_weeks" };
        const sets: string[] = [];
        const params: Param[] = [];
        for (const [k, v] of Object.entries(p) as [keyof SeriesPatch, unknown][]) {
          if (v === undefined) continue;
          sets.push(`${cols[k]} = ?`);
          params.push(k === "reviewers" || k === "attendees" ? JSON.stringify((v as string[]).map(lower)) : (v as Param));
        }
        sets.push("updated_at = ?");
        await db.run(`UPDATE meeting_series SET ${sets.join(", ")} WHERE id = ?`, [...params, stamp(), id]);
        return (await seriesById(id))!;
      });
    },
    async removeSeries(id: number): Promise<void> {
      await db.tx(async () => void (await db.run("UPDATE meeting_series SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL", [stamp(), stamp(), id])));
    },
    /** The gate for Graph: a join link or online meeting id of a registered (not removed) series. */
    async registered(q: { joinUrl?: string; onlineMeetingId?: string }): Promise<MeetingSeries | null> {
      const r = q.joinUrl
        ? await db.get("SELECT * FROM meeting_series WHERE join_url = ? AND removed_at IS NULL", [q.joinUrl])
        : q.onlineMeetingId
          ? await db.get("SELECT * FROM meeting_series WHERE online_meeting_id = ? AND removed_at IS NULL", [q.onlineMeetingId])
          : undefined;
      return r ? toSeries(r) : null;
    },

    // ---- occurrences ----
    occurrence: occurrenceById,
    async occurrencesOf(seriesId: number, o: { from?: string } = {}): Promise<Occurrence[]> {
      return (await db.all(`SELECT * FROM meeting_occurrences WHERE series_id = ?${o.from ? " AND day >= ?" : ""} ORDER BY day DESC`, o.from ? [seriesId, o.from] : [seriesId])).map(toOccurrence);
    },
    /** The occurrence of a series on a day, made (as `state`) when there is none yet. */
    async ensureOccurrence(seriesId: number, day: string, startAt: string, endAt: string, state: OccurrenceState, nextCheckAt: string | null): Promise<Occurrence> {
      return db.tx(async () => {
        const have = await db.get("SELECT * FROM meeting_occurrences WHERE series_id = ? AND day = ?", [seriesId, day]);
        if (have) return toOccurrence(have);
        const t = stamp();
        const r = await db.run("INSERT INTO meeting_occurrences (series_id, day, start_at, end_at, state, next_check_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [seriesId, day, startAt, endAt, state, nextCheckAt, t, t]);
        return (await occurrenceById(r.lastId!))!;
      });
    },
    async updateOccurrence(id: number, p: OccurrencePatch): Promise<Occurrence> {
      return db.tx(async () => {
        if (!(await occurrenceById(id))) throw new PlanError("No such meeting");
        const cols: Record<keyof OccurrencePatch, string> = { state: "state", nextCheckAt: "next_check_at", checks: "checks", transcriptFrom: "transcript_from", transcriptAt: "transcript_at", aiOutcome: "ai_outcome", dismissedBy: "dismissed_by", reviewedBy: "reviewed_by" };
        const sets: string[] = [];
        const params: Param[] = [];
        for (const [k, v] of Object.entries(p) as [keyof OccurrencePatch, unknown][]) {
          if (v === undefined) continue;
          if (k === "state" && !OCCURRENCE_STATES.includes(v as OccurrenceState)) throw new PlanError("Not a state");
          sets.push(`${cols[k]} = ?`);
          params.push(v as Param);
        }
        sets.push("updated_at = ?");
        await db.run(`UPDATE meeting_occurrences SET ${sets.join(", ")} WHERE id = ?`, [...params, stamp(), id]);
        return (await occurrenceById(id))!;
      });
    },
    /** Occurrences waiting for Graph whose check is due. */
    async dueChecks(nowIso: string): Promise<Occurrence[]> {
      return (await db.all("SELECT * FROM meeting_occurrences WHERE state = 'waiting' AND next_check_at IS NOT NULL AND next_check_at <= ? ORDER BY next_check_at", [nowIso])).map(toOccurrence);
    },
    /** The soonest check any occurrence waits for (the scheduler's wake), or null. */
    async nextDue(): Promise<string | null> {
      const r = await db.get("SELECT MIN(next_check_at) AS at FROM meeting_occurrences WHERE state = 'waiting' AND next_check_at IS NOT NULL");
      return s(r?.at);
    },
    async recentOccurrences(seriesIds: readonly number[], fromDay: string): Promise<Occurrence[]> {
      if (!seriesIds.length) return [];
      return (await db.all(`SELECT * FROM meeting_occurrences WHERE series_id IN (${seriesIds.map(() => "?").join(", ")}) AND day >= ? ORDER BY day DESC`, [...seriesIds, fromDay])).map(toOccurrence);
    },

    // ---- transcripts ----
    async saveTranscript(occurrenceId: number, lines: readonly TranscriptLine[], source: TranscriptSource, uploadedBy: string | null): Promise<void> {
      await db.tx(async () => {
        await db.run("DELETE FROM meeting_transcripts WHERE occurrence_id = ?", [occurrenceId]);
        const t = stamp();
        await db.run("INSERT INTO meeting_transcripts (occurrence_id, lines_json, line_count, source, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)", [occurrenceId, JSON.stringify(lines), lines.length, source, uploadedBy ? lower(uploadedBy) : null, t]);
        await db.run("UPDATE meeting_occurrences SET transcript_from = ?, transcript_at = ?, updated_at = ? WHERE id = ?", [source, t, t, occurrenceId]);
      });
    },
    async transcript(occurrenceId: number): Promise<TranscriptLine[] | null> {
      const r = await db.get("SELECT lines_json FROM meeting_transcripts WHERE occurrence_id = ?", [occurrenceId]);
      return r ? json<TranscriptLine[]>(r.lines_json, []) : null;
    },

    // ---- proposals ----
    /** The AI pass's proposals for an occurrence, replacing any still open (decided ones stay). */
    async replaceProposals(occurrenceId: number, xs: readonly { body: ProposalBody; quotes: Quote[] }[]): Promise<Proposal[]> {
      return db.tx(async () => {
        await db.run("DELETE FROM meeting_proposals WHERE occurrence_id = ? AND state = 'open'", [occurrenceId]);
        const t = stamp();
        for (const x of xs) await db.run("INSERT INTO meeting_proposals (occurrence_id, kind, body_json, quotes_json, state, created_at) VALUES (?, ?, ?, ?, 'open', ?)", [occurrenceId, x.body.kind, JSON.stringify(x.body), JSON.stringify(x.quotes), t]);
        return (await db.all("SELECT * FROM meeting_proposals WHERE occurrence_id = ? ORDER BY id", [occurrenceId])).map(toProposal);
      });
    },
    async proposals(occurrenceId: number): Promise<Proposal[]> {
      return (await db.all("SELECT * FROM meeting_proposals WHERE occurrence_id = ? ORDER BY id", [occurrenceId])).map(toProposal);
    },
    async proposal(id: number): Promise<Proposal | null> {
      const r = await db.get("SELECT * FROM meeting_proposals WHERE id = ?", [id]);
      return r ? toProposal(r) : null;
    },
    async updateProposal(id: number, p: ProposalPatch): Promise<Proposal> {
      return db.tx(async () => {
        const sets: string[] = [];
        const params: Param[] = [];
        if (p.body !== undefined) sets.push("body_json = ?"), params.push(JSON.stringify(p.body));
        if (p.state !== undefined) {
          if (!PROPOSAL_STATES.includes(p.state)) throw new PlanError("Not a state");
          sets.push("state = ?"), params.push(p.state);
        }
        if (p.result !== undefined) sets.push("result_json = ?"), params.push(p.result ? JSON.stringify(p.result) : null);
        if (p.decidedBy !== undefined) sets.push("decided_by = ?"), params.push(p.decidedBy ? lower(p.decidedBy) : null);
        if (p.decidedAt !== undefined) sets.push("decided_at = ?"), params.push(p.decidedAt);
        if (!sets.length) throw new PlanError("Nothing to change");
        await db.run(`UPDATE meeting_proposals SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
        const r = await db.get("SELECT * FROM meeting_proposals WHERE id = ?", [id]);
        if (!r) throw new PlanError("No such proposal");
        return toProposal(r);
      });
    },
  };
}

type BaseStore = ReturnType<typeof baseStore>;
const noMeeting = () => new PlanError("No such meeting");

export function createMeetingStore(db: Conn, now: () => Temporal.Instant) {
  const store = baseStore(db, now);
  return { ...store, viewer: (userId: string) => viewerOf(store, userId) };
}

/**
 * One person's way into the shared meetings: only series they review or attend. Anything else reads as missing or is
 * refused as "No such meeting". Uploads, edits, confirms and dismissals need a reviewer.
 */
function viewerOf(store: BaseStore, userId: string) {
  const seen = async (seriesId: number) => {
    const x = await store.series(seriesId);
    if (!x || x.removedAt || !canView(x, userId)) throw noMeeting();
    return x;
  };
  const occ = async (occurrenceId: number) => {
    const o = await store.occurrence(occurrenceId);
    if (!o) throw noMeeting();
    return { o, series: await seen(o.seriesId) };
  };
  const reviewer = async (occurrenceId: number) => {
    const r = await occ(occurrenceId);
    if (!canConfirm(r.series, userId)) throw new PlanError("Only this meeting's reviewers can do that");
    return r;
  };
  return {
    userId,
    /** Series I review or attend, all clients or one. */
    async series(clientKey?: string): Promise<MeetingSeries[]> {
      return (clientKey ? await store.seriesOf(clientKey) : await store.allSeries()).filter((x) => canView(x, userId));
    },
    seriesById: (id: number) => seen(id).catch(() => null),
    occurrence: (id: number) => occ(id).catch(() => null),
    reviewer,
    async occurrences(seriesId: number, from?: string): Promise<Occurrence[]> {
      await seen(seriesId);
      return store.occurrencesOf(seriesId, from ? { from } : {});
    },
    async transcript(occurrenceId: number): Promise<TranscriptLine[] | null> {
      await occ(occurrenceId);
      return store.transcript(occurrenceId);
    },
    async proposals(occurrenceId: number): Promise<Proposal[]> {
      await occ(occurrenceId);
      return store.proposals(occurrenceId);
    },
    async saveTranscript(occurrenceId: number, lines: readonly TranscriptLine[]): Promise<void> {
      await reviewer(occurrenceId);
      await store.saveTranscript(occurrenceId, lines, "upload", userId);
    },
    async updateOccurrence(occurrenceId: number, p: OccurrencePatch): Promise<Occurrence> {
      await reviewer(occurrenceId);
      return store.updateOccurrence(occurrenceId, p);
    },
    async updateProposal(id: number, p: ProposalPatch): Promise<Proposal> {
      const x = await store.proposal(id);
      if (!x) throw new PlanError("No such proposal");
      await reviewer(x.occurrenceId);
      return store.updateProposal(id, p);
    },
    /** An occurrence of a series I review, made for an upload on a date it has (or had) no row for. */
    async ensureOccurrence(seriesId: number, day: string, startAt: string, endAt: string): Promise<Occurrence> {
      const x = await seen(seriesId);
      if (!canConfirm(x, userId)) throw new PlanError("Only this meeting's reviewers can do that");
      return store.ensureOccurrence(seriesId, day, startAt, endAt, x.source === "upload" ? "needs_upload" : "waiting", null);
    },
  };
}

export type MeetingStore = ReturnType<typeof createMeetingStore>;
export type MeetingView = ReturnType<MeetingStore["viewer"]>;
