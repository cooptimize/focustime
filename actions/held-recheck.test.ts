// GD-3: every held message checked again under GD-2's rules: old batch holds with no match are released and sorted, a
// real mention in a client-facing chat stays held with what it matched, item ids and codes never match, an alias edit
// re-checks that client's held messages, and the one-time run is marked and idempotent. Fictional names.
import { describe, expect, it } from "vitest";
import { aClientChat, aClientEntry, aConversationUpdate, anUpdateAnswer, HOME_TENANT } from "../test/builders/index.ts";
import { parsed } from "../test/conversation-people.ts";
import { BLAKE, CHAT, EVAN, SAM, world } from "../test/conversations.ts";
import type { ClientEntry } from "../ai/guard.ts";
import type { ProviderCall } from "../ai/types.ts";
import { CLIENT_REFUSED, HELD_MENTION, HELD_REASONS, LEGACY_CLIENT_REFUSED, unsortedLine } from "../plan/conversations.ts";
import type { TeamsMessage } from "../plan/requests.ts";
import { HELD_RECHECK_MARK, heldRecheckOnce, mergeDirectories, recheckHeld } from "./held-recheck.ts";
import type { PollDeps, PollPerson } from "./request-poll.ts";

const contoso = aClientEntry({ key: "contoso", names: ["Contoso Supply"], projects: [], itemIds: [] });
const wingtip = aClientEntry({ key: "wingtip", names: ["Wingtip"], aliases: ["WTG"], projects: ["Wing Ops"], itemIds: [4410, 7701] });
const everyWork = (c: ProviderCall) => {
  const input = JSON.parse(c.input) as { messages: { ref: string }[] };
  return JSON.stringify(anUpdateAnswer({ messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: "n1", confident_new_topic: false })), conversations: [aConversationUpdate({ ref: "n1", title: "Export totals" })] }));
};
type W = ReturnType<typeof world>;

function pollDeps(w: W, o: { directory?: () => ClientEntry[]; boundaryFails?: boolean; logs?: { kind?: string; count?: number; op: string }[] } = {}): PollDeps {
  const person: PollPerson = {
    name: "Sam", config: parsed.ok ? parsed.config : null, ai: null, pipelineAi: async () => w.ai, plan: null, openItems: async () => [],
    boundary: async () => {
      if (o.boundaryFails) throw new Error("dataverse");
      return { internal: false, directory: o.directory ? o.directory() : [contoso, wingtip] };
    },
  };
  return {
    teams: w.teams, conversations: w.convs, users: async () => w.users, person: async () => person, homeTenant: async () => HOME_TENANT, now: w.now,
    log: (r) => void o.logs?.push(r as { kind?: string; count?: number; op: string }),
  };
}
const held = async (w: W, chatId: string, reason: string, ms: TeamsMessage[]) => w.convs.place(ms.map((m) => ({ chatId, messageId: m.messageId, conversationId: null, role: "unsorted" as const, reason, placedBy: "rule" as const, at: m.createdAt })));
const stillHeld = async (w: W, chatId: string) => (await w.convs.placesByRole([chatId], "unsorted")).filter((p) => HELD_REASONS.has(p.reason ?? ""));

