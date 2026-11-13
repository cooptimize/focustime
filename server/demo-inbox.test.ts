// IB-1 slice 4, IB-4: the demo shows each of the slim Inbox's lists with something in it (From chats with two
// suggestions and a conversation that isn't one, Promises with a late one and two that cleared on their own, Captures),
// on whatever weekday it opens, with nothing sent out of FocusTime and only the demo's fictional people.
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { MyPromisesData, SuggestionsData } from "../plan/conversation-views.ts";
import { railItems, todayLines, type InboxListData, type InboxTodayData } from "../plan/inbox-items.ts";
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

describe("the demo's Inbox (IB-4)", () => {
  const net = useNoOutbound();

  for (const now of days)
    it(`has something in each list (${Temporal.Instant.from(now).toZonedDateTimeISO("America/New_York").toLocaleString("en-US", { weekday: "long" })})`, async () => {
      const ctx = await demo(now);
      const promises = await run<MyPromisesData>(ctx, "my_promises.list");
      const list = await run<InboxListData>(ctx, "inbox.list");
      const chats = await run<SuggestionsData>(ctx, "conversations.suggestions");
      // From chats: the two from my last workday; never the one about which story is next, nor the one asked 25 minutes ago.
      expect(chats.suggestions.map((x) => x.title).sort()).toEqual(["Show the delivery fee as its own column in the order export", "Spanish version of the intake form"]);
      expect(chats.suggestions.find((x) => x.clientName === "Harbor")?.levelWord).toBe("Feature");
      expect(chats.foot.lastPoll).toBeTruthy();
      // Promises: a late one; two cleared on their own, with their reasons.
      expect(list.items.some((i) => i.views.includes("promises") && i.late)).toBe(true);
      expect(promises.cleared?.map((c) => c.reason).sort()).toEqual(["#2216 was finished", "Not touched for 7 days"]);
      expect(promises.promises.map((p) => p.what)).not.toContain("Share a sample pallet label with Priya");
      // Captures.
      expect(list.items.some((i) => i.views.includes("captures"))).toBe(true);
      // The badge: suggestions plus late or due-today promises; Today's strip and Week's rail read the same rows.
      const today = await run<InboxTodayData>(ctx, "inbox.today");
      expect(today.needsYou).toBe(list.counts.needs_you);
      expect(list.counts.needs_you).toBe(chats.suggestions.length + list.items.filter((i) => i.kind === "promise" && i.views.includes("needs_you")).length);
      expect(todayLines(today.items, { today: list.today, now, dayEnd: null }).length).toBeGreaterThan(0);
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
