// ADM-1: the four kinds of setting, and how a value is resolved. Pure: rows in, values out; no I/O.
//   Rule              set by admins, the same for everyone, not changeable per person.
//   Default           set by admins; each person may override it for themselves ("Reset to team default").
//   Default by level  set by admins per level (Consultant, Senior consultant, Lead consultant); each person may override.
//   Personal          each person's own, as before ([hours], [ui], ...; config/schema.ts).
// Org values are rows of the app table org_settings: (scope, key, value as JSON). Scopes: "org", "client:<client key>"
// and "level:<consultant|senior|lead>". A read resolves: personal override, then the level default, then the org
// default, then the built-in default (resolve()). Every key has a spec here (its kind, area, words, validation and
// built-in value); an admin write is refused for a key that has none. Nothing secret is ever an org setting.
import { DEFAULT_ACK_PHRASES, DEFAULT_PROMISE_PHRASES, DEFAULT_REQUEST_PHRASES } from "../plan/asks.ts";
import { WEEKDAY_KEYS, parseSpan, type WeekdayKey } from "../week/hours.ts";
import { CLIENT_SLOTS } from "./schema.ts";

export type SettingKind = "rule" | "default" | "level" | "personal";
export const KIND_NAMES: Record<SettingKind, string> = { rule: "Rule", default: "Default", level: "Default by level", personal: "Personal" };

/** People's levels at Cooptimize (systemuser.positionid → position.name in Dataverse). Guidance, never permissions. */
export const LEVELS = ["consultant", "senior", "lead"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_NAMES: Record<Level, string> = { consultant: "Consultant", senior: "Senior consultant", lead: "Lead consultant" };
/** Dataverse's position names (any case) to levels. */
export function levelFromPosition(name: unknown): Level | null {
  if (typeof name !== "string") return null;
  const n = name.trim().toLowerCase();
  return n === "consultant" ? "consultant" : n === "senior consultant" ? "senior" : n === "lead consultant" ? "lead" : null;
}

export type AdminArea = "clients" | "ai" | "conversations" | "organization" | "levels" | "people";

export class OrgInputError extends Error {}

type Spec<T = unknown> = { kind: SettingKind; area: AdminArea; label: string; builtin: T; parse: (v: unknown) => T };

const bool = (v: unknown): boolean => {
  if (typeof v !== "boolean") throw new OrgInputError("Must be on or off");
  return v;
};
const intIn = (min: number, max: number, what: string) => (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new OrgInputError(`Must be a whole number of ${what} from ${min} to ${max}`);
  return v;
};
const usd = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10_000) throw new OrgInputError("Must be a number of dollars from 0 to 10000");
  return Math.round(v * 100) / 100;
};
const text = (max: number) => (v: unknown): string => {
  if (typeof v !== "string" || v.length > max) throw new OrgInputError(`Must be text of at most ${max} characters`);
  return v.trim();
};
const list = (maxItems: number, maxLen: number, lower = false) => (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length > maxItems || v.some((x) => typeof x !== "string" || x.length > maxLen)) throw new OrgInputError(`Must be a list of up to ${maxItems} entries, each at most ${maxLen} characters`);
  const out = (v as string[]).map((x) => (lower ? x.trim().toLowerCase() : x.trim())).filter(Boolean);
  return [...new Set(out)];
};
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const domains = (v: unknown): string[] => {
  const d = list(20, 100, true)(v);
  const bad = d.find((x) => !DOMAIN.test(x));
  if (bad) throw new OrgInputError(`${bad} isn't a domain name like example.com`);
  return d;
};
const orNull = <T>(p: (v: unknown) => T) => (v: unknown): T | null => (v === null ? null : p(v));

export type FeedbackRule = { org: string; project: string; parentId: number; live: boolean };
const feedback = (v: unknown): FeedbackRule => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new OrgInputError("Must be a DevOps organization, project and parent feature");
  const o = v as Record<string, unknown>;
  const org = text(100)(o.org);
  const project = text(100)(o.project);
  const parentId = intIn(1, 99_999_999, "")(o.parentId);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(org)) throw new OrgInputError("The organization is a DevOps organization name, like cooptimize");
  if (!project) throw new OrgInputError("Name the project");
  return { org, project, parentId, live: bool(o.live) };
};

