// AH-1: Ahead's one model (D653) and my change set (D657). ahead.load reads every client's items from the central
// DevOps store (all levels), my rights on each (D656), my pending changes reconciled against what DevOps has now (a
// conflict only when a field I'm changing changed there, D658), my kept half-days and FocusTime's own sizes as hints.
// Edits never write: ahead.stage keeps a change in the plan store; committing goes through the write framework
// (devops.preview / devops.confirm with kind "fields", actions/devops-write-actions.ts), one patch per item.
import type { AppConfig } from "../config/schema.ts";
import { KINDS, RANGES } from "../plan/ahead-view.ts";
import type { AheadGapKind, AheadRange } from "../plan/ahead-edit.ts";
import { byItem, canEdit, CHANGE_FIELDS, checkValue, conflictOf, sameValue, type ChangeField, type ChangeValue, type DayHalf, type EditRight, type StagedChange, type AheadFilters, type AheadOwner } from "../plan/ahead-edit.ts";
import { aboutText, hoursText, storyMinutes, unsizedText, type SizeScale } from "../plan/estimate.ts";
import { aheadWeeks, PLAN_WEEKS } from "../plan/ahead.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday, mondayOf } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import type { ActionResponse, AheadClient, AheadItem, AheadLoad } from "./types.ts";
import { GAP_KINDS, TOP_N, type GapKind } from "../plan/fixnext.ts";
import { bulkDecide, DEFAULT_AHEAD, type BulkOp } from "../plan/backlog.ts";
import { assignPeople, type AssignPerson } from "../plan/ahead-people.ts";
import { FIXED_KEY, fixedSince, liveSkips, readFixed, SKIPS_KEY } from "../plan/readiness.ts";

export const AHEAD_ACTIONS = ["ahead.load", "ahead.people", "ahead.stage", "ahead.stage_bulk", "ahead.unstage", "ahead.discard", "ahead.resolve", "ahead.filters", "ahead.set_filters", "ahead.skip", "ahead.unskip"] as const;
export type AheadAction = (typeof AHEAD_ACTIONS)[number];

export type AheadContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  /** The clients this person sees (followed, clients only via clientAccounts(), with DevOps), as Roadmap reads them. */
  clients: (cfg: AppConfig, weekStart: IsoDate, refresh: boolean) => Promise<ClientRef[]>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "aheadItems" | "lastChanges" | "projectPeople">;
  /** isClientLead over clientAccounts() for me (Internal like any client). */
  isLead: (clientKey: string) => Promise<boolean>;
  /** An admin flagged me as an automation account. */
  automation: () => Promise<boolean>;
  /** I can commit for this client (my write PAT is saved and the write framework is here). */
  canWrite: (clientKey: string) => Promise<boolean>;
  /** Whom I may assign on this client: its Account Workers who are Cooptimizers, and me (by email). */
  assignable: (clientKey: string, email: string) => Promise<boolean>;
  /** AH-5: the client's Cooptimizers (its Account Workers, with their own email), who is one, and my name. Missing: none. */
  people?: (clientKey: string) => Promise<{ cooptimizers: { email: string; name: string }[]; isCooptimizer: (email: string) => boolean; myName: string | null }>;
  now: () => string;
  /**
   * AH-3: client DevOps identities: every address that is me on a client, and who a DevOps email is (their FocusTime
   * name), with the address to write when I assign a person there (their client login when they have one). Missing:
   * only my own address counts and names show as DevOps has them.
   */
  identities?: () => Promise<AheadIdentities>;
  /** AH-3: Fix next's Rules: the top N of each backlog and each client's counted gaps. Missing: the built-ins. */
  fixRules?: () => Promise<{ topN: number; gaps: (clientKey: string) => GapKind[] }>;
};

export type AheadIdentities = {
  mine(clientKey: string): string[];
  personOf(clientKey: string, email: string): { id: string; name: string } | null;
  /** The address to write for this person on this client: a linked client login, else the one given. */
  writeAs(clientKey: string, email: string): string;
};

