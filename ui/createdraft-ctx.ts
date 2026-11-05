// CP-1: opening the create dialog for a draft, by id. App provides it; null outside App. Its own module, so the
// capture box and the Drafts list can open it without importing the dialog (and its imports) themselves.
import { createContext } from "react";

export const CreateDraftCtx = createContext<((draftId: number) => void) | null>(null);

/** How often the dialog and the Drafts list look again while AI is writing. */
export const WRITING_POLL_MS = 1500;
