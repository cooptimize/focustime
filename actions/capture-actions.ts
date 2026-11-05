// Quick capture (step 9): save first, sort later. A capture is written to the local plan store only, so it works
// with every source offline; routing makes a follow-up, a draft story or (step 13.5) a draft feature, also local.
// The only DevOps read is a client's open features and epics (to put a draft under), read-only and optional. No AI.
import { personRef } from "../plan/person-ref.ts";
import type { AppConfig } from "../config/schema.ts";
import type { Size } from "../plan/types.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { MAX_CAPTURE, PlanError, type CaptureRoute, type PlanStore } from "../store/plan-store.ts";
import { mondayOf } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import type { ActionResponse, CaptureFeatures, CaptureState } from "./types.ts";
import { userZone } from "../week/zone.ts";
export type { CaptureFeatures, CaptureState } from "./types.ts";

export const CAPTURE_ACTIONS = ["capture.add", "capture.load", "capture.route", "capture.features", "draft.add_feature"] as const;
export type CaptureAction = (typeof CAPTURE_ACTIONS)[number];

export type CaptureContext = {
  plan: PlanStore | undefined;
  /** May be null (no or broken config): capturing still works. */
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "portfolio">;
  /** Followed clients with DevOps this week (for a client's features). */
  clients: (cfg: AppConfig, weekStart: IsoDate) => Promise<ClientRef[]>;
  now: () => string;
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
const id = (v: unknown, name: string) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
};
const text = (v: unknown, name: string, max: number) => {
  if (typeof v !== "string") throw new Invalid(`${name} must be text`);
  const t = v.trim();
  if (t.length > max) throw new Invalid(`${name} is at most ${max} characters`);
  return t;
};
const optClient = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.trim().length > 100) throw new Invalid("clientKey must be text");
  return v.trim();
};
const date = (v: unknown): IsoDate | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid("A date must be YYYY-MM-DD");
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid("due must be a real date");
  }
};
const size = (v: unknown): Size => {
  if (v === undefined) return "M";
  if (v !== "S" && v !== "M" && v !== "L") throw new Invalid("size must be S, M or L");
  return v;
};

async function todayOf(ctx: CaptureContext, cfg: AppConfig | null): Promise<IsoDate> {
  const tz = userZone(cfg);
  return Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz).toPlainDate().toString();
}

/** A client's open features (feature tier), from the Plan the week read. Never blocks: DevOps down means none to pick. */
async function featuresOf(ctx: CaptureContext, cfg: AppConfig | null, key: string): Promise<CaptureFeatures> {
  if (!cfg) return { clientKey: key, status: "unavailable", message: "Fix the config to see features", features: [], epics: [] };
  try {
    const refs = await ctx.clients(cfg, mondayOf(await todayOf(ctx, cfg)));
    const ref = refs.find((r) => r.clientKey === key);
    if (!ref) return { clientKey: key, status: "unavailable", message: `No DevOps for ${key}`, features: [], epics: [] };
    const [p] = await ctx.devops(cfg).portfolio([ref]);
    const of = (tier: "feature" | "epic") => (p?.items ?? []).filter((i) => i.tier === tier).map((i) => ({ id: i.id, title: i.title, state: i.state, type: i.type, url: i.url, areaPath: i.areaPath ?? null, iterationPath: i.iterationPath ?? null }));
    if (!p || p.status !== "ok") return { clientKey: key, status: "unavailable", message: p?.message ?? `DevOps unavailable for ${key}`, features: of("feature"), epics: of("epic") };
    return { clientKey: key, status: "ok", features: of("feature"), epics: of("epic"), acceptanceField: !!p.acceptanceField };
  } catch {
    return { clientKey: key, status: "unavailable", message: `DevOps unavailable for ${key}`, features: [], epics: [] };
  }
}

/** An epic to put a draft feature under: one of the client's open epics as DevOps lists them now, or none. */
async function epicOf(ctx: CaptureContext, key: string, v: unknown): Promise<number | null | ActionResponse> {
  if (v === undefined || v === null) return null;
  const epicId = id(v, "parentItemId");
  const f = await featuresOf(ctx, await ctx.config().catch(() => null), key);
  if (f.status !== "ok") return bad(`${f.message ?? "DevOps unavailable"}. Save the draft feature without an epic for now`, 409);
  if (!f.epics.some((x) => x.id === epicId)) return bad(`#${epicId} isn't one of ${key}'s open epics`, 422);
  return epicId;
}

