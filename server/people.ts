// A2: what happens when someone signs in with Microsoft, after the ID token checked out: their users row (refused when
// their data was deleted), the store's rows from before people claimed by their owner, and settings rows the first
// time: the config file read once more for the owner, else the starter in the time zone their Outlook mailbox names
// (else the host clock's).
import type { Logger } from "../log/logger.ts";
import { starterToml } from "../config/starter.ts";
import type { ParseResult } from "../config/schema.ts";
import { userZone } from "../week/zone.ts";
import type { AccountStore } from "../store/accounts.ts";
import type { Conn } from "../store/sql/conn.ts";
import { claimUnowned, isOwner, unownedRows } from "../store/claim.ts";
import type { UserSettings } from "../store/user-settings.ts";
import type { SignInRefusal } from "./app.ts";
import type { SignedIn, SignInTokens } from "./auth/entra.ts";

export type PeopleDeps = {
  db: Conn;
  accounts: Pick<AccountStore, "users">;
  settingsFor: (userId: string) => UserSettings;
  /** The settings file: its parsed form (for its work email) and its text (to seed its owner once). */
  configFile: { load: () => Promise<{ parsed: ParseResult } | null>; raw: () => Promise<string | null> };
  /** A new person's zone from Outlook (null when Graph can't say). */
  mailboxZone: (accessToken: string) => Promise<string | null>;
  hostZone: () => string;
  log: Logger;
};

export function createPeople(d: PeopleDeps) {
  async function seed(u: SignedIn, o: { owner: boolean; zone: string | null }): Promise<void> {
    const s = d.settingsFor(u.oid);
    if ((await s.has())) return;
    const file = o.owner ? await d.configFile.raw().catch(() => null) : null;
    if (file) {
      await s.seed(file);
      const parsed = (await s.load()).parsed;
      if (parsed.ok) await d.accounts.users.setTimeZone(u.oid, userZone(parsed.config));
      d.log({ source: "plan", op: "settings_seeded", kind: "config_file" });
      return;
    }
    const zone = o.zone ?? (await d.accounts.users.get(u.oid))?.timeZone ?? d.hostZone();
    await s.seed(starterToml(zone));
    await d.accounts.users.setTimeZone(u.oid, zone);
    d.log({ source: "plan", op: "settings_seeded", kind: o.zone ? "starter_mailbox_zone" : "starter_host_zone" });
  }

  /** A validated Microsoft sign-in: the user id to start a session for, or why not. */
  /** `owner`: this sign-in made them the store's owner (claimed its rows, or seeded from the config file), once. */
  async function signedIn(u: SignedIn, tokens: SignInTokens): Promise<{ userId: string; owner: boolean } | { refused: SignInRefusal }> {
    if ((await d.accounts.users.get(u.oid))?.deletedAt) {
      d.log({ source: "auth", op: "sign_in", kind: "deleted" });
      return { refused: "deleted" };
    }
    const { created } = await d.accounts.users.signedIn({ id: u.oid, tenantId: u.tid, upn: u.upn, displayName: u.name, email: u.email });
    d.log({ source: "auth", op: "user", kind: created ? "created" : "returning" });
    const who = { oid: u.oid, tid: u.tid, email: u.email, upn: u.upn };
    const unowned = (await unownedRows(d.db)) > 0;
    const fresh = !(await d.settingsFor(u.oid).has());
    const cfg = unowned || fresh ? await d.configFile.load().catch(() => null) : null;
    const myEmail = cfg?.parsed.ok ? cfg.parsed.config.dataverse.myEmail : "";
    let owner = false;
    if (unowned) {
      const r = (await claimUnowned(d.db, who, myEmail));
      d.log({ source: "plan", op: "claim", kind: r.claimed ? "claimed" : r.reason, count: r.rows });
      owner = r.claimed;
    } else owner = fresh && (await d.accounts.users.count()) === 1 && (await isOwner(d.db, who, myEmail));
    const zone = fresh && !owner ? await d.mailboxZone(tokens.accessToken) : null;
    if (fresh) await seed(u, { owner, zone });
    return { userId: u.oid, owner };
  }

  return { signedIn };
}
