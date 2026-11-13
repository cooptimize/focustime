// QF-1 (part 6): a short "I will" reply to a teammate's ask is my promise. With AI (the answer names me and my reply)
// and with AI off (the rules' promise phrase), it lands in My promises and in the Inbox's Promises and Needs you, and
// the conversation's status names me. The messages are fictional and only of the real one's shape.
import { describe, expect, it } from "vitest";
import type { ProviderCall } from "../ai/types.ts";
import type { ConversationsData, MyPromisesData } from "../plan/conversation-views.ts";
import { viewsOf } from "../plan/inbox-items.ts";
import { aCommitmentAnswer, aConversationUpdate, anUpdateAnswer } from "../test/builders/index.ts";
import { cfg, people } from "../test/conversation-people.ts";
import { CHAT, EVAN, LENA, NOW, world } from "../test/conversations.ts";
import { inboxFacts } from "./conversation-actions.ts";

/** The fake AI: every message work in one conversation; "I will" is its sender's commitment. */
const answer = (c: ProviderCall) => {
  const input = JSON.parse(c.input) as { open_conversations: { ref: string }[]; messages: { ref: string; from: string; text: string }[] };
  const conv = input.open_conversations[0]?.ref ?? "n1";
  const reply = input.messages.find((m) => /^I will\b/.test(m.text));
  return JSON.stringify(anUpdateAnswer({
    messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: conv, confident_new_topic: false })),
    conversations: [aConversationUpdate({ ref: conv, commitments: reply ? [aCommitmentAnswer({ who: reply.from, what: "Update the report views and the schema", messages: [reply.ref] })] : [] })],
  }));
};

describe("an \"I will\" reply is my promise", () => {
  for (const mode of ["with AI", "with AI off"] as const)
    it(mode, async () => {
      const w = world(mode === "with AI" ? { respond: answer } : { allowed: [] });
      const more = mode === "with AI" ? {} : { groupWithoutAi: true };
      const ask = await w.say(CHAT, LENA, "2026-11-04T19:00:00Z", "Evan can you take the report view changes and the schema updates this week?", { mentions: [{ id: EVAN.userId!, name: "Evan Ford", at: 0 }] });
      await w.run(CHAT, [ask], more);
      const reply = await w.say(CHAT, EVAN, "2026-11-04T19:05:00Z", "I will", { replyToId: ask.messageId });
      await w.run(CHAT, [reply], more);

      const p = await people(w);
      const mine = await p.as(EVAN).run<MyPromisesData>("my_promises.list");
      expect(mine.promises).toHaveLength(1);
      expect(mine.promises[0]).toMatchObject({ state: "open", toName: "Lena Hart" });
      // The Inbox: in Promises (IB-4: new alone doesn't make it count).
      const facts = (await inboxFacts(p.as(EVAN).ctx, cfg)).filter((f) => f.kind === "promise");
      expect(facts).toHaveLength(1);
      expect(viewsOf(facts[0]!, undefined, NOW.slice(0, 10), NOW)).toEqual(["promises"]);
      if (mode === "with AI") {
        const list = await p.as(EVAN).run<ConversationsData>("conversations.list");
        const lines = [...list.needsYou, ...list.inProgress].map((c) => c.statusLine);
        expect(lines).toContain("Evan committed");
      }
      // Never Lena's.
      expect((await p.as(LENA).run<MyPromisesData>("my_promises.list")).promises).toEqual([]);
    });
});