export async function captureAction(ctx: CaptureContext, action: CaptureAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  try {
    switch (action) {
      case "capture.add": {
        // No source and no config is needed here: the store is local.
        const o = fields(input, ["text"], ["clientKey"]);
        const t = text(o.text, "text", MAX_CAPTURE);
        if (!t) throw new Invalid("Type something to capture");
        const capture = (await plan.addCapture({ text: t, clientKey: optClient(o.clientKey) }));
        return { ok: true, data: { capture, inboxCount: (await plan.inboxCount()) } };
      }
      case "capture.load": {
        fields(input ?? {}, []);
        const cfg = await ctx.config().catch(() => null);
        const state: CaptureState = { today: await todayOf(ctx, cfg), inbox: (await plan.inbox()), inboxCount: (await plan.inboxCount()), drafts: (await plan.drafts()) };
        return { ok: true, data: state };
      }
      case "capture.features": {
        const o = fields(input, ["clientKey"]);
        const key = optClient(o.clientKey);
        if (!key) throw new Invalid("clientKey is required");
        return { ok: true, data: await featuresOf(ctx, await ctx.config().catch(() => null), key) };
      }
      case "capture.route": {
        const o = fields(input, ["id", "as"], ["clientKey", "who", "whoRef", "what", "due", "title", "size", "parentItemId", "channel", "itemId", "targetDate"]);
        const capId = id(o.id, "id");
        let route: CaptureRoute;
        // Step 15.3: a follow-up's linked item (needs a client) and a draft feature's target date; nothing else takes them.
        if (o.itemId !== undefined && o.itemId !== null && o.as !== "follow_up") throw new Invalid("Only a follow-up links a work item here");
        if (o.whoRef !== undefined && o.whoRef !== null && o.as !== "follow_up") throw new Invalid("Only a follow-up has a Who");
        if (o.targetDate !== undefined && o.targetDate !== null && o.as !== "draft_feature") throw new Invalid("A target date is for a draft feature");
        switch (o.as) {
          case "follow_up":
            route = { as: "follow_up", clientKey: optClient(o.clientKey), who: text(o.who ?? "", "who", 100), what: text(o.what, "what", 200), due: date(o.due), channel: o.channel === undefined || o.channel === null || o.channel === "" ? null : (["teams", "email", "devops", "call"].includes(String(o.channel)) ? String(o.channel) : (() => { throw new Invalid("channel must be teams, email, devops or call"); })()) };
            // CV-3: Who as a person from the PersonPicker (as on a follow-up), or a plain name with no reference.
            if (o.whoRef !== undefined && o.whoRef !== null) {
              const ref = personRef(o.whoRef);
              if (!ref) throw new Invalid("whoRef is a person from the picker, or null");
              if (route.who.trim()) route.whoRef = ref;
            }
            if (o.itemId !== undefined && o.itemId !== null) {
              if (!route.clientKey) throw new Invalid("A linked work item needs a client");
              route.itemId = id(o.itemId, "itemId");
            }
            break;
          case "draft": {
            const key = optClient(o.clientKey);
            if (!key) throw new Invalid("A draft story needs a client");
            const parentItemId = o.parentItemId === undefined || o.parentItemId === null ? null : id(o.parentItemId, "parentItemId");
            if (parentItemId !== null) {
              // Only one of the client's open features, as DevOps lists them now; when DevOps can't say, save without one.
              const f = await featuresOf(ctx, await ctx.config().catch(() => null), key);
              if (f.status !== "ok") return bad(`${f.message ?? "DevOps unavailable"}. Save the draft without a feature for now`, 409);
              if (!f.features.some((x) => x.id === parentItemId)) return bad(`#${parentItemId} isn't one of ${key}'s open features`, 422);
            }
            route = { as: "draft", clientKey: key, parentItemId, title: text(o.title, "title", 200), size: size(o.size) };
            break;
          }
          case "draft_feature": {
            const key = optClient(o.clientKey);
            if (!key) throw new Invalid("A draft feature needs a client");
            const parentItemId = await epicOf(ctx, key, o.parentItemId);
            if (typeof parentItemId === "object" && parentItemId !== null) return parentItemId;
            route = { as: "draft_feature", clientKey: key, parentItemId, title: text(o.title, "title", 200), targetDate: date(o.targetDate) };
            break;
          }
          case "dismissed":
            route = { as: "dismissed" };
            break;
          default:
            throw new Invalid("as must be follow_up, draft, draft_feature or dismissed");
        }
        const capture = (await plan.routeCapture(capId, route));
        return { ok: true, data: { capture, inboxCount: (await plan.inboxCount()) } };
      }
      case "draft.add_feature": {
        // Plan the week's "Epic with no features: Draft a feature". Local only, until it is added in DevOps.
        const o = fields(input, ["clientKey", "title"], ["parentItemId"]);
        const key = optClient(o.clientKey);
        if (!key) throw new Invalid("clientKey is required");
        const parentItemId = await epicOf(ctx, key, o.parentItemId);
        if (typeof parentItemId === "object" && parentItemId !== null) return parentItemId;
        const title = text(o.title, "title", 200);
        if (!title) throw new Invalid("A draft feature needs a title");
        return { ok: true, data: { draft: (await plan.addDraft({ clientKey: key, parentItemId, title, size: "M", level: "feature" })) } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
