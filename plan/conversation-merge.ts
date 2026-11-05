// CV-2: the summary after Merge into…. One "conversations.merge_summary" request (the person's own cap, that client
// only): both conversations' titles and summaries and their messages as text, people by display name, never an
// address. Without AI, or when the answer fails its schema: the two summaries joined, the target's title kept.
import type { JsonSchema } from "../ai/types.ts";
import { withoutEmails } from "./asks-ai.ts";
import { oneLine } from "./conversations.ts";

export const MERGE_TASK = "conversations.merge_summary";

export const MERGE_INSTRUCTIONS = [
  "Two Teams conversations between a consulting team and its client were merged by hand into one.",
  "Use only the input. Plain, short English. title: at most 80 characters, the topic of the merged conversation. summary: 2 to 4 short lines (separated by newlines): what is asked, what is known, who is doing what next.",
].join("\n");

export const MERGE_SCHEMA: JsonSchema = {
  type: "object",
  properties: { title: { type: "string" }, summary: { type: "string" } },
  required: ["title", "summary"],
  additionalProperties: false,
};
export type MergeAnswer = { title: string; summary: string };

type Side = { title: string; summary: string; messages: { from: string; at: string; text: string }[] };

export function mergeInput(o: { clientName: string; into: Side; from: Side }): string {
  const side = (s: Side) => ({ title: withoutEmails(s.title), summary: withoutEmails(s.summary), messages: s.messages.slice(-30).map((m) => ({ from: m.from, at: m.at, text: withoutEmails(m.text.slice(0, 1500)) })) });
  return JSON.stringify({ client: o.clientName, kept: side(o.into), merged: side(o.from) });
}

/** The answer as a title and a 2 to 4 line summary, or null when it isn't usable. */
export function mergeFrom(a: MergeAnswer): { title: string; summary: string } | null {
  const title = oneLine(a.title, 80);
  const lines = a.summary.split("\n").map((l) => oneLine(l, 240)).filter(Boolean).slice(0, 4);
  return title && lines.length ? { title, summary: lines.join("\n") } : null;
}

/** Without AI: the target's title, its summary then the merged one's, at most 4 lines and no line twice. */
export function joinedSummary(into: { title: string; summary: string }, from: { summary: string }): { title: string; summary: string } {
  const lines: string[] = [];
  for (const l of [...into.summary.split("\n"), ...from.summary.split("\n")].map((x) => x.trim()).filter(Boolean)) if (!lines.includes(l)) lines.push(l);
  return { title: into.title, summary: lines.slice(0, 4).join("\n") };
}