describe("GD-3: the re-check", () => {
  it("releases and sorts an old batch hold with no match; a real name match in a client-facing chat stays held and records the word", async () => {
    const w = world({ directory: [contoso, wingtip], allowed: ["contoso"], respond: everyWork });
    const a = await w.say(CHAT, BLAKE, "2026-11-06T15:00:00Z", "01J has weight on the other lines");
    const b = await w.say(CHAT, BLAKE, "2026-11-06T15:01:00Z", "This screenshot is 04JS");
    const c = await w.say(CHAT, BLAKE, "2026-11-06T15:02:00Z", "Same issue WTG had last month");
    await held(w, CHAT.chatId, CLIENT_REFUSED, [a, b]);
    await held(w, CHAT.chatId, LEGACY_CLIENT_REFUSED, [c]);

    const counts = await recheckHeld(pollDeps(w));

    expect(counts).toMatchObject({ released: 2, stillHeld: 1, unresolved: 0, before: { "client_facing:other_client": 2, "client_facing:refused_client": 1 } });
    expect((await w.convs.placeOf(CHAT.chatId, a.messageId))?.role).toBe("work");
    expect((await w.convs.placeOf(CHAT.chatId, b.messageId))?.role).toBe("work");
    expect(await w.convs.placeOf(CHAT.chatId, c.messageId)).toMatchObject({ role: "unsorted", reason: HELD_MENTION, matched: [{ key: "wingtip", word: "WTG" }] });
    // Only what was released went to AI.
    expect(JSON.stringify(w.calls)).toContain("01J");
    expect(JSON.stringify(w.calls)).not.toMatch(/WTG/);
  });

  it("an item id, a project, numbers and codes never hold an incoming message", async () => {
    const w = world({ directory: [contoso, wingtip], allowed: ["contoso"], respond: everyWork });
    const ms = [
      await w.say(CHAT, BLAKE, "2026-11-06T15:00:00Z", "Totals off by 4410 rows, see #7701"),
      await w.say(CHAT, BLAKE, "2026-11-06T15:01:00Z", "This one is 04JS and 01J"),
      await w.say(CHAT, BLAKE, "2026-11-06T15:02:00Z", "Wing Ops isn't involved"),
    ];
    await held(w, CHAT.chatId, CLIENT_REFUSED, ms);
    expect(await recheckHeld(pollDeps(w))).toMatchObject({ released: 3, stillHeld: 0 });
    expect(await stillHeld(w, CHAT.chatId)).toEqual([]);
  });

  it("an internal chat sorts its held messages, a real mention included", async () => {
    const w = world({ directory: [contoso, wingtip], allowed: ["contoso"], respond: everyWork });
    const team = aClientChat({ chatId: "19:contoso-team@thread.v2", clientKey: "contoso", kind: "delivery", displayName: "Contoso team", members: [EVAN, SAM] });
    const m = await w.say(team, EVAN, "2026-11-06T15:00:00Z", "Same issue Wingtip had last month");
    await held(w, team.chatId, HELD_MENTION, [m]);
    expect(await recheckHeld(pollDeps(w))).toMatchObject({ released: 1, stillHeld: 0, before: { "internal:mentions_client": 1 } });
    expect((await w.convs.placeOf(team.chatId, m.messageId))?.role).toBe("work");
  });

  it("never releases on no knowledge: no directory or a failed boundary leaves them held and unresolved", async () => {
    const w = world({ directory: [contoso, wingtip], allowed: ["contoso"], respond: everyWork });
    const m = await w.say(CHAT, BLAKE, "2026-11-06T15:00:00Z", "Same issue WTG had last month");
    await held(w, CHAT.chatId, CLIENT_REFUSED, [m]);
    expect(await recheckHeld(pollDeps(w, { directory: () => [] }))).toMatchObject({ released: 0, unresolved: 1 });
    expect(await recheckHeld(pollDeps(w, { boundaryFails: true }))).toMatchObject({ released: 0, unresolved: 1 });
    expect(await w.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ reason: CLIENT_REFUSED });
    expect(w.calls).toHaveLength(0);
  });

  it("a guard refusal with no boundary isn't a hold: it waits to be sorted and isn't listed as held", async () => {
    const w = world({ directory: [contoso, wingtip], allowed: ["contoso"], respond: everyWork });
    const m = await w.say(CHAT, BLAKE, "2026-11-06T15:00:00Z", "Totals off by 4410 rows");
    const { boundary: _unused, ...rest } = await w.deps(CHAT);
    const { runPipeline } = await import("./conversations-pipeline.ts");
    await runPipeline(rest, CHAT, [m]);
    expect(await w.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ role: "unsorted", reason: "no_boundary" });
    expect(await stillHeld(w, CHAT.chatId)).toEqual([]);
    expect(unsortedLine("no_boundary", "Contoso").does).toBe("retry");
  });

  it("logs counts only, never a name, a word or an id", async () => {
    const w = world({ directory: [contoso, wingtip], allowed: ["contoso"], respond: everyWork });
    const m = await w.say(CHAT, BLAKE, "2026-11-06T15:00:00Z", "Same issue WTG had last month");
    await held(w, CHAT.chatId, CLIENT_REFUSED, [m]);
    const logs: { kind?: string; count?: number; op: string }[] = [];
    await recheckHeld(pollDeps(w, { logs }));
    expect(logs.map((l) => l.kind)).toEqual(expect.arrayContaining(["all:before:client_facing:other_client", "all:still_held"]));
    expect(JSON.stringify(logs)).not.toMatch(/WTG|wingtip|contoso|19:/i);
  });

  it("merges what followers know, so a client only one of them follows still matches", () => {
    const merged = mergeDirectories([aClientEntry({ key: "Wingtip", names: ["Wingtip"], projects: [], itemIds: [] }), aClientEntry({ key: "wingtip", names: ["Wingtip Toys"], aliases: ["WTG"], projects: [], itemIds: [], exactCase: true })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ names: ["Wingtip", "Wingtip Toys"], aliases: ["WTG"], exactCase: true });
  });
});

