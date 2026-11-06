// DX-1: the pure rules behind Diagnostics: each promise reason, each extraction reason, each chatter kind, and the copy
// text (counts only).
import { describe, expect, it } from "vitest";
import type { MessagePlace } from "./conversations.ts";
import { chatOutcomes, chatterKind, diagnosticsText, extractionReason, extractionRetry, promiseReason, zeroReasons, zeroStatuses, type CommitmentFact, type Diagnostics } from "./diagnostics.ts";

const ME = { id: "ME-ID", name: "Evan Ford" };
const k = (id: number, whoId: string | null, whoName: string, state: CommitmentFact["state"] = "open"): CommitmentFact => ({ id, whoId, whoName, state });
const reason = (ks: CommitmentFact[], shown: number[] = [], others: string[] = []) => promiseReason(ks, ME, { otherUserIds: new Set(others), shownIds: new Set(shown) });
const place = (p: Partial<MessagePlace & { byUser: string | null }>): MessagePlace & { byUser: string | null } => ({ chatId: "c", messageId: "m", conversationId: null, role: "work", reason: null, placedBy: "ai", at: "2026-11-04T15:00:00Z", byUser: null, ...p });

describe("promiseReason", () => {
  it("shown when my open commitment is in Promises or Needs you, filtered when it isn't", () => {
    expect(reason([k(1, "me-id", "Evan Ford")], [1])).toBe("shown");
    expect(reason([k(1, "ME-ID", "Evan Ford")], [])).toBe("filtered");
  });
  it("no open commitment when none is open (a done one doesn't count)", () => {
    expect(reason([])).toBe("no_open_commitment");
    expect(reason([k(1, "ME-ID", "Evan Ford", "done")])).toBe("no_open_commitment");
  });
  it("names the status line's committer: someone else, my name under another id, a namesake user, or no id", () => {
    expect(reason([k(1, "LENA", "Lena Hart")])).toBe("someone_else");
    expect(reason([k(1, "GUEST", "Evan Ford")])).toBe("my_name_other_id");
    expect(reason([k(1, "EVAN-2", "Evan Stone")], [], ["evan-2"])).toBe("same_first_name_other_user");
    expect(reason([k(1, null, "Evan Ford")])).toBe("who_unknown");
    expect(reason([k(1, null, "Lena Hart")])).toBe("someone_else");
  });
});

describe("extractionReason", () => {
  it("from the message's place, or a commitment holding it under another id", () => {
    expect(extractionReason(null, null)).toBe("not_placed");
    expect(extractionReason(place({ role: "unsorted", reason: "chat_cap" }), null)).toBe("unsorted:chat_cap");
    expect(extractionReason(place({ role: "chatter", reason: "ack" }), null)).toBe("ack");
    expect(extractionReason(place({ role: "chatter", reason: "ai" }), null)).toBe("chatter:ai");
    expect(extractionReason(place({ role: "ack", conversationId: 3 }), null)).toBe("ack");
    expect(extractionReason(place({ conversationId: 3 }), null)).toBe("in_conversation");
    expect(extractionReason(place({}), null)).toBe("work_no_conversation");
    expect(extractionReason(place({}), { whoId: "GUEST" })).toBe("other_id");
  });
  it("Retry only for a reason that passes on its own", () => {
    expect(extractionRetry("unsorted:rate_limited")).toBe(true);
    expect(extractionRetry("unsorted:off")).toBe(false);
    expect(extractionRetry("unsorted:other_client")).toBe(false);
    expect(extractionRetry("ack")).toBe(false);
  });
});

describe("chatter outcomes", () => {
  it("tells a keyword rule, the AI, Social chat and Not work-related apart", () => {
    expect(["gif", "sticker", "emoji", "empty", "ack"].map((r) => chatterKind({ reason: r, placedBy: "rule" }))).toEqual(["rule", "rule", "rule", "rule", "rule"]);
    expect(chatterKind({ reason: "ai", placedBy: "ai" })).toBe("ai");
    expect(chatterKind({ reason: "social", placedBy: "rule" })).toBe("social");
    expect(chatterKind({ reason: "not_work:4", placedBy: "person" })).toBe("not_work");
  });
  it("counts the window only, my marks only, and the messages with no place", () => {
    const r = chatOutcomes(["a", "b", "c", "d"], [
      place({ messageId: "a", conversationId: 1, placedBy: "person", reason: "is_work", byUser: "me-id" }),
      place({ messageId: "b", conversationId: 1, placedBy: "person", byUser: "LENA" }),
      place({ messageId: "c", role: "chatter", reason: "not_work:1", placedBy: "person", byUser: "ME-ID" }),
      place({ messageId: "old", role: "chatter", reason: "gif", placedBy: "rule", at: "2026-10-01T00:00:00Z" }),
    ], "2026-10-21T00:00:00Z", "ME-ID");
    expect(r.outcomes.sorted).toEqual({ ai: 0, rules: 0, person: 2 });
    expect(r.outcomes.chatter.rule).toBe(0);
    expect(r.outcomes.notPlaced).toBe(1);
    expect(r.marks).toEqual({ thisIsWork: 1, movedByMe: 0, notWorkMessages: 1, notWorkConversations: 1 });
  });
});

describe("diagnosticsText", () => {
  it("has counts only: no titles, chat names or client names", () => {
    const d: Diagnostics = {
      at: "2026-11-06T15:00:00Z", days: 14,
      promises: { byStatus: { ...zeroStatuses(), committed: 2 }, committed: 2, byReason: { ...zeroReasons(), shown: 1, my_name_other_id: 1 }, rows: [{ conversationId: 9, clientName: "Contoso Supply", title: "Secret plan title", reason: "my_name_other_id" }], extraction: { checked: 1, byReason: { ack: 1 }, rows: [{ clientName: "Contoso Supply", title: "Secret plan title", reason: "ack", retry: false }] } },
      chats: [{ chatName: "Contoso Alliance", clientName: "Contoso Supply", kind: "customer", social: false, total: 3, outcomes: { sorted: { ai: 1, rules: 0, person: 0 }, workNoConversation: 0, chatter: { rule: 1, ai: 1, social: 0, notWork: 0, other: 0 }, unsorted: {}, notPlaced: 0 }, marks: { thisIsWork: 0, movedByMe: 0, notWorkMessages: 0, notWorkConversations: 0 } }],
    };
    const t = diagnosticsText(d);
    for (const x of ["Secret plan title", "Contoso"]) expect(t).not.toContain(x);
    expect(t).toContain("Committed: 2; by reason: shown 1, my_name_other_id 1");
    expect(t).toContain("Chat 1 (customer): 3 messages");
    expect(t).toContain("chatter: keyword rule 1, AI 1");
  });
});
