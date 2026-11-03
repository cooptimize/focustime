// The collaboration finder (step 13): "Needs help from…" on a pick, a week list item, a timebox or a work item.
// Reads only: teammates, Focus Time, Account Workers and PTO from Dataverse (PTO as dates, never titles), free/busy
// from Graph getSchedule (availability and working hours only). The one write, the invite, is held as a preview in
// the write framework (actions/timebox-actions.ts) and sent only on confirm.
import { inviteDomains, type AppConfig } from "../config/schema.ts";
import { defaultRange, domainAllowed, inviteFields, rankCandidates, suggestSlots, type Availability, type Candidate } from "../plan/collab.ts";
import { ownEventIds, withoutOwn } from "../plan/timebox.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { OutlookWrite, ScheduleReader } from "../sources/graph/source.ts";
import { NetworkError } from "../sources/calendar/http.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import { hoursOn } from "../week/hours.ts";
import { localToday, mondayOf } from "../week/dates.ts";
import type { Week, CalEvent, IsoDate } from "../week/types.ts";
import { hold, type InviteMeta } from "./timebox-actions.ts";
import type { ActionResponse, CandidatesData, CandidateView, SuggestData } from "./types.ts";
import { userZone } from "../week/zone.ts";

export const COLLAB_ACTIONS = ["collab.candidates", "collab.suggest", "collab.preview_invite"] as const;
export type CollabAction = (typeof COLLAB_ACTIONS)[number];

export type CollabContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  dataverse: (cfg: AppConfig) => DataverseSource;
  outlook: (cfg: AppConfig) => { write: OutlookWrite | null; schedule: ScheduleReader | null; source: CalendarSource } | null;
  google: (cfg: AppConfig) => CalendarSource | null;
  /** Step 13.5: my week's focus blocks (patterns and standing blocks only), to rank slots inside a client's blocks first. */
  blocks?: (cfg: AppConfig, weekStart: IsoDate) => Promise<Week | null>;
  now: () => string;
};

/** The longest range searched at once, and the most people checked or invited. */
export const MAX_RANGE_DAYS = 14;
export const MAX_CHECKED = 40;
export const MAX_INVITED = 8;

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
const text = (v: unknown, name: string, max: number) => {
  if (typeof v !== "string" || !v.trim()) throw new Invalid(`${name} must be text`);
  if (v.trim().length > max) throw new Invalid(`${name} is at most ${max} characters`);
  return v.trim();
};
const optText = (v: unknown, name: string, max: number) => (v === undefined || v === null || v === "" ? null : text(v, name, max));
const optId = (v: unknown, name: string) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
};
const isoDate = (v: unknown, name: string): IsoDate => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid(`${name} must be YYYY-MM-DD`);
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid(`${name} must be a real date`);
  }
};
const emails = (v: unknown, max: number) => {
  if (!Array.isArray(v) || !v.length || v.length > max || v.some((x) => typeof x !== "string" || x.length > 200)) throw new Invalid(`people must be a list of 1 to ${max} email addresses`);
  return [...new Set((v as string[]).map((x) => x.trim().toLowerCase()))];
};
const devopsUrl = (v: unknown) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 500 || !v.startsWith("https://dev.azure.com/")) throw new Invalid("url must be a DevOps link");
  return v;
};

export async function collabAction(ctx: CollabContext, action: CollabAction, input: unknown): Promise<ActionResponse> {
  try {
    return await run(ctx, action, input);
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    if (e instanceof NetworkError) return bad("Outlook unreachable", 503);
    throw e;
  }
}

/** Range dates from..to, inclusive. */
function datesOf(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = Temporal.PlainDate.from(from); Temporal.PlainDate.compare(d, to) <= 0; d = d.add({ days: 1 })) out.push(d.toString());
  return out;
}

