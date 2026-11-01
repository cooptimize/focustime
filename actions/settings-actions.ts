// Settings actions (step 6b): load everything Settings shows, save one section, store an app secret in the keyring,
// export the plan store. Secrets are never returned: only whether they are set and an expiry date Tanner entered.
import { DEFAULT_FOCUS } from "../plan/focussound.ts";
import { join } from "node:path";
import { DEFAULT_TIMEBOX, CLIENT_SLOTS, colorCss, DEFAULT_PLAN, inviteDomains, DEFAULT_COLLAB, type AppConfig, type ParseResult } from "../config/schema.ts";
import { secretExpiryEdit, settingsEdit, SETTINGS_SECTIONS, SettingsInputError, type SettingsSection } from "../config/settings.ts";
import type { WriteResult } from "../config/edit.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday } from "../week/dates.ts";
import { followState } from "../week/follow.ts";
import { followOptions } from "./follow.ts";
import type { ActionResponse, AppSecret, FieldProblem, HostBrowsers, SecretPresence, SettingsClient, SettingsData } from "./types.ts";

export type SettingsAction = "settings.load" | "settings.save" | "secret.set" | "data.export";

export const APP_SECRETS: readonly AppSecret[] = ["dataverse-client-secret", "google-client-secret"];

export type SettingsContext = {
  loadConfig: () => Promise<{ path: string; parsed: ParseResult }>;
  writeConfig?: (edit: (text: string) => string) => Promise<WriteResult>;
  makeDataverse: (cfg: AppConfig["dataverse"], timeZone: string) => Pick<DataverseSource, "myClients"> & Partial<Pick<DataverseSource, "following">>;
  /** The server clock (ISO instant), for which clients are followed today. */
  now?: () => string;
  plan?: PlanStore;
  /** Keyring presence and app secret writes (secrets/keyring.ts). Absent: shown as unavailable, can't be set. */
  secrets?: { state: (a: AppSecret) => Promise<SecretPresence>; set: (a: AppSecret, value: string) => Promise<void> };
  /** The host's browsers and profiles (server/host.ts). Absent: none found. */
  host?: HostBrowsers;
  /** Where data.export writes (0600), and how. */
  exportPlan?: (json: string) => Promise<string>;
};

const SECRET_LABELS: Record<AppSecret, string> = { "dataverse-client-secret": "Dataverse client secret", "google-client-secret": "Google client secret" };

function browsers(ctx: SettingsContext): SettingsData["browsers"] {
  const d = ctx.host?.detect();
  return { edge: d?.edge ?? { found: false, profiles: [] }, chromium: d ? { found: d.chromium.found, profiles: d.chromium.profiles } : { found: false, profiles: [] } };
}

const bad = (error: string, status = 400, fields?: FieldProblem[]): ActionResponse => ({ ok: false, status, error, ...(fields ? { fields } : {}) });

async function load(ctx: SettingsContext): Promise<SettingsData> {
  const loaded = await ctx.loadConfig();
  const secrets = await Promise.all(
    APP_SECRETS.map(async (account) => ({
      account,
      label: SECRET_LABELS[account],
      state: ctx.secrets ? await ctx.secrets.state(account).catch((): SecretPresence => "unavailable") : ("unavailable" as const),
      expires: loaded.parsed.ok ? (loaded.parsed.config.secretExpiry[account] ?? null) : null,
    })),
  );
  const base = { configPath: loaded.path, palette: CLIENT_SLOTS, browsers: browsers(ctx), secrets, data: { planStore: !!ctx.plan } };
  if (!loaded.parsed.ok)
    return { ...base, problems: loaded.parsed.errors, dataverseReached: false, you: null, hours: null, standingBlocks: [], risk: null, planning: { pickablePortfolioTypes: [], ...DEFAULT_PLAN, sizes: { ...DEFAULT_PLAN.sizes } }, focus: { ...DEFAULT_FOCUS, playlists: [] }, clients: [], display: null, timebox: { ...DEFAULT_TIMEBOX }, collab: { ...DEFAULT_COLLAB, domains: [] } };
  const cfg = loaded.parsed.config;
  const tz = cfg.week.hours.timeZone;
  const dv = cfg.dataverse.mySystemUserId ? ctx.makeDataverse(cfg.dataverse, tz) : null;
  const [fetched, follow] = await Promise.all([
    dv ? dv.myClients().catch(() => null) : Promise.resolve(null),
    // Which clients are followed (step 6d). Without the read (or its cache) the state is unknown, not guessed.
    dv?.following && ctx.now
      ? followOptions(dv as Pick<DataverseSource, "following">, cfg, localToday(ctx.now(), tz), {}, []).catch(() => null)
      : Promise.resolve(null),
  ]);
  const mine = fetched ?? [];
  const keys = [...new Set([...mine.map((c) => c.clientKey), ...Object.keys(cfg.clientSettings), ...cfg.week.standingBlocks.map((b) => b.clientKey)])].sort((a, b) => a.localeCompare(b));
  const clients = keys.map((key): SettingsClient => {
    const m = mine.find((c) => c.clientKey === key);
    const setting = cfg.clientSettings[key] ?? { color: null, name: null, browser: "edge", profile: null, openStates: [], follow: false };
    const profile = setting.profile ?? (setting.browser === "edge" && Object.hasOwn(cfg.edge.profiles, key) ? cfg.edge.profiles[key]! : null);
    // Without the focus time read, only what doesn't need it is known (internal, standing block, Keep following).
    const sure = follow ? followState(key, follow.usable ? follow.patterns : [], follow.options) : null;
    const state = sure && (follow!.usable || sure.active) ? sure : null;
    // Step 14: whose write PAT this client has, if any (never the PAT).
    const w = ctx.plan?.devopsIdentity(key) ?? null;
    const write = w ? { name: w.name, email: w.email, org: w.org, validatedAt: w.validatedAt, expires: w.expires } : null;
    return { key, dataverseName: m?.clientName ?? null, devopsEmail: m?.devopsEmail ?? null, devops: m?.devops ?? false, setting, profile, css: setting.color ? colorCss(setting.color) : null, follow: state, write };
  });
  return {
    ...base,
    problems: [],
    dataverseReached: fetched !== null,
    you: { email: cfg.dataverse.myEmail, systemUserId: cfg.dataverse.mySystemUserId, environmentUrl: cfg.dataverse.environmentUrl, timeZone: tz },
    hours: cfg.week.hours,
    standingBlocks: cfg.week.standingBlocks,
    risk: cfg.week.thresholds,
    planning: cfg.plan,
    focus: cfg.focus,
    clients,
    display: cfg.ui,
    timebox: cfg.timebox,
    collab: { ...cfg.collab, domains: inviteDomains(cfg) },
  };
}

