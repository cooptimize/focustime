// DV-2: how fresh DevOps is, in words, and which clients' versions moved. Pure: the clock comes in.
import type { Freshness } from "../plan/devops-fresh-types.ts";

export type FreshEntry = Freshness & { clientName: string };

/** "40s ago", "4 min ago", "2 h ago". */
export function agoShort(at: string | null, nowMs: number): string {
  if (!at) return "not yet";
  const s = Math.max(0, Math.round((nowMs - Date.parse(at)) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

const inMin = (at: string | null, nowMs: number) => {
  if (!at) return "soon";
  const m = Math.ceil((Date.parse(at) - nowMs) / 60_000);
  return m <= 0 ? "soon" : `in ${m} min`;
};

/** One client's state without its name: "checked 40s ago", or what's wrong. */
export function clientDetail(e: FreshEntry, nowMs: number): string {
  if (e.problem?.kind === "refused") return "DevOps sign-in was refused";
  if (e.problem?.kind === "slowed") return `slowed by DevOps, next check ${inMin(e.nextAt, nowMs)}`;
  if (e.problem?.kind === "failed") return e.problem.words;
  if (e.problem?.kind === "first") return "being read for the first time";
  return `checked ${agoShort(e.checkedAt, nowMs)}`;
}

/** One client's line for the hover: "Contoso: checked 40s ago", or what's wrong. */
export function clientLine(e: FreshEntry, nowMs: number): string {
  return `${e.clientName}: ${clientDetail(e, nowMs)}`;
}

/** The status bar's words: the stalest client's check ("DevOps checked 40s ago"), with each client on hover. */
export function freshWords(entries: readonly FreshEntry[], nowMs: number): { text: string; title: string; trouble: boolean } | null {
  if (!entries.length) return null;
  const checked = entries.map((e) => e.checkedAt).filter((x): x is string => !!x).sort();
  const trouble = entries.some((e) => e.problem && e.problem.kind !== "first");
  return { text: `DevOps checked ${agoShort(checked[0] ?? null, nowMs)}`, title: entries.map((e) => clientLine(e, nowMs)).join("\n"), trouble };
}

/** The clients whose version moved between two answers (a client seen for the first time hasn't moved). */
export function movedClients(before: ReadonlyMap<string, string | null>, after: readonly Pick<Freshness, "clientKey" | "version">[]): string[] {
  return after.filter((e) => before.has(e.clientKey) && before.get(e.clientKey) !== e.version).map((e) => e.clientKey);
}