/** Working week, day shape and risk thresholds for new people (prefilled into Setup; theirs to change after). */
export type NewPersonDefaults = { weekdays: Record<WeekdayKey, string[]>; lunch: string; risk: { watch: number; atRisk: number; minWindow: number } };
export const BUILTIN_NEW_PERSON: NewPersonDefaults = {
  weekdays: { mon: ["09:00-17:00"], tue: ["09:00-17:00"], wed: ["09:00-17:00"], thu: ["09:00-17:00"], fri: ["09:00-17:00"], sat: [], sun: [] },
  lunch: "12:00-12:00",
  risk: { watch: 90, atRisk: 150, minWindow: 90 },
};
const newPerson = (v: unknown): NewPersonDefaults => {
  if (typeof v !== "object" || v === null) throw new OrgInputError("Must be a working week");
  const o = v as Record<string, unknown>;
  const wd = (o.weekdays ?? {}) as Record<string, unknown>;
  const weekdays = Object.fromEntries(
    WEEKDAY_KEYS.map((k) => {
      const spans = list(3, 11)(wd[k] ?? []);
      for (const s of spans) if (!parseSpan(s)) throw new OrgInputError(`${s} isn't a time span like 09:00-17:00`);
      return [k, spans];
    }),
  ) as Record<WeekdayKey, string[]>;
  const lunch = text(11)(o.lunch ?? "");
  if (lunch && !parseSpan(lunch) && !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(lunch)) throw new OrgInputError("Lunch is a span like 12:00-12:30, or empty");
  const r = (o.risk ?? {}) as Record<string, unknown>;
  const m = intIn(1, 600, "minutes");
  return { weekdays, lunch, risk: { watch: m(r.watch), atRisk: m(r.atRisk), minWindow: m(r.minWindow) } };
};

// ---------- colors ----------

