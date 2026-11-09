// AS-1 into TB-1, TB-3: the bot's AssistantService on the real assistant's types. The answer's cards and links stay as
// the Assistant made them (server/teams/render.ts draws them); proposals keep their whole preview; ids are strings in
// the bot and numbers in the service; a DevOps write's undo is that write's own; only "teams" is sent as the context.
import { describe, expect, it } from "vitest";
import type { Assistant, ConfirmResult, HandleResult, Proposal } from "../../assistant/types.ts";
import { teamsAssistant } from "./assistant.ts";

const URL = "https://focustime.example.com";
const proposal: Proposal = {
  id: 7, action: "devops.confirm", clientKey: "fabrikam", clientName: "Fabrikam", title: "Comment on #4417",
  preview: { summary: "Add a comment to a DevOps item", system: "DevOps", target: "#4417 Export", identity: "Sam <sam@cooptimize.example>", rows: [{ label: "Comment", before: null, after: "Works for March." }], notes: ["Written only if the item is still at revision 3."] },
  whoSees: "Visible to everyone with access to the Portal project in DevOps.", before: { Comment: null }, after: { Comment: "Works for March." }, expiresAt: "2026-11-05T15:15:00Z", editable: ["text"], state: "open",
};

function fake(confirm: ConfirmResult) {
  const seen: unknown[] = [];
  const a: Pick<Assistant, "handle" | "confirm" | "cancel" | "propose"> = {
    handle: async (i) => (seen.push(i), {
      turnId: 3, status: "ok", reply: "Here it is.", proposals: [proposal],
      cards: [{ kind: "item", clientKey: "fabrikam", clientName: "Fabrikam", id: 4417, title: "Export", type: "Feature", state: "Active", owner: null, start: null, target: "2026-12-04", children: [], link: { label: "Open #4417 in Ahead", href: "#/ahead/item/4417" }, devopsUrl: null }],
      links: [{ label: "Open the command menu", href: "#/commands" }],
    } satisfies HandleResult),
    confirm: async (i) => (seen.push(i), confirm),
    cancel: async (i) => (seen.push(i), { ok: true as const }),
    propose: async (i) => (seen.push(i), { ok: true as const, proposal }),
  };
  return { a, seen };
}

describe("teamsAssistant", () => {
  it("maps an answer: cards, proposals and links; only 'teams' goes as the context", async () => {
    const { a, seen } = fake({ ok: false, reason: "gone", message: "x" });
    const r = await teamsAssistant(a, URL).handle({ person: { userId: "u1" }, channel: "teams", text: "What's #4417?", context: { surface: "teams", conversation: "personal", locale: "en-US", timeZone: "America/New_York" } });
    expect(seen[0]).toEqual({ person: { userId: "u1" }, channel: "teams", text: "What's #4417?", context: { screen: "teams" } });
    expect(r.turnId).toBe("3");
    expect(r.cards[0]).toMatchObject({ kind: "item", id: 4417, link: { href: "#/ahead/item/4417" } });
    expect(r.proposals[0]).toEqual({ id: "7", title: "Comment on #4417 (Fabrikam)", whoSees: proposal.whoSees, changes: [{ field: "Comment", before: null, after: "Works for March." }], note: "Written only if the item is still at revision 3.", expiresAt: proposal.expiresAt, summary: "Add a comment to a DevOps item", target: "#4417 Export", system: "DevOps", identity: "Sam <sam@cooptimize.example>", editable: ["text"], turnId: null });
    expect(r.links).toEqual([{ label: "Open the command menu", href: "#/commands" }]);
  });
  it("confirm: the id as a number, Undo is the write's own; changed carries the fresh proposal; cancel", async () => {
    const ok = fake({ ok: true, result: { kind: "note", text: "Comment added" }, undo: { kind: "devops", id: 12 }, message: "Added the comment to #4417" });
    expect(await teamsAssistant(ok.a, URL).confirm({ person: { userId: "u1" }, proposalId: "7", edits: { text: "Works.", junk: 4 } })).toEqual({ status: "ok", message: "Added the comment to #4417", undo: { label: "Undo", proposalId: "7", writeId: 12 }, links: [] });
    expect(ok.seen[0]).toEqual({ person: { userId: "u1" }, proposalId: 7, edits: { text: "Works." } });
    const changed = fake({ ok: false, reason: "changed", message: "It changed", proposal });
    expect(await teamsAssistant(changed.a, URL).confirm({ person: { userId: "u1" }, proposalId: "7" })).toMatchObject({ status: "changed", proposal: { id: "7" } });
    const no = fake({ ok: false, reason: "not_allowed", message: "Not yours" });
    expect(await teamsAssistant(no.a, URL).confirm({ person: { userId: "u1" }, proposalId: "nope" })).toEqual({ status: "not_allowed", message: "Not yours" });
    expect(no.seen[0]).toMatchObject({ proposalId: 0 });
    await teamsAssistant(no.a, URL).cancel({ person: { userId: "u1" }, proposalId: "7" });
    expect(no.seen.at(-1)).toEqual({ person: { userId: "u1" }, proposalId: 7 });
  });
});
