// PK-2: connecting a person's own Pocket. A good key connects and the count and time are kept; nothing is saved when
// the check fails; a new key replaces the old only after its own check passes; Disconnect forgets the key; another
// person's key is untouched and can't be reached; the key never comes back in an answer, an error or a log line;
// nothing of a recording is kept or shown; Pocket is called only by pocket.connect and pocket.check. Pretend Pocket only.
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../log/logger.ts";
import { createDemoPocketFetch, DEMO_POCKET_KEYS, type PocketCall } from "../sources/demo/pocket.ts";
import { createPocketClient } from "../sources/pocket/client.ts";
import { createUserSecrets, fakeKeyProvider } from "../store/user-secrets.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { pocketAction, pocketPort, POCKET_ACTIONS } from "./pocket-actions.ts";

const ADA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const GOOD = "pk_test_good_0123456789";
const NEWER = "pk_test_newer_9876543210";
const BENS = "pk_test_bens_5555555555";
const NOW = Date.parse("2026-11-17T15:00:00Z");

async function setup() {
  const db = sqliteDb();
  await addUsers(db.conn, ADA, BEN);
  const keys = fakeKeyProvider();
  const calls: PocketCall[] = [];
  const logs: LogRecord[] = [];
  const client = createPocketClient({ fetch: createDemoPocketFetch({ now: () => NOW, calls }), log: (r) => logs.push(r), timeoutMs: 200 });
  const secretsOf = (id: string) => createUserSecrets({ db: db.conn, userId: id, keys, now: () => Temporal.Instant.fromEpochMilliseconds(NOW) });
  const portOf = (id: string) => pocketPort({ secrets: secretsOf(id), client, now: () => NOW });
  const act = (id: string, a: (typeof POCKET_ACTIONS)[number], input: unknown = {}) => pocketAction(portOf(id), a, input);
  return { db, calls, logs, secretsOf, act };
}

