// Step 15.3: how any screen opens the draft editor, and a draft's title as the button that does. Its own file (PF-1)
// so the screens in the first download don't bring the editor itself (ui/DraftEditor.tsx, loaded when first opened).
import { createContext, useContext, type ReactNode } from "react";
import type { DraftStory } from "../plan/types.ts";

/** Opens the editor for a draft. App provides it; null outside App (the title then shows as plain text). */
export const DraftEditorCtx = createContext<((d: DraftStory) => void) | null>(null);

/** A draft's title as a button that opens the editor. */
export function DraftTitle({ draft, className }: { draft: DraftStory; className?: string }): ReactNode {
  const open = useContext(DraftEditorCtx);
  if (!open) return <span className={className}>{draft.title}</span>;
  return (
    <button type="button" className={`link-btn draft-title${className ? ` ${className}` : ""}`} title="Edit this draft" onClick={(e) => (e.stopPropagation(), open(draft))}>
      {draft.title}
    </button>
  );
}