/** parseConfig's field names, plainly. */
const fieldsOf = (r: WriteResult): FieldProblem[] => (r.parsed.ok ? [] : r.parsed.errors.map((e) => ({ field: e.field, message: e.message })));

export async function settingsAction(ctx: SettingsContext, action: SettingsAction, input: unknown): Promise<ActionResponse> {
  const o = (typeof input === "object" && input !== null && !Array.isArray(input) ? input : null) as Record<string, unknown> | null;
  if (!o) return bad("input must be an object");
  switch (action) {
    case "settings.load":
      if (Object.keys(o).length) return bad("settings.load takes {}");
      return { ok: true, data: await load(ctx) };
    case "settings.save": {
      for (const k of Object.keys(o)) if (k !== "section" && k !== "values") return bad(`unknown input field ${k}`);
      if (typeof o.section !== "string" || !(SETTINGS_SECTIONS as readonly string[]).includes(o.section)) return bad(`section must be one of ${SETTINGS_SECTIONS.join(", ")}`);
      if (!ctx.writeConfig) return bad("Settings can't be saved here", 503);
      let edit: (text: string) => string;
      try {
        const chromium = o.section === "client" ? ctx.host?.detect().chromium ?? null : null;
        const uwsm = (await ctx.loadConfig()).parsed;
        const prefix = uwsm.ok && uwsm.config.edge.command[0] === "uwsm-app" ? ["uwsm-app", "--"] : [];
        edit = settingsEdit(o.section as SettingsSection, o.values, { chromiumCommand: chromium?.command ? [...prefix, ...chromium.command] : null });
      } catch (e) {
        if (e instanceof SettingsInputError) return bad(`${e.field}: ${e.message}`, 422, [{ field: e.field, message: e.message }]);
        throw e;
      }
      const r = await ctx.writeConfig(edit);
      if (!r.ok) {
        const fields = fieldsOf(r);
        return bad(`Not saved: ${fields.map((f) => `${f.field} ${f.message}`).join("; ")}`, 422, fields);
      }
      return { ok: true, data: { settings: await load(ctx), backup: r.backup.split("/").pop() } };
    }
    case "secret.set": {
      for (const k of Object.keys(o)) if (!["account", "value", "expires"].includes(k)) return bad(`unknown input field ${k}`);
      if (typeof o.account !== "string" || !(APP_SECRETS as readonly string[]).includes(o.account)) return bad(`account must be one of ${APP_SECRETS.join(", ")}`);
      const account = o.account as AppSecret;
      const expires = o.expires === undefined || o.expires === null || o.expires === "" ? null : o.expires;
      if (expires !== null && (typeof expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expires))) return bad("expires must be a date like 2027-03-01", 422, [{ field: "expires", message: "Must be a date like 2027-03-01" }]);
      // Either a new value, an expiry date, or both. The value goes to the keyring and nowhere else.
      if (o.value !== undefined) {
        if (typeof o.value !== "string" || !o.value || o.value.length > 1024 || /[\r\n]/.test(o.value)) return bad("The secret must be one line of 1 to 1024 characters", 422, [{ field: "value", message: "One line of 1 to 1024 characters" }]);
        if (!ctx.secrets) return bad("The keyring isn't available here", 503);
        try {
          await ctx.secrets.set(account, o.value);
        } catch {
          return bad("The keyring refused the secret (locked or unavailable). Unlock it and try again", 503);
        }
      }
      if (o.expires !== undefined && ctx.writeConfig) {
        const r = await ctx.writeConfig(secretExpiryEdit(account, expires as string | null));
        if (!r.ok) return bad("Secret saved, but the expiry date was not", 422, fieldsOf(r));
      }
      return { ok: true, data: { account, changed: o.value !== undefined ? "secret" : "expiry" } };
    }
    case "data.export": {
      if (Object.keys(o).length) return bad("data.export takes {}");
      if (!ctx.plan || !ctx.exportPlan) return bad("The plan store isn't available", 503);
      const path = await ctx.exportPlan(`${JSON.stringify(ctx.plan.exportJson(), null, 2)}\n`);
      return { ok: true, data: { path } };
    }
  }
}

/** Default export location: ~/.local/share/coopilot/exports/plan-<stamp>.json. */
export const exportPath = (dataDir: string, stamp: string) => join(dataDir, "exports", `plan-${stamp.replace(/[^0-9TZ]/g, "")}.json`);
