import { describe, expect, it } from "vitest";
import { readOrMakeDataKey } from "../host/local/datakey.ts";
import type { Runner } from "../host/local/keyring.ts";
import { SecretError } from "../host/types.ts";
import { openPlanDb } from "./plan-store.ts";
import { exportUser } from "./user-data.ts";
import { createAccountStore } from "./accounts.ts";
import { createUserSecrets, fakeKeyProvider, open, seal } from "./user-secrets.ts";

const now = () => Temporal.Instant.from("2026-11-02T14:30:00Z");
const TOKEN = "0.AXcA-refresh-token-value-that-must-never-show";
const PAT = "pat52characterslongpat52characterslongpat52characters";

function setup() {
  const db = openPlanDb({ path: ":memory:", now: () => now().toZonedDateTimeISO("UTC") });
  const keys = fakeKeyProvider();
  const forUser = (userId: string) => createUserSecrets({ db, userId, keys, now });
  return { db, keys, forUser };
}

describe("a person's secrets (A2)", () => {
  it("round-trips through the KeyProvider, sealed in the store (never the plain value)", async () => {
    const t = setup();
    const ana = t.forUser("ana");
    await ana.set("outlook-refresh-token", TOKEN);
    await ana.set("devops-write-pat:cooptimize", PAT);
    expect(await ana.get("outlook-refresh-token")).toBe(TOKEN);
    expect(await ana.get("devops-write-pat:cooptimize")).toBe(PAT);
    const raw = JSON.stringify(t.db.prepare("SELECT * FROM user_secrets").all());
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(PAT);
    expect(raw).toContain("v1.");
    // A new value each time (fresh IV), same plain text.
    const a = seal(await t.keys.dataKey(), "ana", "x", "same");
    const b = seal(await t.keys.dataKey(), "ana", "x", "same");
    expect(a).not.toBe(b);
  });

  it("keeps people apart: another person's store doesn't see it, and a value moved to them doesn't open", async () => {
    const t = setup();
    await t.forUser("ana").set("google-refresh-token", TOKEN);
    const ben = t.forUser("ben");
    await expect(ben.get("google-refresh-token")).rejects.toMatchObject({ kind: "not_found" });
    expect(ben.has("google-refresh-token")).toBe(false);
    ben.clear();
    expect(await t.forUser("ana").get("google-refresh-token")).toBe(TOKEN);
    // Copy ana's sealed value onto ben's row: the associated data (person, account) doesn't match.
    t.db.prepare("INSERT INTO user_secrets (user_id, account, sealed, updated_at) SELECT 'ben', account, sealed, updated_at FROM user_secrets WHERE user_id = 'ana'").run();
    await expect(ben.get("google-refresh-token")).rejects.toBeInstanceOf(SecretError);
    // Or onto another account of ana's.
    const sealed = (t.db.prepare("SELECT sealed FROM user_secrets WHERE user_id = 'ana'").get() as { sealed: string }).sealed;
    expect(() => open(new Uint8Array(32), "ana", "google-refresh-token", sealed)).toThrow(SecretError);
    await expect(Promise.resolve().then(() => open(Buffer.alloc(32, 1), "ana", "outlook-refresh-token", sealed))).rejects.toBeInstanceOf(SecretError);
  });

  it("is never in the export", async () => {
    const t = setup();
    const accounts = createAccountStore(t.db, now);
    accounts.users.signedIn({ id: "ana", tenantId: "t", upn: "ana@x.example", displayName: "Ana", email: null });
    await t.forUser("ana").set("outlook-refresh-token", TOKEN);
    const text = JSON.stringify(exportUser(t.db, accounts.users.get("ana")!, now()));
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("user_secrets");
    expect(text).not.toContain("v1.");
  });

  it("takes only a person's accounts", async () => {
    const t = setup();
    await expect(t.forUser("ana").set("dataverse-client-secret" as never, "x")).rejects.toThrow();
  });
});

describe("the local data key (A2)", () => {
  it("is made once in the secret store (through stdin, never argv) and read back after", async () => {
    const store = new Map<string, string>();
    const argvs: string[][] = [];
    const run: Runner = async (args, stdin) => {
      argvs.push(args);
      const account = args[args.indexOf("account") + 1]!;
      if (args[0] === "store") {
        store.set(account, stdin!);
        return { code: 0, stdout: "", stderr: "" };
      }
      const v = store.get(account);
      return v ? { code: 0, stdout: `${v}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" };
    };
    const k1 = await readOrMakeDataKey(run);
    expect(k1.length).toBe(32);
    const k2 = await readOrMakeDataKey(run);
    expect(Buffer.from(k2).equals(Buffer.from(k1))).toBe(true);
    expect(argvs.filter((a) => a[0] === "store")).toHaveLength(1);
    expect(argvs.flat().join(" ")).not.toContain(Buffer.from(k1).toString("base64"));
  });

  it("refuses to work on a locked secret store", async () => {
    const run: Runner = async () => ({ code: 1, stdout: "", stderr: "Cannot get secret: collection is locked" });
    await expect(readOrMakeDataKey(run)).rejects.toMatchObject({ kind: "locked" });
  });
});
