// CL-1: AP-1's per-person chat tables (delivery_chats, chat_messages, asks) are no longer read or written: chats,
// messages and Requests live once in the shared app tables (D514 to D519). Until a later release drops them (D468,
// docs/cleanup-step-2.md), two things hold: no code outside the migrations and the 14-day cleanup touches them, and
// that cleanup still deletes the rows left there under the 14-day rule (asks keep their message).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { addUsers, forEachDriver } from "../test/db.ts";
import type { Conn } from "./sql/conn.ts";
import { planStoreOn } from "./plan-store.ts";

const ROOT = join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "dist", ".git", "e2e", "fixtures", "test"]);
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const LEGACY = ["delivery_chats", "chat_messages", "asks"];
/** SQL that reads or writes one of the legacy tables, by table. */
export function touches(source: string): string[] {
  const hits: string[] = [];
  for (const t of LEGACY) {
    const re = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, "gi");
    for (const m of source.matchAll(re)) hits.push(m[0]);
  }
  return hits;
}

describe("AP-1's per-person chat tables stay unused (CL-1)", () => {
  it("spots SQL on a legacy table, not on its shared successor", () => {
    expect(touches(`db.all("SELECT * FROM delivery_chats")`)).toHaveLength(1);
    expect(touches(`db.run("INSERT INTO chat_messages (chat_id) VALUES (?)")`)).toHaveLength(1);
    expect(touches(`db.run("UPDATE asks SET status = ?")`)).toHaveLength(1);
    expect(touches(`db.all("SELECT * FROM client_chats JOIN teams_messages m ON 1 = 1")`)).toEqual([]);
    expect(touches(`"SELECT * FROM asks_ai"`)).toEqual([]);
  });

  it("only the migrations and the 14-day cleanup (purgeChatText) name them", () => {
    const files = sources(ROOT).filter((f) => !relative(ROOT, f).startsWith(join("store", "migrations")));
    expect(files.length).toBeGreaterThan(100);
    const found: string[] = [];
    for (const f of files) {
      let text = readFileSync(f, "utf8");
      if (relative(ROOT, f) === join("store", "plan-store.ts")) {
        // The numbered SQLite migrations (frozen) and the cleanup are the allowed uses.
        const cleanup = text.indexOf("async purgeChatText(");
        expect(cleanup, "purgeChatText").toBeGreaterThan(0);
        const end = text.indexOf("\n    },\n", cleanup);
        text = text.slice(text.indexOf("export function planStoreOn("), cleanup) + text.slice(end);
      }
      for (const h of touches(text)) found.push(`${relative(ROOT, f)}: ${h}`);
    }
    expect(found).toEqual([]);
  });
});

await forEachDriver("the 14-day cleanup of AP-1's per-person rows", ({ open }) => {
  const now = () => Temporal.Instant.from("2026-11-04T15:00:00Z").toZonedDateTimeISO("America/New_York");
  const CHAT = "19:fabrikam@thread.v2";
  const message = (db: Conn, who: string, id: string, at: string) =>
    db.run("INSERT INTO chat_messages (user_id, chat_id, message_id, client_key, author_id, author_tenant, created_at, body_text, has_image, has_file, reply_to_id) VALUES (?, ?, ?, 'fabrikam', 'c-dana', 'client', ?, 'text', 0, 0, NULL)", [who, CHAT, id, at]);
  const ask = (db: Conn, who: string, id: string, at: string, o: { status?: string; aiKind?: string | null } = {}) =>
    db.run("INSERT INTO asks (user_id, chat_id, message_id, client_key, ask_rule, rule_detail, status, created_at, updated_at, ai_status, ai_kind) VALUES (?, ?, ?, 'fabrikam', 'question', NULL, ?, ?, ?, ?, ?)", [who, CHAT, id, o.status ?? "dismissed", at, at, o.aiKind ? "sorted" : null, o.aiKind ?? null]);
  const ids = async (db: Conn, table: string, who: string) => ((await db.all(`SELECT message_id FROM ${table} WHERE user_id = ? ORDER BY message_id`, [who])) as { message_id: string }[]).map((r) => r.message_id);

  it("deletes unmatched messages after 14 days, keeps asks' messages and newer ones, and hidden no-action asks go", async () => {
    const db = (await open()).conn;
    await addUsers(db, "ana", "ben");
    const ana = planStoreOn(db, { userId: "ana", now });
    await message(db, "ana", "170000000001", "2026-10-20T15:00:00Z");
    await message(db, "ana", "170000000002", "2026-10-20T16:00:00Z");
    await message(db, "ana", "170000000003", "2026-11-01T15:00:00Z");
    await ask(db, "ana", "170000000002", "2026-10-20T16:00:00Z");
    // AP-2: an open ask the AI said needs no action, still hidden, under the same rule.
    await ask(db, "ana", "170000000004", "2026-10-20T16:00:00Z", { status: "open", aiKind: "none" });
    // Another person's rows are theirs alone.
    await message(db, "ben", "170000000001", "2026-10-20T15:00:00Z");
    expect(await ana.purgeChatText({ olderThan: "2026-10-21T15:00:00Z" })).toBe(1);
    expect(await ids(db, "chat_messages", "ana")).toEqual(["170000000002", "170000000003"]);
    expect(await ids(db, "asks", "ana")).toEqual(["170000000002"]);
    expect(await ids(db, "chat_messages", "ben")).toEqual(["170000000001"]);
  });
});
