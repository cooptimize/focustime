// The clients a capture, a draft or a promise can be tagged with. Its own file (PF-1) so the screens in the first
// download (the phone's bar, App) don't bring Quick capture (ui/Capture.tsx, loaded when first opened) with them.
import { useEffect, useState } from "react";
import type { CaptureFeatures, WeekLoadData } from "../actions/types.ts";
import { call } from "./api.ts";
import type { CaptureClient } from "../plan/capture.ts";

/** Followed clients to tag (Open half-day choices and DevOps clients), or the configured ones when those aren't known. */
export function captureClients(data: WeekLoadData): CaptureClient[] {
  const m = new Map<string, string>();
  for (const c of data.planClients) m.set(c.clientKey, c.clientName);
  for (const c of data.devops ?? []) if (!m.has(c.clientKey)) m.set(c.clientKey, c.clientName);
  if (!m.size) for (const k of Object.keys(data.clients)) m.set(k, k);
  return [...m].map(([clientKey, clientName]) => ({ clientKey, clientName })).sort((a, b) => a.clientName.localeCompare(b.clientName));
}

/** A client's open features and epics from DevOps (read-only), for a draft's parent; null while loading. */
export function useClientFeatures(client: string | null, on: boolean): CaptureFeatures | null {
  const [features, setFeatures] = useState<CaptureFeatures | null>(null);
  useEffect(() => {
    setFeatures(null);
    if (!on || !client) return;
    let live = true;
    call<CaptureFeatures>("capture.features", { clientKey: client }).then((f) => live && setFeatures(f), () => live && setFeatures({ clientKey: client, status: "unavailable", features: [], epics: [] }));
    return () => {
      live = false;
    };
  }, [client, on]);
  return features;
}
