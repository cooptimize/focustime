import { describe, expect, it } from "vitest";
import { Pat } from "../sources/devops/pat.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { createUserSecrets, fakeKeyProvider } from "../store/user-secrets.ts";
import { copyOwnerSecrets, writePatAccount } from "./owner-secrets.ts";

const now = () => Temporal.Instant.from("2026-11-02T14:30:00Z");
const PAT_A = "patforclientaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PAT_B = "patforclientbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function setup() {
  const db = openPlanDb({ path: ":memory:", now: () => now().toZonedDateTimeISO("UTC") });
  const mine = createUserSecrets({ db, userId: "owner", keys: fakeKeyProvider(), now });
  const keyring = new Map<string, string>([["cooptimize", PAT_A], ["T&W", PAT_B]]);
  const reads: string[] = [];
  const k = {
    writePat: async (c: string) => {
      reads.push(c);
      const v = keyring.get(c);
      if (!v) throw new Error("not found");
      return new Pat(v);
    },
    googleRefreshToken: async () => "google-refresh-from-keyring",
  };
  return { db, mine, k, reads };
}

describe("the owner's secrets from the keyring (A2)", () => {
  it("copies their write PATs and Google token once, only where they have none, and leaves the keyring alone", async () => {
    const t = setup();
    await t.mine.set(writePatAccount("T&W"), "already-mine");
    const r = await copyOwnerSecrets({ clientKeys: ["cooptimize", "T&W", "proseware"], mine: t.mine, keyring: t.k });
    expect(r).toEqual({ pats: 1, google: true });
    expect(await t.mine.get(writePatAccount("cooptimize"))).toBe(PAT_A);
    expect(await t.mine.get(writePatAccount("T&W"))).toBe("already-mine");
    expect(await t.mine.get("google-refresh-token")).toBe("google-refresh-from-keyring");
    expect(t.mine.has(writePatAccount("proseware"))).toBe(false);
    expect(await copyOwnerSecrets({ clientKeys: ["cooptimize", "T&W"], mine: t.mine, keyring: t.k })).toEqual({ pats: 0, google: false });
    // Sealed in the store, never in plain text.
    expect(JSON.stringify(t.db.prepare("SELECT * FROM user_secrets").all())).not.toContain(PAT_A);
  });

  it("goes on without a keyring entry", async () => {
    const t = setup();
    const r = await copyOwnerSecrets({ clientKeys: ["nowhere"], mine: t.mine, keyring: { writePat: async () => { throw new Error("locked"); }, googleRefreshToken: async () => { throw new Error("locked"); } } });
    expect(r).toEqual({ pats: 0, google: false });
  });
});
