// Timeboxes and the write framework (step 12). A timebox is local first; "Put on Outlook" makes Coopilot own one Busy
// event for it. Every external write goes through here: a named change with narrow inputs, a preview (target system,
// account, calendar, exact fields, who can see it) held on the server for five minutes, a confirm that writes, reads
// back and only then reports success, an audit log entry with the prior values, and undo. Coopilot only changes events
// that carry its marker. Nothing writes on a single click: the UI previews, the person confirms (or, for changes to
// their own timebox events with confirm_own off, the confirm follows the preview, still logged and undoable).
import type { AppConfig } from "../config/schema.ts";
import { DEFAULT_TIMEBOX, inviteDomains } from "../config/schema.ts";
import {
  dayTimeboxes, isShowAs, outlookFields, SHOW_AS_LABEL, syncNeed, timeboxProblem, undoOf,
  type Fields, type LocalState, type OutlookShowAs, type SyncOp, type Timebox, type WriteEntry, type WriteKind,
} from "../plan/timebox.ts";
import { domainAllowed, helpFollowUpText } from "../plan/collab.ts";
import { REMOVED_IN_OUTLOOK, timeboxFrom } from "../plan/outlooksync.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import type { OutlookWrite } from "../sources/graph/source.ts";
import { DomainError, editableMine, GoneError, inviteMatches, matches, NotMineError, OwnershipError, sameInstant, type OutlookEvent } from "../sources/graph/write.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { IsoDate } from "../week/types.ts";
import type { ActionResponse, PreviewField, TimeboxView, WritePreview, WriteResult, WriteState } from "./types.ts";

