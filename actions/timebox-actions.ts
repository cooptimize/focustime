// Timeboxes and the write framework (step 12). A timebox is local first; "Put on Outlook" makes Coopilot own one Busy
// event for it. Every external write goes through here: a named change with narrow inputs, a preview (target system,
// account, calendar, exact fields, who can see it) held on the server for five minutes, a confirm that writes, reads
// back and only then reports success, an audit log entry with the prior values, and undo. Coopilot only changes events
// that carry its marker. Nothing writes on a single click: the UI previews, the person confirms (or, for changes to
// their own timebox events with confirm_own off, the confirm follows the preview, still logged and undoable).
import type { AppConfig } from "../config/schema.ts";
import { DEFAULT_TIMEBOX } from "../config/schema.ts";
import {
  dayTimeboxes, outlookFields, syncNeed, timeboxProblem, undoOf,
  type Fields, type LocalState, type SyncOp, type Timebox, type WriteEntry,
} from "../plan/timebox.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import type { OutlookWrite } from "../sources/graph/source.ts";
import { matches, OwnershipError, type OutlookEvent } from "../sources/graph/write.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { IsoDate } from "../week/types.ts";
import type { ActionResponse, PreviewField, TimeboxView, WritePreview, WriteResult, WriteState } from "./types.ts";

export const TIMEBOX_ACTIONS = [
  "timebox.add", "timebox.update", "timebox.remove", "timebox.set_outlook",
  "write.status", "write.preview", "write.confirm", "write.retry", "write.log",
] as const;
export type TimeboxAction = (typeof TIMEBOX_ACTIONS)[number];

export type TimeboxContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  /** Outlook's write side, or null when Outlook isn't set up. */
  outlook: (cfg: AppConfig) => OutlookWrite | null;
  now: () => string;
};

/** How long a preview stays valid. */
export const PREVIEW_MS = 5 * 60_000;
type Held = { id: string; expiresAt: number; uid: string; op: SyncOp; eventId: string | null; before: Fields | null; after: Fields | null; localBefore: LocalState | null; localAfter: LocalState | null; undoOf: number | null; auto: boolean; account: string; calendar: string };
const previews = new Map<string, Held>();

class Invalid extends Error {}
const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
type Obj = Record<string, unknown>;
function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
const posId = (v: unknown, name: string) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
};
const optId = (v: unknown, name: string) => (v === undefined || v === null ? null : posId(v, name));
const text = (v: unknown, name: string, max: number) => {
  if (typeof v !== "string" || !v.trim()) throw new Invalid(`${name} must be text`);
  if (v.trim().length > max) throw new Invalid(`${name} is at most ${max} characters`);
  return v.trim();
};
const isoDate = (v: unknown): IsoDate => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid("date must be YYYY-MM-DD");
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid("date must be a real date");
  }
};
/** A local time with offset; normalized to the configured zone so stored times read the same everywhere. */
const localTime = (v: unknown, name: string, tz: string) => {
  if (typeof v !== "string" || v.length > 40) throw new Invalid(`${name} must be an ISO time with offset`);
  try {
    return Temporal.Instant.from(v).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" });
  } catch {
    throw new Invalid(`${name} must be an ISO time with offset`);
  }
};
const devopsUrl = (v: unknown) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 500 || !v.startsWith("https://dev.azure.com/")) throw new Invalid("url must be a DevOps link");
  return v;
};

const clientName = (cfg: AppConfig, key: string) => cfg.clientSettings[key]?.name ?? key;
const want = (cfg: AppConfig, tb: Timebox | null) => (tb && !tb.removedAt && tb.outlook ? outlookFields(tb, clientName(cfg, tb.clientKey)) : null);
const localOf = (tb: Pick<Timebox, "start" | "end" | "outlook" | "removedAt">): LocalState => ({ start: tb.start, end: tb.end, outlook: tb.outlook, removedAt: tb.removedAt });
const toLocal = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" });