/** Ahead's items with assignees shown by their FocusTime name, and every address that is me on the client. */
export function withIdentities<C extends AheadClient>(c: C, ix: AheadIdentities | null): C & { mine: string[] } {
  const mine = [...new Set([c.me, ...(ix?.mine(c.clientKey) ?? [])].filter((e): e is string => !!e).map((e) => e.toLowerCase()))];
  if (!ix) return { ...c, mine };
  const items = c.items.map((i) => {
    const p = i.assignee?.email ? ix.personOf(c.clientKey, i.assignee.email) : null;
    return p && i.assignee ? { ...i, assignee: { ...i.assignee, name: p.name } } : i;
  });
  return { ...c, items, mine };
}

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
type Obj = Record<string, unknown>;
const obj = (v: unknown, allowed: string[]): Obj | null => {
  const o = v === undefined || v === null ? {} : v;
  if (typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => !allowed.includes(k))) return null;
  return o as Obj;
};
const isKey = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 100;
const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isField = (v: unknown): v is ChangeField => typeof v === "string" && (CHANGE_FIELDS as readonly string[]).includes(v);

/** What DevOps has now for a field of an item. */
export function currentValue(i: AheadItem, field: ChangeField): ChangeValue {
  if (field === "start") return i.start;
  if (field === "target") return i.target;
  if (field === "size") return i.size;
  if (field === "state") return i.state;
  return i.assignee?.email ? { email: i.assignee.email.toLowerCase(), name: i.assignee.name } : null;
}
/** Whether the item's type has the field in its process (assignee always; a state where the model lists the type's states). */
export const hasField = (c: Pick<AheadClient, "startFields" | "targetFields" | "sizeFields" | "states">, type: string, field: ChangeField): boolean =>
  field === "assignee" ? true : field === "state" ? (c.states?.[type]?.length ?? 0) > 0 : !!(field === "start" ? c.startFields : field === "target" ? c.targetFields : c.sizeFields)[type];

/** My rights on every item of a client. */
export function rightsOf(c: AheadClient & { mine?: readonly string[] }, me: { lead: boolean; automation: boolean }): Map<number, EditRight> {
  const byId = new Map(c.items.map((i) => [i.id, i]));
  const at = (i: AheadItem | undefined) => (i ? { assigneeEmail: i.assignee?.email ?? null, rung: i.rung } : null);
  return new Map(c.items.map((i) => [i.id, canEdit({ email: c.me, emails: c.mine ?? [], lead: me.lead, automation: me.automation }, at(i)!, at(i.parentId !== null ? byId.get(i.parentId) : undefined), c.clientName)]));
}

