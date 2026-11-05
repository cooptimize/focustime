// DevOps work as the UI sees it. Items are looked up by exact client key only, so a block can never
// show another client's items.
import { createContext } from "react";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { causeWord } from "./status.ts";

export type WorkByClient = ReadonlyMap<string, ClientWork>;
export const DevOpsWork = createContext<WorkByClient>(new Map());

export function workByClient(devops: ClientWork[] | null): WorkByClient {
  const m = new Map<string, ClientWork>();
  for (const c of devops ?? []) if (!m.has(c.clientKey)) m.set(c.clientKey, c);
  return m;
}

/** The top items for a card, in board order, and how many more there are. */
export function topWork(work: ClientWork | undefined, n = 3): { top: WorkItem[]; more: number } {
  const items = work?.items ?? [];
  return { top: items.slice(0, n), more: Math.max(0, items.length - n) };
}

/** Only links into Azure DevOps are opened. */
export const isDevOpsUrl = (url: string) => url.startsWith("https://dev.azure.com/");

const STATUS: Record<ClientWork["status"], string> = {
  ok: "live",
  identity_missing: "identity missing",
  not_set_up: "not set up",
  auth_failed: "PAT expired or invalid",
  no_access: "no access",
  unreachable: "unreachable",
  error: "error",
};

/** "live", "cached (keyring locked)", "PAT expired or invalid": a shared root cause wins over the status word. */
export function workStatusLabel(c: ClientWork): string {
  const why = c.status !== "ok" && c.cause ? causeWord(c.cause) : STATUS[c.status];
  if (c.status !== "ok" && c.fromCache) return `cached (${why})`;
  return why;
}

/** "DevOps 4 of 5 live", or null when DevOps is not in play. */
export function devopsSummary(devops: ClientWork[] | null): { label: string; level: "live" | "partial" | "down" } | null {
  if (!devops || devops.length === 0) return null;
  const live = devops.filter((c) => c.status === "ok").length;
  return { label: `${live} of ${devops.length} live`, level: live === devops.length ? "live" : live === 0 ? "down" : "partial" };
}
