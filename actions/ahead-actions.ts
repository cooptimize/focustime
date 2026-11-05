// AH-1: Ahead's one model (D649) and my change set (D653). ahead.load reads every client's items from the central
// DevOps store (all levels), my rights on each (D652), my pending changes reconciled against what DevOps has now (a
// conflict only when a field I'm changing changed there, D654), my kept half-days and FocusTime's own sizes as hints.
// Edits never write: ahead.stage keeps a change in the plan store; committing goes through the write framework
// (devops.preview / devops.confirm with kind "fields", actions/devops-write-actions.ts), one patch per item.
import type { AppConfig } from "../config/schema.ts";
import { byItem, canEdit, CHANGE_FIELDS, checkValue, conflictOf, sameValue, type ChangeField, type ChangeValue, type DayHalf, type EditRight, type StagedChange, type AheadFilters, type AheadOwner } from "../plan/ahead-edit.ts";
import { aboutText, hoursText, storyMinutes } from "../plan/estimate.ts";
import { aheadWeeks, PLAN_WEEKS } from "../plan/ahead.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday, mondayOf } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import type { ActionResponse, AheadClient, AheadItem, AheadLoad } from "./types.ts";

export const AHEAD_ACTIONS = ["ahead.load", "ahead.stage", "ahead.unstage", "ahead.discard", "ahead.resolve", "ahead.filters", "ahead.set_filters"] as const;
export type AheadAction = (typeof AHEAD_ACTIONS)[number];

export type AheadContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  /** The clients this person sees (followed, clients only via clientAccounts(), with DevOps), as Roadmap reads them. */
  clients: (cfg: AppConfig, weekStart: IsoDate, refresh: boolean) => Promise<ClientRef[]>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "aheadItems">;
  /** isClientLead over clientAccounts() for me (Internal like any client). */
  isLead: (clientKey: string) => Promise<boolean>;
  /** An admin flagged me as an automation account. */
  automation: () => Promise<boolean>;
  /** I can commit for this client (my write PAT is saved and the write framework is here). */
  canWrite: (clientKey: string) => Promise<boolean>;
  /** Whom I may assign on this client: its Account Workers who are Cooptimizers, and me (by email). */
  assignable: (clientKey: string, email: string) => Promise<boolean>;
  now: () => string;
};

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
  return i.assignee?.email ? { email: i.assignee.email.toLowerCase(), name: i.assignee.name } : null;
}
/** Whether the item's type has the field in its process (assignee always). */
export const hasField = (c: Pick<AheadClient, "startFields" | "targetFields" | "sizeFields">, type: string, field: ChangeField): boolean =>
  field === "assignee" ? true : !!(field === "start" ? c.startFields : field === "target" ? c.targetFields : c.sizeFields)[type];

