// A2: migration 24 keeps every row (as no one's) with a backup first, and the first sign-in of the store's owner
// claims them all; anyone else's sign-in claims nothing.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { localStoreFiles } from "../host/local/files.ts";
import { claimUnowned, isOwner, unownedRows } from "./claim.ts";
import { MIGRATIONS, openPlanDb, planStoreOn } from "./plan-store.ts";
import { USER_TABLES } from "./scope.ts";
import { sqliteConn } from "./sql/sqlite.ts";

const now = () => Temporal.ZonedDateTime.from("2026-11-02T09:30:00-05:00[America/New_York]");
const OID = "0b7c6f1e-0000-4000-8000-00000000a11c";
const TID = "abf29d42-0000-4000-8000-000000000001";
const ME = { oid: OID, tid: TID, email: "ana@cooptimize.example", upn: "ana@cooptimize.example" };

/** A store as it was at schema 23 (before people), with a week's worth of rows and the signed-in identity. */
function v23Store(identity: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "focustime-claim-"));
  const path = join(dir, "plan.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  MIGRATIONS.slice(0, 23).forEach((m, i) => {
    db.exec(m);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(i + 1, "2026-10-01T00:00:00Z");
  });
  const at = "2026-11-02T09:00:00-05:00";
  db.prepare("INSERT INTO day_plans (date, created_at, updated_at) VALUES ('2026-11-02', ?, ?)").run(at, at);
  for (let i = 0; i < 3; i++)
    db.prepare("INSERT INTO picks (date, half, position, client_key, kind, title, size, status, created_at, updated_at) VALUES ('2026-11-02', 'AM', ?, 'cooptimize', 'intention', ?, 'S', 'planned', ?, ?)").run(i, `Pick ${i}`, at, at);
  db.prepare("INSERT INTO captures (text, client_key, created_at) VALUES ('Ask about the import', NULL, ?)").run(at);
  db.prepare("INSERT INTO follow_ups (kind, who, what, opened_at) VALUES ('manual', 'Sam', 'Send the estimate', ?)").run(at);
  db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('timer', '{}', ?)").run(at);
  db.prepare("INSERT INTO markers (kind, date, at) VALUES ('reminder', '2026-11-02', ?)").run(at);
  if (identity) db.prepare("INSERT INTO account_state (key, value, updated_at) VALUES ('ms_identity', ?, ?)").run(JSON.stringify({ oid: OID, tid: TID, name: "Ana", username: ME.upn }), at);
  // Tables added after schema 23 start empty.
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const counts = Object.fromEntries(USER_TABLES.map((t) => [t, has(t) ? (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n : 0]));
  // IB-1: except inbox_marks, whose data step marks each open follow-up seen (here the one above).
  counts.inbox_marks = 1;
  db.close();
  return { dir, path, counts };
}

const countsOf = (db: DatabaseSync, where: string) => Object.fromEntries(USER_TABLES.map((t) => [t, (db.prepare(`SELECT count(*) AS n FROM ${t} WHERE ${where}`).get() as { n: number }).n]));

describe("migration 24 and the first sign-in (A2)", () => {
  it("keeps every row as no one's, after a private backup", async () => {
    const s = v23Store(true);
    const raw = openPlanDb({ path: s.path, now, files: localStoreFiles });
    expect(countsOf(raw, "user_id = ''")).toEqual(s.counts);
    expect(readdirSync(s.dir).some((f) => f.startsWith("plan.db.bak-v23-"))).toBe(true);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    raw.close();
  });

  it("gives every row to the signed-in owner (the recorded Microsoft account) and leaves nothing unowned", async () => {
    const s = v23Store(true);
    const raw = openPlanDb({ path: s.path, now });
    const db = sqliteConn(raw);
    const r = (await claimUnowned(db, ME, ""));
    expect(r).toMatchObject({ claimed: true });
    expect((await unownedRows(db))).toBe(0);
    expect(countsOf(raw, `user_id = '${OID}'`)).toEqual(s.counts);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    // The owner's store shows them.
    const plan = planStoreOn(db, { userId: OID, now });
    expect((await plan.picksFor("2026-11-02")).map((p) => p.title)).toEqual(["Pick 0", "Pick 1", "Pick 2"]);
    expect((await plan.inbox()).length).toBe(1);
    // Nothing is left to claim the next time.
    expect((await claimUnowned(db, ME, ""))).toMatchObject({ claimed: false, reason: "nothing" });
  });

  it("claims nothing for another person, even one with the config file's email", async () => {
    const s = v23Store(true);
    const raw = openPlanDb({ path: s.path, now });
    const db = sqliteConn(raw);
    const other = { ...ME, oid: "11111111-0000-4000-8000-000000000000" };
    expect((await claimUnowned(db, other, ME.email))).toMatchObject({ claimed: false, reason: "not_owner" });
    expect((await claimUnowned(db, { ...ME, tid: "22222222-0000-4000-8000-000000000000" }, ""))).toMatchObject({ claimed: false, reason: "not_owner" });
    expect(countsOf(raw, "user_id = ''")).toEqual(s.counts);
  });

  it("without a recorded account, the config file's work email names the owner", async () => {
    const s = v23Store(false);
    const raw = openPlanDb({ path: s.path, now });
    const db = sqliteConn(raw);
    expect((await isOwner(db, ME, ""))).toBe(false);
    expect((await isOwner(db, ME, "someone@cooptimize.example"))).toBe(false);
    expect((await claimUnowned(db, ME, "Ana@Cooptimize.example"))).toMatchObject({ claimed: true });
    expect((await unownedRows(db))).toBe(0);
  });

  it("never merges into a person who already has rows of their own", async () => {
    const s = v23Store(true);
    const raw = openPlanDb({ path: s.path, now });
    const db = sqliteConn(raw);
    await planStoreOn(db, { userId: OID, now }).addCapture({ text: "Mine already", clientKey: null });
    expect((await claimUnowned(db, ME, ""))).toMatchObject({ claimed: false, reason: "has_rows" });
    expect(countsOf(raw, "user_id = ''")).toEqual(s.counts);
  });
});
