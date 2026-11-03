import { describe, expect, it } from "vitest";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createAccountStore } from "../store/accounts.ts";
import { unownedRows } from "../store/claim.ts";
import { openPlanDb, planStoreOn } from "../store/plan-store.ts";
import { createUserSettings } from "../store/user-settings.ts";
import { createPeople } from "./people.ts";
import type { SignedIn } from "./auth/entra.ts";

const now = () => Temporal.Instant.from("2026-11-02T14:30:00Z");
const TOKENS = { refreshToken: "r", accessToken: "fake-access", expiresIn: 3599, scope: "" };
const OWNER: SignedIn = { oid: "oid-owner", tid: "tid", upn: "ana@cooptimize.example", name: "Ana", email: "ana@cooptimize.example" };
const NEW: SignedIn = { oid: "oid-new", tid: "tid", upn: "ben@cooptimize.example", name: "Ben", email: "ben@cooptimize.example" };

/** The owner's config file: their email, Central time, and a display choice to recognize it by. */
const FILE = setValue(setValue(setValue(STARTER_TOML, "dataverse", "my_email", "ana@cooptimize.example"), "hours", "time_zone", "America/Chicago"), "ui", "theme", "neutral");

function setup(o: { mailbox?: string | null; unowned?: boolean } = {}) {
  const db = openPlanDb({ path: ":memory:", now: () => now().toZonedDateTimeISO("UTC") });
  if (o.unowned) {
    // Rows from before people (as migration 24 leaves them), with the owner's recorded identity.
    const tmp = planStoreOn(db, { userId: "tmp", now: () => now().toZonedDateTimeISO("UTC") });
    tmp.addCapture({ text: "From before", clientKey: null });
    tmp.setAccountState("ms_identity", { oid: OWNER.oid, tid: OWNER.tid });
    for (const t of ["captures", "account_state"]) db.prepare(`UPDATE ${t} SET user_id = '' WHERE user_id = 'tmp'`).run();
  }
  const accounts = createAccountStore(db, now);
  let file: string | null = FILE;
  let reads = 0;
  const mailboxAsked: string[] = [];
  const settingsFor = (userId: string) =>
    createUserSettings({ db, userId, app: { dataverse: null, entra: null, google: null }, person: () => ({ email: accounts.users.get(userId)?.email ?? null, upn: accounts.users.get(userId)?.upn ?? "", timeZone: accounts.users.get(userId)?.timeZone ?? null }), setZone: (z) => accounts.users.setTimeZone(userId, z), defaultZone: "UTC", now });
  const people = createPeople({
    db,
    accounts,
    settingsFor,
    configFile: {
      load: async () => (file ? { parsed: parseConfig(file) } : null),
      raw: async () => {
        reads++;
        return file;
      },
    },
    mailboxZone: async (t) => {
      mailboxAsked.push(t);
      return o.mailbox ?? null;
    },
    hostZone: () => "America/Phoenix",
    log: () => {},
  });
  return { db, accounts, people, settingsFor, setFile: (f: string | null) => void (file = f), reads: () => reads, mailboxAsked };
}

const theme = async (s: ReturnType<ReturnType<typeof setup>["settingsFor"]>) => {
  const p = (await s.load()).parsed;
  return p.ok ? p.config.ui.theme : null;
};

describe("first sign-in (A2)", () => {
  it("claims the store's rows for its owner and seeds their settings from the config file, once", async () => {
    const t = setup({ unowned: true });
    expect(await t.people.signedIn(OWNER, TOKENS)).toEqual({ userId: OWNER.oid, owner: true });
    expect(await t.people.signedIn(OWNER, TOKENS)).toEqual({ userId: OWNER.oid, owner: false });
    expect(unownedRows(t.db)).toBe(0);
    expect(planStoreOn(t.db, { userId: OWNER.oid, now: () => now().toZonedDateTimeISO("UTC") }).inbox().map((c) => c.text)).toEqual(["From before"]);
    const s = t.settingsFor(OWNER.oid);
    expect(await theme(s)).toBe("neutral");
    expect(t.accounts.users.get(OWNER.oid)!.timeZone).toBe("America/Chicago");
    expect(t.mailboxAsked).toEqual([]);
    // The file changes later: ignored from now on.
    t.setFile(setValue(FILE, "ui", "theme", "cooptimize-light"));
    await t.people.signedIn(OWNER, TOKENS);
    expect(await theme(s)).toBe("neutral");
    expect(t.reads()).toBe(1);
  });

  it("without rows from before, the first person the file names is still its owner", async () => {
    const t = setup();
    await t.people.signedIn(OWNER, TOKENS);
    expect(await theme(t.settingsFor(OWNER.oid))).toBe("neutral");
  });

  it("someone new gets the starter in their Outlook time zone; nothing of the owner's", async () => {
    const t = setup({ unowned: true, mailbox: "America/New_York" });
    await t.people.signedIn(OWNER, TOKENS);
    expect(await t.people.signedIn(NEW, TOKENS)).toEqual({ userId: NEW.oid, owner: false });
    expect(t.mailboxAsked).toEqual(["fake-access"]);
    expect(t.accounts.users.get(NEW.oid)!.timeZone).toBe("America/New_York");
    const p = (await t.settingsFor(NEW.oid).load()).parsed;
    expect(p.ok && p.config.week.hours.timeZone).toBe("America/New_York");
    expect(await theme(t.settingsFor(NEW.oid))).toBe("cooptimize-dark");
    expect(planStoreOn(t.db, { userId: NEW.oid, now: () => now().toZonedDateTimeISO("UTC") }).inbox()).toEqual([]);
  });

  it("falls back to the host clock's zone when Outlook can't say", async () => {
    const t = setup({ mailbox: null });
    t.setFile(null);
    await t.people.signedIn(NEW, TOKENS);
    expect(t.accounts.users.get(NEW.oid)!.timeZone).toBe("America/Phoenix");
  });

  it("someone else signing in first claims nothing", async () => {
    const t = setup({ unowned: true });
    await t.people.signedIn(NEW, TOKENS);
    expect(unownedRows(t.db)).toBeGreaterThan(0);
  });

  it("refuses someone whose data was deleted", async () => {
    const t = setup();
    await t.people.signedIn(NEW, TOKENS);
    t.accounts.users.setDeleted(NEW.oid, now().toString());
    expect(await t.people.signedIn(NEW, TOKENS)).toEqual({ refused: "deleted" });
  });
});