/** My rights on every item of a client. */
export function rightsOf(c: AheadClient, me: { lead: boolean; automation: boolean }): Map<number, EditRight> {
  const byId = new Map(c.items.map((i) => [i.id, i]));
  const at = (i: AheadItem | undefined) => (i ? { assigneeEmail: i.assignee?.email ?? null, rung: i.rung } : null);
  return new Map(c.items.map((i) => [i.id, canEdit({ email: c.me, lead: me.lead, automation: me.automation }, at(i)!, at(i.parentId !== null ? byId.get(i.parentId) : undefined), c.clientName)]));
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

  /** One client's items (the store read is cheap). */
  const oneClient = async (clientKey: string): Promise<AheadClient | null> => {
    const ref = (await ctx.clients(cfg, mondayOf(today), false)).find((c) => c.clientKey === clientKey);
    if (!ref) return null;
    const [c] = await ctx.devops(cfg).aheadItems!([ref]);
    return c ?? null;
  };

  if (action === "ahead.load") {
    const o = obj(input, ["refresh"]);
    if (!o || (o.refresh !== undefined && typeof o.refresh !== "boolean")) return bad("ahead.load takes { refresh? }");
    const refs = await ctx.clients(cfg, mondayOf(today), o.refresh === true);
    const read = ctx.devops(cfg).aheadItems;
    const clients = read && refs.length ? await read(refs, o.refresh === true ? { refresh: true } : {}) : [];
    const hints = await hintsOf(plan, today);
    const out: AheadLoad["clients"] = [];
    for (const c of clients) {
      const lead = await ctx.isLead(c.clientKey).catch(() => false);
      const rights = rightsOf(c, { lead, automation });
      out.push({ ...c, lead, editable: [...rights].filter(([, r]) => r.ok).map(([id]) => id), note: automation ? "Automation accounts don't change DevOps from FocusTime." : `Only ${c.clientName}'s leads and the owner can change this.`, canWrite: await ctx.canWrite(c.clientKey).catch(() => false), hints: hints.get(c.clientKey) ?? {} });
    }
    await moveOldDrags(plan, out);
    await reconcile(plan, out);
    const halves = await keptHalves(plan, out);
    return { ok: true, data: { today, clients: out, changes: await plan.aheadChanges(), halves, automation } satisfies AheadLoad };
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
    if (!hasField(c, item.type, o.field)) return bad(`${o.field === "size" ? "A size" : o.field === "start" ? "A start date" : "A target date"} isn't in ${c.project ?? c.clientName}'s process for ${item.type}`, 409);
    if (o.field === "assignee" && value && typeof value === "object" && !(await ctx.assignable(c.clientKey, value.email).catch(() => false))) return bad(`Only Cooptimizers on ${c.clientName} can be assigned here`, 403);
    const half: DayHalf | null = o.field === "start" || o.field === "target" ? (value === null ? null : ((o.half as DayHalf | undefined) ?? (o.field === "start" ? "AM" : "PM"))) : null;
    const existing = (await plan.aheadChanges()).find((x) => x.clientKey === c.clientKey && x.itemId === item.id && x.field === o.field);
    const baseValue = existing ? existing.baseValue : currentValue(item, o.field);
    const baseRev = existing ? existing.baseRev : item.rev;
    if (sameValue(o.field, value, baseValue) && existing?.theirs === undefined) {
      // Back to what DevOps has: no change. A different half on the same day is FocusTime's alone.
      await plan.removeAheadChanges(c.clientKey, item.id, o.field);
      if ((o.field === "start" || o.field === "target") && typeof value === "string") await plan.setAheadHalf(c.clientKey, item.id, o.field, value, half);
    } else await plan.stageAheadChange({ clientKey: c.clientKey, itemId: item.id, field: o.field, value, half, baseRev, baseValue });
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
 * clears. Other changes to the item don't count (D654).
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
async function hintsOf(plan: PlanStore, today: IsoDate): Promise<Map<string, Record<number, { text: string; minutes: number }>>> {
  const out = new Map<string, Record<number, { text: string; minutes: number }>>();
  for (const w of aheadWeeks(mondayOf(today)).slice(0, PLAN_WEEKS)) {
    for (const f of (await plan.weekPlan(w)).features) {
      const m = out.get(f.clientKey) ?? {};
      if (m[f.itemId]) continue;
      if (f.level === "story") m[f.itemId] = { text: f.size ? `FocusTime: ${f.size}, about ${hoursText(storyMinutes(f.size))}` : `FocusTime: no size (counts ${hoursText(storyMinutes(null))})`, minutes: storyMinutes(f.size) };
      else if (f.estimate !== null) m[f.itemId] = { text: `FocusTime: ${aboutText(f.estimate)}`, minutes: f.estimate };
      out.set(f.clientKey, m);
    }
  }
  return out;
}

// ---- Filters, remembered per person (D650) ----
export const FILTERS_KEY = "ahead_filters";
export type { AheadFilters, AheadOwner };
export function checkFilters(v: unknown): AheadFilters | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Obj;
  if (Object.keys(o).some((k) => !["owner", "clients", "epic", "gaps", "from", "to", "q", "states"].includes(k))) return null;
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
  if (o.q !== undefined && (typeof o.q !== "string" || o.q.length > 200)) return null;
  return { owner, clients, epic: (o.epic as string | null | undefined) ?? null, gaps: o.gaps === true, from, to, q: (o.q as string | undefined) ?? "", states };
}

export { byItem };
export type { StagedChange };
