// Morning ignition actions (step 5). Local only: they read DevOps results already in memory to check a pick,
// and write only to the local plan store. Nothing here calls DevOps, Outlook, Google or Dataverse.
import type { AppConfig } from "../config/schema.ts";
import { unpickableReason } from "../plan/rules.ts";
import { DEFAULT_SIZE, SIZES, type IgnitionState, type Size } from "../plan/types.ts";
import { PlanError, type NewPick, type PlanStore } from "../store/plan-store.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import type { Half, IsoDate } from "../week/types.ts";
import type { ActionResponse } from "./types.ts";

export const PLAN_ACTIONS = ["ignition.start", "ignition.commit", "pick.add", "pick.remove", "pick.set_size", "pick.move", "pick.mark_done", "draft.add_story"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];
export const isPlanAction = (a: unknown): a is PlanAction => typeof a === "string" && (PLAN_ACTIONS as readonly string[]).includes(a);

export type PlanContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "lookup">;
};

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
class Invalid extends Error {}

type Obj = Record<string, unknown>;
function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
function date(v: unknown, name = "date"): IsoDate {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid(`${name} must be YYYY-MM-DD`);
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid(`${name} must be a real date`);
  }
}
function half(v: unknown): Half {
  if (v !== "AM" && v !== "PM") throw new Invalid("half must be AM or PM");
  return v;
}
function id(v: unknown, name = "id"): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
}
function size(v: unknown): Size {
  if (v === undefined) return DEFAULT_SIZE;
  if (typeof v === "string" && (SIZES as readonly string[]).includes(v)) return v as Size;
  throw new Invalid("size must be S, M or L. Nothing above L: split it first");
}
function text(v: unknown, name: string, max = 200): string {
  if (typeof v !== "string") throw new Invalid(`${name} must be text`);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) throw new Invalid(`${name} can't be empty`);
  if (t.length > max) throw new Invalid(`${name} must be ${max} characters or fewer`);
  return t;
}
const clientKey = (v: unknown) => text(v, "clientKey", 100);
const bool = (v: unknown, name: string) => {
  if (typeof v !== "boolean") throw new Invalid(`${name} must be true or false`);
  return v;
};

function state(plan: PlanStore, d: IsoDate, opened = true): IgnitionState {
  return { date: d, plan: plan.start(d), picks: plan.picksFor(d), carryOver: plan.carryOverFor(d), drafts: plan.drafts(), opened };
}

export async function planAction(ctx: PlanContext, action: PlanAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store is not available", 503);
  try {
    switch (action) {
      case "ignition.start": {
        const o = fields(input, ["date"], ["auto"]);
        const d = date(o.date);
        const auto = o.auto === undefined ? false : bool(o.auto, "auto");
        // An automatic open happens once per day, and never for a day already committed.
        const opened = !auto || (!plan.day(d)?.committedAt && plan.markOnce("ignition_auto", d));
        return { ok: true, data: state(plan, d, opened) };
      }
      case "ignition.commit": {
        const d = date(fields(input, ["date"]).date);
        plan.commit(d);
        return { ok: true, data: state(plan, d) };
      }
      case "pick.add": {
        const o = fields(input, ["date", "half", "clientKey"], ["size", "itemId", "intention", "draftId"]);
        const base = { date: date(o.date), half: half(o.half), clientKey: clientKey(o.clientKey), size: size(o.size) };
        const given = ["itemId", "intention", "draftId"].filter((k) => o[k] !== undefined);
        if (given.length !== 1) throw new Invalid("give exactly one of itemId, intention or draftId");
        let p: NewPick;
        if (o.itemId !== undefined) {
          const itemId = id(o.itemId, "itemId");
          const cfg = await ctx.config();
          if (!cfg) return bad("Fix the config first", 409);
          const item = ctx.devops(cfg).lookup(base.clientKey, itemId);
          if (!item) return bad(`Item ${itemId} is not among the loaded DevOps items for ${base.clientKey}. Refresh and try again`, 409);
          const why = unpickableReason(item);
          if (why) return bad(why, 422);
          const dup = plan.picksFor(base.date).find((x) => x.itemId === itemId && x.clientKey === base.clientKey && (x.status === "planned" || x.status === "done"));
          if (dup) return bad(`Item ${itemId} is already picked for ${dup.half} that day`, 409);
          p = { ...base, kind: "item", itemId, title: item.title, itemType: item.type, itemUrl: item.url.startsWith("https://dev.azure.com/") ? item.url : null };
        } else if (o.draftId !== undefined) {
          const draft = plan.getDraft(id(o.draftId, "draftId"));
          if (!draft || draft.clientKey !== base.clientKey) return bad("No such draft story for this client", 404);
          p = { ...base, kind: "draft", draftId: draft.id, title: draft.title, itemType: "Draft story" };
        } else {
          p = { ...base, kind: "intention", title: text(o.intention, "intention") };
        }
        const pick = plan.addPick(p);
        return { ok: true, data: { pick, state: state(plan, pick.date) } };
      }
      case "pick.remove": {
        const pid = id(fields(input, ["id"]).id);
        const before = plan.getPick(pid);
        if (!before) return bad(`No pick ${pid}`, 404);
        const r = plan.removePick(pid);
        return { ok: true, data: { result: r.result, state: state(plan, before.date) } };
      }
      case "pick.set_size": {
        const o = fields(input, ["id", "size"]);
        const pick = plan.setSize(id(o.id), size(o.size));
        return { ok: true, data: { pick, state: state(plan, pick.date) } };
      }
      case "pick.move": {
        const o = fields(input, ["id", "date", "half"]);
        const pid = id(o.id);
        const before = plan.getPick(pid);
        if (!before) return bad(`No pick ${pid}`, 404);
        const pick = plan.move(pid, date(o.date), half(o.half));
        return { ok: true, data: { pick, state: state(plan, before.date) } };
      }
      case "pick.mark_done": {
        const o = fields(input, ["id", "done"]);
        const pick = plan.setDone(id(o.id), bool(o.done, "done"));
        return { ok: true, data: { pick } };
      }
      case "draft.add_story": {
        const o = fields(input, ["clientKey", "parentItemId", "title"], ["size"]);
        const key = clientKey(o.clientKey);
        const parentItemId = id(o.parentItemId, "parentItemId");
        const title = text(o.title, "title");
        const sz = size(o.size);
        const cfg = await ctx.config();
        if (!cfg) return bad("Fix the config first", 409);
        const parent = ctx.devops(cfg).lookup(key, parentItemId);
        if (!parent) return bad(`Item ${parentItemId} is not among the loaded DevOps items for ${key}. Refresh and try again`, 409);
        if (parent.level !== "portfolio") return bad("Draft stories go under an epic or feature; this item can be picked directly", 422);
        return { ok: true, data: { draft: plan.addDraft({ clientKey: key, parentItemId, title, size: sz }) } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
