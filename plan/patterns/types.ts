// WP-1: DevOps patterns, the shapes shared by the pure parts (plan/patterns/), the store and the run. An item here is
// what FocusTime keeps of a DevOps work item for this page: ids, type, state, dates, parent, title, and numbers about
// its text. Never a description, acceptance criteria or comment text, never a person.

/** Where a type sits, from the real parent and child links (never from type names). */
export type Level = "top" | "middle" | "leaf" | "other";
export const LEVELS: readonly Level[] = ["top", "middle", "leaf", "other"];

/** Numbers about an item's text and fields, worked out when it was read. The text itself is never kept. */
export type Facts = {
  /** Description length in characters after HTML is stripped (0: empty). */
  descLen: number;
  /** Acceptance criteria length, the same way (0: empty or the type has none). */
  acLen: number;
  tags: number;
  /** An estimate or size field has a value. */
  estimate: boolean;
  comments: number;
  /** The state's category is closed (Completed or Removed) or resolved, from the process. */
  closed: boolean;
  /** From the history sample (closed items only), null when not sampled. */
  history?: { changedAfterStart: boolean; emptyAtClose: boolean } | null;
};

export type PatternItem = {
  id: number;
  rev: number;
  type: string;
  state: string;
  createdAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  parentId: number | null;
  title: string;
  facts: Facts;
  /** Created in the 24 months the run covers (false: a parent read for the structure). */
  inWindow: boolean;
};

/** The labels one item gets (validated; see plan/patterns/labels.ts). */
export type Labels = {
  requestType: string;
  /** For "other": a short generic name and a one-line meaning, both already scrubbed of client names. */
  otherName: string | null;
  otherMeaning: string | null;
  layers: string[];
  readiness: string;
  missing: string[];
  confidence: string;
};

/** One request type in a list version. */
export type RequestType = { name: string; meaning: string; example: string };
export type TypeChange = { kind: "merge" | "split" | "rename" | "add" | "keep"; from: string[]; to: string[]; reason: string; count: number };
export type TypeList = { version: string; createdAt: string; types: RequestType[]; changes: TypeChange[]; fingerprint: string };

export type Platform = "azure" | "fabric" | "both";
export const PLATFORMS: readonly Platform[] = ["azure", "fabric", "both"];