export async function aheadAction(ctx: AheadContext, action: AheadAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The plan store isn't available", 503);
  if (action === "ahead.filters") {
    if (!obj(input, [])) return bad("ahead.filters takes no input");
    return { ok: true, data: { filters: (await plan.getState<unknown>(FILTERS_KEY)) ?? null } };
  }
  if (action === "ahead.set_filters") {
    const o = obj(input, ["filters"]);
    const f = o ? checkFilters(o.filters) : null;
    if (!f) return bad("ahead.set_filters takes { filters: { owner?, clients?, epic?, gaps?, from?, to?, q?, states? } }");
    await plan.setState(FILTERS_KEY, f);
    return { ok: true, data: { filters: f } };
  }
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const today = localToday(ctx.now(), userZone(cfg));
  const automation = await ctx.automation().catch(() => false);

  // AH-7: Readiness's Skip, remembered in my plan store for 2 weeks (so it follows me to another device).
  if (action === "ahead.skip" || action === "ahead.unskip") {
    const o = obj(input, ["clientKey", "itemId"]);
    if (!o || !isKey(o.clientKey) || !isId(o.itemId)) return bad(`${action} takes { clientKey, itemId }`);
    const skips = liveSkips(await plan.getState<unknown>(SKIPS_KEY), today);
    const key = `${o.clientKey}:${o.itemId}`;
    if (action === "ahead.skip") skips[key] = today;
    else delete skips[key];
    await plan.setState(SKIPS_KEY, skips);
    return { ok: true, data: { skips } };
  }

  let held: Promise<AheadIdentities | null> | null = null;
  const idx = () => (held ??= ctx.identities ? ctx.identities().catch(() => null) : Promise.resolve(null));
  /** One client's items (the store read is cheap). */
  const oneClient = async (clientKey: string): Promise<(AheadClient & { mine: string[] }) | null> => {
    const ref = (await ctx.clients(cfg, mondayOf(today), false)).find((c) => c.clientKey === clientKey);
    if (!ref) return null;
    // AH-2: any item of the project (an item shown with "Show the whole project" can be changed too; rights still decide).
    const [c] = await ctx.devops(cfg).aheadItems!([ref], { whole: true });
    return c ? withIdentities(c, await idx()) : null;
  };

  if (action === "ahead.load") {
    const o = obj(input, ["refresh", "lastChanges", "keep"]);
    const keepOk = o?.keep === undefined || (Array.isArray(o.keep) && o.keep.length <= 50 && o.keep.every((k) => !!k && typeof k === "object" && isKey((k as { clientKey?: unknown }).clientKey) && Number.isSafeInteger((k as { id?: unknown }).id)));
    if (!o || !keepOk || (o.refresh !== undefined && typeof o.refresh !== "boolean") || (o.lastChanges !== undefined && typeof o.lastChanges !== "boolean")) return bad("ahead.load takes { refresh?, lastChanges?, keep? }");
    const refs = await ctx.clients(cfg, mondayOf(today), o.refresh === true);
    const read = ctx.devops(cfg).aheadItems;
    // AH-2: "Show the whole project" is remembered with my filters; without it, only Cooptimize's scope (and my items).
    const whole = (await plan.getState<AheadFilters>(FILTERS_KEY))?.whole === true;
    const clients = read && refs.length ? await read(refs, { ...(o.refresh === true ? { refresh: true } : {}), ...(whole ? { whole: true } : {}) }) : [];
    // QC-1: items I just created (this page asks for them) show even outside Cooptimize's scope, until I leave Ahead.
    // Only my own confirmed creates, from my write log; they come marked as outside the scope, as the whole project shows them.
    const keep = ((o.keep as { clientKey: string; id: number }[] | undefined) ?? []).filter((k) => clients.some((c) => c.clientKey === k.clientKey && !c.items.some((i) => i.id === k.id)));
    if (keep.length && read) {
      const log = await plan.devopsWriteLog(200);
      const mine = keep.filter((k) => log.some((e) => e.op === "create" && e.status === "confirmed" && e.undoneBy === null && e.clientKey === k.clientKey && e.itemId === k.id));
      for (const key of new Set(mine.map((k) => k.clientKey))) {
        const ref = refs.find((r) => r.clientKey === key);
        const c = clients.find((x) => x.clientKey === key);
        if (!ref || !c) continue;
        const [w] = await read([ref], { whole: true }).catch(() => []);
        for (const i of w?.items ?? []) if (mine.some((k) => k.clientKey === key && k.id === i.id) && !c.items.some((x) => x.id === i.id)) c.items.push(i);
      }
    }
    const hints = await hintsOf(plan, today, cfg.plan.sizes);
    const out: AheadLoad["clients"] = [];
    const fr = (await ctx.fixRules?.().catch(() => null)) ?? { topN: TOP_N, gaps: () => [...GAP_KINDS] };
    const ix = await idx();
    for (const raw of clients) {
      const c = withIdentities(raw, ix);
      const lead = await ctx.isLead(c.clientKey).catch(() => false);
      const rights = rightsOf(c, { lead, automation });
      // BH-1: Backlog asks for what the change log says each item's last change was (30 days at most).
      const last = o.lastChanges === true && c.status === "ok" ? await ctx.devops(cfg).lastChanges?.(c.clientKey).catch(() => null) : null;
      out.push({ ...c, ...(last ? { last } : {}), lead, editable: [...rights].filter(([, r]) => r.ok).map(([id]) => id), note: automation ? "Automation accounts don't change DevOps from FocusTime." : `Only ${c.clientName}'s leads and the owner can change this.`, canWrite: await ctx.canWrite(c.clientKey).catch(() => false), hints: hints.get(c.clientKey) ?? {}, fixGaps: fr.gaps(c.clientKey) });
    }
    await moveOldDrags(plan, out);
    await reconcile(plan, out);
    const halves = await keptHalves(plan, out);
    const skips = liveSkips(await plan.getState<unknown>(SKIPS_KEY), today);
    const monday = Temporal.PlainDate.from(mondayOf(today)).toZonedDateTime({ timeZone: userZone(cfg) }).toInstant().toString();
    const fixedWeek = fixedSince(readFixed(await plan.getState<unknown>(FIXED_KEY)), monday);
    return { ok: true, data: { today, clients: out, changes: await plan.aheadChanges(), halves, automation, fixTopN: fr.topN, staleWeeks: cfg.ahead?.staleWeeks ?? DEFAULT_AHEAD.staleWeeks, skips, fixedWeek } satisfies AheadLoad };
  }

  /**
   * AH-5: whom the assignee dropdown lists for one client: its own DevOps project's people (never another client's),
   * its Cooptimizers and whoever has an item there, me first (plan/ahead-people.ts).
   */
  const peopleOf = async (c: AheadClient & { mine?: string[] }): Promise<{ people: AssignPerson[]; problem: string | null }> => {
    const [project, org, ix, staged] = await Promise.all([
      ctx.devops(cfg).projectPeople?.(c.clientKey).catch(() => null) ?? Promise.resolve(null),
      ctx.people ? ctx.people(c.clientKey).catch(() => null) : Promise.resolve(null),
      idx(),
      plan.aheadChanges(),
    ]);
    const coops = org?.cooptimizers ?? [];
    const assignees = [
      ...c.items.flatMap((i) => (i.assignee?.email ? [{ email: i.assignee.email, name: i.assignee.name }] : [])),
      ...staged.filter((x) => x.clientKey === c.clientKey && x.field === "assignee").flatMap((x) => (x.value && typeof x.value === "object" ? [x.value] : [])),
    ];
    const loginOf = (e: string): string | null => {
      const who = ix?.personOf(c.clientKey, e);
      if (!who) return null;
      return coops.find((w) => w.email.toLowerCase() !== e && ix!.personOf(c.clientKey, w.email)?.id === who.id)?.email ?? null;
    };
    const people = assignPeople({ mine: c.mine ?? (c.me ? [c.me] : []), myName: org?.myName ?? null, cooptimizers: coops, project: project ?? [], assignees, loginOf, isCooptimizer: org?.isCooptimizer ?? (() => false) });
    return { people, problem: project === null ? `${c.clientName}'s DevOps project members couldn't be read, so only its Cooptimizers and people already assigned are listed.` : null };
  };

  if (action === "ahead.people") {
    const o = obj(input, ["clientKey"]);
    if (!o || !isKey(o.clientKey)) return bad("ahead.people takes { clientKey }");
    const c = await oneClient(o.clientKey);
    if (!c) return bad("That client isn't one you see in Ahead", 404);
    return { ok: true, data: { clientKey: c.clientKey, ...(await peopleOf(c)) } };
  }

  /** One change into my change set, after the same checks every edit has (rights, the field, whom I may assign). */
  const stageOne = async (c: AheadClient, item: AheadItem, field: ChangeField, raw: ChangeValue, halfIn: DayHalf | null, lead: boolean): Promise<string | null> => {
    let value = raw;
    const right = rightsOf(c, { lead, automation }).get(item.id)!;
    if (!right.ok) return right.note;
    if (!hasField(c, item.type, field)) return `${field === "size" ? "A size" : field === "start" ? "A start date" : field === "state" ? "A state" : "A target date"} isn't in ${c.project ?? c.clientName}'s process for ${item.type}`;
    // AH-5: one of the type's states in the process model, by its own spelling.
    if (field === "state") {
      const st = c.states?.[item.type]?.find((x) => typeof value === "string" && x.name.toLowerCase() === value.toLowerCase());
      if (!st) return `${String(value)} isn't a state of ${item.type} in ${c.project ?? c.clientName}'s process`;
      value = st.name;
    }
    // AH-5: anyone on this client's DevOps project (its teams), its Cooptimizers, or someone already assigned there.
    if (field === "assignee" && value && typeof value === "object" && !(await ctx.assignable(c.clientKey, value.email).catch(() => false))) {
      const email = value.email.toLowerCase();
      if (!(await peopleOf(c)).people.some((p) => p.email === email)) return `Only people on ${c.clientName}'s DevOps project can be assigned here`;
    }
    // AH-3: a person who signs in to this client's DevOps with a client login is assigned as that login.
    if (field === "assignee" && value && typeof value === "object") {
      const ix = await idx();
      if (ix) value = { email: ix.writeAs(c.clientKey, value.email).toLowerCase(), name: ix.personOf(c.clientKey, value.email)?.name ?? value.name };
    }
    const half: DayHalf | null = field === "start" || field === "target" ? (value === null ? null : (halfIn ?? (field === "start" ? "AM" : "PM"))) : null;
    const existing = (await plan.aheadChanges()).find((x) => x.clientKey === c.clientKey && x.itemId === item.id && x.field === field);
    const baseValue = existing ? existing.baseValue : currentValue(item, field);
    const baseRev = existing ? existing.baseRev : item.rev;
    if (sameValue(field, value, baseValue) && existing?.theirs === undefined) {
      // Back to what DevOps has: no change. A different half on the same day is FocusTime's alone.
      await plan.removeAheadChanges(c.clientKey, item.id, field);
      if ((field === "start" || field === "target") && typeof value === "string") await plan.setAheadHalf(c.clientKey, item.id, field, value, half);
    } else await plan.stageAheadChange({ clientKey: c.clientKey, itemId: item.id, field, value, half, baseRev, baseValue });
    return null;
  };

  if (action === "ahead.stage_bulk") {
    // BH-1: one bulk action from Backlog on the selected rows, one staged change per item, the rest skipped with why.
    const o = obj(input, ["items", "op"]);
    const op = o ? checkBulkOp(o.op) : null;
    const list = o && Array.isArray(o.items) && o.items.length > 0 && o.items.length <= 200 ? (o.items as unknown[]) : null;
    const keys = list?.every((x) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).every((k) => k === "clientKey" || k === "itemId") && isKey((x as Obj).clientKey) && isId((x as Obj).itemId)) ? (list as { clientKey: string; itemId: number }[]) : null;
    if (!op || !keys) return bad("ahead.stage_bulk takes { items: [{ clientKey, itemId }] (1 to 200), op: { kind: push, weeks: 2 | 4 } | { kind: move | set_missing, date } | { kind: assign_me } }");
    const staged: { clientKey: string; itemId: number }[] = [];
    const skipped: { clientKey: string; itemId: number; reason: string }[] = [];
    for (const clientKey of [...new Set(keys.map((k) => k.clientKey))]) {
      const ids = [...new Set(keys.filter((k) => k.clientKey === clientKey).map((k) => k.itemId))];
      const c = await oneClient(clientKey);
      if (!c) {
        for (const itemId of ids) skipped.push({ clientKey, itemId, reason: "That client isn't one you see in Ahead" });
        continue;
      }
      const lead = await ctx.isLead(clientKey).catch(() => false);
      const rights = rightsOf(c, { lead, automation });
      const pending = (await plan.aheadChanges()).filter((x) => x.clientKey === clientKey);
      const meEmail = c.me ?? c.mine[0] ?? null;
      const mine = new Set(c.mine);
      for (const itemId of ids) {
        const item = c.items.find((i) => i.id === itemId);
        if (!item) {
          skipped.push({ clientKey, itemId, reason: `#${itemId} isn't in ${c.clientName}'s DevOps items here` });
          continue;
        }
        const p = (f: ChangeField) => pending.find((x) => x.itemId === itemId && x.field === f);
        const pt = p("target"), pa = p("assignee");
        const target = pt ? (pt.value as string | null) : item.target;
        const assignee = pa ? (pa.value as { email: string } | null)?.email ?? null : item.assignee?.email ?? null;
        const right = rights.get(itemId)!;
        const d = bulkDecide({ id: itemId, type: item.type, editable: right.ok, note: right.ok ? "" : right.note, hasTarget: hasField(c, item.type, "target"), target, mine: !!assignee && mine.has(assignee.toLowerCase()) }, op, c.project ?? c.clientName);
        if (!d.ok) {
          skipped.push({ clientKey, itemId, reason: d.reason });
          continue;
        }
        if (d.step.field === "assignee" && !meEmail) {
          skipped.push({ clientKey, itemId, reason: `FocusTime doesn't know your DevOps identity on ${c.clientName}` });
          continue;
        }
        const ix = await idx();
        const value: ChangeValue = d.step.field === "target" ? d.step.value : { email: meEmail!.toLowerCase(), name: ix?.personOf(clientKey, meEmail!)?.name ?? "Me" };
        const half = d.step.field === "target" ? (pt?.half ?? null) : null;
        const why = await stageOne(c, item, d.step.field, value, half, lead);
        if (why) skipped.push({ clientKey, itemId, reason: why });
        else staged.push({ clientKey, itemId });
      }
    }
    return { ok: true, data: { changes: await plan.aheadChanges(), staged, skipped } };
  }

  if (action === "ahead.stage") {
    const o = obj(input, ["clientKey", "itemId", "field", "value", "half"]);
    if (!o || !isKey(o.clientKey) || !isId(o.itemId) || !isField(o.field) || !("value" in o)) return bad("ahead.stage takes { clientKey, itemId, field, value, half? }");
    if (o.half !== undefined && o.half !== null && o.half !== "AM" && o.half !== "PM") return bad("half is AM or PM");
    let value: ChangeValue;
    try {
      value = checkValue(o.field, o.value);
    } catch (e) {
      return bad((e as Error).message);
    }
    const c = await oneClient(o.clientKey);
    if (!c) return bad("That client isn't one you see in Ahead", 404);
    const item = c.items.find((i) => i.id === o.itemId);
    if (!item) return bad(`#${o.itemId} isn't in ${c.clientName}'s DevOps items here`, 404);
    const lead = await ctx.isLead(c.clientKey).catch(() => false);
    const right = rightsOf(c, { lead, automation }).get(item.id)!;
    if (!right.ok) return bad(right.note, 403);
    if (!hasField(c, item.type, o.field)) return bad(`${o.field === "size" ? "A size" : o.field === "start" ? "A start date" : o.field === "state" ? "A state" : "A target date"} isn't in ${c.project ?? c.clientName}'s process for ${item.type}`, 409);
    const why = await stageOne(c, item, o.field, value, (o.half as DayHalf | undefined) ?? null, lead);
    if (why) return bad(why, 403);
    return { ok: true, data: { changes: await plan.aheadChanges() } };
  }

  if (action === "ahead.unstage") {
    const o = obj(input, ["clientKey", "itemId", "field"]);
    if (!o || !isKey(o.clientKey) || !isId(o.itemId) || (o.field !== undefined && !isField(o.field))) return bad("ahead.unstage takes { clientKey, itemId, field? }");
    await plan.removeAheadChanges(o.clientKey, o.itemId, (o.field as ChangeField | undefined) ?? null);
    return { ok: true, data: { changes: await plan.aheadChanges() } };
  }

  if (action === "ahead.discard") {
    const o = obj(input, ["confirm"]);
    if (!o || o.confirm !== true) return bad("ahead.discard takes { confirm: true }");
    const n = await plan.removeAheadChanges(null);
    return { ok: true, data: { removed: n, changes: [] } };
  }

  // ahead.resolve: a conflict, Keep mine (edit on from DevOps's revision and value now) or Take theirs (drop mine).
  const o = obj(input, ["clientKey", "itemId", "keep"]);
  if (!o || !isKey(o.clientKey) || !isId(o.itemId) || (o.keep !== "mine" && o.keep !== "theirs")) return bad("ahead.resolve takes { clientKey, itemId, keep: mine | theirs }");
  const mine = (await plan.aheadChanges()).filter((x) => x.clientKey === o.clientKey && x.itemId === o.itemId && x.theirs !== undefined);
  if (!mine.length) return bad("Nothing to resolve on that item", 409);
  if (o.keep === "theirs") for (const x of mine) await plan.removeAheadChanges(x.clientKey, x.itemId, x.field);
  else {
    const c = await oneClient(o.clientKey);
    const item = c?.items.find((i) => i.id === o.itemId);
    if (!c || !item) return bad("That item can't be read just now; try again", 503);
    for (const x of mine) await plan.rebaseAheadChange(x.clientKey, x.itemId, x.field, item.rev, currentValue(item, x.field));
  }
  return { ok: true, data: { changes: await plan.aheadChanges() } };
}

