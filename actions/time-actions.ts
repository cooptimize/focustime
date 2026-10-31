// Time model actions (step 6b): the view range and one-day working hours (config), unavailable time and flex sessions
// (plan store). Nothing here writes to a calendar or any other external system.
import { overrideBody, replaceArrayTables, setValue, type WriteResult } from "../config/edit.ts";
import { parseConfig, type AppConfig } from "../config/schema.ts";
import { zonedAt } from "../week/dates.ts";
import { hoursOn, parseSpan, toMin, VIEW_RANGES, type DayOverride, type Span } from "../week/hours.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import type { ActionResponse } from "./types.ts";

export type TimeAction = "ui.set_view_range" | "hours.set_day" | "hours.clear_day" | "unavailable.add" | "unavailable.remove" | "flex.add" | "flex.remove";

export type TimeContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  writeConfig?: (edit: (text: string) => string) => Promise<WriteResult>;
  /** The loaded DevOps items, to name the item a flex session is for (read-only, nothing fetched here). */
  devops?: (cfg: AppConfig) => Pick<DevOpsSource, "lookup">;
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
function date(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid("date must be YYYY-MM-DD");
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid("date must be a real date");
  }
}
function text(v: unknown, name: string, max = 200): string {
  if (typeof v !== "string") throw new Invalid(`${name} must be text`);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) throw new Invalid(`${name} can't be empty`);
  if (t.length > max) throw new Invalid(`${name} must be ${max} characters or fewer`);
  return t;
}
const note = (v: unknown) => (v === undefined || v === null || v === "" ? null : text(v, "note", 500));
function id(v: unknown, name = "id"): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
}
/** "HH:MM" to "HH:MM" on one day; the end may be 24:00. */
function span(start: unknown, end: unknown): Span {
  const s = typeof start === "string" && typeof end === "string" ? parseSpan(`${start}-${end}`) : null;
  if (!s || toMin(s.end) <= toMin(s.start)) throw new Invalid("start and end must be times like 09:00, with the end after the start on the same day");
  return s;
}
function spanList(v: unknown, name: string): Span[] {
  if (!Array.isArray(v)) throw new Invalid(`${name} must be a list like ["09:00-17:00"], or [] for no working hours`);
  const out = v.map((x) => {
    const s = typeof x === "string" ? parseSpan(x) : null;
    if (!s || toMin(s.end) <= toMin(s.start)) throw new Invalid(`${name}: use "HH:MM-HH:MM", e.g. "09:00-17:00"`);
    return s;
  });
  const sorted = [...out].sort((a, b) => toMin(a.start) - toMin(b.start));
  for (let i = 1; i < sorted.length; i++) if (toMin(sorted[i]!.start) < toMin(sorted[i - 1]!.end)) throw new Invalid(`${name}: spans overlap`);
  return sorted;
}

const configRefusal = (r: WriteResult): ActionResponse => ({ ok: false, status: 409, error: `Fix the config first: ${r.parsed.ok ? "" : r.parsed.errors.map((e) => `${e.field} ${e.message}`).join("; ")}` });

/** Rewrites every [[hours.override]] table from the file's current overrides, changed by `change`. */
function editOverrides(change: (all: DayOverride[]) => DayOverride[]) {
  return (text: string) => {
    const now = parseConfig(text);
    if (!now.ok) return text; // writeConfig refuses it and reports the errors
    const next = change(now.config.week.hours.overrides).sort((a, b) => a.date.localeCompare(b.date));
    return replaceArrayTables(text, "hours.override", next.map(overrideBody), "One-day working hours (from a day's menu or Settings).");
  };
}