export const TIMEBOX_ACTIONS = [
  "timebox.add", "timebox.add_many", "timebox.update", "timebox.remove", "timebox.set_outlook", "timebox.resolve",
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
/** What a help invite is about (step 13), kept with its preview and in the invites table. */
export type InviteMeta = { clientKey: string; itemId: number | null; pickId: number | null; timeboxId: number | null; title: string; url: string | null; note: string | null };
type Held = { id: string; expiresAt: number; kind: WriteKind; uid: string; op: SyncOp; eventId: string | null; before: Fields | null; after: Fields | null; localBefore: LocalState | null; localAfter: LocalState | null; undoOf: number | null; auto: boolean; account: string; calendar: string; invite?: InviteMeta };
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
const localOf = (tb: Pick<Timebox, "start" | "end" | "outlook" | "removedAt" | "title" | "showAs" | "date">): LocalState => ({ start: tb.start, end: tb.end, outlook: tb.outlook, removedAt: tb.removedAt, title: tb.title, showAs: tb.showAs, date: tb.date });
const toLocal = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" });

/** Plain words for "when" in the configured zone: "Tue, Nov 3, 9:00 AM to 10:30 AM". */
function when(f: Fields, tz: string) {
  const s = Temporal.Instant.from(f.start).toZonedDateTimeISO(tz);
  const e = Temporal.Instant.from(f.end).toZonedDateTimeISO(tz);
  const day = s.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const t = (z: Temporal.ZonedDateTime) => z.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(s)} to ${t(e)}`;
}
const showLabel = (v: string) => SHOW_AS_LABEL[v as OutlookShowAs] ?? v;
const people = (f: Fields) => (f.attendees ?? []).map((a) => `${a.name} <${a.email}>`).join(", ");
/** The preview's field list: every field Coopilot writes, before and after (an update marks what changes). */
export function previewFields(op: SyncOp, before: Fields | null, after: Fields | null, tz: string, kind: WriteKind = "timebox"): PreviewField[] {
  const row = (label: string, b: string | null, a: string | null): PreviewField => ({ label, before: b, after: a, changed: op === "update" ? b !== a : true });
  const pick = <K extends keyof Fields>(f: Fields | null, k: K) => (f ? (f[k] as string) : null);
  if (kind === "event")
    // My own event: only time and show as change; the title is shown so I know which event, and stays.
    return [
      row("Title", pick(before, "subject"), pick(after, "subject")),
      row("When", before ? when(before, tz) : null, after ? when(after, tz) : null),
      row("Show as", before ? showLabel(before.showAs) : null, after ? showLabel(after.showAs) : null),
    ];
  if (kind === "invite")
    return [
      row("Title", pick(before, "subject"), pick(after, "subject")),
      row("When", before ? when(before, tz) : null, after ? when(after, tz) : null),
      row("Attendees", before ? people(before) : null, after ? people(after) : null),
      row("Teams meeting", before ? (before.teams ? "Yes" : "No") : null, after ? (after.teams ? "Yes" : "No") : null),
      row("Show as", before ? "Busy" : null, after ? "Busy" : null),
      row("Body", pick(before, "body"), pick(after, "body")),
    ];
  return [
    row("Title", pick(before, "subject"), pick(after, "subject")),
    row("When", before ? when(before, tz) : null, after ? when(after, tz) : null),
    row("Show as", before ? showLabel(before.showAs) : null, after ? showLabel(after.showAs) : null),
    row("Reminder", before ? "None" : null, after ? "None" : null),
    row("Attendees", before ? "None" : null, after ? "None" : null),
    row("Body", pick(before, "body"), pick(after, "body")),
  ];
}
export const VISIBILITY = "Only on your calendar. No attendees, so nobody is invited or notified. People who can see your calendar see this time as it is shown (Busy unless you change it); whether they also see the title depends on your Outlook sharing settings.";
export const VISIBILITY_EVENT = "Your own event with nobody else on it, so nobody is notified. Coopilot changes only its time and show as: the title and body stay as they are, and it isn't marked as Coopilot's.";
const others = (f: Fields | null) => (f?.attendees ?? []).filter((a) => a.name !== "You").map((a) => a.name);
/** Who hears about an invite: every teammate by name; a test invite to myself says so instead of "You will each". */
function inviteVisibility(op: SyncOp, f: Fields | null): string {
  const who = others(f);
  const self = (f?.attendees ?? []).some((a) => a.name === "You");
  if (!who.length) return op === "delete" ? "Only you are on it: you get the cancellation email and it comes off your calendar. Nobody else is notified." : "This is a meeting with only you on it: you get the invite email. Nobody else is invited or notified.";
  const list = who.length === 1 ? `${who[0]} will receive` : `${who.join(", ")} will each receive`;
  const also = self ? " You get one too." : "";
  return op === "delete"
    ? `${list} a cancellation email from you, and the meeting comes off their calendars.${also}`
    : `This is a meeting: ${list} an invite by email from you, and it shows on their calendars.${also} Only Cooptimize addresses can be invited.`;
}
const visibility = (kind: WriteKind, op: SyncOp, f: Fields | null) =>
  kind === "event" ? VISIBILITY_EVENT
  : kind === "invite" ? inviteVisibility(op, f)
  : VISIBILITY;
const SUMMARY: Record<SyncOp, string> = { create: "Create an Outlook event", update: "Change an Outlook event Coopilot created", delete: "Delete an Outlook event Coopilot created" };
const summaryOf = (kind: WriteKind, op: SyncOp) => (kind === "event" ? "Change your own Outlook event" : kind === "invite" ? (op === "delete" ? "Cancel the help invite" : "Send a help invite") : SUMMARY[op]);

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

  /** One timebox's preview (single or combined): what to hold, nothing to do, already gone, or a refusal. */
  type HeldIn = Omit<Held, "id" | "expiresAt" | "account" | "calendar">;
  const previewTimebox = async (ow: OutlookWrite, uid: string): Promise<{ held: HeldIn | "nothing" | "gone" } | { bad: ActionResponse }> => {
    const tb = plan.timeboxByUid(uid);
    const own = plan.ownEvent(uid);
    if (!tb && !own) throw new PlanError("No such timebox");
    if (tb?.conflict) return { bad: bad("This timebox changed in Coopilot and in Outlook: choose which version to keep first", 409) };
    const w = want(cfg, tb);
    let op = syncNeed(tb, own, w);
    let current: OutlookEvent | null = null;
    if (op && op !== "create" && own) {
      // Read the event now: preview shows what is really there, and an event deleted in Outlook isn't "changed".
      current = await ow.writer.get(own.eventId).catch((e: unknown) => { throw e instanceof NetworkError ? new PlanError("Outlook unreachable") : e; });
      if (!current) {
        // Step 13.5: already gone from Outlook. Done for a delete; for a change, the timebox is kept here with Put
        // on Outlook off (never re-created on its own). Logged as "already gone", not an error.
        plan.markOwnDeleted(uid);
        const localBefore = tb ? localOf(tb) : null;
        if (tb && !tb.removedAt && op !== "delete") plan.updateTimebox(tb.id, { outlook: false, outlookNote: REMOVED_IN_OUTLOOK, conflict: null });
        plan.logWrite({ op, kind: "timebox", status: "confirmed", message: op === "delete" ? "Already gone from Outlook; nothing to remove" : "Already gone from Outlook; the timebox is kept here with Put on Outlook off", uid, eventId: own.eventId, account: null, calendar: null, before: own.fields, after: null, localBefore, localAfter: tb ? localOf(plan.timebox(tb.id)!) : null, auto: true });
        return { held: "gone" as const };
      } else if (current.marker !== uid) return { bad: bad(new OwnershipError().message, 409) };
    }
    if (!op) return { held: "nothing" as const };
    const own2 = plan.ownEvent(uid);
    const before = op === "create" ? null : current ? { ...own2!.fields, subject: current.subject, start: current.start, end: current.end } : own2!.fields;
    const after = op === "delete" ? null : w;
    // What the timebox looked like before this change (for undo): from the event's fields when there is one.
    const localBefore: LocalState | null = op === "create" ? (tb ? { ...localOf(tb), outlook: false } : null) : before ? { start: toLocal(before.start, tz), end: toLocal(before.end, tz), outlook: true, removedAt: null } : null;
    return { held: { kind: "timebox" as const, uid, op, eventId: op === "create" ? null : own2!.eventId, before, after, localBefore, localAfter: tb ? localOf(tb) : null, undoOf: null, auto: !settings.confirmOwn && op !== "create" } };
  };

  /** Confirm one held preview: still the same change, then write, read back and log (single and combined). */
  const confirmOne = async (previewId: string): Promise<ActionResponse> => {
    const held = previews.get(previewId);
    previews.delete(previewId);
    if (!held || held.expiresAt < Date.now()) return bad("That preview has expired. Review the change again", 410);
    // Still the same change? A timebox moved again after the preview needs a new one.
    if (held.undoOf === null && held.kind === "timebox") {
      const tb = plan.timeboxByUid(held.uid);
      if (tb?.conflict) return bad("This timebox changed in Coopilot and in Outlook: choose which version to keep first", 409);
      const w = want(cfg, tb);
      const now = syncNeed(tb, plan.ownEvent(held.uid), w);
      if (now !== held.op || JSON.stringify(w) !== JSON.stringify(held.after)) return bad("The timebox changed since the preview. Review the change again", 409);
    }
    // Invites go only to allowed domains: checked at preview, here, and again in the writer.
    if (held.kind === "invite" && held.op === "create" && (held.after?.attendees ?? []).some((a) => !domainAllowed(a.email, inviteDomains(cfg)))) return bad(new DomainError().message, 422);
    const ow = cfg.outlook ? ctx.outlook(cfg) : null;
    if (!ow) return bad("Outlook isn't set up", 409);
    if (held.kind === "invite" && held.op === "create" && held.invite) plan.addInvite({ uid: held.uid, ...held.invite, start: toLocal(held.after!.start, tz), end: toLocal(held.after!.end, tz), attendees: held.after!.attendees ?? [], teams: !!held.after!.teams });
    const entry = plan.logWrite({ op: held.op, kind: held.kind, uid: held.uid, eventId: held.eventId, account: held.account, calendar: held.calendar, before: held.before, after: held.after, localBefore: held.localBefore, localAfter: held.localAfter, auto: held.auto, undoOf: held.undoOf });
    return { ok: true, data: await attempt(plan, ow, entry, false, { domains: inviteDomains(cfg), now: ctx.now }) };
  };

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
    case "timebox.add_many": {
      // Step 13.6 (D246): Timebox my day. Every item is checked first, then all are added in one transaction.
      const o = fields(input, ["date", "items"]);
      const date = isoDate(o.date);
      if (!Array.isArray(o.items) || o.items.length === 0) throw new Invalid("items needs at least one timebox");
      if (o.items.length > 30) throw new Invalid("At most 30 timeboxes at once");
      const boxed = new Set(plan.timeboxesBetween(date, date).filter((t) => !t.removedAt && t.pickId !== null).map((t) => t.pickId));
      const seen = new Set<number>();
      const list = o.items.map((raw) => {
        const it = fields(raw, ["pickId", "start", "end"], ["outlook"]);
        const pickId = posId(it.pickId, "pickId");
        const start = localTime(it.start, "start", tz);
        const end = localTime(it.end, "end", tz);
        const p = timeboxProblem(date, start, end);
        if (p) throw new Invalid(p);
        if (it.outlook !== undefined && typeof it.outlook !== "boolean") throw new Invalid("outlook must be true or false");
        const pick = plan.getPick(pickId);
        if (!pick) throw new PlanError(`No pick ${pickId}`);
        if (pick.date !== date) throw new Invalid("A pick's timebox is on the pick's day");
        if (pick.status !== "planned") throw new PlanError(`"${pick.title}" isn't planned`);
        if (boxed.has(pickId) || seen.has(pickId)) throw new PlanError(`"${pick.title}" is already timeboxed`);
        seen.add(pickId);
        return { date, clientKey: pick.clientKey, pickId, itemId: pick.itemId, title: pick.title, url: pick.itemUrl, start, end, outlook: typeof it.outlook === "boolean" ? it.outlook : settings.outlookDefault };
      });
      const added = plan.addTimeboxes(list);
      return { ok: true, data: { timeboxes: added.map((t) => timeboxView(t, plan, cfg)), sync: added.filter((t) => sync(t)).map((t) => t.uid) } };
    }
    case "timebox.update": {
      // Step 13: also the title and show as. Editing the timebox and editing its Outlook event are the same thing.
      const o = fields(input, ["id"], ["start", "end", "title", "showAs"]);
      const tb = plan.timebox(posId(o.id, "id"));
      if (!tb || tb.removedAt) throw new PlanError("No such timebox");
      const start = o.start === undefined ? tb.start : localTime(o.start, "start", tz);
      const end = o.end === undefined ? tb.end : localTime(o.end, "end", tz);
      const p = timeboxProblem(tb.date, start, end);
      if (p) throw new Invalid(p);
      const title = o.title === undefined ? tb.title : text(o.title, "title", 200);
      if (o.showAs !== undefined && !isShowAs(o.showAs)) throw new Invalid("showAs must be busy, tentative, free, oof or workingElsewhere");
      const showAs = (o.showAs as OutlookShowAs | undefined) ?? tb.showAs;
      return out(plan.updateTimebox(tb.id, { start, end, title, showAs, outlookNote: null }));
    }
    case "timebox.resolve": {
      // Step 13: both sides changed since the last sync. Keep Coopilot's (then the usual preview puts it on Outlook)
      // or use Outlook's (the timebox follows it, nothing is written).
      const o = fields(input, ["id", "keep"]);
      if (o.keep !== "coopilot" && o.keep !== "outlook" && o.keep !== "local" && o.keep !== "remove") throw new Invalid("keep must be coopilot, outlook, local or remove");
      if (o.keep === "local" || o.keep === "remove") {
        // Step 13.5: its event was deleted in Outlook. Keep it here only, or remove it; nothing is written either way.
        const gone = plan.timebox(posId(o.id, "id"));
        if (!gone || gone.removedAt || gone.outlookNote !== REMOVED_IN_OUTLOOK) throw new PlanError("This timebox wasn't removed in Outlook");
        if (o.keep === "local") return out(plan.updateTimebox(gone.id, { outlookNote: null }));
        plan.updateTimebox(gone.id, { removedAt: ctx.now(), outlookNote: null });
        return { ok: true, data: { timebox: null, uid: gone.uid, sync: null } };
      }
      const tb = plan.timebox(posId(o.id, "id"));
      if (!tb || !tb.conflict) throw new PlanError("Nothing to choose for this timebox");
      const own = plan.ownEvent(tb.uid);
      const theirs = tb.conflict.outlook;
      const localBefore = localOf(tb);
      if (o.keep === "coopilot") {
        // Outlook's version becomes "what is there", so the timebox shows as out of step until it is written.
        if (own && theirs) plan.recordOwnEvent(tb.uid, tb.id, own.eventId, theirs);
        else if (own) plan.markOwnDeleted(tb.uid);
        return out(plan.updateTimebox(tb.id, { conflict: null, outlookNote: null }));
      }
      if (!theirs) {
        plan.updateTimebox(tb.id, { conflict: null, removedAt: ctx.now(), outlookNote: "Deleted in Outlook" });
        plan.logWrite({ op: "delete", kind: "sync", status: "confirmed", message: "From Outlook: deleted there (chosen)", uid: tb.uid, eventId: own?.eventId ?? null, account: null, calendar: null, before: own?.fields ?? null, after: null, localBefore, localAfter: localOf(plan.timebox(tb.id)!), auto: false });
        return { ok: true, data: { timebox: null, uid: tb.uid, sync: null } };
      }
      const t = timeboxFrom(theirs, clientName(cfg, tb.clientKey), tz);
      if (!t) throw new PlanError("Outlook's version can't be a timebox (it is longer than 8 hours or crosses midnight). Keep Coopilot's, or change it in Outlook");
      const next = plan.updateTimebox(tb.id, { ...t, pickId: t.date === tb.date ? tb.pickId : null, conflict: null, outlookNote: `Changed in Outlook: ${tb.conflict.changed.join(", ")}` });
      if (own) plan.recordOwnEvent(tb.uid, tb.id, own.eventId, want(cfg, next) ?? theirs);
      plan.logWrite({ op: "update", kind: "sync", status: "confirmed", message: "From Outlook: Outlook's version kept (chosen)", uid: tb.uid, eventId: own?.eventId ?? null, account: null, calendar: null, before: own?.fields ?? null, after: theirs, localBefore, localAfter: localOf(next), auto: false });
      return out(next);
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
      const o = fields(input, [], ["uid", "uids", "undo", "event"]);
      if ([o.uid, o.uids, o.undo, o.event].filter((x) => x !== undefined).length !== 1) throw new Invalid("write.preview takes { uid }, { uids }, { undo } or { event }");
      const ow = cfg.outlook ? ctx.outlook(cfg) : null;
      if (!ow) return bad("Outlook isn't set up", 409);
      const access = await ow.access();
      if (access.status !== "write") return bad(access.status === "unavailable" ? access.message : NO_WRITE, 409);
      if (o.uids !== undefined) {
        // Step 13.6 (D247): the combined preview. Each event is held exactly as a single preview would be.
        if (!Array.isArray(o.uids) || o.uids.length === 0) throw new Invalid("uids needs at least one timebox");
        if (o.uids.length > 20) throw new Invalid("At most 20 events in one preview");
        const uids = [...new Set(o.uids.map((u) => text(u, "uid", 80)))];
        const previews: WritePreview[] = [], nothing: string[] = [], alreadyGone: string[] = [];
        for (const uid of uids) {
          const r = await previewTimebox(ow, uid);
          if ("bad" in r) return r.bad;
          if (r.held === "nothing") nothing.push(uid);
          else if (r.held === "gone") alreadyGone.push(uid);
          else previews.push(await hold(ow, r.held, tz));
        }
        return { ok: true, data: { previews, nothing, alreadyGone } };
      }
      let held: Omit<Held, "id" | "expiresAt" | "account" | "calendar">;
      if (o.undo !== undefined) {
        const entry = plan.writeEntry(posId(o.undo, "undo"));
        if (!entry) throw new PlanError("No such write");
        if (entry.kind === "sync") throw new PlanError("A change made in Outlook isn't undone from here: change the timebox, or change it in Outlook");
        if (undoTops(plan.writeLog(1000)).get(entry.uid) !== entry.id) throw new PlanError("Only the latest change to an event that isn't undone yet can be undone");
        const u = undoOf(entry);
        if (!u) throw new PlanError("This change can't be undone");
        const tb = entry.kind === "timebox" ? plan.timeboxByUid(entry.uid) : null;
        held = { kind: entry.kind, uid: entry.uid, op: u.op, eventId: u.eventId, before: entry.after, after: u.fields, localBefore: tb ? localOf(tb) : null, localAfter: u.local, undoOf: entry.id, auto: false };
      } else if (o.event !== undefined) {
        // Step 13, tier "mine": one of my own events with nobody else on it. Time and show as only.
        const e = fields(o.event, ["id"], ["start", "end", "showAs"]);
        const eventId = text(e.id, "event id", 400);
        const now = await ow.writer.ownEditable(eventId).catch((x: unknown) => { throw x instanceof NetworkError ? new PlanError("Outlook unreachable") : x; });
        if (!now) throw new PlanError("That event is gone from Outlook");
        if (!editableMine(now)) return bad(now.marker ? "That event is Coopilot's: change its timebox instead" : now.others > 0 || !now.isOrganizer ? "Others are on this meeting, so Coopilot won't change it: open it in Outlook" : now.isAllDay ? "An all-day event: change it in Outlook" : "A repeating event: change it in Outlook", 409);
        const start = e.start === undefined ? now.start : Temporal.Instant.from(localTime(e.start, "start", tz)).toString();
        const end = e.end === undefined ? now.end : Temporal.Instant.from(localTime(e.end, "end", tz)).toString();
        if (Temporal.Instant.compare(Temporal.Instant.from(end), Temporal.Instant.from(start)) <= 0) throw new Invalid("An event ends after it starts");
        if (Temporal.Instant.from(start).until(Temporal.Instant.from(end)).total("hours") > 24) throw new Invalid("Coopilot changes events of up to 24 hours");
        if (e.showAs !== undefined && !isShowAs(e.showAs)) throw new Invalid("showAs must be busy, tentative, free, oof or workingElsewhere");
        const showNow = (isShowAs(now.showAs) ? now.showAs : (["busy", "tentative", "free", "oof", "workingElsewhere"] as const).find((v) => v.toLowerCase() === now.showAs.toLowerCase()) ?? "busy") as OutlookShowAs;
        const before: Fields = { subject: now.subject, body: "", start: Temporal.Instant.from(now.start).toString(), end: Temporal.Instant.from(now.end).toString(), showAs: showNow, reminder: false };
        const after: Fields = { ...before, start, end, showAs: (e.showAs as OutlookShowAs | undefined) ?? showNow };
        if (sameInstant(before.start, after.start) && sameInstant(before.end, after.end) && before.showAs === after.showAs) return { ok: true, data: { nothing: true } };
        held = { kind: "event", uid: `ev:${eventId}`, op: "update", eventId, before, after, localBefore: null, localAfter: null, undoOf: null, auto: false };
      } else {
        const r = await previewTimebox(ow, text(o.uid, "uid", 80));
        if ("bad" in r) return r.bad;
        if (r.held === "gone") return { ok: true, data: { nothing: true, alreadyGone: true } };
        if (r.held === "nothing") return { ok: true, data: { nothing: true } };
        held = r.held;
      }
      return { ok: true, data: { preview: await hold(ow, held, tz) } };
    }
    case "write.confirm": {
      const o = fields(input, [], ["previewId", "previewIds"]);
      if ((o.previewId === undefined) === (o.previewIds === undefined)) throw new Invalid("write.confirm takes { previewId } or { previewIds }");
      if (o.previewIds !== undefined) {
        // Step 13.6 (D247): each held preview confirmed in turn, exactly as one confirm; a refusal or failure on one
        // doesn't stop the rest.
        if (!Array.isArray(o.previewIds) || o.previewIds.length === 0 || o.previewIds.length > 20) throw new Invalid("previewIds needs 1 to 20 previews");
        const results: (WriteResult | { error: string; status: number })[] = [];
        for (const id of o.previewIds) {
          if (typeof id !== "string") throw new Invalid("previewId must be text");
          const r = await confirmOne(id);
          results.push(r.ok ? (r.data as WriteResult) : { error: r.error, status: r.status });
        }
        return { ok: true, data: { results } };
      }
      if (typeof o.previewId !== "string") throw new Invalid("previewId must be text");
      return confirmOne(o.previewId);
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
      return { ok: true, data: await attempt(plan, ow, entry, true, { domains: inviteDomains(cfg), now: ctx.now }) };
    }
  }
}

