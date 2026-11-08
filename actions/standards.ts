// KB-1: what the draft paths and Ask ask for: the synced library and the articles that fit a piece of text, with the
// client's data platform and source systems. Null means no good sync yet: drafts go on without standards.
import { DEFAULT_SOURCE_SYSTEMS, retrieveStandards, standardsInput, usedOf, type Retrieved, type StandardsLibrary, type StandardsUsed } from "../plan/standards.ts";
import type { StandardsSyncResult, StandardsSyncState } from "../store/standards-store.ts";

/** Handed in at startup (server/main.ts, or the demo's in server/demo.ts). */
export type StandardsPort = {
  library(): Promise<StandardsLibrary | null>;
  state(): Promise<StandardsSyncState | null>;
  syncNow(): Promise<StandardsSyncResult>;
};

export type ClientStandards = { library: StandardsLibrary; retrieved: Retrieved; input: ReturnType<typeof standardsInput>; used: StandardsUsed };
export type StandardsLookup = (clientKey: string, text: readonly string[]) => Promise<ClientStandards | null>;

type RulesOf = (clientKey: string) => Promise<{ dataPlatform: string | null; sourceSystems: readonly string[] | null } | null>;

/** The lookup a draft path calls. A library that can't be read is the same as none: a draft never fails on it. */
export function standardsLookup(port: StandardsPort | undefined, rules: RulesOf): StandardsLookup | undefined {
  if (!port) return undefined;
  return async (clientKey, text) => {
    const library = await port.library().catch(() => null);
    if (!library?.articles.length) return null;
    const r = await rules(clientKey).catch(() => null);
    const retrieved = retrieveStandards(library.articles, { text, dataPlatform: r?.dataPlatform ?? null, sourceSystems: r?.sourceSystems ?? null });
    return { library, retrieved, input: standardsInput(library.articles, retrieved), used: usedOf(library, retrieved) };
  };
}

/** Ask has no client: both D365 systems count, and no platform is assumed. */
export async function standardsForQuestion(port: StandardsPort | undefined, question: string): Promise<{ library: StandardsLibrary; retrieved: Retrieved } | null> {
  const library = await port?.library().catch(() => null);
  if (!library?.articles.length) return null;
  return { library, retrieved: retrieveStandards(library.articles, { text: [question], dataPlatform: null, sourceSystems: DEFAULT_SOURCE_SYSTEMS, question: true }) };
}