/** Plain words for "when" in the configured zone: "Tue, Nov 3, 9:00 AM to 10:30 AM". */
function when(f: Fields, tz: string) {
  const s = Temporal.Instant.from(f.start).toZonedDateTimeISO(tz);
  const e = Temporal.Instant.from(f.end).toZonedDateTimeISO(tz);
  const day = s.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const t = (z: Temporal.ZonedDateTime) => z.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(s)} to ${t(e)}`;
}
/** The preview's field list: every field Coopilot writes, before and after (an update marks what changes). */
export function previewFields(op: SyncOp, before: Fields | null, after: Fields | null, tz: string): PreviewField[] {
  const row = (label: string, b: string | null, a: string | null): PreviewField => ({ label, before: b, after: a, changed: op === "update" ? b !== a : true });
  const pick = <K extends keyof Fields>(f: Fields | null, k: K) => (f ? f[k] : null);
  return [
    row("Title", pick(before, "subject"), pick(after, "subject")),
    row("When", before ? when(before, tz) : null, after ? when(after, tz) : null),
    row("Show as", before ? "Busy" : null, after ? "Busy" : null),
    row("Reminder", before ? "None" : null, after ? "None" : null),
    row("Attendees", before ? "None" : null, after ? "None" : null),
    row("Body", pick(before, "body"), pick(after, "body")),
  ];
}
export const VISIBILITY = "Only on your calendar. No attendees, so nobody is invited or notified. People who can see your calendar see this time as Busy; whether they also see the title depends on your Outlook sharing settings.";
const SUMMARY: Record<SyncOp, string> = { create: "Create an Outlook event", update: "Change an Outlook event Coopilot created", delete: "Delete an Outlook event Coopilot created" };

const NO_WRITE = "Coopilot can't change your Outlook calendar yet. Reconnect Outlook in Settings > Connections and allow calendar changes. Your timeboxes still work locally.";

export async function timeboxAction(ctx: TimeboxContext, action: TimeboxAction, input: unknown): Promise<ActionResponse> {
  try {
    return await run(ctx, action, input);
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}

async function run(ctx: TimeboxContext, action: TimeboxAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const tz = cfg.week.hours.timeZone;
  const settings = cfg.timebox ?? DEFAULT_TIMEBOX;
  const sync = (tb: Timebox) => syncNeed(tb, plan.ownEvent(tb.uid), want(cfg, tb));
  const out = (tb: Timebox) => ({ ok: true as const, data: { timebox: timeboxView(tb, plan, cfg), sync: sync(tb) } });

  switch (action) {
    case "timebox.add": {
      const o = fields(input, ["date", "start", "end"], ["pickId", "clientKey", "itemId", "title", "url", "outlook"]);
      const date = isoDate(o.date);
      const start = localTime(o.start, "start", tz);
      const end = localTime(o.end, "end", tz);
      const p = timeboxProblem(date, start, end);
      if (p) throw new Invalid(p);
      const pickId = optId(o.pickId, "pickId");
      if (o.outlook !== undefined && typeof o.outlook !== "boolean") throw new Invalid("outlook must be true or false");
      const outlook = typeof o.outlook === "boolean" ? o.outlook : settings.outlookDefault;
      let tb: Timebox;
      if (pickId !== null) {
        // From a pick: its client, title and link; nothing else is taken from the input.
        if (o.clientKey !== undefined || o.title !== undefined || o.itemId !== undefined || o.url !== undefined) throw new Invalid("a pick's timebox takes its client, title and link from the pick");
        const pick = plan.getPick(pickId);
        if (!pick) throw new PlanError(`No pick ${pickId}`);
        if (pick.date !== date) throw new Invalid("A pick's timebox is on the pick's day");
        tb = plan.addTimebox({ date, clientKey: pick.clientKey, pickId, itemId: pick.itemId, title: pick.title, url: pick.itemUrl, start, end, outlook });
      } else {
        // A must or nice to have for the day, or plain client time.
        tb = plan.addTimebox({ date, clientKey: text(o.clientKey, "clientKey", 100), itemId: optId(o.itemId, "itemId"), title: text(o.title, "title", 200), url: devopsUrl(o.url), start, end, outlook });
      }
      return out(tb);
    }
    case "timebox.update": {
      const o = fields(input, ["id"], ["start", "end"]);
      const tb = plan.timebox(posId(o.id, "id"));
      if (!tb || tb.removedAt) throw new PlanError("No such timebox");
      const start = o.start === undefined ? tb.start : localTime(o.start, "start", tz);
      const end = o.end === undefined ? tb.end : localTime(o.end, "end", tz);
      const p = timeboxProblem(tb.date, start, end);
      if (p) throw new Invalid(p);
      return out(plan.updateTimebox(tb.id, { start, end }));
    }
    case "timebox.remove": {
      const o = fields(input, ["id"]);
      const tb = plan.timebox(posId(o.id, "id"));
      if (!tb || tb.removedAt) throw new PlanError("No such timebox");
      const { kept } = plan.removeTimebox(tb.id);
      return { ok: true, data: { timebox: kept ? plan.timebox(tb.id) : null, uid: tb.uid, sync: kept ? sync(plan.timebox(tb.id)!) : null } };
    }
    case "timebox.set_outlook": {
      const o = fields(input, ["id", "on"]);
      if (typeof o.on !== "boolean") throw new Invalid("on must be true or false");
      const tb = plan.timebox(posId(o.id, "id"));
      if (!tb || tb.removedAt) throw new PlanError("No such timebox");
      return out(plan.updateTimebox(tb.id, { outlook: o.on }));
    }
    case "write.status": {
      fields(input ?? {}, []);
      return { ok: true, data: await writeState(ctx, cfg) };
    }
    case "write.log": {
      fields(input ?? {}, [], ["limit"]);
      const entries = plan.writeLog(100);
      const top = undoTops(plan.writeLog(1000));
      const undoable = (e: WriteEntry) => top.get(e.uid) === e.id && !!undoOf(e);
      // Coopilot events on Outlook whose timebox is gone (after Reset local plan): offered for removal.
      const orphans = plan.ownEvents().filter((x) => { const t = plan.timeboxByUid(x.uid); return !t || t.removedAt || !t.outlook; }).map((x) => ({ uid: x.uid, title: x.fields.subject, when: when(x.fields, tz) }));
      return { ok: true, data: { entries: entries.map((e) => ({ ...e, undoable: undoable(e), retryable: e.status === "unconfirmed" || e.status === "failed" || e.status === "pending", whenText: e.after ? when(e.after, tz) : e.before ? when(e.before, tz) : null })), orphans } };
    }
    case "write.preview": {
      const o = fields(input, [], ["uid", "undo"]);
      if ((o.uid === undefined) === (o.undo === undefined)) throw new Invalid("write.preview takes { uid } or { undo }");
      const ow = cfg.outlook ? ctx.outlook(cfg) : null;
      if (!ow) return bad("Outlook isn't set up", 409);
      const access = await ow.access();
      if (access.status !== "write") return bad(access.status === "unavailable" ? access.message : NO_WRITE, 409);
      let held: Omit<Held, "id" | "expiresAt" | "account" | "calendar">;
      if (o.undo !== undefined) {
        const entry = plan.writeEntry(posId(o.undo, "undo"));
        if (!entry) throw new PlanError("No such write");
        if (undoTops(plan.writeLog(1000)).get(entry.uid) !== entry.id) throw new PlanError("Only the latest change to an event that isn't undone yet can be undone");
        const u = undoOf(entry);
        if (!u) throw new PlanError("This change can't be undone");
        const tb = plan.timeboxByUid(entry.uid);
        held = { uid: entry.uid, op: u.op, eventId: u.eventId, before: entry.after, after: u.fields, localBefore: tb ? localOf(tb) : null, localAfter: u.local, undoOf: entry.id, auto: false };
      } else {
        const uid = text(o.uid, "uid", 80);
        const tb = plan.timeboxByUid(uid);
        const own = plan.ownEvent(uid);
        if (!tb && !own) throw new PlanError("No such timebox");
        const w = want(cfg, tb);
        let op = syncNeed(tb, own, w);
        let current: OutlookEvent | null = null;
        if (op && op !== "create" && own) {
          // Read the event now: preview shows what is really there, and an event deleted in Outlook isn't "changed".
          current = await ow.writer.get(own.eventId).catch((e: unknown) => { throw e instanceof NetworkError ? new PlanError("Outlook unreachable") : e; });
          if (!current) {
            plan.markOwnDeleted(uid);
            op = syncNeed(tb, plan.ownEvent(uid), w);
          } else if (current.marker !== uid) return bad(new OwnershipError().message, 409);
        }
        if (!op) return { ok: true, data: { nothing: true } };
        const own2 = plan.ownEvent(uid);
        const before = op === "create" ? null : current ? { ...own2!.fields, subject: current.subject, start: current.start, end: current.end } : own2!.fields;
        const after = op === "delete" ? null : w;
        // What the timebox looked like before this change (for undo): from the event's fields when there is one.
        const localBefore: LocalState | null = op === "create" ? (tb ? { ...localOf(tb), outlook: false } : null) : before ? { start: toLocal(before.start, tz), end: toLocal(before.end, tz), outlook: true, removedAt: null } : null;
        held = { uid, op, eventId: op === "create" ? null : own2!.eventId, before, after, localBefore, localAfter: tb ? localOf(tb) : null, undoOf: null, auto: !settings.confirmOwn && op !== "create" };
      }
      const cal = await ow.writer.calendar().catch(() => ({ name: "Calendar", owner: "" }));
      const id = crypto.randomUUID();
      const expiresAt = Date.now() + PREVIEW_MS;
      for (const [k, v] of previews) if (v.expiresAt < Date.now()) previews.delete(k);
      previews.set(id, { ...held, id, expiresAt, account: cal.owner, calendar: cal.name });
      const preview: WritePreview = {
        previewId: id, expiresAt: new Date(expiresAt).toISOString(), op: held.op, undo: held.undoOf !== null, auto: held.auto,
        system: "Outlook", account: cal.owner || "Your Microsoft account", calendar: cal.name,
        summary: held.undoOf !== null ? `Undo: ${SUMMARY[held.op].toLowerCase()}` : SUMMARY[held.op],
        fields: previewFields(held.op, held.before, held.after, tz), visibility: VISIBILITY,
      };
      return { ok: true, data: { preview } };
    }
    case "write.confirm": {
      const o = fields(input, ["previewId"]);
      if (typeof o.previewId !== "string") throw new Invalid("previewId must be text");
      const held = previews.get(o.previewId);
      previews.delete(o.previewId);
      if (!held || held.expiresAt < Date.now()) return bad("That preview has expired. Review the change again", 410);
      // Still the same change? A timebox moved again after the preview needs a new one.
      if (held.undoOf === null) {
        const tb = plan.timeboxByUid(held.uid);
        const w = want(cfg, tb);
        const now = syncNeed(tb, plan.ownEvent(held.uid), w);
        if (now !== held.op || JSON.stringify(w) !== JSON.stringify(held.after)) return bad("The timebox changed since the preview. Review the change again", 409);
      }
      const ow = cfg.outlook ? ctx.outlook(cfg) : null;
      if (!ow) return bad("Outlook isn't set up", 409);
      const entry = plan.logWrite({ op: held.op, uid: held.uid, eventId: held.eventId, account: held.account, calendar: held.calendar, before: held.before, after: held.after, localBefore: held.localBefore, localAfter: held.localAfter, auto: held.auto, undoOf: held.undoOf });
      return { ok: true, data: await attempt(plan, ow, entry, false) };
    }
    case "write.retry": {
      const o = fields(input, ["id"]);
      const entry = plan.writeEntry(posId(o.id, "id"));
      if (!entry) throw new PlanError("No such write");
      if (entry.status === "confirmed" || entry.status === "refused") return { ok: true, data: { entry, confirmed: entry.status === "confirmed", message: entry.status === "confirmed" ? "Already confirmed" : entry.message ?? "Refused" } satisfies WriteResult };
      const ow = cfg.outlook ? ctx.outlook(cfg) : null;
      if (!ow) return bad("Outlook isn't set up", 409);
      const access = await ow.access();
      if (access.status !== "write") return bad(access.status === "unavailable" ? access.message : NO_WRITE, 409);
      return { ok: true, data: await attempt(plan, ow, entry, true) };
    }
  }
}

/**
 * Undo works as a stack per event: the newest confirmed change that isn't undone and isn't itself an undo. Undoing a
 * move and then the create is two undos in a row. `log` is newest first.
 */
export function undoTops(log: readonly WriteEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of log) if (!out.has(e.uid) && e.status === "confirmed" && e.undoOf === null && !e.undoneBy) out.set(e.uid, e.id);
  return out;
}

/** Write access and the two settings, for Settings and the toggle. */
async function writeState(ctx: TimeboxContext, cfg: AppConfig): Promise<WriteState> {
  const settings = cfg.timebox ?? DEFAULT_TIMEBOX;
  if (!cfg.outlook) return { access: "not_set_up", message: "Outlook isn't set up", ...settings };
  const ow = ctx.outlook(cfg);
  if (!ow) return { access: "not_set_up", message: "Outlook isn't set up", ...settings };
  const a = await ow.access();
  return { access: a.status, message: a.status === "write" ? "Coopilot can create and change its own Outlook events" : a.status === "read_only" ? NO_WRITE : a.message, ...settings };
}

/**
 * One attempt at a logged write, safe to repeat: a create first looks for an event with the marker (no duplicates);
 * an update or delete reads the event and refuses one without the marker. Success only after reading it back.
 */
async function attempt(plan: PlanStore, ow: OutlookWrite, entry: WriteEntry, retry: boolean): Promise<WriteResult> {
  const settle = (status: WriteEntry["status"], message: string, more: { eventId?: string | null; before?: Fields | null } = {}): WriteResult => {
    const e = plan.settleWrite(entry.id, { status, message, retry, ...more });
    return { entry: e, confirmed: status === "confirmed", message };
  };
  const tb = plan.timeboxByUid(entry.uid);
  try {
    let eventId = entry.eventId;
    if (entry.op === "create") {
      const r = await ow.writer.create(entry.after!, entry.uid, `${entry.uid}:${entry.id}`);
      eventId = r.id;
      plan.settleWrite(entry.id, { status: "pending", eventId });
      const now = await ow.writer.get(eventId);
      if (r.existed && now && !matches(now, entry.after!, entry.uid).ok) await ow.writer.update(eventId, entry.uid, entry.after!, true);
    } else if (entry.op === "update") {
      const was = await ow.writer.update(eventId!, entry.uid, entry.after!, entry.before?.body !== entry.after!.body);
      // The prior values are what was really there just before the change.
      if (!retry) plan.settleWrite(entry.id, { status: "pending", before: { ...(entry.before ?? entry.after!), subject: was.subject, start: was.start, end: was.end } });
    } else {
      await ow.writer.remove(eventId!, entry.uid);
    }
    // Read back before reporting success.
    const back = await ow.writer.get(eventId!);
    if (entry.op === "delete") {
      if (back) return settle("unconfirmed", "Outlook still shows the event. Retry to delete it again", {});
      plan.markOwnDeleted(entry.uid);
    } else {
      const m = matches(back, entry.after!, entry.uid);
      if (!m.ok) return settle("unconfirmed", `Outlook didn't show the change yet (${m.differs.join(", ")}). Retry to check and fix it`, { eventId });
      plan.recordOwnEvent(entry.uid, tb?.id ?? null, eventId!, entry.after!);
    }
    // An undo puts the timebox back as it was too, and marks the original undone.
    if (entry.undoOf !== null) {
      if (tb && entry.localAfter) plan.updateTimebox(tb.id, entry.localAfter);
      plan.markUndone(entry.undoOf, entry.id);
    }
    return settle("confirmed", entry.undoOf !== null ? "Undone on Outlook" : entry.op === "create" ? "On Outlook" : entry.op === "update" ? "Outlook updated" : "Removed from Outlook", { eventId });
  } catch (e) {
    if (e instanceof OwnershipError) return settle("refused", e.message);
    if (e instanceof NetworkError) return settle("unconfirmed", "Outlook didn't answer, so Coopilot can't tell whether the change landed. Retry checks first and won't make a duplicate");
    if (e instanceof HttpError && e.status === 403) return settle("failed", NO_WRITE);
    if (e instanceof HttpError) return settle("failed", `Outlook refused the change (HTTP ${e.status}). Retry when it's back`);
    return settle("failed", "The change didn't go through. Retry");
  }
}

/** A timebox as the UI sees it: whether Outlook needs a change, and whether it is on Outlook now. */
export function timeboxView(tb: Timebox, plan: PlanStore, cfg: AppConfig | null): TimeboxView {
  const own = plan.ownEvent(tb.uid);
  return { ...tb, sync: cfg ? syncNeed(tb, own, want(cfg, tb)) : null, onOutlook: !!own && !own.deletedAt };
}
/** Timeboxes of a date range for the week view (live ones, plus removed ones still on Outlook). */
export function timeboxesFor(plan: PlanStore, from: IsoDate, to: IsoDate) {
  return plan.timeboxesBetween(from, to).filter((t) => !t.removedAt || (plan.ownEvent(t.uid) && !plan.ownEvent(t.uid)!.deletedAt));
}
export { dayTimeboxes };
/** Test hook: forget held previews. */
export const clearPreviews = () => previews.clear();
