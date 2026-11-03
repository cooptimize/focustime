// Two-way sync for FocusTime's own Outlook events and edit facts for the tiers (step 13), on each Outlook refresh with
// write access. One calendarView scan of the week on the write token: marked events are compared with what FocusTime
// last wrote (plan/outlooksync.ts); a change made only in Outlook moves the timebox ("Changed in Outlook"), a change
// on both sides becomes a conflict to choose, and a marked event with no record of this person's is left alone as an ordinary event (D470). Nothing is written
// to Outlook here; sync changes are logged as "from Outlook". Failures only mean no sync and no edit facts this time.
import type { AppConfig } from "../config/schema.ts";
import type { EditFacts } from "../plan/caltier.ts";
import { INVITE_MARKER, TIMEBOX_MARKER } from "../plan/caltier.ts";
import { REMOVED_IN_OUTLOOK, syncDecision, timeboxFrom, type SeenEvent } from "../plan/outlooksync.ts";
import { outlookFields, type Timebox } from "../plan/timebox.ts";
import type { OutlookWrite } from "../sources/graph/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { clientName, localOf, wantFields } from "./timebox-actions.ts";
import { userZone } from "../week/zone.ts";

/** `earlier`: FocusTime-marked events this person's store has no record of (D470): left alone, shown as ordinary events. */
export type SyncResult = { facts: Record<string, EditFacts>; changed: number; conflicts: number; earlier: number };

const memo = new Map<string, { at: number; result: SyncResult }>();
const MEMO_MS = 5 * 60_000;
/** Test hook. */
export const clearSyncMemo = () => memo.clear();

const instant = (s: string) => Temporal.Instant.from(s);

/**
 * Scan [Monday 00:00, next Monday 00:00) of a week in the configured zone, then sync. `clients` names known clients
 * for rebuilding a record from a subject. At most once every 5 minutes per week unless refreshed.
 */
export async function syncWeek(o: { plan: PlanStore; ow: OutlookWrite; cfg: AppConfig; weekStart: string; refresh: boolean; now: () => string; clients: readonly { key: string; name: string }[] }): Promise<SyncResult> {
  const { plan, ow, cfg } = o;
  const tz = userZone(cfg);
  const t = Date.now();
  const hit = memo.get(o.weekStart);
  if (hit && !o.refresh && t - hit.at < MEMO_MS) return hit.result;
  const mon = Temporal.PlainDate.from(o.weekStart).toZonedDateTime({ timeZone: tz });
  const startIso = mon.toInstant().toString();
  const endIso = mon.add({ days: 7 }).toInstant().toString();
  const events = await ow.writer.scan(startIso, endIso);
  const result: SyncResult = { facts: {}, changed: 0, conflicts: 0, earlier: 0 };
  for (const e of events) result.facts[`outlook:${e.id}`] = e.facts;
  // D470: a help invite this person's store doesn't know was sent by an earlier FocusTime: not cancellable from here.
  for (const e of events) if (e.facts.marker && INVITE_MARKER.test(e.facts.marker) && !(await plan.invite(e.facts.marker))) result.facts[`outlook:${e.id}`] = { ...e.facts, earlier: true };

  const seen = new Map<string, SeenEvent>();
  for (const e of events) if (e.facts.marker && TIMEBOX_MARKER.test(e.facts.marker) && e.subject !== null) seen.set(e.facts.marker, { id: e.id, subject: e.subject, start: e.start, end: e.end, showAs: e.showAs, marker: e.facts.marker });

  const log = async (tb: Timebox | null, op: "create" | "update" | "delete", message: string, before: Timebox | null, after: Timebox | null, eventId: string | null, fBefore: ReturnType<typeof outlookFields> | null, fAfter: ReturnType<typeof outlookFields> | null) =>
    (await plan.logWrite({ op, kind: "sync", status: "confirmed", message, uid: tb?.uid ?? "", eventId, account: null, calendar: null, before: fBefore, after: fAfter, localBefore: before ? localOf(before) : null, localAfter: after ? localOf(after) : null, auto: true }));

  // Marked events Outlook shows this week.
  for (const [uid, ev] of seen) {
    const own = (await plan.ownEvent(uid));
    let tb = (await plan.timeboxByUid(uid));
    if (!own || own.deletedAt) {
      // D470 (replaces Q69's rebuild): a marked event this person has no timebox for was made by an earlier FocusTime
      // (the local app, another store). It is theirs, not ours: an ordinary event, never changed or deleted, nothing
      // recorded. Only a timebox of their own whose event record went missing is linked again.
      if (!tb) {
        result.facts[`outlook:${ev.id}`] = { ...result.facts[`outlook:${ev.id}`]!, earlier: true };
        result.earlier++;
        continue;
      }
      log(tb, "update", "From Outlook: record linked again from its FocusTime marker", tb, tb, ev.id, null, null);
      const fields = wantFields(cfg, tb) ?? outlookFields({ ...tb }, clientName(cfg, tb.clientKey));
      (await plan.recordOwnEvent(uid, tb.id, ev.id, { ...fields, subject: ev.subject, start: instant(ev.start).toString(), end: instant(ev.end).toString(), showAs: (tb.showAs) }));
      continue;
    }
    if (!tb) continue; // An orphan after Reset local plan: listed in Settings > Data for removal.
    result.changed += (await apply(o, tb, own.fields, ev, log, result));
  }

  // FocusTime's events on this week that the scan didn't show: deleted in Outlook, or moved out of the week.
  const weekEnd = Temporal.PlainDate.from(o.weekStart).add({ days: 6 }).toString();
  for (const own of (await plan.ownEvents())) {
    if (seen.has(own.uid)) continue;
    const tb = (await plan.timeboxByUid(own.uid));
    const at = instant(own.fields.start).toZonedDateTimeISO(tz).toPlainDate().toString();
    if (at < o.weekStart || at > weekEnd || !TIMEBOX_MARKER.test(own.uid)) continue;
    const now = await ow.writer.get(own.eventId);
    if (now && now.marker !== own.uid) continue;
    if (!tb) {
      if (!now) (await plan.markOwnDeleted(own.uid));
      continue;
    }
    result.changed += (await apply(o, tb, own.fields, now ? { id: now.id, subject: now.subject, start: now.start, end: now.end, showAs: now.showAs, marker: own.uid } : null, log, result));
  }
  memo.set(o.weekStart, { at: t, result });
  return result;
}