describe("GD-3: editing a client's names", () => {
  it("re-checks only that client's held messages: an alias removed releases them; an unrelated client's stay untouched", async () => {
    const w = world({ directory: [contoso, wingtip], allowed: ["contoso"], respond: everyWork });
    const m = await w.say(CHAT, BLAKE, "2026-11-06T15:00:00Z", "Same issue WTG had last month");
    await w.run(CHAT, [m]);
    expect(await w.convs.placeOf(CHAT.chatId, m.messageId)).toMatchObject({ reason: HELD_MENTION, matched: [{ key: "wingtip", word: "WTG" }] });
    const noAlias = aClientEntry({ key: "wingtip", names: ["Wingtip"], projects: [], itemIds: [] });
    const unrelated = await recheckHeld(pollDeps(w, { directory: () => [contoso, noAlias] }), { clientKey: "fabrikam" });
    expect(unrelated).toMatchObject({ released: 0, stillHeld: 0, before: {} });
    expect(await recheckHeld(pollDeps(w, { directory: () => [contoso, noAlias] }), { clientKey: "wingtip" })).toMatchObject({ released: 1, stillHeld: 0 });
    expect((await w.convs.placeOf(CHAT.chatId, m.messageId))?.role).toBe("work");
  });
});

describe("GD-3: once per deploy", () => {
  const store = () => {
    const rows = new Map<string, unknown>();
    return { rows, orgRow: async (s: string, k: string) => (rows.has(`${s}/${k}`) ? ({ scope: s, key: k, value: rows.get(`${s}/${k}`) } as never) : null), setOrg: async (o: { scope: string; key: string; value?: unknown }) => (rows.set(`${o.scope}/${o.key}`, o.value), {} as never) };
  };
  const counts = (unresolved: number) => ({ before: { "client_facing:other_client": 19 }, released: 19, stillHeld: 0, skipped: 0, unresolved });

  it("runs once, recording the counts", async () => {
    const s = store();
    let runs = 0;
    const run = async () => (runs++, counts(0));
    expect((await heldRecheckOnce({ store: s, run, log: () => {} })).ran).toBe(true);
    expect((await heldRecheckOnce({ store: s, run, log: () => {} })).ran).toBe(false);
    expect(runs).toBe(1);
    expect(s.rows.get(`${HELD_RECHECK_MARK.scope}/${HELD_RECHECK_MARK.key}`)).toMatchObject({ released: 19 });
  });

  it("isn't marked while a chat couldn't be worked out, so the next start tries again", async () => {
    const s = store();
    let runs = 0;
    await heldRecheckOnce({ store: s, run: async () => (runs++, counts(1)), log: () => {} });
    await heldRecheckOnce({ store: s, run: async () => (runs++, counts(0)), log: () => {} });
    expect(runs).toBe(2);
  });
});