describe("PK-2: Check and save, Check again, Disconnect", () => {
  it("not connected: the status says so, and reading it never calls Pocket", async () => {
    const t = await setup();
    expect(await t.act(ADA, "pocket.status")).toEqual({ ok: true, data: { connected: false, checkedAt: null, recordings: null } });
    expect(t.calls).toHaveLength(0);
  });

  it("a good key connects: the count from the last 7 days and when it was checked; the key is in the person's sealed secrets", async () => {
    const t = await setup();
    const r = await t.act(ADA, "pocket.connect", { key: ` ${GOOD} ` });
    expect(r).toEqual({ ok: true, data: { connected: true, checkedAt: "2026-11-17T15:00:00.000Z", recordings: 1 } });
    expect(t.calls).toHaveLength(1);
    expect(await t.secretsOf(ADA).get("pocket-key")).toBe(GOOD);
    // Stored sealed, never as is.
    const rows = (await t.db.conn.all("SELECT sealed FROM user_secrets")) as { sealed: string }[];
    expect(JSON.stringify(rows)).not.toContain(GOOD);
    // Reading the status afterwards: no call.
    expect(await t.act(ADA, "pocket.status")).toMatchObject({ ok: true, data: { connected: true, recordings: 1 } });
    expect(t.calls).toHaveLength(1);
  });

  it.each([
    [DEMO_POCKET_KEYS.wrong, "pocket_not_accepted", /didn't accept this key/],
    [DEMO_POCKET_KEYS.busy, "pocket_busy", /busy right now/],
    [DEMO_POCKET_KEYS.slow, "pocket_no_answer", /didn't answer in time/],
    [DEMO_POCKET_KEYS.odd, "pocket_unexpected", /doesn't understand.*may have changed/],
  ])("nothing is saved when the check fails (%s), and the words say so", async (key, code, words) => {
    const t = await setup();
    const r = await t.act(ADA, "pocket.connect", { key });
    expect(r).toMatchObject({ ok: false, code });
    expect(!r.ok && r.error).toMatch(words);
    expect(!r.ok && r.error).toMatch(/Nothing was saved\.$/);
    expect(!r.ok && r.error).not.toContain(key);
    expect(await t.secretsOf(ADA).has("pocket-key")).toBe(false);
    expect(await t.secretsOf(ADA).has("pocket-check")).toBe(false);
  });

  it("a key of the wrong shape is refused before Pocket is called, without echoing it", async () => {
    const t = await setup();
    for (const key of ["", "sk_live_abcdef", "pk_ with spaces", 42]) {
      const r = await t.act(ADA, "pocket.connect", { key });
      expect(r).toMatchObject({ ok: false, status: 400 });
      if (typeof key === "string" && key) expect(!r.ok && r.error).not.toContain(key);
    }
    expect(t.calls).toHaveLength(0);
  });

  it("a new key replaces the old only after its own check passes", async () => {
    const t = await setup();
    await t.act(ADA, "pocket.connect", { key: GOOD });
    // A key Pocket refuses: the old one stays, with its check.
    const r = await t.act(ADA, "pocket.connect", { key: DEMO_POCKET_KEYS.wrong });
    expect(r).toMatchObject({ ok: false, code: "pocket_not_accepted" });
    expect(await t.secretsOf(ADA).get("pocket-key")).toBe(GOOD);
    expect(await t.act(ADA, "pocket.status")).toMatchObject({ data: { connected: true, recordings: 1 } });
    // One it accepts: replaced.
    expect(await t.act(ADA, "pocket.connect", { key: NEWER })).toMatchObject({ ok: true });
    expect(await t.secretsOf(ADA).get("pocket-key")).toBe(NEWER);
  });

  it("Check again asks Pocket once with the kept key; a failure keeps the connection and says so", async () => {
    const t = await setup();
    expect(await t.act(ADA, "pocket.check")).toMatchObject({ ok: false, status: 409, code: "pocket_not_connected" });
    expect(t.calls).toHaveLength(0);
    await t.act(ADA, "pocket.connect", { key: GOOD });
    expect(await t.act(ADA, "pocket.check")).toMatchObject({ ok: true, data: { connected: true, recordings: 1 } });
    expect(t.calls).toHaveLength(2);
    // The key stops working in Pocket (here: swapped for one Pocket refuses, as a revoked key would be).
    await t.secretsOf(ADA).set("pocket-key", DEMO_POCKET_KEYS.wrong);
    const r = await t.act(ADA, "pocket.check");
    expect(r).toMatchObject({ ok: false, code: "pocket_not_accepted" });
    expect(!r.ok && r.error).toMatch(/Your connection is kept as it was\.$/);
    expect(await t.act(ADA, "pocket.status")).toMatchObject({ data: { connected: true } });
  });

  it("Disconnect forgets the key at once; another person's key is untouched and can't be reached", async () => {
    const t = await setup();
    await t.act(ADA, "pocket.connect", { key: GOOD });
    await t.act(BEN, "pocket.connect", { key: BENS });
    expect(await t.act(ADA, "pocket.disconnect")).toEqual({ ok: true, data: { connected: false, checkedAt: null, recordings: null } });
    expect(await t.secretsOf(ADA).has("pocket-key")).toBe(false);
    expect(await t.secretsOf(BEN).get("pocket-key")).toBe(BENS);
    expect(await t.act(BEN, "pocket.status")).toMatchObject({ data: { connected: true } });
    // Nothing names another person: any input beyond the key is refused, so Ada can't ask about Ben.
    expect(await t.act(ADA, "pocket.status", { userId: BEN })).toMatchObject({ ok: false, status: 400 });
    expect(await t.act(ADA, "pocket.disconnect", { userId: BEN })).toMatchObject({ ok: false, status: 400 });
    expect(await t.act(ADA, "pocket.connect", { key: GOOD, userId: BEN })).toMatchObject({ ok: false, status: 400 });
    expect(await t.secretsOf(BEN).get("pocket-key")).toBe(BENS);
  });

  it("the key never comes back: not in any answer, error or log line; nothing of a recording either", async () => {
    const t = await setup();
    const answers = [
      await t.act(ADA, "pocket.connect", { key: GOOD }),
      await t.act(ADA, "pocket.status"),
      await t.act(ADA, "pocket.check"),
      await t.act(ADA, "pocket.connect", { key: DEMO_POCKET_KEYS.wrong }),
      await t.act(ADA, "pocket.connect", { key: DEMO_POCKET_KEYS.odd }),
      await t.act(ADA, "pocket.disconnect"),
    ];
    const out = JSON.stringify([answers, t.logs]);
    expect(out).not.toMatch(/pk_/);
    expect(out).not.toMatch(/Invented|rec-demo|transcript/);
    // The kept check holds a time and a count only.
    await t.act(ADA, "pocket.connect", { key: GOOD });
    expect(JSON.parse(await t.secretsOf(ADA).get("pocket-check"))).toEqual({ at: "2026-11-17T15:00:00.000Z", recordings: 1 });
  });

  it("only pocket.connect and pocket.check reach Pocket", async () => {
    const t = await setup();
    await t.act(ADA, "pocket.status");
    await t.act(ADA, "pocket.disconnect");
    expect(t.calls).toHaveLength(0);
  });
});