/**
 * Against what DevOps has now: a change DevOps already shows goes (it landed, or someone made the same change); a
 * field that changed since I started editing it is a conflict (its value kept beside mine); a conflict DevOps undid
 * clears. Other changes to the item don't count (D658).
 */
async function reconcile(plan: PlanStore, clients: readonly AheadClient[]): Promise<void> {
  const items = new Map(clients.flatMap((c) => c.items.map((i) => [`${c.clientKey}:${i.id}`, i] as const)));
  for (const ch of await plan.aheadChanges()) {
    const i = items.get(`${ch.clientKey}:${ch.itemId}`);
    if (!i) continue;
    const now = currentValue(i, ch.field);
    if (sameValue(ch.field, ch.value, now)) {
      await plan.removeAheadChanges(ch.clientKey, ch.itemId, ch.field);
      if ((ch.field === "start" || ch.field === "target") && typeof ch.value === "string" && ch.half) await plan.setAheadHalf(ch.clientKey, ch.itemId, ch.field, ch.value, ch.half);
      continue;
    }
    const k = conflictOf(ch, now);
    if (k.conflict && (ch.theirs === undefined || !sameValue(ch.field, ch.theirs, k.theirs))) await plan.markAheadConflict(ch.clientKey, ch.itemId, ch.field, k.theirs);
    if (!k.conflict && ch.theirs !== undefined) await plan.rebaseAheadChange(ch.clientKey, ch.itemId, ch.field, ch.baseRev, ch.baseValue);
  }
}

