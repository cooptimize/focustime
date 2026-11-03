// A2: a person's settings, kept as rows in the plan store (config/sections.ts), in place of the config file. Loading
// puts the text together from their rows and the app's keys (the Dataverse, Microsoft and Google registrations from
// the app config, their sign-in email, their time zone); saving runs the same edit as before on that text, validates
// it, and stores the person's part back as rows. Every statement is scoped to the person (store/scope.ts).
import type { DatabaseSync } from "node:sqlite";
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
};

/** Who the settings are for, as the users table has them. */
export type SettingsPerson = { email: string | null; upn: string; timeZone: string | null };

/** Where Settings says they are saved. */
export const SETTINGS_PLACE = "your FocusTime account";

/** The starter's Dataverse keys (used when the app config names no Dataverse environment). */
const starterKey = (key: string) => new RegExp(`^${key} = "([^"]*)"`, "m").exec(starterToml("UTC"))?.[1] ?? "";

export function createUserSettings(o: {
  db: DatabaseSync;
  userId: string;
  app: AppKeys;
  person: () => SettingsPerson;
  /** The person's time zone changed in Settings (kept on their users row too). */
  setZone: (zone: string) => void;
  /** The zone for someone whose settings name none (the host clock's). */
  defaultZone: string;
  now: () => Temporal.Instant;
}) {
  const db = scopedDb(o.db, o.userId);
  const rows = (): SettingsRow[] => (db.prepare("SELECT section, position, body FROM user_settings ORDER BY position").all() as SettingsRow[]).map((r) => ({ section: r.section, position: r.position, body: r.body }));

  function store(next: SettingsRow[]): void {
    const at = o.now().toString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM user_settings").run();
      for (const r of next) db.prepare("INSERT INTO user_settings (section, position, body, updated_at) VALUES (?, ?, ?, ?)").run(r.section, r.position, r.body, at);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  /** The whole settings text: the person's rows, completed with the app's keys and who they are. */
  function text(): string {
    let t = joinSettings(rows());
    const p = o.person();
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

  const parse = (t: string): ParseResult => parseConfig(t, { defaultZone: o.defaultZone });

  return {
    /** Whether the person has settings yet (a first sign-in has none until seeded). */
    has: (): boolean => !!db.prepare("SELECT 1 FROM user_settings LIMIT 1").get(),
    /** Stores settings text as the person's rows (their config file once, or the starter for someone new). */
    seed(textToSeed: string): void {
      store(personalRows(textToSeed));
    },
    text,
    load: async () => ({ path: SETTINGS_PLACE, parsed: parse(text()) }),
    /** Runs a Settings edit on the text; stored only when the result is valid. */
    async write(edit: (text: string) => string): Promise<WriteResult> {
      const next = edit(text());
      const parsed = parse(next);
      if (!parsed.ok) return { ok: false, parsed };
      store(personalRows(next));
      const zone = userZone(parsed.config);
      if (zone !== o.person().timeZone) o.setZone(zone);
      const again = parse(text());
      return again.ok ? { ok: true, parsed: again, backup: "" } : { ok: false, parsed: again };
    },
    async saveSystemUserId(id: string): Promise<void> {
      await this.write((t) => setSystemUserIdInText(t, id));
    },
  };
}

export type UserSettings = ReturnType<typeof createUserSettings>;
