// RQ-1: what a client's process needs on a new item, asked when a form or a row opens and again as its fields are
// filled (a few times at most), through the write framework's devops.needed: DevOps checks the item without saving
// it. The answers live only in this page's memory (about 10 minutes, as the server keeps them); nothing is stored. When
// the check can't be made the form works as before and says nothing; the check made at preview time still decides.
import { useEffect, useRef, useState } from "react";
import type { NeededField, NeededFill } from "../plan/needed.ts";
import { call } from "./api.ts";

export type NeededView = {
  checked: boolean;
  /** What DevOps says the item still needs, from the latest answer. */
  needed: NeededField[];
  /** Every field the process has said it requires on this item since it opened (filled or not): "Required by this client's process" stays. */
  required: Set<NeededFill>;
  /** The level the item's type sits at in the client's process (story or above), when the check knows it. */
  level: "story" | "above" | null;
  /** The parent's own values (Break down's stories start from the feature's). */
  parent: { date: string | null; start: string | null } | null;
  /** The client's DevOps project, for "<project>'s process needs …". */
  projectName: string | null;
};
type Answer = { checked: boolean; needed: NeededField[]; level: "story" | "above" | null; parent: { date: string | null; start: string | null } | null; projectName?: string };

const memo = new Map<string, { at: number; p: Promise<Answer | null> }>();
const TTL = 10 * 60_000;
/** A form asks at most this many times while it is open (the first, then once per field DevOps names one at a time). */
export const NEEDED_ASKS = 6;

/** Asks once per client and change (kept about 10 minutes), or null when it can't be asked. */
export function askNeeded(clientKey: string, change: Record<string, unknown>): Promise<Answer | null> {
  const key = `${clientKey}|${JSON.stringify(change)}`;
  const hit = memo.get(key);
  if (hit && hit.at > Date.now() - TTL) return hit.p;
  const p = call<Answer>("devops.needed", { clientKey, change }).catch(() => null);
  memo.set(key, { at: Date.now(), p });
  if (memo.size > 200) for (const [k, v] of memo) if (v.at < Date.now() - TTL) memo.delete(k);
  return p;
}
/** Forget what was asked (after a create, or a refusal that named fields). */
export const forgetNeeded = () => memo.clear();

/**
 * The item's needed fields for one change, asked again when `change` changes (debounced), at most NEEDED_ASKS times
 * while mounted. `change` null: not asked (no client or type yet, or no write token).
 */
export function useNeeded(clientKey: string | null, change: Record<string, unknown> | null): NeededView & { add: (n: readonly NeededField[]) => void } {
  const [view, setView] = useState<NeededView>({ checked: false, needed: [], required: new Set(), level: null, parent: null, projectName: null });
  const asks = useRef(0);
  const key = clientKey && change ? `${clientKey}|${JSON.stringify(change)}` : null;
  const scope = clientKey && change ? `${clientKey}|${String(change.type ?? "")}|${String(change.parentId ?? "")}` : null;
  const lastScope = useRef<string | null>(null);
  useEffect(() => {
    // A new client, type or parent starts over: its own first check, its own few asks.
    if (scope !== lastScope.current) {
      lastScope.current = scope;
      asks.current = 0;
      setView({ checked: false, needed: [], required: new Set(), level: null, parent: null, projectName: null });
    }
    if (!key || !clientKey || !change || asks.current >= NEEDED_ASKS) return;
    let live = true;
    const t = setTimeout(() => {
      asks.current++;
      void askNeeded(clientKey, change).then((a) => {
        if (!live || !a) return;
        setView((v) => ({ checked: a.checked, needed: a.checked ? a.needed : v.needed, required: new Set([...v.required, ...(a.checked ? a.needed.flatMap((f) => (f.fill ? [f.fill] : [])) : [])]), level: a.level ?? v.level, parent: a.parent ?? v.parent, projectName: a.projectName ?? v.projectName }));
      });
    }, asks.current === 0 ? 0 : 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (n: readonly NeededField[]) => setView((v) => ({ ...v, needed: [...v.needed.filter((x) => !n.some((y) => y.name === x.name)), ...n], required: new Set([...v.required, ...n.flatMap((f) => (f.fill ? [f.fill] : []))]) }));
  return { ...view, add };
}