/** Hold a preview on the server for five minutes (the single path to a confirm). Also used for help invites. */
export async function hold(ow: OutlookWrite, held: Omit<Held, "id" | "expiresAt" | "account" | "calendar">, tz: string): Promise<WritePreview> {
  const cal = await ow.writer.calendar().catch(() => ({ name: "Calendar", owner: "" }));
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + PREVIEW_MS;
  for (const [k, v] of previews) if (v.expiresAt < Date.now()) previews.delete(k);
  previews.set(id, { ...held, id, expiresAt, account: cal.owner, calendar: cal.name });
  const subject = held.after ?? held.before;
  return {
    previewId: id, expiresAt: new Date(expiresAt).toISOString(), op: held.op, kind: held.kind, undo: held.undoOf !== null, auto: held.auto,
    system: "Outlook", account: cal.owner || "Your Microsoft account", calendar: cal.name,
    summary: held.undoOf !== null && held.kind !== "invite" ? `Undo: ${summaryOf(held.kind, held.op).toLowerCase()}` : summaryOf(held.kind, held.op),
    fields: previewFields(held.op, held.before, held.after, tz, held.kind), visibility: visibility(held.kind, held.op, subject),
    attendees: held.kind === "invite" ? (subject?.attendees ?? []).map((a) => ({ ...a })) : [],
  };
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
async function attempt(plan: PlanStore, ow: OutlookWrite, entry: WriteEntry, retry: boolean, env: { domains: readonly string[]; now: () => string }): Promise<WriteResult> {
  const settle = (status: WriteEntry["status"], message: string, more: { eventId?: string | null; before?: Fields | null } = {}): WriteResult => {
    const e = plan.settleWrite(entry.id, { status, message, retry, ...more });
    return { entry: e, confirmed: status === "confirmed", message };
  };
  if (entry.kind === "event" || entry.kind === "invite") {
    try {
      return entry.kind === "event" ? await attemptOwn(plan, ow, entry, settle) : await attemptInvite(plan, ow, entry, settle, env);
    } catch (e) {
      return failed(e, settle);
    }
  }
  const tb = plan.timeboxByUid(entry.uid);
  // Step 13.5: the event is already gone from Outlook (deleted there, or a 404). A delete is done; an update has
  // nothing to change, so the timebox is kept with Put on Outlook off, as a sync would. Logged, never an error.
  const alreadyGone = (): WriteResult => {
    plan.markOwnDeleted(entry.uid);
    if (entry.op === "update" && tb && !tb.removedAt) plan.updateTimebox(tb.id, { outlook: false, outlookNote: REMOVED_IN_OUTLOOK, conflict: null });
    if (entry.undoOf !== null) plan.markUndone(entry.undoOf, entry.id);
    return settle("confirmed", entry.op === "delete" ? "Already gone from Outlook; nothing to remove" : "Already gone from Outlook; the timebox is kept here with Put on Outlook off");
  };
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
    } else if ((await ow.writer.remove(eventId!, entry.uid)) === "already_gone") {
      return alreadyGone();
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
    if (e instanceof GoneError && (entry.op === "update" || entry.op === "delete")) return alreadyGone();
    return failed(e, settle);
  }
}

