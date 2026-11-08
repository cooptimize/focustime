// SR-3: the pure rules behind Status's inline lines: Enter, Esc, what counts as pending, and where an unpushed line
// shows in the email-like Preview. No React, no storage.

/** A line waiting for Push all: a new comment on a feature, an edit of one of my comments, or deleting one. */
export type Line = { key: string; clientKey: string; itemId: number; kind: "comment" | "comment_edit" | "comment_delete"; commentId: number | null; text: string; from: "me" | "ai" };

/**
 * Enter in a line box: a new line with text closes (it stays pending) and the next empty one opens under the same
 * feature; an empty new line stays open. An edit closes. Returns the lines and the key of the box to open (null: none).
 */
export function enterLine(lines: readonly Line[], key: string, nextKey: string): { lines: Line[]; open: string | null } {
  const l = lines.find((x) => x.key === key);
  if (!l) return { lines: [...lines], open: null };
  if (l.kind !== "comment") return { lines: [...lines], open: null };
  if (!l.text.trim()) return { lines: [...lines], open: key };
  const at = lines.indexOf(l);
  const next: Line = { key: nextKey, clientKey: l.clientKey, itemId: l.itemId, kind: "comment", commentId: null, text: "", from: "me" };
  return { lines: [...lines.slice(0, at + 1), next, ...lines.slice(at + 1)], open: nextKey };
}

/**
 * Esc (or leaving a box with Tab): it closes. A new line left empty is removed; an edit that says what the comment says
 * now is removed (it isn't a change). Anything else stays pending.
 */
export function closeLine(lines: readonly Line[], key: string, currentText?: (commentId: number) => string | null): Line[] {
  const l = lines.find((x) => x.key === key);
  if (!l) return [...lines];
  const drop = (l.kind === "comment" && !l.text.trim()) || (l.kind === "comment_edit" && l.commentId !== null && currentText?.(l.commentId)?.trim() === l.text.trim());
  return drop ? lines.filter((x) => x.key !== key) : [...lines];
}

/** Lines that Push all would write: with text, and an edit only when it changes something. */
export function pendingLines(lines: readonly Line[], currentText?: (commentId: number) => string | null): Line[] {
  return lines.filter((l) => l.text.trim() && !(l.kind === "comment_edit" && l.commentId !== null && currentText?.(l.commentId)?.trim() === l.text.trim()));
}

/** "4 lines to push". */
export const pendingLabel = (n: number) => (n === 1 ? "1 line to push" : `${n} lines to push`);
/** "3 features need your update". */
export const needsLabel = (n: number) => (n === 1 ? "1 feature needs your update" : `${n} features need your update`);

/** Stack-rank order: the order field ascending, unset last, then id (as DevOps' backlog and Kat's report). */
export function byRank<T extends { order?: number | null; id: number }>(a: T, b: T): number {
  const x = a.order ?? Number.POSITIVE_INFINITY;
  const y = b.order ?? Number.POSITIVE_INFINITY;
  return x === y ? a.id - b.id : x < y ? -1 : 1;
}

/**
 * The Preview's features as Monday's email will have them once pushed: those with a comment in the window, plus any
 * other shown feature with a new line pending, in stack-rank order, each once.
 */
export function previewFeatures<T extends { order?: number | null; id: number }>(inReport: readonly T[], others: readonly T[], lines: readonly Line[]): T[] {
  const seen = new Set(inReport.map((f) => f.id));
  const pending = new Set(lines.filter((l) => l.kind === "comment" && l.text.trim()).map((l) => l.itemId));
  const extra: T[] = [];
  for (const f of others) if (!seen.has(f.id) && pending.has(f.id)) (seen.add(f.id), extra.push(f));
  return [...inReport, ...extra].sort(byRank);
}
