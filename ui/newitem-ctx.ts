// QC-1: how any screen opens the New form and hears what it made. Its own file (PF-1) so the screens in the first
// download don't bring the form itself (ui/NewItem.tsx, loaded when first opened) with them.
import { createContext, useContext } from "react";
import type { NewPlace } from "../plan/quick-create.ts";
import type { DraftStory } from "../plan/types.ts";

export type { NewPlace };
/** What the opener hears back: the item it made (Ahead selects it, the panel places it) or the draft it saved. */
export type NewHooks = {
  onCreated?: (c: Created) => void;
  onDraft?: (d: DraftStory) => void;
  /** The block panel: the draft is put on the block first, so the created item takes its place there (or it stays as a draft). */
  place?: (d: DraftStory) => Promise<void>;
};
export type Created = { clientKey: string; itemId: number; url: string | null; title: string; type: string; parentId: number | null; assignTo: string | null };
export type OpenNew = (place: NewPlace, hooks?: NewHooks) => void;
/** App provides it; null outside App (the form then isn't offered). */
export const NewItemCtx = createContext<OpenNew | null>(null);
export const useOpenNew = () => useContext(NewItemCtx);
/** Every open screen hears a new item at once (Ahead rereads and selects it); DV-2's signal carries it to others. */
export const CREATED_EVENT = "focustime:devops-created";
