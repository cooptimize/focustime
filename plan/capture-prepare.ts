// CP-1: an AI-prepared DevOps version of one captured draft. Pure: the instructions, the schema built from what this
// client's DevOps offers (its process's types and its open parents), the input, the answer's checks, and the words a
// draft row shows. One client per request: everything offered here comes from that client's own DevOps reads.
import type { JsonSchema } from "../ai/types.ts";
import type { DraftAi, DraftStory } from "./types.ts";

/** The task name the AI log keeps (never the input or the answer). */
export const PREPARE_TASK = "capture.prepare";
/** Its own output limit (maxOutputTokens key, D686). */
export const PREPARE_MAX_OUTPUT = 1200;
/** At most this many open parents go with a request (titles only). */
export const MAX_CANDIDATES = 60;
/** At most this many examples from the client's past items. */
export const MAX_EXAMPLES = 5;
/** A "writing" older than this is a lost request: the draft shows as plain. */
export const WRITING_MS = 2 * 60_000;

export const PREPARE_INSTRUCTIONS = [
  "You turn one quick note a consultant captured into a DevOps-ready work item for one client.",
  "Write in plain language, the way this client's own items read (see the examples and house style when given).",
  "title: short and specific, an action or outcome, no client name, no ticket ids, at most 120 characters.",
  "description: two to five plain sentences on what and why, only from the note and the parent; never invent facts, names or numbers.",
  "acceptance_criteria: for a story, three to six short lines, each starting with '- ', testable; for a feature, an empty string.",
  "type: one of the offered types, the one that fits the note best; null only when none is offered.",
  "parent_id: the id of the one offered parent the note clearly belongs under, or null when none clearly fits. Never guess.",
  "parent_reason: one short line on why that parent, or why none fits.",
].join("\n");

export type Candidate = { id: number; title: string; type: string };
export type Example = { title: string; summary: string };
export type PrepareInput = {
  level: "story" | "feature";
  clientName: string;
  /** What I typed (the capture's text) and my draft's title. */
  note: string;
  title: string;
  types: string[];
  candidates: Candidate[];
  examples: Example[];
  style: string | null;
};
export type PrepareAnswer = { title: string; description: string; acceptance_criteria: string; type: string | null; parent_id: number | null; parent_reason: string };

/** The strict schema for this request: the type and the parent can only be what was offered (or null). */
export function prepareSchema(types: readonly string[], candidateIds: readonly number[]): JsonSchema {
  const nullable = (values: readonly (string | number)[], t: "string" | "integer"): JsonSchema => (values.length ? { anyOf: [{ type: t, enum: [...values] }, { type: "null" }] } : { type: "null" });
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      acceptance_criteria: { type: "string" },
      type: nullable(types, "string"),
      parent_id: nullable(candidateIds, "integer"),
      parent_reason: { type: "string" },
    },
    required: ["title", "description", "acceptance_criteria", "type", "parent_id", "parent_reason"],
    additionalProperties: false,
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The request's input: the note, this client's offered types and parents, a few of its own examples. */
export function prepareInput(p: PrepareInput): string {
  return JSON.stringify({
    kind: p.level === "feature" ? "feature" : "story",
    client: p.clientName,
    note: clip(p.note, 1000),
    my_title: clip(p.title, 200),
    offered_types: p.types,
    offered_parents: p.candidates.slice(0, MAX_CANDIDATES).map((c) => ({ id: c.id, type: c.type, title: clip(c.title, 160) })),
    examples: p.examples.slice(0, MAX_EXAMPLES).map((e) => ({ title: clip(e.title, 160), summary: clip(e.summary, 300) })),
    house_style: p.style ? clip(p.style, 1200) : null,
  });
}

/**
 * The types offered for a draft: the children the offered parents' types take, kept to the level the draft is (the
 * process's child level for a story, its parent level for a feature), else that level's types. The process default
 * first, so it is the obvious choice.
 */
export function offeredTypes(o: { level: "story" | "feature"; levelTypes: readonly string[]; childrenOf: (type: string) => readonly string[]; parentTypes: readonly string[]; defaultType: string | null }): string[] {
  const level = new Set(o.levelTypes);
  const fromParents = [...new Set(o.parentTypes.flatMap((t) => o.childrenOf(t)))].filter((t) => level.has(t));
  const out = fromParents.length ? fromParents : [...o.levelTypes];
  return o.defaultType && out.includes(o.defaultType) ? [o.defaultType, ...out.filter((t) => t !== o.defaultType)] : out;
}

/** The answer as the draft's AI version, or why it can't be used. Trimmed; acceptance dropped for a feature. */
export function toDraftAi(a: PrepareAnswer, o: { level: "story" | "feature"; types: readonly string[]; candidateIds: readonly number[]; hasParent: boolean; ranAt: string }): DraftAi | { problem: string } {
  const title = a.title.trim();
  if (!title) return { problem: "empty title" };
  if (title.length > 200) return { problem: "title too long" };
  if (a.type !== null && !o.types.includes(a.type)) return { problem: "type not offered" };
  if (a.parent_id !== null && !o.candidateIds.includes(a.parent_id)) return { problem: "parent not offered" };
  const parentId = a.parent_id;
  return {
    state: parentId !== null || o.hasParent ? "ready" : "needs_parent",
    title,
    description: clip(a.description.trim(), 8000) || null,
    acceptance: o.level === "story" ? clip(a.acceptance_criteria.trim(), 8000) || null : null,
    type: a.type,
    parentId,
    parentReason: clip(a.parent_reason.trim(), 300) || null,
    note: null,
    ranAt: o.ranAt,
  };
}

/** Where a draft stands, for its row and the preview. "no_pat" and "stale" come from outside the stored state. */
export type DraftRowState = "no_pat" | "writing" | "ready" | "needs_parent" | "plain";
export function draftRowState(d: Pick<DraftStory, "parentItemId" | "ai">, o: { canWrite: boolean; now: string }): DraftRowState {
  if (!o.canWrite) return "no_pat";
  const ai = d.ai;
  if (ai?.state === "writing") return ai.ranAt && Temporal.Instant.compare(Temporal.Instant.from(ai.ranAt).add({ milliseconds: WRITING_MS }), Temporal.Instant.from(o.now)) > 0 ? "writing" : "plain";
  if (ai?.state === "ready" || ai?.state === "needs_parent") return d.parentItemId !== null || ai.parentId !== null ? "ready" : "needs_parent";
  return "plain";
}

/** The row's words: what the draft needs next. */
export function draftRowText(state: DraftRowState, d: Pick<DraftStory, "parentItemId" | "ai">, clientName: string): string {
  switch (state) {
    case "no_pat":
      return `Add a write PAT for ${clientName}`;
    case "writing":
      return "AI still writing…";
    case "ready":
      return "Ready to create";
    case "needs_parent":
      return "Needs a parent";
    case "plain":
      return d.ai?.state === "failed" ? `Plain draft: ${d.ai.note ?? "the AI couldn't help"}${d.parentItemId === null ? " · needs a parent" : ""}` : `AI off: plain draft${d.parentItemId === null ? " · needs a parent" : ""}`;
  }
}
