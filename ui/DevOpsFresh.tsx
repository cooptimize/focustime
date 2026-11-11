// DV-2: one signal that something changed in DevOps. The page asks for its clients' DevOps versions every 30 s while
// it is visible and when it comes back into view (a background call: it never counts as use), and Refresh asks for a
// check now. Screens subscribe with useDevOpsChanged and reread their own data quietly when a client they show moves;
// none keeps a timer of its own for this.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RefreshAnswer, VersionsAnswer } from "../plan/devops-fresh-types.ts";
import { call } from "./api.ts";
import { movedClients, type FreshEntry } from "./devops-fresh.ts";

export const VERSIONS_MS = 30_000;
/** Coming back into view asks again, at most this often. */
const FOCUS_GAP_MS = 5_000;

export type FreshEnv = {
  entries: FreshEntry[];
  /** Moves with every answer (what subscribers watch). */
  seq: number;
  /** Refresh: a check now of these clients (all of mine without), and what it found. */
  refresh: (clientKeys?: string[]) => Promise<RefreshAnswer | null>;
};

export const DevOpsFreshCtx = createContext<FreshEnv | null>(null);
export const useDevOpsFresh = () => useContext(DevOpsFreshCtx);

const merge = (was: readonly FreshEntry[], next: readonly FreshEntry[]): FreshEntry[] => {
  const by = new Map(was.map((e) => [e.clientKey, e] as const));
  for (const e of next) by.set(e.clientKey, { clientKey: e.clientKey, clientName: e.clientName, version: e.version, checkedAt: e.checkedAt, okAt: e.okAt, nextAt: e.nextAt, problem: e.problem });
  return [...by.values()];
};

/** App's one poll. `on`: signed in with data showing (never before the first load). */
export function useDevOpsFreshFlow(on: boolean): FreshEnv {
  const [state, setState] = useState<{ entries: FreshEntry[]; seq: number }>({ entries: [], seq: 0 });
  const inflight = useRef(false);
  const last = useRef(0);
  const ask = useCallback(async () => {
    if (inflight.current || (typeof document !== "undefined" && document.hidden)) return;
    inflight.current = true;
    last.current = Date.now();
    try {
      const r = await call<VersionsAnswer>("devops.versions", {}, { background: true });
      // Only the clients in this answer: one I lost access to drops out (and never "moves").
      setState((s) => ({ entries: r.clients, seq: s.seq + 1 }));
    } catch {
      // Offline or signed out: the next ask tries again; screens keep what they show.
    } finally {
      inflight.current = false;
    }
  }, []);
  useEffect(() => {
    if (!on) return;
    void ask();
    const id = window.setInterval(() => void ask(), VERSIONS_MS);
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= FOCUS_GAP_MS) void ask();
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [on, ask]);
  const refresh = useCallback(async (clientKeys?: string[]) => {
    try {
      const r = await call<RefreshAnswer>("devops.refresh", clientKeys ? { clientKeys } : {});
      setState((s) => ({ entries: merge(s.entries, r.clients), seq: s.seq + 1 }));
      return r;
    } catch {
      return null;
    }
  }, []);
  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}

/**
 * Calls `onMoved` with the clients whose DevOps version moved since this screen last looked (null: any client). The
 * first answer only sets the starting point, so opening a screen never rereads it twice.
 */
export function useDevOpsChanged(clients: readonly string[] | null, onMoved: (clientKeys: string[]) => void, /** The provider's own env (App renders the provider, so its context is above it). */ own?: FreshEnv): void {
  const ctx = useContext(DevOpsFreshCtx);
  const env = own ?? ctx;
  const seen = useRef<Map<string, string | null> | null>(null);
  const cb = useRef(onMoved);
  cb.current = onMoved;
  const key = clients ? [...clients].sort().join("|") : "*";
  useEffect(() => {
    if (!env) return;
    const want = key === "*" ? null : new Set(key.split("|"));
    const list = env.entries.filter((e) => !want || want.has(e.clientKey));
    const before = seen.current;
    seen.current = new Map(list.map((e) => [e.clientKey, e.version] as const));
    if (!before) return;
    const moved = movedClients(before, list);
    if (moved.length) cb.current(moved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env?.seq, key]);
}
