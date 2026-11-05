// CV-1: the DevOps item drafted from a whole conversation for the person who committed to it, and the comment
// suggested to a linked item's owner when the conversation moves. Pure: what one "conversations.draft_item" or
// "conversations.comment" request sends and accepts, and how the description and the comment are written. The
// original messages are appended by code (never by the model), after a rule, each with its sender and time, its
// sanitized HTML intact, then the link to the Teams chat.
import type { JsonSchema } from "../ai/types.ts";
import { withoutEmails } from "./asks-ai.ts";
import { oneLine, type ItemDraft } from "./conversations.ts";

export const DRAFT_TASK = "conversations.draft_item";
export const COMMENT_TASK = "conversations.comment";

export const DRAFT_INSTRUCTIONS = [
  "You draft one Azure DevOps work item from a Teams conversation between a consulting team and its client.",
  "Use only the input. Plain, short English. Never invent ids: parent_feature and likely_item must be ids from the input's lists, or null.",
  "title: at most 80 characters, a DevOps title. asked: one or two sentences, what is being asked. check_first: up to 4 short steps to check first. likely_change: one or two sentences, the change that probably fixes it. open_questions: up to 4 short questions still open.",
  "level: bug (something is wrong), story (a change or new work), or feature (a larger piece with several stories).",
  "parent_feature: the open feature this belongs under, when one clearly fits; else null. likely_item: an open item that is clearly already this work, else null.",
].join("\n");

export const DRAFT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    asked: { type: "string" },
    check_first: { type: "array", items: { type: "string" } },
    likely_change: { type: "string" },
    open_questions: { type: "array", items: { type: "string" } },
    level: { type: "string", enum: ["bug", "story", "feature"] },
    parent_feature: { type: ["integer", "null"] },
    likely_item: { type: ["integer", "null"] },
  },
  required: ["title", "asked", "check_first", "likely_change", "open_questions", "level", "parent_feature", "likely_item"],
  additionalProperties: false,
};
export type DraftAnswer = { title: string; asked: string; check_first: string[]; likely_change: string; open_questions: string[]; level: "bug" | "story" | "feature"; parent_feature: number | null; likely_item: number | null };

export type DraftMessage = { ref: string; from: string; side: "client" | "Cooptimize"; at: string; text: string };

/** The draft request's input: the conversation (title, summary, messages as text) and the client's open features and items. */
export function draftInput(o: { clientName: string; title: string; summary: string; messages: readonly DraftMessage[]; features: readonly { id: number; title: string }[]; items: readonly { id: number; title: string; type: string }[] }): string {
  return JSON.stringify({
    client: o.clientName,
    conversation: { title: withoutEmails(o.title), summary: withoutEmails(o.summary), messages: o.messages.map((m) => ({ ...m, text: withoutEmails(m.text.slice(0, 2000)) })) },
    open_features: o.features.slice(0, 40).map((f) => ({ id: f.id, title: withoutEmails(f.title.slice(0, 200)) })),
    open_items: o.items.slice(0, 50).map((i) => ({ id: i.id, title: withoutEmails(i.title.slice(0, 200)), type: i.type })),
  });
}

/** The answer as a draft, or null when it names an id it wasn't given (nothing invented reaches the preview). */
export function draftFrom(a: DraftAnswer, o: { featureIds: readonly number[]; itemIds: readonly number[] }): ItemDraft | null {
  if (a.parent_feature !== null && !o.featureIds.includes(a.parent_feature)) return null;
  if (a.likely_item !== null && !o.itemIds.includes(a.likely_item)) return null;
  const title = oneLine(a.title, 80);
  if (!title) return null;
  const list = (xs: readonly string[]) => xs.map((x) => oneLine(x, 200)).filter(Boolean).slice(0, 4);
  return { title, asked: oneLine(a.asked, 400), checkFirst: list(a.check_first), likelyChange: oneLine(a.likely_change, 400), openQuestions: list(a.open_questions), level: a.level, parentId: a.parent_feature, likelyItem: a.likely_item, byAi: true };
}