type Settle = (status: WriteEntry["status"], message: string, more?: { eventId?: string | null; before?: Fields | null }) => WriteResult;
function failed(e: unknown, settle: Settle): WriteResult {
  if (e instanceof OwnershipError || e instanceof NotMineError || e instanceof DomainError) return settle("refused", e.message);
  if (e instanceof GoneError) return settle("refused", "That event is gone from Outlook, so there is nothing to change");
  if (e instanceof NetworkError) return settle("unconfirmed", "Outlook didn't answer, so Coopilot can't tell whether the change landed. Retry checks first and won't make a duplicate");
  if (e instanceof HttpError && e.status === 403) return settle("failed", NO_WRITE);
  if (e instanceof HttpError) return settle("failed", `Outlook refused the change (HTTP ${e.status}). Retry when it's back`);
  return settle("failed", "The change didn't go through. Retry");
}

/** My own event (step 13): time and show as only, after the tier check in the writer; read back before success. */
async function attemptOwn(plan: PlanStore, ow: OutlookWrite, entry: WriteEntry, settle: Settle): Promise<WriteResult> {
  const after = entry.after!;
  const was = await ow.writer.updateOwn(entry.eventId!, { start: after.start, end: after.end, showAs: after.showAs });
  if (entry.attempts === 1 && entry.undoOf === null) plan.settleWrite(entry.id, { status: "pending", before: { ...(entry.before ?? after), subject: was.subject, start: was.start, end: was.end } });
  const back = await ow.writer.ownEditable(entry.eventId!);
  const ok = !!back && sameInstant(back.start, after.start) && sameInstant(back.end, after.end) && back.showAs.toLowerCase() === after.showAs.toLowerCase();
  if (!ok) return settle("unconfirmed", "Outlook didn't show the change yet. Retry to check and fix it");
  if (entry.undoOf !== null) plan.markUndone(entry.undoOf, entry.id);
  return settle("confirmed", entry.undoOf !== null ? "Undone on Outlook" : "Outlook updated");
}