export async function timeAction(ctx: TimeContext, action: TimeAction, input: unknown): Promise<ActionResponse> {
  try {
    switch (action) {
      case "ui.set_view_range": {
        const o = fields(input, ["range"]);
        if (typeof o.range !== "string" || !(VIEW_RANGES as readonly string[]).includes(o.range)) throw new Invalid(`range must be one of ${VIEW_RANGES.join(", ")}`);
        if (!ctx.writeConfig) return bad("Settings can't be saved here", 503);
        const r = await ctx.writeConfig((t) => setValue(t, "ui", "view_range", o.range as string));
        return r.ok ? { ok: true, data: { ui: r.parsed.config.ui } } : configRefusal(r);
      }
      case "hours.set_day": {
        const o = fields(input, ["date", "segments"], ["lunch"]);
        const d = date(o.date);
        const segments = spanList(o.segments, "segments");
        const ov: DayOverride = { date: d, segments };
        if (o.lunch !== undefined) {
          if (o.lunch === "" || o.lunch === null) ov.lunch = null;
          else {
            const l = typeof o.lunch === "string" ? parseSpan(o.lunch) : null;
            if (!l) throw new Invalid('lunch must be "HH:MM-HH:MM", or "" for none');
            ov.lunch = l;
          }
        }
        if (!ctx.writeConfig) return bad("Settings can't be saved here", 503);
        const r = await ctx.writeConfig(editOverrides((all) => [...all.filter((x) => x.date !== d), ov]));
        return r.ok ? { ok: true, data: { hours: r.parsed.config.week.hours } } : configRefusal(r);
      }
      case "hours.clear_day": {
        const d = date(fields(input, ["date"]).date);
        if (!ctx.writeConfig) return bad("Settings can't be saved here", 503);
        const r = await ctx.writeConfig(editOverrides((all) => all.filter((x) => x.date !== d)));
        return r.ok ? { ok: true, data: { hours: r.parsed.config.week.hours } } : configRefusal(r);
      }
      case "unavailable.add":
      case "flex.add": {
        const plan = ctx.plan;
        if (!plan) return bad("The plan store isn't available", 503);
        const cfg = await ctx.config();
        if (!cfg) return bad("Fix the config first", 409);
        const tz = cfg.week.hours.timeZone;
        if (action === "unavailable.add") {
          const o = fields(input, ["date", "title", "start", "end"], ["note"]);
          const d = date(o.date);
          const s = span(o.start, o.end);
          const unavailable = plan.addUnavailable({ date: d, title: text(o.title, "title"), start: zonedAt(d, s.start, tz).toInstant().toString(), end: zonedAt(d, s.end, tz).toInstant().toString(), note: note(o.note) });
          return { ok: true, data: { unavailable } };
        }
        const o = fields(input, ["date", "clientKey", "start", "end"], ["itemId", "note"]);
        const d = date(o.date);
        const s = span(o.start, o.end);
        // A flex session is time outside working hours; inside them it would be counted twice.
        const inside = hoursOn(cfg.week.hours, d).segments.find((w) => toMin(s.start) < toMin(w.end) && toMin(s.end) > toMin(w.start));
        if (inside) return bad(`That overlaps working hours (${inside.start} to ${inside.end}). A flex session is time outside them`, 422);
        const clientKey = text(o.clientKey, "clientKey", 100);
        const itemId = o.itemId === undefined || o.itemId === null ? null : id(o.itemId, "itemId");
        let item: { title: string; url: string } | null = null;
        if (itemId !== null) {
          item = ctx.devops?.(cfg).lookup(clientKey, itemId) ?? null;
          if (!item) return bad(`Item ${itemId} is not among the loaded DevOps items for ${clientKey}. Refresh and try again`, 409);
        }
        const flex = plan.addFlex({
          date: d,
          clientKey,
          start: zonedAt(d, s.start, tz).toInstant().toString(),
          end: zonedAt(d, s.end, tz).toInstant().toString(),
          itemId,
          itemTitle: item?.title ?? null,
          itemUrl: item && item.url.startsWith("https://dev.azure.com/") ? item.url : null,
          note: note(o.note),
        });
        return { ok: true, data: { flex } };
      }
      case "unavailable.remove":
      case "flex.remove": {
        const plan = ctx.plan;
        if (!plan) return bad("The plan store isn't available", 503);
        const n = id(fields(input, ["id"]).id);
        if (action === "unavailable.remove") return plan.removeUnavailable(n) ? { ok: true, data: { removed: n } } : bad(`No unavailable time ${n}`, 404);
        if (!plan.getFlex(n)) return bad(`No flex session ${n}`, 404);
        try {
          plan.removeFlex(n);
        } catch (e) {
          if (e instanceof PlanError) return bad("This flex session has ended and its update is owed, so it stays on record", 409);
          throw e;
        }
        return { ok: true, data: { removed: n } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    throw e;
  }
}