/** The brand's navy and green: never suggested for a client, and refused as a client's color (too easily mistaken for FocusTime's own). */
export const BRAND_COLORS = ["#00416b", "#42783c", "#9cc24f"] as const;
/** The palette slots suggested for clients, in order. Green is left out: it reads as the brand's green. */
export const SUGGESTED_SLOTS = CLIENT_SLOTS.filter((s) => s !== "green");
/** The two backgrounds a client color sits on: the dark and the light theme's page. */
export const THEME_BACKGROUNDS = ["#0d1318", "#f4f5f7"] as const;
/** Each slot's dark and light theme value (ui/styles.css), for distinctness checks. */
export const SLOT_VALUES: Record<string, readonly [string, string]> = {
  teal: ["#3fc1ae", "#0f8576"],
  violet: ["#b8a2ff", "#6b4fd8"],
  ochre: ["#e3a24a", "#a8620c"],
  blue: ["#4f8de8", "#1f5fb8"],
  rose: ["#f0b0e8", "#d0457a"],
  earth: ["#efe3c4", "#5e5040"],
  green: ["#9acd5a", "#4b8a1f"],
  slate: ["#8fa0b8", "#4e5f78"],
};

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio between two "#rrggbb" colors. */
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
/** A rough distance between two colors (0 to about 442): under 60 looks like the same color on a card's edge. */
export const distance = (a: string, b: string) => {
  const [p, q] = [rgb(a), rgb(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
/** A color's values in both themes: a slot's two, a hex as itself twice. */
export const themeValues = (c: string): readonly [string, string] => SLOT_VALUES[c] ?? [c, c];
/** Readable in both themes: at least 3:1 against both page backgrounds (a hex), or a palette slot (each theme has its own value). */
export const readableEverywhere = (c: string) => !!SLOT_VALUES[c] || THEME_BACKGROUNDS.every((bg) => contrast(c, bg) >= 3);
const HEX = /^#[0-9a-f]{6}$/i;
/** Why a color can't be a client's, or null. */
export function colorProblem(c: string): string | null {
  if (SLOT_VALUES[c]) return null;
  if (!HEX.test(c)) return `Must be a palette color (${CLIENT_SLOTS.join(", ")}) or "#rrggbb"`;
  if (BRAND_COLORS.some((b) => distance(b, c.toLowerCase()) < 40)) return "Too close to FocusTime's own navy or green";
  if (!readableEverywhere(c)) return "Hard to see in the light or the dark theme; pick a mid-tone color";
  return null;
}
const hsl = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
/**
 * A color for a client with none: the first palette slot no other client has, else a mid-tone hex readable in both
 * themes, as far as can be from every color already used and from the brand's. Deterministic for the same input.
 */
export function suggestColor(taken: readonly string[]): string {
  const used = new Set(taken);
  const slot = SUGGESTED_SLOTS.find((s) => !used.has(s));
  if (slot) return slot;
  const usedValues = [...taken.flatMap((c) => [...themeValues(c)]), ...BRAND_COLORS].filter((c) => HEX.test(c));
  let best: { c: string; d: number } | null = null;
  for (let i = 0; i < 72; i++) {
    const h = (i * 137.508) % 360;
    for (const l of [0.5, 0.45, 0.55, 0.42]) {
      const c = hsl(h, 0.62, l);
      if (!readableEverywhere(c) || colorProblem(c)) continue;
      const d = Math.min(...usedValues.map((u) => distance(u, c)));
      if (!best || d > best.d) best = { c, d };
    }
  }
  return best?.c ?? "#8a6fd0";
}

// ---------- the keys ----------

/** Org-wide keys (scope "org"). */
export const ORG_SPECS = {
  "ai.on": { kind: "rule", area: "ai", label: "AI for FocusTime", builtin: false, parse: bool },
  "ai.model": { kind: "rule", area: "ai", label: "Model", builtin: "", parse: (v) => {
    const s = text(60)(v);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(s)) throw new OrgInputError("A model name, like gpt-6-luna");
    return s;
  } },
  "ai.person_cap_usd": { kind: "rule", area: "ai", label: "Monthly cap per person (US dollars)", builtin: 10, parse: usd },
  "ai.app_cap_usd": { kind: "rule", area: "ai", label: "Monthly cap for everyone (US dollars)", builtin: 100, parse: usd },
  "conv.request_phrases": { kind: "default", area: "conversations", label: "Request phrases", builtin: [...DEFAULT_REQUEST_PHRASES], parse: list(50, 60, true) },
  "conv.ack_phrases": { kind: "default", area: "conversations", label: "Thanks and short replies", builtin: [...DEFAULT_ACK_PHRASES], parse: list(50, 60, true) },
  "conv.promise_phrases": { kind: "default", area: "conversations", label: "Commitment phrases", builtin: [...DEFAULT_PROMISE_PHRASES], parse: list(50, 60, true) },
  // ADM-2 (D582): read live by the poller each tick; 1 to 30 (a stored value outside it falls back to 5 with a Status line).
  "conv.poll_minutes": { kind: "rule", area: "conversations", label: "Read client chats every (minutes)", builtin: 5, parse: intIn(1, 30, "minutes") },
  "conv.retention_days": { kind: "rule", area: "conversations", label: "Keep messages that aren't requests (days)", builtin: 14, parse: intIn(1, 90, "days") },
  "conv.closed_shown_days": { kind: "rule", area: "conversations", label: "Closed conversations stay shown (days)", builtin: 14, parse: intIn(1, 90, "days") },
  "conv.chat_ai_daily_cap": { kind: "rule", area: "conversations", label: "AI requests per chat per day", builtin: 200, parse: intIn(0, 5000, "requests") },
  // ADM-2 (D578): also who is a Cooptimizer (sign-in and People); help invites go only to these too.
  "org.invite_domains": { kind: "rule", area: "organization", label: "Cooptimize email domains (sign-in and people)", builtin: [] as string[], parse: domains },
  "org.never_suggest": { kind: "rule", area: "organization", label: "Never suggested as helpers or Who", builtin: ["Kat 🤖"], parse: list(100, 100) },
  "org.feedback": { kind: "rule", area: "organization", label: "Send feedback goes to", builtin: null as FeedbackRule | null, parse: orNull(feedback) },
  "org.retention_years": { kind: "rule", area: "organization", label: "Keep people's data (years)", builtin: 2, parse: intIn(1, 10, "years") },
  "org.new_person": { kind: "default", area: "organization", label: "Working week for new people", builtin: BUILTIN_NEW_PERSON, parse: newPerson },
} satisfies Record<string, Spec>;
export type OrgKey = keyof typeof ORG_SPECS;

/** Per-client keys (scope "client:<key>"). */
export const CLIENT_SPECS = {
  color: { kind: "default", area: "clients", label: "Team color", builtin: null as string | null, parse: orNull((v) => {
    const c = text(7)(v);
    const p = colorProblem(c);
    if (p) throw new OrgInputError(p);
    return c;
  }) },
  allow_ai: { kind: "rule", area: "ai", label: "Allow AI", builtin: false, parse: bool },
  attachments_ai: { kind: "rule", area: "ai", label: "Send attachments to AI", builtin: false, parse: (v) => {
    // A later step: the switch is shown and stays off.
    if (bool(v)) throw new OrgInputError("Sending attachments to AI comes in a later step");
    return false;
  } },
  open_states: { kind: "rule", area: "clients", label: "States treated as open", builtin: [] as string[], parse: list(20, 60) },
  // WT-1's process overrides, one switch per type in Admin › Clients (type names; matched without case).
  no_breakdown: { kind: "rule", area: "clients", label: "Types that don't need breakdown", builtin: [] as string[], parse: list(40, 100) },
  background: { kind: "rule", area: "clients", label: "Background types", builtin: [] as string[], parse: list(40, 100) },
  house_style: { kind: "rule", area: "clients", label: "House style for Break down", builtin: null as string | null, parse: orNull(text(1200)) },
  // ADM-2 (D575): an admin's two per-account overrides of the customer rule (plan/client-accounts.ts).
  treat_as_client: { kind: "rule", area: "clients", label: "Treat as a client", builtin: false, parse: bool },
  hidden: { kind: "rule", area: "clients", label: "Hide from FocusTime", builtin: false, parse: bool },
} satisfies Record<string, Spec>;
export type ClientKeyName = keyof typeof CLIENT_SPECS;

/** Guidance by level (scope "level:<level>"). Each person may override any of these for themselves. */
export type Guidance = { draftStories: boolean; readinessNudges: boolean; planShare: number };
export const LEVEL_SPECS = {
  draft_stories: { kind: "level", area: "levels", label: "Draft stories offered", builtin: true, parse: bool },
  readiness_nudges: { kind: "level", area: "levels", label: "Readiness nudges in Plan ahead", builtin: true, parse: bool },
  // "plan_share": the share of a client's free time Plan the week plans up to before the amber over line. Named so a
  // later per-client "Keep open" share can join it (planned up to = free × plan share × (1 − keep open)).
  plan_share: { kind: "level", area: "levels", label: "Plan up to (% of free time)", builtin: 100, parse: intIn(50, 100, "percent") },
} satisfies Record<string, Spec>;
export type LevelKeyName = keyof typeof LEVEL_SPECS;
/** The starting level defaults (ADM-1): Consultants plan up to 80% of their free time; everything else as before. */
export const LEVEL_STARTERS: Record<Level, Partial<Record<LevelKeyName, unknown>>> = { consultant: { plan_share: 80 }, senior: {}, lead: {} };
const GUIDANCE_KEY: Record<LevelKeyName, keyof Guidance> = { draft_stories: "draftStories", readiness_nudges: "readinessNudges", plan_share: "planShare" };

/** ADM-2: per-person keys (scope "person:<id>"), set by an admin. */
export const PERSON_SPECS = {
  automation: { kind: "rule", area: "people", label: "Automation account", builtin: false, parse: bool },
} satisfies Record<string, Spec>;

export type Scope = "org" | `client:${string}` | `level:${Level}` | `person:${string}`;
export const clientScope = (k: string): Scope => `client:${k}`;
export const personScope = (id: string): Scope => `person:${id.toLowerCase()}`;

/** The spec for a scope and key, or null (refused). */
export function specFor(scope: string, key: string): Spec | null {
  if (scope === "org") return (ORG_SPECS as Record<string, Spec>)[key] ?? null;
  if (scope.startsWith("client:") && scope.length > 7 && scope.length <= 107) return (CLIENT_SPECS as Record<string, Spec>)[key] ?? null;
  if (scope.startsWith("level:") && (LEVELS as readonly string[]).includes(scope.slice(6))) return (LEVEL_SPECS as Record<string, Spec>)[key] ?? null;
  if (/^person:(dv:)?[0-9a-f-]{36}$/.test(scope)) return (PERSON_SPECS as Record<string, Spec>)[key] ?? null;
  return null;
}

/** One stored org value. `value` is JSON. */
export type OrgRow = { scope: string; key: string; value: string; updatedAt: string; updatedBy: string | null };

/** What the app config supplies when nothing is stored (the bootstrap: env values). */
export type OrgBootstrap = { model: string; appCapUsd: number; inviteDomains: readonly string[]; feedback: FeedbackRule | null };

/** Every org value resolved: stored, else bootstrap, else built-in. */
export type OrgRules = {
  ai: { on: boolean; model: string; personCapUsd: number; appCapUsd: number; allowedClients: string[] };
  conversations: { pollMinutes: number; retentionDays: number; closedShownDays: number; chatAiDailyCap: number; requestPhrases: string[]; ackPhrases: string[]; promisePhrases: string[] };
  organization: { inviteDomains: string[]; neverSuggest: string[]; feedback: FeedbackRule | null; retentionYears: number; newPerson: NewPersonDefaults };
  clients: Record<string, ClientRules>;
  levels: Record<Level, Guidance>;
  /** ADM-2: ids an admin flagged as automation accounts. */
  automation: string[];
  /** ADM-2 (D582): team values stored that no longer validate, each read as its built-in value (Status shows them). */
  problems: { key: string; label: string; fallback: unknown }[];
};
export type ClientRules = { color: string | null; allowAi: boolean; attachmentsAi: boolean; openStates: string[]; /** Parent or top types that don't need breakdown. */ noBreakdown: string[]; /** Types that don't count against hours. */ background: string[]; houseStyle: string | null; treatAsClient: boolean; hidden: boolean };
export const NO_CLIENT_RULES: ClientRules = { color: null, allowAi: false, attachmentsAi: false, openStates: [], noBreakdown: [], background: [], houseStyle: null, treatAsClient: false, hidden: false };

const parsed = (r: OrgRow): unknown => {
  try {
    return JSON.parse(r.value);
  } catch {
    return undefined;
  }
};
/** A stored value through its spec; a stored value that no longer validates falls back (never throws on read). */
function valueOf<T>(rows: Map<string, OrgRow>, scope: string, key: string, spec: Spec<T>, fallback: T): T {
  const r = rows.get(`${scope}\u0000${key}`);
  if (!r) return fallback;
  try {
    return spec.parse(parsed(r));
  } catch {
    return fallback;
  }
}

export function resolveRules(rows: readonly OrgRow[], boot: OrgBootstrap): OrgRules {
  const m = new Map(rows.map((r) => [`${r.scope}\u0000${r.key}`, r]));
  const problems: OrgRules["problems"] = [];
  const o = <K extends OrgKey>(k: K, fallback?: (typeof ORG_SPECS)[K]["builtin"]) => {
    const fb = fallback ?? ORG_SPECS[k].builtin;
    const r = m.get(`org\u0000${k}`);
    if (r && !problems.some((p) => p.key === k)) {
      try {
        (ORG_SPECS[k] as Spec).parse(parsed(r));
      } catch {
        problems.push({ key: k, label: ORG_SPECS[k].label, fallback: fb });
      }
    }
    return valueOf(m, "org", k, ORG_SPECS[k] as Spec, fb) as (typeof ORG_SPECS)[K]["builtin"];
  };
  const clientKeys = [...new Set(rows.filter((r) => r.scope.startsWith("client:")).map((r) => r.scope.slice(7)))];
  const clients: Record<string, ClientRules> = {};
  for (const k of clientKeys) {
    const s = `client:${k}`;
    const c = <K extends ClientKeyName>(key: K) => valueOf(m, s, key, CLIENT_SPECS[key] as Spec, CLIENT_SPECS[key].builtin) as (typeof CLIENT_SPECS)[K]["builtin"];
    clients[k] = { color: c("color"), allowAi: c("allow_ai"), attachmentsAi: false, openStates: c("open_states"), noBreakdown: c("no_breakdown"), background: c("background"), houseStyle: c("house_style"), treatAsClient: c("treat_as_client"), hidden: c("hidden") };
  }
  const levels = Object.fromEntries(
    LEVELS.map((l) => {
      const g = {} as Guidance;
      for (const [key, spec] of Object.entries(LEVEL_SPECS) as [LevelKeyName, Spec][]) {
        const start = LEVEL_STARTERS[l][key] ?? spec.builtin;
        (g as Record<string, unknown>)[GUIDANCE_KEY[key]] = valueOf(m, `level:${l}`, key, spec, start);
      }
      return [l, g];
    }),
  ) as Record<Level, Guidance>;
  return {
    ai: {
      on: o("ai.on"),
      model: o("ai.model", boot.model) || boot.model,
      personCapUsd: o("ai.person_cap_usd"),
      appCapUsd: o("ai.app_cap_usd", boot.appCapUsd),
      allowedClients: Object.entries(clients).filter(([, c]) => c.allowAi).map(([k]) => k).sort(),
    },
    conversations: { pollMinutes: o("conv.poll_minutes"), retentionDays: o("conv.retention_days"), closedShownDays: o("conv.closed_shown_days"), chatAiDailyCap: o("conv.chat_ai_daily_cap"), requestPhrases: o("conv.request_phrases"), ackPhrases: o("conv.ack_phrases"), promisePhrases: o("conv.promise_phrases") },
    organization: {
      // Kept as the bootstrap when nothing is stored (the env values, D512).
      inviteDomains: m.has("org\u0000org.invite_domains") ? o("org.invite_domains") : [...boot.inviteDomains],
      neverSuggest: o("org.never_suggest"),
      feedback: m.has("org\u0000org.feedback") ? (o("org.feedback") ?? boot.feedback) : boot.feedback,
      retentionYears: o("org.retention_years"),
      newPerson: o("org.new_person"),
    },
    clients,
    levels,
    automation: rows.filter((r) => r.scope.startsWith("person:") && r.key === "automation" && parsed(r) === true).map((r) => r.scope.slice(7)).sort(),
    problems,
  };
}

export const clientRules = (r: OrgRules, k: string): ClientRules => r.clients[k] ?? NO_CLIENT_RULES;

/** The four-kind read: personal override, then the level default, then the org default, then the built-in one. */
export function resolve<T>(o: { personal?: T | null | undefined; level?: T | null | undefined; org?: T | null | undefined; builtin: T }): { value: T; from: "personal" | "level" | "org" | "builtin" } {
  if (o.personal !== undefined && o.personal !== null) return { value: o.personal, from: "personal" };
  if (o.level !== undefined && o.level !== null) return { value: o.level, from: "level" };
  if (o.org !== undefined && o.org !== null) return { value: o.org, from: "org" };
  return { value: o.builtin, from: "builtin" };
}

/** A person's guidance: their own choices over their level's defaults (no level: the built-in ones). */
export function guidanceFor(r: OrgRules, level: Level | null, personal: Partial<Guidance>): Guidance {
  const lv = level ? r.levels[level] : null;
  const builtin: Guidance = { draftStories: LEVEL_SPECS.draft_stories.builtin, readinessNudges: LEVEL_SPECS.readiness_nudges.builtin, planShare: LEVEL_SPECS.plan_share.builtin };
  return {
    draftStories: resolve({ personal: personal.draftStories, level: lv?.draftStories, builtin: builtin.draftStories }).value,
    readinessNudges: resolve({ personal: personal.readinessNudges, level: lv?.readinessNudges, builtin: builtin.readinessNudges }).value,
    planShare: resolve({ personal: personal.planShare, level: lv?.planShare, builtin: builtin.planShare }).value,
  };
}

/** Team phrases plus a person's own, never fewer than the team's (a person can't remove one). */
export const withMine = (team: readonly string[], mine: readonly string[]): string[] => [...new Set([...team, ...mine.map((p) => p.trim().toLowerCase()).filter(Boolean)])];
/** A person's own phrases: theirs minus the team's (what they added on top). */
export const onlyMine = (team: readonly string[], mine: readonly string[]): string[] => {
  const t = new Set(team);
  return [...new Set(mine.map((p) => p.trim().toLowerCase()).filter((p) => p && !t.has(p)))];
};

/** Each client's color for the team: the admin's, else the one FocusTime suggested and stored. */
export const teamColors = (r: OrgRules): Record<string, string> => Object.fromEntries(Object.entries(r.clients).filter(([, c]) => c.color).map(([k, c]) => [k, c.color!]));
