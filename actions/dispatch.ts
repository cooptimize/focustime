// Named, validated actions (docs/spec.md section 5). The UI calls these through the local server;
// the future chat panel will call the same ones. Unknown actions and unexpected input are rejected.
import { clients as defaultClients, weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import type { DataverseConfig, ParseResult } from "../config/schema.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import { loadSampleSources } from "../sources/sample.ts";
import { buildWeek } from "../week/build.ts";
import { defaultWeekStart, localToday, todayTarget } from "../week/dates.ts";
import type { FocusPattern, SourceResult } from "../week/types.ts";
import type { ActionResponse, SourceSummary, WeekLoadData } from "./types.ts";

export type { ActionResponse, SourceSummary, WeekLoadData };

export type ActionContext = {
  loadConfig: () => Promise<{ path: string; parsed: ParseResult; created?: boolean }>;
  makeDataverse: (cfg: DataverseConfig, timeZone: string) => DataverseSource;
  saveSystemUserId: (id: string) => Promise<void>;
  now: () => string;
};

export type ActionRequest = { action: unknown; input: unknown };

const bad = (error: string): ActionResponse => ({ ok: false, status: 400, error });

type WeekLoadInput = { weekStart?: string; now?: string; refresh?: boolean };

function validateWeekLoad(input: unknown): WeekLoadInput | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "input must be an object";
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["weekStart", "now", "refresh"].includes(k)) return `unknown input field ${k}`;
  const out: WeekLoadInput = {};
  if (o.weekStart !== undefined) {
    if (typeof o.weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.weekStart)) return "weekStart must be YYYY-MM-DD";
    try {
      if (Temporal.PlainDate.from(o.weekStart).dayOfWeek !== 1) return "weekStart must be a Monday";
    } catch {
      return "weekStart must be a real date";
    }
    out.weekStart = o.weekStart;
  }
  if (o.now !== undefined) {
    if (typeof o.now !== "string") return "now must be an ISO instant";
    try {
      Temporal.Instant.from(o.now);
    } catch {
      return "now must be an ISO instant";
    }
    out.now = o.now;
  }
  if (o.refresh !== undefined) {
    if (typeof o.refresh !== "boolean") return "refresh must be true or false";
    out.refresh = o.refresh;
  }
  return out;
}

const summarize = (s: SourceResult<unknown>): SourceSummary => {
  const { items, ...rest } = s;
  return { ...rest, itemCount: items.length };
};

async function weekLoad(ctx: ActionContext, input: WeekLoadInput): Promise<WeekLoadData> {
  const loaded = await ctx.loadConfig();
  const parsed = loaded.parsed;
  const cfg = parsed.ok ? parsed.config : null;
  // With an invalid config nothing is guessed: no standing blocks either.
  const weekConfig = cfg?.week ?? { ...defaultWeekConfig, standingBlocks: [] };
  const shape = weekConfig.dayShape;
  const now = input.now ?? ctx.now();
  const weekStart = input.weekStart ?? defaultWeekStart(localToday(now, shape.timeZone));

  let dataverse: SourceResult<FocusPattern>;
  if (!cfg) {
    const n = parsed.ok ? 0 : parsed.errors.length;
    dataverse = {
      source: "dataverse",
      status: "misconfigured",
      fetchedAt: null,
      fromCache: false,
      items: [],
      message: `Config needs attention (${n} ${n === 1 ? "field" : "fields"})`,
      fixAction: "open_settings",
    };
  } else {
    let dv = cfg.dataverse;
    let resolveError: string | null = null;
    if (!dv.mySystemUserId) {
      const r = await ctx.makeDataverse(dv, shape.timeZone).resolveUserId(dv.myEmail);
      if (r.ok) {
        await ctx.saveSystemUserId(r.id);
        dv = { ...dv, mySystemUserId: r.id };
      } else resolveError = r.message;
    }
    dataverse = resolveError
      ? { source: "dataverse", status: "misconfigured", fetchedAt: null, fromCache: false, items: [], message: resolveError, fixAction: "open_settings" }
      : await ctx.makeDataverse(dv, shape.timeZone).load(weekStart, input.refresh ? { refresh: true } : {});
  }

  const sample = loadSampleSources();
  const week = buildWeek({ weekStart, patterns: dataverse.items, events: [...sample.outlook.items, ...sample.google.items], config: weekConfig });
  const clientColors = cfg ? cfg.clients : Object.fromEntries(Object.values(defaultClients).map((c) => [c.shortName, c.color]));

  return {
    weekStart,
    week,
    today: todayTarget(now, shape),
    sources: [dataverse, sample.outlook, sample.google].map(summarize),
    clients: clientColors,
    dayShape: shape,
    thresholds: weekConfig.thresholds,
    config: { ok: parsed.ok, path: loaded.path, created: !!loaded.created, errors: parsed.ok ? [] : parsed.errors },
  };
}

export async function dispatch(ctx: ActionContext, req: ActionRequest): Promise<ActionResponse> {
  switch (req.action) {
    case "week.load": {
      const input = validateWeekLoad(req.input ?? {});
      if (typeof input === "string") return bad(input);
      return { ok: true, data: await weekLoad(ctx, input) };
    }
    case "source.status": {
      if (req.input !== undefined && (typeof req.input !== "object" || req.input === null || Object.keys(req.input).length)) return bad("source.status takes no input");
      const d = await weekLoad(ctx, {});
      return { ok: true, data: { sources: d.sources, config: d.config } };
    }
    default:
      return bad("unknown action");
  }
}
