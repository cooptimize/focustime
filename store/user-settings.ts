// A2: a person's settings, kept as rows in the plan store (config/sections.ts), in place of the config file. Loading
// puts the text together from their rows and the app's keys (the Dataverse, Microsoft and Google registrations from
// the app config, their sign-in email, their time zone); saving runs the same edit as before on that text, validates
// it, and stores the person's part back as rows. Every statement is scoped to the person (store/scope.ts).
import type { Conn } from "./sql/conn.ts";
import { joinSettings, personalRows, type SettingsRow } from "../config/sections.ts";
import { setValue, type WriteResult } from "../config/edit.ts";
import { parseConfig, setSystemUserIdInText, type ParseResult } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import { userZone } from "../week/zone.ts";
import { scopedDb } from "./scope.ts";

/** The app-level settings a person's text is completed with. */
export type AppKeys = {
  dataverse: { environmentUrl: string; tenantId: string; clientId: string } | null;
  entra: { tenantId: string; clientId: string } | null;
  google: { clientId: string } | null;
  /** A5: invite domains set by the FocusTime admin for everyone; they replace a person's own. Absent or empty: theirs. */
  inviteDomains?: string[];
};

/** Who the settings are for, as the users table has them. */
export type SettingsPerson = { email: string | null; upn: string; timeZone: string | null };

/** Where Settings says they are saved. */
export const SETTINGS_PLACE = "your FocusTime account";

/** The starter's Dataverse keys (used when the app config names no Dataverse environment). */
const starterKey = (key: string) => new RegExp(`^${key} = "([^"]*)"`, "m").exec(starterToml("UTC"))?.[1] ?? "";

export function createUserSettings(o: {
  db: Conn;
  userId: string;
  app: AppKeys;
  person: () => SettingsPerson | Promise<SettingsPerson>;
  /** The person's time zone changed in Settings (kept on their users row too). */
  setZone: (zone: string) => void | Promise<void>;
  /** The zone for someone whose settings name none (the host clock's). */
  defaultZone: string;
  now: () => Temporal.Instant;
}) {
  const db = scopedDb(o.db, o.userId);
  const rows = async (): Promise<SettingsRow[]> => ((await db.all("SELECT section, position, body FROM user_settings ORDER BY position")) as SettingsRow[]).map((r) => ({ section: r.section, position: r.position, body: r.body }));

  async function store(next: SettingsRow[]): Promise<void> {
    const at = o.now().toString();
    await db.tx(async () => {
      await db.run("DELETE FROM user_settings");
      for (const r of next) await db.run("INSERT INTO user_settings (section, position, body, updated_at) VALUES (?, ?, ?, ?)", r.section, r.position, r.body, at);
    });
  }

  /** The whole settings text: the person's rows, completed with the app's keys and who they are. */
  async function text(): Promise<string> {
    let t = joinSettings(await rows());
    const p = await o.person();
    const dv = o.app.dataverse ?? { environmentUrl: starterKey("environment_url"), tenantId: starterKey("tenant_id"), clientId: starterKey("client_id") };
    t = setValue(t, "dataverse", "environment_url", dv.environmentUrl);
    t = setValue(t, "dataverse", "tenant_id", dv.tenantId);
    t = setValue(t, "dataverse", "client_id", dv.clientId);
    // Dataverse finds you by your sign-in (email first, then the sign-in name).
    const email = p.email || (p.upn.includes("@") ? p.upn : "");
    if (email) t = setValue(t, "dataverse", "my_email", email);
    if (o.app.entra) {
      t = setValue(t, "outlook", "tenant_id", o.app.entra.tenantId);
      t = setValue(t, "outlook", "client_id", o.app.entra.clientId);
    }
    // Google is offered when the app has a client for it; a person's [google] (their calendars) stays either way.
    if (o.app.google) t = setValue(t, "google", "client_id", o.app.google.clientId);
    else if (/^\[google\]/m.test(t)) t = setValue(t, "google", "client_id", "");
    if (p.timeZone) t = setValue(t, "hours", "time_zone", p.timeZone);
    return t;
  }

  const admin = (o.app.inviteDomains ?? []).map((d) => d.toLowerCase());
  const parse = (t: string): ParseResult => {
    const r = parseConfig(t, { defaultZone: o.defaultZone });
    if (!r.ok || !admin.length) return r;
    return { ...r, config: { ...r.config, collab: { ...r.config.collab, domains: [...admin], domainsByAdmin: true } } };
  };

  return {
    /** Whether the person has settings yet (a first sign-in has none until seeded). */
    has: async (): Promise<boolean> => !!(await db.get("SELECT 1 FROM user_settings LIMIT 1")),
    /** Stores settings text as the person's rows (their config file once, or the starter for someone new). */
    async seed(textToSeed: string): Promise<void> {
      await store(personalRows(textToSeed));
    },
    text,
    load: async () => ({ path: SETTINGS_PLACE, parsed: parse(await text()) }),
    /** Runs a Settings edit on the text; stored only when the result is valid. */
    async write(edit: (text: string) => string): Promise<WriteResult> {
      const next = edit(await text());
      const parsed = parse(next);
      if (!parsed.ok) return { ok: false, parsed };
      await store(personalRows(next));
      const zone = userZone(parsed.config);
      if (zone !== (await o.person()).timeZone) await o.setZone(zone);
      const again = parse(await text());
      return again.ok ? { ok: true, parsed: again, backup: "" } : { ok: false, parsed: again };
    },
    async saveSystemUserId(id: string): Promise<void> {
      await this.write((t) => setSystemUserIdInText(t, id));
    },
  };
}

export type UserSettings = ReturnType<typeof createUserSettings>;