/** The candidates for a client over a range, or a plain refusal. Clients: mine (Account Worker) or Internal. */
async function candidatesFor(ctx: CollabContext, cfg: AppConfig, clientKey: string, from: IsoDate, to: IsoDate): Promise<{ candidates: Candidate[]; problems: string[] } | { refuse: string; status: number }> {
  const dv = ctx.dataverse(cfg);
  const me = cfg.dataverse.mySystemUserId;
  if (!me) return { refuse: "Your Dataverse user id is not resolved yet", status: 409 };
  const mine = await dv.myClients().catch(() => null);
  if (clientKey !== INTERNAL_CLIENT && mine && !mine.some((c) => c.clientKey === clientKey)) return { refuse: "Help is found only for your own clients", status: 403 };
  const [team, crew, pto] = await Promise.all([dv.teammates(), dv.clientTeam(clientKey, from, to), dv.teamPto(from, to)]);
  if (!team.ok) return { refuse: team.message, status: 503 };
  const problems: string[] = [];
  if (!crew.ok) problems.push(`Who works on ${clientKey} isn't known (${crew.message}); everyone is shown as tier 3`);
  if (!pto.ok) problems.push(`PTO couldn't be read (${pto.message}), so time off isn't shown`);
  const candidates = rankCandidates({
    team: team.people, meId: me, meEmail: cfg.dataverse.myEmail, domains: inviteDomains(cfg),
    patterns: crew.ok ? crew.patterns : [], workers: new Set(crew.ok ? crew.workers : []),
    away: pto.ok ? pto.away : [], dates: datesOf(from, to), exclude: cfg.collab.exclude,
  });
  return { candidates, problems };
}

const view = (c: Candidate): CandidateView => ({ name: c.name, email: c.email, tier: c.tier, onClient: c.onClient, away: c.away });

function range(o: Obj, cfg: AppConfig, today: IsoDate): { from: IsoDate; to: IsoDate } {
  const model = cfg.week.hours;
  const def = defaultRange(today, o.pinned === undefined || o.pinned === null ? null : isoDate(o.pinned, "pinned"), (d) => hoursOn(model, d).segments.length > 0, cfg.collab.daysAhead);
  const from = o.from === undefined ? def.from : isoDate(o.from, "from");
  const to = o.to === undefined ? (o.from === undefined ? def.to : from) : isoDate(o.to, "to");
  if (to < from) throw new Invalid("to is before from");
  if (Temporal.PlainDate.from(from).until(to).days >= MAX_RANGE_DAYS) throw new Invalid(`Search up to ${MAX_RANGE_DAYS} days at once`);
  if (to < today) throw new Invalid("That range is in the past");
  return { from: from < today ? today : from, to };
}

/** My working time per date (lunch out, PTO days out), as epoch ms. */
function myWindows(cfg: AppConfig, dates: readonly IsoDate[], away: ReadonlySet<IsoDate>) {
  const tz = userZone(cfg);
  const at = (d: IsoDate, hm: string) => Temporal.PlainDate.from(d).toZonedDateTime({ timeZone: tz, plainTime: Temporal.PlainTime.from(hm) }).epochMilliseconds;
  const out: { date: IsoDate; start: number; end: number }[] = [];
  for (const d of dates) {
    if (away.has(d)) continue;
    const h = hoursOn(cfg.week.hours, d);
    for (const s of h.segments) {
      const a = at(d, s.start), b = s.end === "24:00" ? at(Temporal.PlainDate.from(d).add({ days: 1 }).toString(), "00:00") : at(d, s.end);
      const lunch = h.lunch && h.lunch.start !== h.lunch.end ? [at(d, h.lunch.start), at(d, h.lunch.end)] : null;
      if (lunch && lunch[0]! > a && lunch[1]! < b) out.push({ date: d, start: a, end: lunch[0]! }, { date: d, start: lunch[1]!, end: b });
      else out.push({ date: d, start: a, end: b });
    }
  }
  return out;
}

const BUSY_SHOW = new Set(["busy", "tentative", "oof", "unknown", undefined]);

