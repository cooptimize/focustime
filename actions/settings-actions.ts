// Settings actions (step 6b): load everything Settings shows, save one section, store an app secret in the keyring,
// export the plan store. Secrets are never returned: only whether they are set and an expiry date I entered.
import { mapSeq } from "./seq.ts";
import { DEFAULT_THRESHOLDS } from "../plan/roadmap.ts";
import { DEFAULT_ASK_SETTINGS } from "../plan/asks.ts";
import { DEFAULT_FOCUS } from "../plan/focussound.ts";
import { DEFAULT_TIMEBOX, CLIENT_SLOTS, colorCss, DEFAULT_PLAN, inviteDomains, DEFAULT_COLLAB, type AppConfig, type ParseResult } from "../config/schema.ts";
import { DEFAULT_NOTIFY } from "../plan/notify.ts";
import { DEFAULT_AZURE } from "../config/schema.ts";
import { secretExpiryEdit, settingsEdit, SETTINGS_SECTIONS, SettingsInputError, type SettingsSection } from "../config/settings.ts";
import type { WriteResult } from "../config/edit.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday } from "../week/dates.ts";
import { followState, INTERNAL_CLIENT } from "../week/follow.ts";
import { followOptions } from "./follow.ts";
import type { ActionResponse, AppSecret, FieldProblem, SecretPresence, SettingsClient, SettingsData } from "./types.ts";
import { userZone } from "../week/zone.ts";
import { DATAVERSE_UNREACHABLE, noDataverseMatch, type MatchResult } from "./dataverse-words.ts";

export type SettingsAction = "settings.load" | "settings.save" | "secret.set" | "data.export";

export const APP_SECRETS: readonly AppSecret[] = ["dataverse-client-secret", "google-client-secret"];

export type SettingsContext = {
  /** The config as written (what a save edits). */
  loadConfig: () => Promise<{ path: string; parsed: ParseResult }>;
  /** The config as the signed-in person sees it ("me" from the sign-in, the Dataverse user kept with it). Absent: loadConfig. */
  viewConfig?: () => Promise<{ path: string; parsed: ParseResult }>;
  /** Finds and keeps my Dataverse user when none is known yet (dispatch's matchMe). Absent: nothing to try. */
  findMe?: (dv: AppConfig["dataverse"], timeZone: string) => Promise<MatchResult>;
  writeConfig?: (edit: (text: string) => string) => Promise<WriteResult>;
  makeDataverse: (cfg: AppConfig["dataverse"], timeZone: string) => Pick<DataverseSource, "myClients"> & Partial<Pick<DataverseSource, "following">>;
  /** The server clock (ISO instant), for which clients are followed today. */
  now?: () => string;
  plan?: PlanStore;
  /** Secret presence and app secret writes (the host's secret store). Absent: shown as unavailable, can't be set. */
  secrets?: { state: (a: AppSecret) => Promise<SecretPresence>; set: (a: AppSecret, value: string) => Promise<void> };
  /** Where data.export writes (0600), and how. */
  exportPlan?: (json: string) => Promise<string>;
};

const SECRET_LABELS: Record<AppSecret, string> = { "dataverse-client-secret": "Dataverse client secret", "google-client-secret": "Google client secret" };

const bad = (error: string, status = 400, fields?: FieldProblem[]): ActionResponse => ({ ok: false, status, error, ...(fields ? { fields } : {}) });

/** A config file on disk (an absolute path), as against "your FocusTime account" or the demo's words. */
export const isFilePath = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("~/");

