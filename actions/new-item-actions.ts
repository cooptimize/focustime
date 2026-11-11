// QC-1: the one New form's reads and its Save as draft. Levels and types come from the client's process model (the
// read side, no PAT), parents from the client's open items in FocusTime's store (Cooptimize's scope, the same pool as
// Link to item), and whether I can write from my checked write PAT. Creating goes through the write framework
// (devops.preview kind "new_item"), never from here. A draft may be at any level; it keeps its exact type.
import type { AppConfig } from "../config/schema.ts";
import type { ProcessModel } from "../plan/process.ts";
import { isClosed } from "../plan/process.ts";
import { cleanTitle, createLevelsOf, draftLevelOf, parentProblem, type NewOptions } from "../plan/quick-create.ts";
export type { NewOptions, NewParent } from "../plan/quick-create.ts";
import type { DraftStory, Size } from "../plan/types.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { ActionResponse } from "./types.ts";

export const NEW_ITEM_ACTIONS = ["new.options", "draft.add", "draft.save"] as const;
export type NewItemAction = (typeof NEW_ITEM_ACTIONS)[number];

export type NewItemContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  model: (cfg: AppConfig, clientKey: string) => Promise<ProcessModel | null>;
  /** The client's open items in scope (the store), or null when DevOps can't say. */
  items: (cfg: AppConfig, clientKey: string) => Promise<{ id: number; title: string; type: string; state: string; stateCategory: string; url: string; parentId: number | null }[] | null>;
  canWrite: (clientKey: string) => Promise<boolean>;
};

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
const key = (v: unknown) => {
  if (typeof v !== "string" || !/^[\w .&'-]{1,100}$/.test(v)) throw new Invalid("clientKey must be a client key");
  return v;
};
const optId = (v: unknown, name: string): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
};
const optText = (v: unknown, name: string, max: number): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Invalid(`${name} must be text`);
  const t = v.trim();
  if (t.length > max) throw new Invalid(`${name} is at most ${max} characters`);
  return t || null;
};
const optDate = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid("targetDate must be YYYY-MM-DD");
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid("targetDate must be a real date");
  }
};
/** Assigned to: absent is me (the default), "none" is nobody, else an email. */
const optEmail = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "" || v === "me") return null;
  if (v === "none") return "none";
  if (typeof v !== "string" || v.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(v)) throw new Invalid("assignTo must be an email");
  return v.toLowerCase();
};
const SIZES = new Set(["XS", "S", "M", "L"]);
const optSize = (v: unknown): Size => {
  if (v === undefined || v === null) return "M";
  if (typeof v !== "string" || !SIZES.has(v)) throw new Invalid("size must be XS, S, M or L");
  return v as Size;
};

/** The levels with each one's default type: the parent level's most common child, else the first. */
export function levelsWithDefaults(m: ProcessModel): NewOptions["levels"] {
  return createLevelsOf(m.ladder).map((l) => {
    const above = l.rung > 0 ? m.ladder[l.rung - 1]! : [];
    const d = above.map((t) => m.types.find((x) => x.name === t)?.defaultChild).find((c): c is string => !!c && l.types.includes(c));
    return { ...l, default: d ?? l.types[0]! };
  });
}

async function optionsOf(ctx: NewItemContext, cfg: AppConfig, clientKey: string): Promise<NewOptions> {
  const [model, items, canWrite] = await Promise.all([ctx.model(cfg, clientKey).catch(() => null), ctx.items(cfg, clientKey).catch(() => null), ctx.canWrite(clientKey).catch(() => false)]);
  if (!model) return { clientKey, canWrite, levels: [], parents: [], problem: "FocusTime couldn't read this client's DevOps process just now. Refresh, or save it as a draft" };
  const levels = levelsWithDefaults(model);
  // Anything at a level with a level under it can be a parent (the requirement level's children are tasks: left out).
  const parentTypes = new Set(levels.filter((l) => l.kind === "portfolio").flatMap((l) => l.types));
  const parents = (items ?? []).filter((i) => parentTypes.has(i.type) && !isClosed(i.stateCategory)).map((i) => ({ id: i.id, title: i.title, type: i.type, state: i.state, url: i.url, parentId: i.parentId }));
  return { clientKey, canWrite, levels, parents, problem: items ? null : "FocusTime couldn't read this client's items just now, so there are no parents to choose" };
}

/** Save as draft's values, checked against the process when it can be read. */
async function draftValues(ctx: NewItemContext, cfg: AppConfig | null, o: Obj, was: DraftStory | null = null): Promise<{ clientKey: string; title: string; itemType: string | null; level: "story" | "feature"; parentItemId: number | null; assignTo: string | null; description: string | null; targetDate: string | null; size: Size }> {
  const clientKey = key(o.clientKey);
  const t = cleanTitle(o.title);
  if ("problem" in t) throw new Invalid(t.problem);
  const type = optText(o.type, "type", 200);
  const parentItemId = optId(o.parentItemId, "parentItemId");
  // Saving an existing draft keeps its level and size unless they are sent (the form sends neither).
  let level: "story" | "feature" = o.level === "story" || o.level === "feature" ? o.level : (was?.level ?? "feature");
  if (cfg && type) {
    const opts = await optionsOf(ctx, cfg, clientKey);
    if (opts.levels.length) {
      if (!opts.levels.some((l) => l.types.includes(type))) throw new Invalid(`${type} isn't a level in this client's process`);
      level = draftLevelOf(opts.levels, type);
      // A parent outside the pool (a row shown with Show the whole project, Break down's item) is kept as chosen; the
      // create's preview reads and checks it before anything is sent.
      const p = parentItemId !== null ? opts.parents.find((x) => x.id === parentItemId) : undefined;
      if (p) {
        const why = parentProblem(opts.levels.map((l) => l.types), p.type, type);
        if (why) throw new Invalid(why);
      }
    }
  }
  return { clientKey, title: t.title, itemType: type, level, parentItemId, assignTo: optEmail(o.assignTo), description: optText(o.description, "description", 8000), targetDate: optDate(o.targetDate), size: o.size === undefined && was ? was.size : optSize(o.size) };
}

const INPUT = ["clientKey", "title"];
const OPTIONAL = ["type", "level", "parentItemId", "assignTo", "description", "targetDate", "size"];

export async function newItemAction(ctx: NewItemContext, action: NewItemAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  try {
    const cfg = await ctx.config().catch(() => null);
    switch (action) {
      case "new.options": {
        const o = fields(input, ["clientKey"]);
        if (!cfg) return bad("FocusTime isn't set up yet", 503);
        return { ok: true, data: await optionsOf(ctx, cfg, key(o.clientKey)) };
      }
      case "draft.add": {
        if (!plan) return bad("The local plan store isn't available", 503);
        const v = await draftValues(ctx, cfg, fields(input, INPUT, OPTIONAL));
        const draft: DraftStory = await plan.addDraft(v);
        return { ok: true, data: { draft } };
      }
      case "draft.save": {
        if (!plan) return bad("The local plan store isn't available", 503);
        const o = fields(input, ["id", ...INPUT], OPTIONAL);
        const id = optId(o.id, "id");
        const was = id ? await plan.getDraft(id) : null;
        if (!was || was.devopsId) throw new PlanError("No such draft, or it is already in DevOps");
        const v = await draftValues(ctx, cfg, o, was);
        const draft = await plan.updateDraft(was.id, v);
        return { ok: true, data: { draft } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
