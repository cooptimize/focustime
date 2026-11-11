// CP-1, QC-1: a captured draft, kept fresh while its AI version is written. The create dialog it served was replaced
// by QC-1's New form (ui/NewItem.tsx), which offers the AI version beside my own words; this hook is what is left.
import { useEffect, useRef, useState } from "react";
import type { DraftAiView } from "../actions/types.ts";
import { draftRowState } from "../plan/capture-prepare.ts";
import { call } from "./api.ts";
import { WRITING_POLL_MS } from "./createdraft-ctx.ts";
export { CreateDraftCtx } from "./createdraft-ctx.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** The draft, kept fresh: prepares it once when it never ran, and reads again while AI is writing. */
export function useDraftView(draftId: number, prepare: boolean): { view: DraftAiView | null; error: string | null; reload: () => void; again: () => Promise<void>; running: boolean } {
  const [view, setView] = useState<DraftAiView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [running, setRunning] = useState(false);
  const asked = useRef(false);
  useEffect(() => {
    // QC-1: the New form asks for no draft with id 0.
    if (!draftId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = async () => {
      try {
        let v = await call<DraftAiView>("draft.get", { id: draftId });
        if (prepare && !asked.current && v.canWrite && !v.draft.ai && !v.draft.devopsId) {
          asked.current = true;
          if (live) setView(v);
          v = await call<DraftAiView>("draft.prepare", { id: draftId });
        }
        if (!live) return;
        setView(v);
        // Look again while AI writes, or while a prepare already asked for (by an earlier run) hasn't landed yet.
        const waiting = asked.current && v.canWrite && !v.draft.ai && !v.draft.devopsId;
        if (waiting || draftRowState(v.draft, { canWrite: v.canWrite, now: v.now }) === "writing") timer = setTimeout(() => void look(), WRITING_POLL_MS);
      } catch (e) {
        if (live) setError(errText(e));
      }
    };
    void look();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [draftId, prepare, n]);
  // UI-7: Prepare again: the same prepare once more (its caps and rules), then the fresh view.
  const again = async () => {
    setRunning(true);
    setError(null);
    try {
      setView(await call<DraftAiView>("draft.prepare", { id: draftId, again: true }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setRunning(false);
    }
  };
  return { view, error, reload: () => setN((x) => x + 1), again, running };
}