async function apply(o: { plan: PlanStore; cfg: AppConfig; now: () => string }, tb: Timebox, last: ReturnType<typeof outlookFields>, ev: SeenEvent | null, log: (tb: Timebox | null, op: "create" | "update" | "delete", message: string, before: Timebox | null, after: Timebox | null, eventId: string | null, fBefore: ReturnType<typeof outlookFields> | null, fAfter: ReturnType<typeof outlookFields> | null) => unknown, result: SyncResult): Promise<number> {
  const { plan, cfg } = o;
  const tz = userZone(cfg);
  const name = clientName(cfg, tb.clientKey);
  const d = syncDecision(last, ev, wantFields(cfg, tb));
  const own = (await plan.ownEvent(tb.uid))!;
  if (d.kind === "none") {
    if (tb.conflict) (await plan.updateTimebox(tb.id, { conflict: null }));
    return 0;
  }
  if (d.kind === "removed_in_outlook") {
    // Step 13.5 (D236): kept locally with Put on Outlook off, so nothing re-creates it; Keep or Remove is my choice.
    const next = (await plan.updateTimebox(tb.id, { outlook: false, outlookNote: REMOVED_IN_OUTLOOK, conflict: null }));
    (await plan.markOwnDeleted(tb.uid));
    log(tb, "delete", "From Outlook: deleted there; the timebox is kept with Put on Outlook off", tb, next, own.eventId, last, null);
    return 1;
  }
  if (d.kind === "adopt") {
    const t = timeboxFrom(d.fields, name, tz);
    if (t) {
      const next = (await plan.updateTimebox(tb.id, { ...t, pickId: t.date === tb.date ? tb.pickId : null, outlookNote: `Changed in Outlook: ${d.changed.join(", ")}`, conflict: null }));
      (await plan.recordOwnEvent(tb.uid, tb.id, ev!.id, wantFields(cfg, next) ?? d.fields));
      log(tb, "update", `From Outlook: ${d.changed.join(", ")} changed there`, tb, next, ev!.id, last, d.fields);
      return 1;
    }
    // Outlook's times can't be a timebox: ask, like a conflict.
  }
  const outlook = d.kind === "conflict" ? d.outlook : d.kind === "adopt" ? d.fields : null;
  const changed = d.kind === "conflict" ? d.changed : d.kind === "adopt" ? [...d.changed, "too long for a timebox"] : [];
  if (JSON.stringify(tb.conflict?.outlook ?? null) === JSON.stringify(outlook) && tb.conflict) return 0;
  (await plan.updateTimebox(tb.id, { conflict: { outlook, changed, at: o.now() } }));
  log(tb, "update", `Changed in FocusTime and in Outlook (${changed.join(", ")}): waiting for your choice`, tb, tb, own.eventId, last, outlook);
  result.conflicts++;
  return 0;
}
