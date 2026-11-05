// SW-1: sending work to someone's week, client priorities, the client team view and Ask <lead> to look. The shared
// records are app tables (store/team-store.ts); a person's own week only changes through their own plan store (Accept
// and Add to my week call addWeekItem there, nothing else).
//
// Who (D630 to D641), checked here on the server for every call, per client:
//   on a client   an Account Worker on it (people_clients) or one of its client leads, and a Cooptimizer
//                 (cooptimizers(): no guests, no automation accounts, nobody outside the Cooptimize domains)
//   Suggested     anyone on the client, to anyone on the client who is on FocusTime
//   Must          that client's leads only (isClientLead): the one place a level is a permission, and only the label
//   priorities    flagged and unflagged by that client's leads; seen by everyone on the client
//   Team view     commitments only (week_commitments, published on commit), sends, priorities; never picks, day
//                 plans, focus, notes, estimates or hours
// DevOps stays read-only here. "Ask them to take it in DevOps" only makes the recipient's Accept offer PV-1's
// assign_to_me pre-ticked; that write runs from the UI through the write framework (preview, read back, undo).
import type { AppConfig } from "../config/schema.ts";
import { isOpen } from "../plan/process.ts";
import { isConflict, OPEN_STATES, sendRefusal, sendWeeks, shownState, stateWords, todayLine, toldOf } from "../plan/sends.ts";
import type { Levels } from "../plan/levels.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import type { PersonClient } from "../store/admin-store.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { LookAsk, Person, Priority, Send, TeamStore } from "../store/team-store.ts";
import type { CommitClient, CommitData, PickerPersonView, SendView, TeamClient, TeamData, TeamPerson } from "../plan/team-types.ts";

export type { CommitClient, CommitData, LookView, PickerPersonView, PriorityView, SendView, TeamClient, TeamData, TeamPerson } from "../plan/team-types.ts";
import { mondayOf } from "../week/dates.ts";
import type { IsoDate, Week } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import type { OrgRuntime } from "./org.ts";
import type { ActionResponse } from "./types.ts";

export const TEAM_ACTIONS = [
  "send.people", "send.create", "send.cancel", "send.accept", "send.pass", "send.cant", "send.withdraw", "send.today",
  "team.commit", "team.view", "priority.flag", "priority.unflag", "priority.add_to_week", "look.ask", "look.reply",
] as const;
export type TeamAction = (typeof TEAM_ACTIONS)[number];

export type TeamContext = {
  plan: PlanStore | undefined;
  team: TeamStore | undefined;
  config: () => Promise<AppConfig | null>;
  org: OrgRuntime | undefined;
  /** The signed-in person's id (Entra object id), or null. */
  me: () => Promise<string | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "itemStates" | "stateChanges">;
  /** The week's blocks from focus patterns and standing blocks (Accept and schedule opens the client's first one). */
  blocks: (cfg: AppConfig, weekStart: IsoDate) => Promise<Week>;
  /** Whether a person has signed in to FocusTime (can receive). Absent: their entry has a sign-in. */
  onFocusTime?: (personId: string) => boolean;
  now: () => string;
};

class Invalid extends Error {}
const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
type Obj = Record<string, unknown>;
const low = (s: string) => s.trim().toLowerCase();

function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
function monday(v: unknown): IsoDate {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid("weekStart must be YYYY-MM-DD");
  let d: Temporal.PlainDate;
  try {
    d = Temporal.PlainDate.from(v, { overflow: "reject" });
  } catch {
    throw new Invalid("weekStart must be a real date");
  }
  if (d.dayOfWeek !== 1) throw new Invalid("weekStart must be a Monday");
  return d.toString();
}
const posId = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
};
const text = (v: unknown, name: string, max: number): string => {
  if (typeof v !== "string" || !v.trim()) throw new Invalid(`${name} must be text`);
  if (v.length > max) throw new Invalid(`${name} is at most ${max} characters`);
  return v.trim();
};
const optText = (v: unknown, name: string, max: number): string | null => (v === undefined || v === null || (typeof v === "string" && !v.trim()) ? null : text(v, name, max));
const key = (v: unknown) => text(v, "clientKey", 100);
const personId = (v: unknown) => text(v, "toId", 100).toLowerCase();

