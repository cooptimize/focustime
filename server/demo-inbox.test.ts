// IB-1 slice 4: the demo shows every Inbox view with something in it (Needs you with reasons, Promises with a late one,
// Waiting on, In progress, Captures and drafts, Handled by teammates, Done, Chatter), on whatever weekday it opens,
// with nothing sent out of FocusTime and only the demo's fictional people.
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { ConversationsData } from "../plan/conversation-views.ts";
import { INBOX_VIEWS, railItems, todayLines, type InboxListData, type InboxTodayData } from "../plan/inbox-items.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const MONDAY = "2026-11-02T15:00:00Z"; // 10:00 AM in New York
const days = Array.from({ length: 5 }, (_, i) => Temporal.Instant.from(MONDAY).add({ hours: 24 * i }).toString());

async function demo(now: string): Promise<ActionContext> {
  const ctx = createDemoContext({ now: () => now, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  return ctx;
}
const run = async <T>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await dispatch(ctx, { action, input });
  if (!r.ok) throw new Error(`${action}: ${r.status} ${r.error}`);
  return r.data as T;
};

describe("the demo's Inbox (IB-1)", () => {
  const net = useNoOutbound();

  for (const now of days)
    it(`has something in every view (${Temporal.Instant.from(now).toZonedDateTimeISO("America/New_York").toLocaleString("en-US", { weekday: "long" })})`, async () => {
      const ctx = await demo(now);
      const list = await run<InboxListData>(ctx, "inbox.list");
      const convs = await run<ConversationsData>(ctx, "conversations.list");
      const empty = INBOX_VIEWS.filter((v) => (v === "chatter" ? convs.chatter.length === 0 : list.counts[v] === 0));
      expect(empty, `empty views: ${empty.join(", ")}`).toEqual([]);
      // Needs you says why for each; Promises has a late one.
      const needs = list.items.filter((i) => i.views.includes("needs_you"));
      for (const i of needs) expect(i.reason, i.key).toBeTruthy();
      expect(list.items.some((i) => i.views.includes("promises") && i.late)).toBe(true);
      // IB-1's own rows: the urgent ask by name, Priya's commitment to me, and both kinds in Done.
      const urgent = list.items.find((i) => i.urgent);
      expect(urgent).toMatchObject({ kind: "conversation", title: "Warehouse sign-in fails after this morning's release" });
      expect(urgent!.views).toContain("needs_you");
      expect(urgent!.reason).toBe("Priya asked you by name");
      expect(list.items.some((i) => i.kind === "commitment" && i.views.includes("waiting") && i.who === "Priya Shah")).toBe(true);
      expect(new Set(list.items.filter((i) => i.views.includes("done")).map((i) => i.kind))).toEqual(new Set(["conversation", "promise"]));
      // Today's strip and Week's rail have something from the same rows, and the badge is Needs you.
      const today = await run<InboxTodayData>(ctx, "inbox.today");
      expect(today.needsYou).toBe(list.counts.needs_you);
      expect(todayLines(today.items, { today: list.today, now, dayEnd: null })[0]!.key).toBe(urgent!.key);
      expect(railItems(today.items).length).toBeGreaterThan(0);
      net.expectNone();
    });

  it("names only the demo's fictional people (each name shown is one the demo's own files define)", async () => {
    const ctx = await demo(days[0]!);
    const list = await run<InboxListData>(ctx, "inbox.list");
    const dir = fileURLToPath(new URL("../sources/demo/", import.meta.url));
    const demoText = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".ts")).map((f) => readFileSync(join(dir, String(f)), "utf8")).join("\n");
    const named = [...new Set(list.items.flatMap((i) => [i.who, i.title]).filter((w): w is string => !!w).flatMap((t) => t.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? []))];
    expect(named.length).toBeGreaterThan(3);
    for (const n of named.filter((x) => !/^(Harbor Health|Northwind Foods|Atlas Freight)$/.test(x))) expect(demoText.includes(n), n).toBe(true);
  });
});