/**
 * A help invite (step 13). Create: domains checked again in the writer, idempotent by marker, read back with its
 * attendees; then the invite is kept on the item and its follow-up opens. Undo cancels it (attendees get a
 * cancellation) and it is read back as gone from the calendar.
 */
async function attemptInvite(plan: PlanStore, ow: OutlookWrite, entry: WriteEntry, settle: Settle, env: { domains: readonly string[]; now: () => string }): Promise<WriteResult> {
  const inv = plan.invite(entry.uid);
  if (entry.op === "create") {
    const f = entry.after!;
    const r = await ow.writer.createInvite(f, entry.uid, `${entry.uid}:${entry.id}`, env.domains);
    plan.settleWrite(entry.id, { status: "pending", eventId: r.id });
    const back = await ow.writer.getInvite(r.id);
    const m = inviteMatches(back, f, entry.uid);
    if (!m.ok) return settle("unconfirmed", `Outlook didn't show the invite as sent yet (${m.differs.join(", ")}). Retry checks first and won't send a second one`, { eventId: r.id });
    if (inv) {
      const followUp = plan.openRuleFollowUp({ kind: "help", ruleKey: `help:${entry.uid}`, clientKey: inv.clientKey, who: inv.attendees.map((a) => a.name).join(", "), what: helpFollowUpText(inv.attendees.map((a) => a.name), inv.title), itemId: inv.itemId, refAt: Temporal.Instant.from(f.end).toString() });
      plan.setInvite(entry.uid, { status: "sent", eventId: r.id, ...(followUp ? { followUpId: followUp.id } : {}) });
    }
    return settle("confirmed", `Invite sent to ${(f.attendees ?? []).map((a) => a.name).join(", ")}`, { eventId: r.id });
  }
  // Undo: cancel.
  const before = entry.before ?? null;
  await ow.writer.cancel(entry.eventId!, entry.uid, "Cancelled from Coopilot.");
  const back = await ow.writer.get(entry.eventId!);
  const still = back && before ? (await ow.writer.scan(before.start, before.end)).some((e) => e.id === entry.eventId) : !!back;
  if (still) return settle("unconfirmed", "Outlook still shows the meeting. Retry to cancel it again");
  if (inv) {
    plan.setInvite(entry.uid, { status: "cancelled" });
    if (inv.followUpId) {
      const l = plan.getFollowUp(inv.followUpId);
      if (l && !l.closedAt) plan.closeFollowUp(inv.followUpId, "Invite cancelled", "signal");
    }
  }
  if (entry.undoOf !== null) plan.markUndone(entry.undoOf, entry.id);
  return settle("confirmed", "Invite cancelled; attendees get a cancellation");
}

/** A timebox as the UI sees it: whether Outlook needs a change, and whether it is on Outlook now. */
export function timeboxView(tb: Timebox, plan: PlanStore, cfg: AppConfig | null): TimeboxView {
  const own = plan.ownEvent(tb.uid);
  return { ...tb, sync: cfg && !tb.conflict ? syncNeed(tb, own, want(cfg, tb)) : null, onOutlook: !!own && !own.deletedAt };
}
export { want as wantFields, localOf, clientName };
/** Timeboxes of a date range for the week view (live ones, plus removed ones still on Outlook). */
export function timeboxesFor(plan: PlanStore, from: IsoDate, to: IsoDate) {
  return plan.timeboxesBetween(from, to).filter((t) => !t.removedAt || (plan.ownEvent(t.uid) && !plan.ownEvent(t.uid)!.deletedAt));
}
export { dayTimeboxes };
/** Test hook: forget held previews. */
export const clearPreviews = () => previews.clear();