/** Who is who, read once per call from the org runtime (people, Account Workers, leads, clients). */
type Roster = {
  me: string | null;
  meName: string;
  isClient: (k: string) => boolean;
  isCoop: (id: string) => boolean;
  isLead: (id: string, k: string) => boolean;
  onClient: (id: string, k: string) => boolean;
  leads: (k: string) => string[];
  /** Everyone on a client: Account Workers and leads, Cooptimizers only, one id each. */
  members: (k: string) => string[];
  /** Every client I'm on (a worker or a lead), clients only. */
  myClients: () => string[];
  name: (id: string) => string;
  email: (id: string) => string | null;
  onFocusTime: (id: string) => boolean;
  canonical: (id: string) => string;
};

async function rosterOf(ctx: TeamContext): Promise<Roster> {
  const me0 = await ctx.me();
  const org = ctx.org;
  let lv: Levels | null = null;
  let workers: PersonClient[] = [];
  let names = new Map<string, string>();
  // CV-3b: clients only via clientAccounts(); without it (no runtime, or it can't be read) nothing is a client.
  let isClient: (k: string) => boolean = () => false;
  if (org) {
    const [l, pc, dir, accounts] = await Promise.all([org.levels().catch(() => null), org.store.peopleClients().catch(() => []), org.store.directory().catch(() => []), org.clientAccounts().catch(() => null)]);
    lv = l;
    workers = pc;
    names = new Map(dir.map((d) => [low(d.personId), d.name]));
    if (accounts) isClient = (k) => accounts.isClient(k);
  }
  const canonical = (id: string) => (lv ? lv.canonical(id) : low(id));
  const entry = (id: string) => lv?.people.entry(id) ?? null;
  const isCoop = (id: string) => (lv ? lv.people.isCooptimizer(id) : true);
  const workerSet = new Map<string, Set<string>>();
  for (const w of workers) if (w.worker !== false) (workerSet.get(w.clientKey) ?? workerSet.set(w.clientKey, new Set()).get(w.clientKey)!).add(canonical(w.personId));
  const leads = (k: string) => (lv && isClient(k) ? lv.clientLeads(k).map((l) => l.personId) : []);
  const isLead = (id: string, k: string) => !!lv && isClient(k) && lv.isClientLead(id, k);
  const onClient = (id: string, k: string) => isClient(k) && isCoop(id) && (workerSet.get(k)?.has(canonical(id)) || isLead(id, k));
  const members = (k: string) => (isClient(k) ? [...new Set([...(workerSet.get(k) ?? []), ...leads(k)])].filter(isCoop).sort() : []);
  const name = (id: string) => {
    const e = entry(id);
    return (e?.dir ? names.get(low(e.dir.personId)) : undefined) ?? names.get(canonical(id)) ?? e?.signedIn?.email ?? "A teammate";
  };
  const me = me0 ? canonical(me0) : null;
  return {
    me,
    meName: me ? name(me) : "",
    isClient,
    isCoop,
    isLead,
    onClient: (id, k) => !!onClient(id, k),
    leads,
    members,
    myClients: () => {
      if (!me) return [];
      const ks = new Set<string>();
      for (const [k, s] of workerSet) if (s.has(me)) ks.add(k);
      if (lv) for (const l of lv.leadsOf(me)) ks.add(l.clientKey);
      return [...ks].filter((k) => isClient(k) && isCoop(me)).sort();
    },
    name,
    email: (id) => (entry(id)?.dir?.email ?? entry(id)?.signedIn?.email ?? null)?.toLowerCase() ?? null,
    onFocusTime: (id) => (ctx.onFocusTime ? ctx.onFocusTime(canonical(id)) : !!entry(id)?.signedIn),
    canonical,
  };
}

const ref = (k: string, cfg: AppConfig): ClientRef => ({ clientKey: k, clientName: cfg.clientSettings[k]?.name ?? k });
const keyOf = (k: string, id: number) => `${k}\u0000${id}`;