/** Dates dragged before AH-1 (roadmap_dates) come in once as pending changes where I may edit; the rows then go. */
async function moveOldDrags(plan: PlanStore, clients: readonly (AheadClient & { editable: number[] })[]): Promise<void> {
  const old = await plan.roadmapDates();
  if (!old.size) return;
  const staged = await plan.aheadChanges();
  for (const [key, d] of old) {
    const [clientKey, idText] = [key.slice(0, key.lastIndexOf(":")), key.slice(key.lastIndexOf(":") + 1)];
    const c = clients.find((x) => x.clientKey === clientKey);
    const i = c?.items.find((x) => x.id === Number(idText));
    if (!c || !i) continue;
    if (c.editable.includes(i.id))
      for (const [field, value] of [["start", d.start], ["target", d.end]] as const) {
        if (!hasField(c, i.type, field) || sameValue(field, value, currentValue(i, field)) || staged.some((s) => s.clientKey === clientKey && s.itemId === i.id && s.field === field)) continue;
        await plan.stageAheadChange({ clientKey, itemId: i.id, field, value, half: field === "start" ? "AM" : "PM", baseRev: i.rev, baseValue: currentValue(i, field) });
      }
    await plan.setRoadmapDates(clientKey, i.id, null);
  }
}

/** Kept half-days while DevOps still has that day; the rest go. */
async function keptHalves(plan: PlanStore, clients: readonly AheadClient[]): Promise<AheadLoad["halves"]> {
  const items = new Map(clients.flatMap((c) => c.items.map((i) => [`${c.clientKey}:${i.id}`, i] as const)));
  const out: AheadLoad["halves"] = [];
  for (const h of await plan.aheadHalves()) {
    const i = items.get(`${h.clientKey}:${h.itemId}`);
    if (!i) continue;
    if ((h.field === "start" ? i.start : i.target) === h.day) out.push(h);
    else await plan.setAheadHalf(h.clientKey, h.itemId, h.field, null, null);
  }
  return out;
}

