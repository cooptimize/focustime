// CP-1: the capture box's keys and its Saved toast, as plain functions (tested in capturebox.test.ts).
import type { BoxKind } from "../plan/capture.ts";

/** Enter saves; Ctrl or Cmd+Enter saves and opens the create preview; Shift+Enter is a new line (null: let it type). */
export function keyAction(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing?: boolean }): "save" | "save_open" | null {
  if (e.key !== "Enter" || e.isComposing) return null;
  if (e.shiftKey) return null;
  return e.ctrlKey || e.metaKey ? "save_open" : "save";
}

/** Whether ↓ should leave the box for the kind's fields: only from the last line, so it still moves through the text. */
export const onLastLine = (text: string, caret: number) => !text.slice(caret).includes("\n");

const KIND_WORDS: Record<BoxKind, string> = { later: "", follow_up: " as a promise", draft: " as a draft story", draft_feature: " as a draft feature" };

/** The toast after a save: it always names the client the capture went to ("Saved to Northwind as a draft story"). */
export function savedText(kind: BoxKind, clientName: string | null, extra = ""): string {
  const where = clientName ? `Saved to ${clientName}` : "Saved to Captures";
  return `${where}${KIND_WORDS[kind]}${extra}`;
}

/** How long the Saved toast (and its Undo) stays. */
export const TOAST_MS = 6000;