/** Items DevOps has resolved, closed or removed, by id ("client\u0000id"); unknown ones are left out. */
async function resolvedOf(ctx: TeamContext, cfg: AppConfig, items: readonly { clientKey: string; itemId: number }[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids: Record<string, number[]> = {};
  for (const i of items) if (!(ids[i.clientKey] ??= []).includes(i.itemId)) ids[i.clientKey]!.push(i.itemId);
  const keys = Object.keys(ids);
  const read = ctx.devops(cfg).itemStates;
  if (!keys.length || !read) return out;
  const results = await read(keys.map((k) => ref(k, cfg)), ids).catch(() => []);
  for (const r of results) for (const [id, category] of Object.entries(r.states ?? {})) if (!isOpen(category)) out.add(keyOf(r.clientKey, Number(id)));
  return out;
}

function viewOf(s: Send, me: string | null, resolved: ReadonlySet<string>, thisWeek: IsoDate): SendView {
  const shown = shownState(s, { resolved: resolved.has(keyOf(s.clientKey, s.itemId)), thisWeek });
  const role = me === s.to.id ? "recipient" : me === s.from.id ? "sender" : me && s.by?.id === me ? "passer" : "teammate";
  return {
    ...s,
    shown,
    words: stateWords(s, shown),
    conflict: isConflict(s, shown),
    role,
    canCancel: role === "sender" && (shown === "waiting" || shown === "passed"),
    canWithdraw: role === "sender" && isConflict(s, shown),
    canAnswer: role === "recipient" && (shown === "waiting" || shown === "passed" || isConflict(s, shown)),
  };
}

/** Settles sends whose item DevOps resolved as Done (stored, so they close for everyone). */
async function settle(team: TeamStore, sends: Send[], resolved: ReadonlySet<string>): Promise<Send[]> {
  const out: Send[] = [];
  for (const s of sends) out.push(OPEN_STATES.has(s.state) && resolved.has(keyOf(s.clientKey, s.itemId)) ? await team.setSend(s.id, { state: "done" }) : s);
  return out;
}

/** Drops priorities whose feature DevOps resolved (they leave the list for good). */
async function livePriorities(team: TeamStore, list: Priority[], resolved: ReadonlySet<string>): Promise<Priority[]> {
  const out: Priority[] = [];
  for (const p of list) {
    if (resolved.has(keyOf(p.clientKey, p.itemId))) await team.unflag(p.clientKey, p.itemId);
    else out.push(p);
  }
  return out;
}

/** SW-1: publishes what I committed for a week (commit and re-commit), for the Team view. Commitments only. */
export async function publishWeek(ctx: Pick<TeamContext, "plan" | "team" | "me" | "now" | "org">, weekStart: IsoDate): Promise<void> {
  const { plan, team } = ctx;
  const me = await ctx.me();
  if (!plan || !team || !me) return;
  const lv = ctx.org ? await ctx.org.levels().catch(() => null) : null;
  const id = lv ? lv.canonical(me) : low(me);
  // CV-3b: only clients (clientAccounts()) are published; a prospect on my week stays mine.
  const accounts = ctx.org ? await ctx.org.clientAccounts().catch(() => null) : null;
  const isClient = (k: string) => !!accounts?.isClient(k);
  const [week, watches] = await Promise.all([plan.weekPlan(weekStart), plan.weekWatches(weekStart)]);
  const rows = [
    ...week.features.filter((f) => f.level === "feature" && f.itemId > 0).map((f) => ({ clientKey: f.clientKey, itemId: f.itemId, title: f.title, itemType: f.itemType, url: f.url, tier: f.tier, watching: false })),
    ...watches.filter((w) => !week.features.some((f) => f.clientKey === w.clientKey && f.itemId === w.itemId)).map((w) => ({ clientKey: w.clientKey, itemId: w.itemId, title: w.title, itemType: w.itemType, url: w.url, tier: "nice" as const, watching: true })),
  ];
  await team.publish(id, weekStart, rows.filter((x) => isClient(x.clientKey)), ctx.now());
}

/** SW-1: an accepted send for an item I just pinned or planned into a day shows the sender "Scheduled". */
export async function markScheduled(ctx: Pick<TeamContext, "team" | "me" | "org">, clientKey: string, itemId: number): Promise<void> {
  const me = await ctx.me();
  if (!ctx.team || !me) return;
  const lv = ctx.org ? await ctx.org.levels().catch(() => null) : null;
  for (const s of await ctx.team.sendsFor(lv ? lv.canonical(me) : low(me), clientKey, itemId)) if (s.state === "accepted") await ctx.team.setSend(s.id, { state: "scheduled" });
}

/** The first block of a client on or after today in a week, for Accept and schedule. */
function firstBlock(week: Week, clientKey: string, today: IsoDate): { date: IsoDate; half: "AM" | "PM" } | null {
  for (const d of week.days) {
    if (d.date < today) continue;
    for (const [slot, half] of [[d.am, "AM"], [d.pm, "PM"]] as const) if (!slot.pto && slot.focus[0]?.clientKey === clientKey) return { date: d.date, half };
  }
  return null;
}

export async function teamAction(ctx: TeamContext, action: TeamAction, input: unknown): Promise<ActionResponse> {
  const { plan, team } = ctx;
  if (!plan) return bad("The local plan store isn't available", 503);
  if (!team) return bad("Sending work isn't available here", 503);
  try {
    const cfg = await ctx.config();
    if (!cfg) return bad("Fix the config first", 409);
    const tz = userZone(cfg);
    const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz).toPlainDate().toString();
    const thisWeek = mondayOf(today);
    const weeks = sendWeeks(thisWeek);
    const r = await rosterOf(ctx);
    const me = r.me;
    if (!me) return bad("Sign in first", 401);
    const clientName = (k: string) => cfg.clientSettings[k]?.name ?? k;
    const person = (id: string): Person => ({ id: r.canonical(id), name: r.name(id) });
    const mine = async (id: number) => {
      const s = await team.send(id);
      if (!s) throw new PlanError("No such send");
      return s;
    };
    const recipientOk = (toId: string, k: string) => sendRefusal("suggested", { onClient: true, lead: true, cooptimizer: true }, { onClient: r.onClient(toId, k), lead: r.isLead(toId, k), cooptimizer: r.isCoop(toId), onFocusTime: r.onFocusTime(toId), self: r.canonical(toId) === me });

    switch (action) {
      case "send.people": {
        const o = fields(input, ["clientKey"]);
        const k = key(o.clientKey);
        if (!r.onClient(me, k)) return { ok: true, data: { people: [], canSend: false, canMust: false, why: "Only people on this client send its work" } };
        const people: PickerPersonView[] = r.members(k).filter((id) => id !== me).map((id) => ({ id, name: r.name(id), email: r.email(id), lead: r.isLead(id, k), onFocusTime: r.onFocusTime(id) })).sort((a, b) => a.name.localeCompare(b.name));
        return { ok: true, data: { people, canSend: true, canMust: r.isLead(me, k), why: null } };
      }
      case "send.create": {
        const o = fields(input, ["clientKey", "itemId", "level", "title", "weekStart", "kind", "toId"], ["itemType", "url", "parentId", "note", "askTake"]);
        const k = key(o.clientKey);
        const weekStart = monday(o.weekStart);
        if (!weeks.includes(weekStart)) throw new Invalid("A send is for this week or next");
        if (o.kind !== "suggested" && o.kind !== "must") throw new Invalid("kind must be suggested or must");
        if (o.level !== "feature" && o.level !== "story") throw new Invalid("level must be feature or story");
        const toId = personId(o.toId);
        const refusal = sendRefusal(o.kind, { onClient: r.onClient(me, k), lead: r.isLead(me, k), cooptimizer: r.isCoop(me) }, { onClient: r.onClient(toId, k), lead: r.isLead(toId, k), cooptimizer: r.isCoop(toId), onFocusTime: r.onFocusTime(toId), self: r.canonical(toId) === me });
        if (refusal) return bad(refusal, 403);
        const itemId = posId(o.itemId, "itemId");
        const to = person(toId);
        if ((await team.sendsOf(to.id, [weekStart])).some((s) => s.to.id === to.id && s.clientKey === k && s.itemId === itemId && OPEN_STATES.has(s.state))) return bad(`Already sent to ${to.name} for that week`, 409);
        const s = await team.addSend({
          clientKey: k,
          itemId,
          level: o.level,
          title: text(o.title, "title", 400),
          itemType: optText(o.itemType, "itemType", 100),
          url: optText(o.url, "url", 1000),
          parentId: o.parentId === undefined || o.parentId === null ? null : posId(o.parentId, "parentId"),
          weekStart,
          kind: o.kind,
          note: optText(o.note, "note", 500),
          askTake: o.askTake === true,
          from: { id: me, name: r.meName },
          to,
        });
        return { ok: true, data: { send: viewOf(s, me, new Set(), thisWeek) } };
      }
      case "send.cancel":
      case "send.withdraw": {
        const o = fields(input, ["id"]);
        const s = await mine(posId(o.id, "id"));
        const v = viewOf(s, me, new Set(), thisWeek);
        if (action === "send.cancel" ? !v.canCancel : !v.canWithdraw) return bad(action === "send.cancel" ? "Only the sender cancels, and only while it's waiting" : "Only the sender withdraws a Must that couldn't be taken", 409);
        const n = await team.setSend(s.id, { state: action === "send.cancel" ? "cancelled" : "withdrawn" });
        return { ok: true, data: { send: viewOf(n, me, new Set(), thisWeek) } };
      }
      case "send.accept": {
        const o = fields(input, ["id"], ["schedule"]);
        const s = await mine(posId(o.id, "id"));
        const v = viewOf(s, me, new Set(), thisWeek);
        if (!v.canAnswer) return bad(v.role === "recipient" ? "That one is settled already" : "Only the person it was sent to answers it", 409);
        if (s.weekStart < thisWeek) return bad("That week is over", 409);
        await plan.addWeekItem({ weekStart: s.weekStart, clientKey: s.clientKey, itemId: s.itemId, title: s.title, itemType: s.itemType, url: s.url, level: s.level, tier: "must", ...(s.level === "story" && s.parentId ? { parentId: s.parentId } : {}) });
        const n = await team.setSend(s.id, { state: "accepted", reason: null });
        // A committed week publishes again so the Team view has it.
        if ((await plan.weekPlan(s.weekStart)).committedAt) await publishWeek(ctx, s.weekStart);
        const open = o.schedule === true ? firstBlock(await ctx.blocks(cfg, s.weekStart).catch(() => ({ days: [] }) as unknown as Week), s.clientKey, today) : null;
        return { ok: true, data: { send: viewOf(n, me, new Set(), thisWeek), open, assign: { clientKey: s.clientKey, itemId: s.itemId, ticked: s.askTake } } };
      }
      case "send.pass": {
        const o = fields(input, ["id", "toId"]);
        const s = await mine(posId(o.id, "id"));
        const v = viewOf(s, me, new Set(), thisWeek);
        // The recipient passes it on; the sender can also pass a Must that couldn't be taken.
        if (!v.canAnswer && !v.canWithdraw) return bad("Only the person it was sent to passes it on", 409);
        const toId = personId(o.toId);
        const refusal = recipientOk(toId, s.clientKey);
        if (refusal) return bad(refusal, 403);
        const to = person(toId);
        if (to.id === s.to.id) return bad(`It's with ${to.name} already`, 409);
        const n = await team.setSend(s.id, { state: "waiting", reason: null, to, by: { id: me, name: r.meName } });
        return { ok: true, data: { send: viewOf(n, me, new Set(), thisWeek) } };
      }
      case "send.cant": {
        const o = fields(input, ["id", "reason"]);
        const s = await mine(posId(o.id, "id"));
        const v = viewOf(s, me, new Set(), thisWeek);
        if (!v.canAnswer || v.conflict) return bad("Only the person it was sent to answers it, once", 409);
        const reason = typeof o.reason === "string" ? o.reason.trim() : "";
        if (!reason) return bad("Say why, in a few words", 400);
        const n = await team.setSend(s.id, { state: "cant", reason: reason.slice(0, 300) });
        return { ok: true, data: { send: viewOf(n, me, new Set(), thisWeek), told: toldOf(s, "cant", r.leads(s.clientKey)) } };
      }
      case "send.today": {
        fields(input ?? {}, []);
        const list = (await team.sendsOf(me, weeks)).filter((s) => s.to.id === me && s.state === "waiting" && r.isClient(s.clientKey));
        return { ok: true, data: { line: todayLine(list), count: list.length, weekStart: list[0]?.weekStart ?? thisWeek } };
      }
      case "team.commit": {
        const o = fields(input ?? {}, [], ["weekStart"]);
        const weekStart = o.weekStart === undefined ? weeks[1] : monday(o.weekStart);
        const raw = await team.sendsOf(me, [weekStart]);
        const myClients = r.myClients();
        const pri0 = await team.priorities(myClients);
        const resolved = await resolvedOf(ctx, cfg, [...raw, ...pri0]);
        const sends = await settle(team, raw, resolved);
        const pri = await livePriorities(team, pri0, resolved);
        const onWeek = new Set((await plan.weekPlan(weekStart)).features.map((f) => keyOf(f.clientKey, f.itemId)));
        const looks = (await team.looksOf(me, Temporal.PlainDate.from(weekStart).subtract({ days: 14 }).toZonedDateTime({ timeZone: tz }).toInstant().toString())).filter((l) => l.weekStart === weekStart && l.from.id === me);
        const keys = [...new Set([...myClients, ...sends.map((s) => s.clientKey)])].filter((k) => r.isClient(k)).sort((a, b) => clientName(a).localeCompare(clientName(b)));
        const clients: CommitClient[] = keys.map((k) => {
          const views = sends.filter((s) => s.clientKey === k).map((s) => viewOf(s, me, resolved, thisWeek));
          return {
            clientKey: k,
            clientName: clientName(k),
            isLead: r.isLead(me, k),
            leads: r.leads(k).filter((id) => id !== me).map(person),
            incoming: views.filter((v) => v.role === "recipient" && (v.canAnswer || v.conflict)),
            sent: views.filter((v) => v.role === "sender" || v.role === "passer"),
            priorities: pri.filter((p) => p.clientKey === k).map((p) => ({ ...p, onMyWeek: onWeek.has(keyOf(k, p.itemId)), canUnflag: r.isLead(me, k) })),
            looks: looks.filter((l) => l.clientKey === k).map((l) => ({ ...l, role: "asker" as const })),
          };
        });
        return { ok: true, data: { weekStart, clients } satisfies CommitData };
      }
      case "team.view": {
        const o = fields(input ?? {}, [], ["weekStart"]);
        const weekStart = o.weekStart === undefined ? thisWeek : monday(o.weekStart);
        const keys = r.myClients();
        const [commits, committed, raw, pri0] = await Promise.all([team.commitments(keys, weekStart), team.committedPeople(weekStart), team.sendsOn(keys, weekStart), team.priorities(keys)]);
        // keys are clients only (myClients()); looks below are filtered the same way.
        const resolved = await resolvedOf(ctx, cfg, [...raw, ...pri0, ...commits.filter((c) => c.watching)]);
        const sends = await settle(team, raw, resolved);
        const pri = await livePriorities(team, pri0, resolved);
        const onWeek = new Set((await plan.weekPlan(weekStart)).features.map((f) => keyOf(f.clientKey, f.itemId)));
        const since = Temporal.PlainDate.from(weekStart).toZonedDateTime({ timeZone: tz }).toInstant().toString();
        const looks = (await team.looksOf(me, since)).filter((l) => l.weekStart === weekStart && r.isClient(l.clientKey));
        const clients: TeamClient[] = [];
        for (const k of keys.sort((a, b) => clientName(a).localeCompare(clientName(b)))) {
          const watched = commits.filter((c) => c.clientKey === k && c.watching);
          const moved = watched.length ? await ctx.devops(cfg).stateChanges?.(k, since).catch(() => null) : null;
          const movedIds = moved?.known ? new Set(moved.itemIds) : null;
          const people: TeamPerson[] = r.members(k).map((id) => {
            const mineRows = commits.filter((c) => c.personId === id && c.clientKey === k);
            const state = committed.has(id) ? "committed" : r.onFocusTime(id) ? "draft" : "not_on_focustime";
            return {
              id,
              name: r.name(id),
              email: r.email(id),
              lead: r.isLead(id, k),
              you: id === me,
              state,
              // Only what was committed: the feature, its type, must or nice to have. Nothing else of their week.
              features: state === "committed" ? mineRows.filter((c) => !c.watching).map((c) => ({ itemId: c.itemId, title: c.title, itemType: c.itemType, url: c.url, tier: c.tier })) : [],
              watching: state === "committed" ? mineRows.filter((c) => c.watching && !resolved.has(keyOf(k, c.itemId))).map((c) => ({ itemId: c.itemId, title: c.title, itemType: c.itemType, url: c.url, moved: movedIds ? movedIds.has(c.itemId) : null })) : [],
            };
          });
          people.sort((a, b) => Number(b.you) - Number(a.you) || Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name));
          clients.push({
            clientKey: k,
            clientName: clientName(k),
            people,
            sends: sends.filter((s) => s.clientKey === k && s.state !== "cancelled").map((s) => viewOf(s, me, resolved, thisWeek)),
            priorities: pri.filter((p) => p.clientKey === k).map((p) => ({ ...p, onMyWeek: onWeek.has(keyOf(k, p.itemId)), canUnflag: r.isLead(me, k) })),
            looks: looks.filter((l) => l.clientKey === k).map((l) => ({ ...l, role: l.to.id === me ? ("lead" as const) : ("asker" as const) })),
          });
        }
        return { ok: true, data: { weekStart, thisWeek, clients } satisfies TeamData };
      }
      case "priority.flag": {
        const o = fields(input, ["clientKey", "itemId", "title"], ["itemType", "url", "note"]);
        const k = key(o.clientKey);
        if (!r.isLead(me, k)) return bad("Only this client's leads flag its priorities", 403);
        await team.flag({ clientKey: k, itemId: posId(o.itemId, "itemId"), title: text(o.title, "title", 400), itemType: optText(o.itemType, "itemType", 100), url: optText(o.url, "url", 1000), note: optText(o.note, "note", 500), flaggedBy: { id: me, name: r.meName } }, ctx.now());
        return { ok: true, data: { priorities: await team.priorities([k]) } };
      }
      case "priority.unflag": {
        const o = fields(input, ["clientKey", "itemId"]);
        const k = key(o.clientKey);
        if (!r.isLead(me, k)) return bad("Only this client's leads change its priorities", 403);
        await team.unflag(k, posId(o.itemId, "itemId"));
        return { ok: true, data: { priorities: await team.priorities([k]) } };
      }
      case "priority.add_to_week": {
        const o = fields(input, ["clientKey", "itemId", "weekStart"]);
        const k = key(o.clientKey);
        const weekStart = monday(o.weekStart);
        if (weekStart < thisWeek) return bad("That week is over", 409);
        if (!r.onClient(me, k)) return bad("Only people on this client", 403);
        const p = (await team.priorities([k])).find((x) => x.itemId === posId(o.itemId, "itemId"));
        if (!p) return bad("That isn't a client priority any more", 404);
        const f = await plan.addWeekItem({ weekStart, clientKey: k, itemId: p.itemId, title: p.title, itemType: p.itemType, url: p.url, level: "feature", tier: "must" });
        if ((await plan.weekPlan(weekStart)).committedAt) await publishWeek(ctx, weekStart);
        return { ok: true, data: { feature: f } };
      }
      case "look.ask": {
        const o = fields(input, ["clientKey", "weekStart", "toId"], ["note"]);
        const k = key(o.clientKey);
        const weekStart = monday(o.weekStart);
        if (!r.onClient(me, k)) return bad("Only people on this client", 403);
        const toId = personId(o.toId);
        if (!r.isLead(toId, k)) return bad("Ask one of this client's leads", 403);
        if (r.canonical(toId) === me) return bad("That's you", 400);
        if (!r.onFocusTime(toId)) return bad("They aren't on FocusTime yet", 409);
        const a = await team.addLook({ clientKey: k, weekStart, from: { id: me, name: r.meName }, to: person(toId), note: optText(o.note, "note", 500) }, ctx.now());
        return { ok: true, data: { look: a } };
      }
      case "look.reply": {
        const o = fields(input, ["id", "reply"]);
        const a = await team.look(posId(o.id, "id"));
        if (!a || a.to.id !== me) return bad("Only the lead it was asked of replies", 403);
        const n = await team.reply(a.id, text(o.reply, "reply", 500), ctx.now());
        return { ok: true, data: { look: n } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}

/** SW-1: what one person's scheduler pass tells them, once each (the notifier's own once-marks keep it to one). */
export type TeamNotice =
  | { kind: "sent_to_you"; send: Send }
  | { kind: "send_answered"; send: Send; words: string }
  | { kind: "send_cant_lead"; send: Send }
  | { kind: "look_ask"; look: LookAsk }
  | { kind: "look_reply"; look: LookAsk };

/** The notices due for a person now: sends to them, answers on sends of theirs, a Must's Can't on a client they lead, asks and replies. */
export async function teamNotices(ctx: Pick<TeamContext, "team" | "org" | "me">, thisWeek: IsoDate, since: string): Promise<TeamNotice[]> {
  const team = ctx.team;
  const me0 = await ctx.me();
  if (!team || !me0) return [];
  const lv = ctx.org ? await ctx.org.levels().catch(() => null) : null;
  if (lv && !lv.people.isCooptimizer(me0)) return [];
  const me = lv ? lv.canonical(me0) : low(me0);
  // CV-3b: notices for clients only (clientAccounts()).
  const accounts = ctx.org ? await ctx.org.clientAccounts().catch(() => null) : null;
  const isClient = (k: string) => !!accounts?.isClient(k);
  const out: TeamNotice[] = [];
  const weeks = sendWeeks(thisWeek);
  for (const s of await team.sendsOf(me, weeks)) {
    if (s.updatedAt < since || !isClient(s.clientKey)) continue;
    if (s.to.id === me && s.state === "waiting") out.push({ kind: "sent_to_you", send: s });
    else if (s.from.id === me && (s.state === "accepted" || s.state === "scheduled" || s.state === "cant" || (s.state === "waiting" && s.by && s.by.id !== me))) {
      const shown = shownState(s, { resolved: false, thisWeek });
      out.push({ kind: "send_answered", send: s, words: s.state === "accepted" ? `${s.to.name} accepted it` : s.state === "scheduled" ? `${s.to.name} scheduled it` : s.state === "cant" ? `${s.to.name} can't this week` : stateWords(s, shown) });
    }
  }
  if (lv) {
    for (const l of lv.leadsOf(me)) {
      if (!isClient(l.clientKey)) continue;
      for (const w of weeks) {
        for (const s of await team.sendsOn([l.clientKey], w)) {
          if (s.kind !== "must" || s.state !== "cant" || s.updatedAt < since) continue;
          if (toldOf(s, "cant", lv.clientLeads(l.clientKey).map((x) => x.personId)).leads.includes(me)) out.push({ kind: "send_cant_lead", send: s });
        }
      }
    }
  }
  for (const a of await team.looksOf(me, since)) {
    if (!isClient(a.clientKey)) continue;
    if (a.to.id === me && !a.reply) out.push({ kind: "look_ask", look: a });
    if (a.from.id === me && a.reply && a.repliedAt && a.repliedAt >= since) out.push({ kind: "look_reply", look: a });
  }
  return out;
}