async function load(ctx: SettingsContext): Promise<SettingsData> {
  const loaded = await (ctx.viewConfig ?? ctx.loadConfig)();
  // A2: app secrets are the app's, never a person's: only a context that may change them (not a signed-in person's)
  // lists them.
  const secrets = await Promise.all(
    (ctx.secrets ? APP_SECRETS : []).map(async (account) => ({
      account,
      label: SECRET_LABELS[account],
      state: ctx.secrets ? await ctx.secrets.state(account).catch((): SecretPresence => "unavailable") : ("unavailable" as const),
      expires: loaded.parsed.ok ? (loaded.parsed.config.secretExpiry[account] ?? null) : null,
    })),
  );
  const base = { configPath: loaded.path, fromFile: isFilePath(loaded.path), palette: CLIENT_SLOTS, secrets, data: { planStore: !!ctx.plan } };
  if (!loaded.parsed.ok)
    return { ...base, problems: loaded.parsed.errors, dataverseReached: false, you: null, hours: null, standingBlocks: [], risk: null, planning: { pickablePortfolioTypes: [], ...DEFAULT_PLAN, sizes: { ...DEFAULT_PLAN.sizes } }, focus: { ...DEFAULT_FOCUS, playlists: [] }, clients: [], display: null, timebox: { ...DEFAULT_TIMEBOX }, collab: { ...DEFAULT_COLLAB, domains: [] }, notify: { ...DEFAULT_NOTIFY, kinds: { ...DEFAULT_NOTIFY.kinds } }, vm: { startWithoutAsking: DEFAULT_AZURE.startWithoutAsking }, roadmap: { ...DEFAULT_THRESHOLDS }, asks: { ...DEFAULT_ASK_SETTINGS, requestPhrases: [...DEFAULT_ASK_SETTINGS.requestPhrases], ackPhrases: [...DEFAULT_ASK_SETTINGS.ackPhrases] } };
  const tz = userZone(loaded.parsed.config);
  // Who I am in Dataverse: the kept user, else a match now (the same as the week's), else why not.
  let matchProblem: string | null = null;
  let me = loaded.parsed.config.dataverse;
  if (!me.mySystemUserId && ctx.findMe) {
    const r = await ctx.findMe(me, tz).catch((): MatchResult => ({ ok: false, reason: "failed", message: DATAVERSE_UNREACHABLE }));
    if (r.ok) me = { ...me, mySystemUserId: r.id };
    else matchProblem = r.message;
  }
  const cfg: AppConfig = { ...loaded.parsed.config, dataverse: me };
  const dv = cfg.dataverse.mySystemUserId ? ctx.makeDataverse(cfg.dataverse, tz) : null;
  const [fetched, follow] = await Promise.all([
    dv ? dv.myClients().catch(() => null) : Promise.resolve(null),
    // Which clients are followed (step 6d). Without the read (or its cache) the state is unknown, not guessed.
    dv?.following && ctx.now
      ? followOptions(dv as Pick<DataverseSource, "following">, cfg, localToday(ctx.now(), tz), {}, []).catch(() => null)
      : Promise.resolve(null),
  ]);
  const mine = fetched ?? [];
  // no-demo-leak: without Dataverse's answer the list says why and where to fix it; nothing stands in for it.
  const dataverseProblem = fetched !== null ? null : dv ? DATAVERSE_UNREACHABLE : (matchProblem ?? noDataverseMatch(cfg.dataverse.myEmail));
  // no-demo-leak: the clients are the internal one, Dataverse's (mine), and standing-block and Keep following clients
  // (my own choices).
  // A color or name in settings alone never makes a client: that is how fixture names once showed up here.
  const kept = Object.entries(cfg.clientSettings).filter(([, v]) => v.follow).map(([k]) => k);
  const keys = [...new Set([INTERNAL_CLIENT, ...mine.map((c) => c.clientKey), ...kept, ...cfg.week.standingBlocks.map((b) => b.clientKey)])].sort((a, b) => a.localeCompare(b));
  const clients = await mapSeq(keys, async (key): Promise<SettingsClient> => {
    const m = mine.find((c) => c.clientKey === key);
    const setting = cfg.clientSettings[key] ?? { color: null, name: null, openStates: [], follow: false };
    // Without the focus time read, only what doesn't need it is known (internal, standing block, Keep following).
    const sure = follow ? followState(key, follow.usable ? follow.patterns : [], follow.options) : null;
    const state = sure && (follow!.usable || sure.active) ? sure : null;
    // Step 14: whose write PAT this client has, if any (never the PAT).
    const w = (await ctx.plan?.devopsIdentity(key)) ?? null;
    const write = w ? { name: w.name, email: w.email, org: w.org, validatedAt: w.validatedAt, expires: w.expires } : null;
    return { key, dataverseName: m?.clientName ?? null, devopsEmail: m?.devopsEmail ?? null, devops: m?.devops ?? false, setting, css: setting.color ? colorCss(setting.color) : null, follow: state, write };
  });
  return {
    ...base,
    problems: [],
    dataverseReached: fetched !== null,
    dataverseProblem,
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
    notify: cfg.notify,
    vm: { startWithoutAsking: cfg.azure.startWithoutAsking },
    roadmap: cfg.roadmap,
    asks: cfg.asks,
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
        edit = settingsEdit(o.section as SettingsSection, o.values);
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
      const path = await ctx.exportPlan(`${JSON.stringify((await ctx.plan.exportJson()), null, 2)}\n`);
      return { ok: true, data: { path } };
    }
  }
}

/** Default export location: ~/.local/share/focustime/exports/plan-<stamp>.json. */