async function run(ctx: CollabContext, action: CollabAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const tz = userZone(cfg);
  const today = localToday(ctx.now(), tz);

  switch (action) {
    case "collab.candidates": {
      const o = fields(input, ["clientKey"], ["from", "to", "pinned"]);
      const clientKey = text(o.clientKey, "clientKey", 100);
      const r = range(o, cfg, today);
      const c = await candidatesFor(ctx, cfg, clientKey, r.from, r.to);
      if ("refuse" in c) return bad(c.refuse, c.status);
      return { ok: true, data: { clientKey, ...r, candidates: c.candidates.map(view), problems: c.problems } satisfies CandidatesData };
    }
    case "collab.suggest": {
      const o = fields(input, ["clientKey", "minutes"], ["from", "to", "pinned", "people"]);
      const clientKey = text(o.clientKey, "clientKey", 100);
      if (typeof o.minutes !== "number" || !Number.isInteger(o.minutes) || o.minutes < 15 || o.minutes > 120 || o.minutes % 15) throw new Invalid("minutes must be 15 to 120 in 15 minute steps");
      const r = range(o, cfg, today);
      const chosen = o.people === undefined || o.people === null ? null : emails(o.people, MAX_INVITED);
      const c = await candidatesFor(ctx, cfg, clientKey, r.from, r.to);
      if ("refuse" in c) return bad(c.refuse, c.status);
      const known = new Set(c.candidates.map((x) => x.email));
      if (chosen && chosen.some((e) => !known.has(e))) return bad("Pick people from the list (Cooptimize staff only)", 422);
      const ol = cfg.outlook ? ctx.outlook(cfg) : null;
      if (!ol?.schedule) return bad("Outlook isn't set up, so free/busy can't be checked", 409);
      const dates = datesOf(r.from, r.to);
      // My PTO days are out; my calendar from the usual reads (FocusTime's own timebox events are soft, not busy).
      const myPto = new Set((await ctx.dataverse(cfg).pto(r.from, r.to).catch(() => null))?.items.map((e) => e.date) ?? []);
      const windows = myWindows(cfg, dates, myPto);
      if (!windows.length) return { ok: true, data: { slots: [], checked: 0, problems: [...c.problems, "No working hours of yours in that range"] } satisfies SuggestData };
      const weeks = [...new Set(dates.map(mondayOf))];
      const own = plan ? ownEventIds(plan.ownEvents()) : new Set<string>();
      const google = ctx.google(cfg);
      const loads = await Promise.all(weeks.flatMap((w) => [ol.source.load(w).catch(() => null), google ? google.load(w).catch(() => null) : Promise.resolve(null)]));
      const problems = [...c.problems];
      if (loads.some((l) => l && l.status !== "ok" && !l.fromCache)) problems.push("A calendar of yours didn't load, so your own busy time may be missing");
      const mine: CalEvent[] = withoutOwn(loads.flatMap((l) => l?.items ?? []), own);
      const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
      const myBusy: [number, number][] = mine.filter((e) => !e.allDay && BUSY_SHOW.has(e.showAs) && e.responseStatus !== "declined").map((e) => [ms(e.start), ms(e.end)]);
      for (const u of plan?.unavailableBetween(r.from, r.to) ?? []) myBusy.push([ms(u.start), ms(u.end)]);
      const myBoxes: [number, number][] = (plan?.timeboxesBetween(r.from, r.to) ?? []).filter((t) => !t.removedAt).map((t) => [ms(t.start), ms(t.end)]);
      // Free/busy for the chosen people, or the best-ranked candidates (not those away the whole range).
      const ask = chosen ?? c.candidates.filter((x) => x.away.length < dates.length).slice(0, MAX_CHECKED).map((x) => x.email);
      if (!ask.length) return { ok: true, data: { slots: [], checked: 0, problems: [...problems, "Nobody to check"] } satisfies SuggestData };
      const startIso = Temporal.Instant.fromEpochMilliseconds(Math.min(...windows.map((w) => w.start))).toString();
      const endIso = Temporal.Instant.fromEpochMilliseconds(Math.max(...windows.map((w) => w.end))).toString();
      let availability: Availability[];
      try {
        availability = await ol.schedule.schedule(ask, startIso, endIso, tz);
      } catch (e) {
        if (e instanceof NetworkError) return bad("Outlook unreachable, so free/busy can't be checked", 503);
        return bad("Outlook didn't return free/busy. Try again, or reconnect Outlook in Settings > Connections", 502);
      }
      for (const a of availability) if (a.problem) problems.push(`${c.candidates.find((x) => x.email === a.email)?.name ?? a.email}: ${a.problem}`);
      // My focus blocks for this client in the range: slots inside them rank first (step 13.5).
      const focus: [number, number][] = [];
      for (const w of weeks) {
        const wk = ctx.blocks ? await ctx.blocks(cfg, w).catch(() => null) : null;
        for (const d of wk?.days ?? []) for (const sl of [d.am, d.pm, d.eve]) if (sl && dates.includes(d.date) && sl.focus[0]?.clientKey === clientKey) for (const win of sl.windows) focus.push([ms(win.start), ms(win.end)]);
      }
      const slots = suggestSlots({ minutes: o.minutes, myWindows: windows, myBusy, myBoxes, focus, candidates: c.candidates.filter((x) => ask.includes(x.email)), availability, chosen, now: Temporal.Instant.from(ctx.now()).epochMilliseconds, tz });
      return { ok: true, data: { slots, checked: availability.length, problems } satisfies SuggestData };
    }
    case "collab.preview_invite": {
      const o = fields(input, ["clientKey", "title", "start", "end", "people"], ["itemId", "pickId", "timeboxId", "url", "note", "teams"]);
      const clientKey = text(o.clientKey, "clientKey", 100);
      const title = text(o.title, "title", 200);
      const people = emails(o.people, MAX_INVITED);
      const note = optText(o.note, "note", 500);
      if (o.teams !== undefined && typeof o.teams !== "boolean") throw new Invalid("teams must be true or false");
      const teams = typeof o.teams === "boolean" ? o.teams : cfg.collab.teams;
      let start: string, end: string;
      try {
        start = Temporal.Instant.from(String(o.start)).toString();
        end = Temporal.Instant.from(String(o.end)).toString();
      } catch {
        throw new Invalid("start and end must be ISO times with offset");
      }
      const minutes = Temporal.Instant.from(start).until(Temporal.Instant.from(end)).total("minutes");
      if (minutes < 15 || minutes > 120) throw new Invalid("A help session is 15 minutes to 2 hours");
      if (Temporal.Instant.compare(Temporal.Instant.from(start), Temporal.Instant.from(ctx.now())) < 0) throw new Invalid("That time has passed");
      const domains = inviteDomains(cfg);
      if (people.some((e) => !domainAllowed(e, domains))) return bad("Invites go only to Cooptimize addresses", 422);
      // Teammates from the list, or me (a test invite to myself).
      const date = Temporal.Instant.from(start).toZonedDateTimeISO(tz).toPlainDate().toString();
      const me = cfg.dataverse.myEmail.toLowerCase();
      const others = people.filter((e) => e !== me);
      let named: { name: string; email: string }[] = people.filter((e) => e === me).map((email) => ({ name: "You", email }));
      if (others.length) {
        const c = await candidatesFor(ctx, cfg, clientKey, date, date);
        if ("refuse" in c) return bad(c.refuse, c.status);
        const byEmail = new Map(c.candidates.map((x) => [x.email, x]));
        if (others.some((e) => !byEmail.has(e))) return bad("Pick people from the list (Cooptimize staff only)", 422);
        named = [...others.map((e) => ({ name: byEmail.get(e)!.name, email: e })), ...named];
      }
      const ol = cfg.outlook ? ctx.outlook(cfg) : null;
      if (!ol?.write) return bad("Outlook isn't set up", 409);
      const access = await ol.write.access();
      if (access.status !== "write") return bad(access.status === "unavailable" ? access.message : "FocusTime can't send invites yet. Reconnect Outlook in Settings > Connections and allow calendar changes.", 409);
      const clientName = cfg.clientSettings[clientKey]?.name ?? clientKey;
      const url = devopsUrl(o.url);
      const f = inviteFields({ clientName, itemTitle: title, url, note, start, end, people: named, teams });
      const meta: InviteMeta = { clientKey, itemId: optId(o.itemId, "itemId"), pickId: optId(o.pickId, "pickId"), timeboxId: optId(o.timeboxId, "timeboxId"), title, url, note };
      const preview = await hold(ol.write, { kind: "invite", uid: `inv-${crypto.randomUUID()}`, op: "create", eventId: null, before: null, after: f, localBefore: null, localAfter: null, undoOf: null, auto: false, invite: meta }, tz);
      return { ok: true, data: { preview } };
    }
  }
}
