// Quick capture (step 9): save first, sort later. A capture is written to the local plan store only, so it works
// with every source offline; routing makes a loop, a draft story or a note, also local. The only DevOps read is the
// list of a client's open features (for "under a feature"), read-only and optional. No AI.
import { weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import type { AppConfig } from "../config/schema.ts";
import type { Size } from "../plan/types.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { MAX_CAPTURE, PlanError, type CaptureRoute, type PlanStore } from "../store/plan-store.ts";
import { mondayOf } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import type { ActionResponse, CaptureFeatures, CaptureState } from "./types.ts";
export type { CaptureFeatures, CaptureState } from "./types.ts";

export const CAPTURE_ACTIONS = ["capture.add", "capture.load", "capture.route", "capture.features", "note.delete"] as const;
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
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid("due must be YYYY-MM-DD");
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
  const tz = cfg?.week.hours.timeZone ?? defaultWeekConfig.hours.timeZone;
  return Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz).toPlainDate().toString();
}

/** A client's open features (feature tier), from the Plan the week read. Never blocks: DevOps down means none to pick. */
async function featuresOf(ctx: CaptureContext, cfg: AppConfig | null, key: string): Promise<CaptureFeatures> {
  if (!cfg) return { clientKey: key, status: "unavailable", message: "Fix the config to see features", features: [] };
  try {
    const refs = await ctx.clients(cfg, mondayOf(await todayOf(ctx, cfg)));
    const ref = refs.find((r) => r.clientKey === key);
    if (!ref) return { clientKey: key, status: "unavailable", message: `No DevOps for ${key}`, features: [] };
    const [p] = await ctx.devops(cfg).portfolio([ref]);
    if (!p || p.status !== "ok") return { clientKey: key, status: "unavailable", message: p?.message ?? `DevOps unavailable for ${key}`, features: (p?.items ?? []).filter((i) => i.tier === "feature").map((i) => ({ id: i.id, title: i.title, state: i.state })) };
    return { clientKey: key, status: "ok", features: p.items.filter((i) => i.tier === "feature").map((i) => ({ id: i.id, title: i.title, state: i.state })) };
  } catch {
    return { clientKey: key, status: "unavailable", message: `DevOps unavailable for ${key}`, features: [] };
  }
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
        const capture = plan.addCapture({ text: t, clientKey: optClient(o.clientKey) });
        return { ok: true, data: { capture, inboxCount: plan.inboxCount() } };
      }
      case "capture.load": {
        const o = fields(input ?? {}, [], ["query", "clientKey"]);
        const query = o.query === undefined ? "" : text(o.query, "query", 200);
        const filter = o.clientKey === undefined ? {} : { clientKey: o.clientKey === "" ? null : optClient(o.clientKey) };
        const cfg = await ctx.config().catch(() => null);
        const state: CaptureState = { today: await todayOf(ctx, cfg), inbox: plan.inbox(), notes: plan.notes({ ...filter, query }), inboxCount: plan.inboxCount() };
        return { ok: true, data: state };
      }
      case "capture.features": {
        const o = fields(input, ["clientKey"]);
        const key = optClient(o.clientKey);
        if (!key) throw new Invalid("clientKey is required");
        return { ok: true, data: await featuresOf(ctx, await ctx.config().catch(() => null), key) };
      }
      case "capture.route": {
        const o = fields(input, ["id", "as"], ["clientKey", "who", "what", "due", "title", "size", "parentItemId", "text"]);
        const capId = id(o.id, "id");
        let route: CaptureRoute;
        switch (o.as) {
          case "loop":
            route = { as: "loop", clientKey: optClient(o.clientKey), who: text(o.who ?? "", "who", 100), what: text(o.what, "what", 200), due: date(o.due) };
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
          case "note":
            route = { as: "note", clientKey: optClient(o.clientKey), text: text(o.text, "text", MAX_CAPTURE) };
            break;
          case "dismissed":
            route = { as: "dismissed" };
            break;
          default:
            throw new Invalid("as must be loop, draft, note or dismissed");
        }
        const capture = plan.routeCapture(capId, route);
        return { ok: true, data: { capture, inboxCount: plan.inboxCount() } };
      }
      case "note.delete": {
        const o = fields(input, ["id"]);
        if (!plan.deleteNote(id(o.id, "id"))) return bad("No such note", 404);
        return { ok: true, data: { deleted: true } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
