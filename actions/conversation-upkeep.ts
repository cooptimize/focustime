// CV-1: what the shared job does after each read of the chats, for everyone at once: escalation of commitments that
// imply a DevOps item nobody made (after one of the committer's working days, their hours and PTO; at once when they
// are on PTO), and follow-through: one suggested DevOps comment for a linked item's owner when its conversation moved
// on and then paused 30 minutes, or resolved (at most one a day per item unless it resolved), and a description change
// only for a clear scope change. Each person's own tick (server/ticks.ts) sends their reminder and "taken over" notice.
// Never reassigns, never notifies the whole team, never writes to DevOps: suggestions wait for Post comment or Skip.
// Nothing about a chat's content is logged (counts only).
import type { AiService } from "../ai/service.ts";
import { NO_OTHER_CLIENTS } from "../plan/boundary.ts";
import { isInternalKey } from "./client-accounts.ts";
import { COMMENT_INSTRUCTIONS, COMMENT_SCHEMA, COMMENT_TASK, type CommentAnswer } from "../plan/conversation-draft.ts";
import { escalateAt, oneLine, suggestionDue, type Conversation } from "../plan/conversations.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import type { TeamsStore } from "../store/teams-store.ts";
import { withoutEmails } from "../plan/asks-ai.ts";
import type { TimeModel } from "../week/hours.ts";
import type { WorkItem } from "../week/types.ts";
import type { LogRecord } from "../log/logger.ts";

export type UpkeepDeps = {
  teams: TeamsStore;
  convs: ConversationStore;
  now: string;
  /** A FocusTime user's hours and PTO days (null: not a FocusTime user, so the neutral default hours). */
  hoursOf: (userId: string) => Promise<{ hours: TimeModel; ptoDays: ReadonlySet<string> } | null>;
  defaultHours: TimeModel;
  /** The client's open items as last read (for an item's assignee), or null. */
  items: (clientKey: string) => Promise<readonly WorkItem[] | null>;
  /** The FocusTime user with this email (an item's assignee), or null. */
  userByEmail: (email: string) => Promise<string | null>;
  /** The pipeline's AI for a client (its reader's switches, the app's cap); null: rules only. */
  ai: (clientKey: string) => Promise<AiService | null>;
  clientName: (clientKey: string) => Promise<string>;
  log: (r: LogRecord) => void;
};

export type UpkeepResult = { escalated: number; suggestions: number };

export async function upkeep(d: UpkeepDeps): Promise<UpkeepResult> {
  const out: UpkeepResult = { escalated: 0, suggestions: 0 };
  // Escalation: open commitments that imply an item, not created or linked yet.
  for (const k of await d.convs.openItemCommitments()) {
    if (k.escalatedAt || k.itemId) continue;
    const h = (k.whoId ? await d.hoursOf(k.whoId).catch(() => null) : null) ?? { hours: d.defaultHours, ptoDays: new Set<string>() };
    const at = escalateAt(k.takenAt ?? k.createdAt, h.hours, h.ptoDays);
    if (Date.parse(at) > Date.parse(d.now)) continue;
    await d.convs.updateCommitment(k.id, { escalatedAt: d.now });
    out.escalated++;
  }
  // Follow-through: conversations tracked as an item, with a meaningful change since the last suggestion.
  const day = d.now.slice(0, 10);
  const chats = await d.teams.chats();
  for (const chat of chats) {
    for (const c of await d.convs.conversations([chat.chatId])) {
      if (!c.itemId || !c.itemChange) continue;
      if (!suggestionDue(c, d.now, await d.convs.suggestedOn(c.itemId, day))) continue;
      const forUser = await ownerOf(d, c);
      if (!forUser) continue;
      const internal = chat.kind === "delivery";
      const { lines, namesRemoved } = await commentLines(d, c);
      await d.convs.addSuggestion({ conversationId: c.id, itemId: c.itemId, kind: "comment", forUser, body: internal ? "" : lines.join("\n"), before: null, after: null, internal: internal ? lines : [], day, ...(namesRemoved ? { namesRemoved } : {}) });
      out.suggestions++;
      // A clear scope change: also a description change, appended to the current text (never a rewrite), confirmed by hand.
      if (c.itemChange.scope && !internal) {
        await d.convs.addSuggestion({ conversationId: c.id, itemId: c.itemId, kind: "description", forUser, body: oneLine(c.itemChange.note, 600), before: null, after: null, internal: [], day });
        out.suggestions++;
      }
      // The change is suggested: wait for the next one.
      await d.convs.updateConversation(c.id, { itemChange: null });
    }
  }
  if (out.escalated || out.suggestions) d.log({ source: "plan", op: "conversations_upkeep", count: out.escalated + out.suggestions });
  return out;
}

/** Who a suggestion is for: the item's assignee (a FocusTime user), else the committer, else the conversation's owner. */
async function ownerOf(d: UpkeepDeps, c: Conversation): Promise<string | null> {
  const item = (await d.items(c.clientKey).catch(() => null))?.find((i) => i.id === c.itemId);
  if (item?.assignedToEmail) {
    const u = await d.userByEmail(item.assignedToEmail).catch(() => null);
    if (u) return u;
  }
  const ks = await d.convs.commitmentsIn([c.id]);
  return ks.find((k) => k.itemId === c.itemId)?.whoId ?? ks[0]?.whoId ?? c.ownerId ?? null;
}

/** The comment's lines: AI's short update (the app's cap) from the summary and the change, else the change itself. */
async function commentLines(d: UpkeepDeps, c: Conversation): Promise<{ lines: string[]; namesRemoved?: boolean }> {
  const fallback = { lines: [oneLine(c.itemChange?.note ?? c.summary, 400)].filter(Boolean) };
  const ai = await d.ai(c.clientKey).catch(() => null);
  if (!ai) return fallback;
  const input = JSON.stringify({ client: await d.clientName(c.clientKey), item: c.itemId, conversation: { title: withoutEmails(c.title), summary: withoutEmails(c.summary) }, change: { kind: c.itemChange?.kind ?? "update", note: withoutEmails(c.itemChange?.note ?? "") }, resolved: c.status === "resolved" });
  // GD-2 point 5: the comment never names another client (the check after replaces one with "another client").
  // Internal's comments may name clients (the service skips the check after for Internal too).
  const internal = await isInternalKey(null, c.clientKey).catch(() => false);
  const r = await ai.run<CommentAnswer>({ name: COMMENT_TASK, client: c.clientKey, instructions: internal ? COMMENT_INSTRUCTIONS : `${COMMENT_INSTRUCTIONS}\n${NO_OTHER_CLIENTS}`, mentions: { input: "words", answer: "scrub" } }, input, COMMENT_SCHEMA);
  if (!r.ok) return fallback;
  const lines = r.value.lines.map((l) => oneLine(l, 300)).filter(Boolean).slice(0, 4);
  return lines.length ? { lines, ...(r.namesRemoved ? { namesRemoved: true } : {}) } : fallback;
}