/** FocusTime's own size per item, from weeks 1 to 4 of my week plans: a story's S/M/L, a feature's estimate. */
async function hintsOf(plan: PlanStore, today: IsoDate, sizes: SizeScale): Promise<Map<string, Record<number, { text: string; minutes: number }>>> {
  const out = new Map<string, Record<number, { text: string; minutes: number }>>();
  for (const w of aheadWeeks(mondayOf(today)).slice(0, PLAN_WEEKS)) {
    for (const f of (await plan.weekPlan(w)).features) {
      const m = out.get(f.clientKey) ?? {};
      if (m[f.itemId]) continue;
      if (f.level === "story") m[f.itemId] = { text: f.size ? `FocusTime: ${f.size}, about ${hoursText(storyMinutes(f.size, sizes))}` : `FocusTime: no size (counts ${unsizedText(sizes)})`, minutes: storyMinutes(f.size, sizes) };
      else if (f.estimate !== null) m[f.itemId] = { text: `FocusTime: ${aboutText(f.estimate)}`, minutes: f.estimate };
      out.set(f.clientKey, m);
    }
  }
  return out;
}

// ---- Filters, remembered per person (D654) ----
export const FILTERS_KEY = "ahead_filters";
export type { AheadFilters, AheadOwner };
export function checkFilters(v: unknown): AheadFilters | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Obj;
  // AH-6: a key a newer build added is left out, not refused (as settings since D900), so a rollback keeps working.
  const date = (x: unknown) => (x === null || x === undefined ? null : typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);
  const owner: Record<string, AheadOwner> = {};
  if (o.owner !== undefined) {
    if (typeof o.owner !== "object" || o.owner === null || Array.isArray(o.owner)) return null;
    for (const [k, w] of Object.entries(o.owner as Obj)) {
      if (!isKey(k) || (w !== "mine" && w !== "contributing" && w !== "all")) return null;
      owner[k] = w;
    }
  }
  const list = (x: unknown) => (x === undefined ? [] : Array.isArray(x) && x.length <= 100 && x.every(isKey) ? (x as string[]) : null);
  const clients = list(o.clients), states = list(o.states);
  const from = date(o.from), to = date(o.to);
  if (!clients || !states || from === undefined || to === undefined) return null;
  if (o.epic !== undefined && o.epic !== null && (typeof o.epic !== "string" || o.epic.length > 120)) return null;
  if (o.gaps !== undefined && typeof o.gaps !== "boolean") return null;
  if (o.whole !== undefined && typeof o.whole !== "boolean") return null;
  // BH-1: Backlog's tier and Stale filter.
  if (o.tier !== undefined && o.tier !== "epic" && o.tier !== "feature" && o.tier !== "story") return null;
  if (o.stale !== undefined && typeof o.stale !== "boolean") return null;
  if (o.q !== undefined && (typeof o.q !== "string" || o.q.length > 200)) return null;
  // AH-6: the Dates quick pick and the readiness kinds.
  if (o.range !== undefined && o.range !== null && !(RANGES as readonly unknown[]).includes(o.range)) return null;
  if (o.kinds !== undefined && !(Array.isArray(o.kinds) && o.kinds.length <= KINDS.length && o.kinds.every((k) => (KINDS as readonly unknown[]).includes(k)))) return null;
  const range = typeof o.range === "string" ? (o.range as AheadRange) : null;
  const kinds = Array.isArray(o.kinds) ? [...new Set(o.kinds as AheadGapKind[])] : [];
  return {
    ...(range ? { range } : {}),
    ...(kinds.length ? { kinds } : {}), owner, clients, epic: (o.epic as string | null | undefined) ?? null, gaps: o.gaps === true, from, to, q: (o.q as string | undefined) ?? "", states, ...(o.whole === true ? { whole: true } : {}), ...(o.tier !== undefined ? { tier: o.tier as "epic" | "feature" | "story" } : {}), ...(o.stale === true ? { stale: true } : {}) };
}

/** BH-1: a bulk action as Backlog sends it. */
export function checkBulkOp(v: unknown): BulkOp | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Obj;
  const date = (x: unknown) => {
    if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
    try {
      return Temporal.PlainDate.from(x, { overflow: "reject" }).toString();
    } catch {
      return null;
    }
  };
  if (o.kind === "push" && Object.keys(o).every((k) => k === "kind" || k === "weeks") && (o.weeks === 2 || o.weeks === 4)) return { kind: "push", weeks: o.weeks };
  if ((o.kind === "move" || o.kind === "set_missing") && Object.keys(o).every((k) => k === "kind" || k === "date")) {
    const d = date(o.date);
    return d ? { kind: o.kind, date: d } : null;
  }
  if (o.kind === "assign_me" && Object.keys(o).length === 1) return { kind: "assign_me" };
  return null;
}

export { byItem };
export type { StagedChange };