/** Without AI: the conversation's title and summary as the draft. */
export function draftWithoutAi(c: { title: string; summary: string }, level: ItemDraft["level"] = "story"): ItemDraft {
  return { title: oneLine(c.title, 80) || "From a Teams conversation", asked: c.summary.split("\n")[0] ?? "", checkFirst: [], likelyChange: "", openQuestions: [], level, parentId: null, likelyItem: null, byAi: false };
}

/** The path of action as plain text (what the person edits in the preview). */
export function pathOfAction(d: ItemDraft): string {
  const parts: string[] = [];
  if (d.asked) parts.push(`What's being asked\n${d.asked}`);
  if (d.checkFirst.length) parts.push(`Check first\n${d.checkFirst.map((x) => `- ${x}`).join("\n")}`);
  if (d.likelyChange) parts.push(`Likely change\n${d.likelyChange}`);
  if (d.openQuestions.length) parts.push(`Open questions\n${d.openQuestions.map((x) => `- ${x}`).join("\n")}`);
  return parts.join("\n\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The edited path of action as HTML (headings bold, "- " lines as a list). */
export function pathHtml(text: string): string {
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return "";
    const [head, ...rest] = lines;
    const bullets = rest.filter((l) => l.startsWith("- "));
    const body = rest.filter((l) => !l.startsWith("- "));
    const isHead = rest.length > 0 && !head!.startsWith("- ");
    return `${isHead ? `<div><strong>${esc(head!)}</strong></div>` : `<div>${esc(head!)}</div>`}${body.map((l) => `<div>${esc(l)}</div>`).join("")}${bullets.length ? `<ul>${bullets.map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>` : ""}`;
  }).join("<br>");
}

export type OriginalMessage = { sender: string; at: string; html: string };

/**
 * The description as DevOps stores it: the path of action, a rule, the original messages (sender and time, the
 * sanitized HTML as it was), then the link to the chat. Written by code; the model never sees or writes this part.
 */
export function descriptionHtml(path: string, originals: readonly OriginalMessage[], o: { zone: string; chatName: string; chatLink: string }): string {
  const when = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(o.zone).toPlainDateTime().toString({ smallestUnit: "minute" }).replace("T", " ");
  const msgs = originals.map((m) => `<div><strong>${esc(m.sender)}</strong> · ${esc(when(m.at))}</div><blockquote>${m.html || "<div><br></div>"}</blockquote>`).join("");
  return `${pathHtml(path)}<hr><div><strong>From the Teams conversation in ${esc(o.chatName)}</strong></div>${msgs}<div><a href="${esc(o.chatLink)}">Open the chat in Teams</a></div>`;
}

// ---- conversations.comment ----

export const COMMENT_INSTRUCTIONS = [
  "You write one short update comment for an Azure DevOps work item from a Teams conversation about it.",
  "Use only the input. Plain, short English, no greeting, no sign-off. Say only what changed since the last update: decisions, root cause, scope, dates, data.",
  "lines: 1 to 4 short sentences, each a separate fact.",
].join("\n");
export const COMMENT_SCHEMA: JsonSchema = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } } },
  required: ["lines"],
  additionalProperties: false,
};
export type CommentAnswer = { lines: string[] };

/** The comment as posted: the chosen lines, then the link back to the conversation in Teams. */
export function commentText(lines: readonly string[], link: string): string {
  const body = lines.map((l) => l.trim()).filter(Boolean);
  return [...(body.length ? body : ["Discussed in an internal chat."]), "", `From the Teams conversation: ${link}`].join("\n");
}

/** A description's proposed text after a clear scope change: the current one kept, the change added below. Never a rewrite. */
export function descriptionAfter(before: string, note: string, day: string): string {
  return `${before.trim()}${before.trim() ? "\n\n" : ""}Scope change from Teams, ${day}: ${note.trim()}`;
}
