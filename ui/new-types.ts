// QC-1: the types the command menu offers as "New <type>" for a client, top-down, from the process looks a DevOps read
// carries (portfolio levels, then the story level; tasks and bugs left out). Never a list of type names.
import type { TypeLook } from "../week/types.ts";

const RANK: Record<string, number> = { top: 0, parent: 1, child: 2 };
export function newTypesOf(looks: readonly TypeLook[] | undefined): string[] {
  return (looks ?? []).filter((t) => t.level && t.level in RANK).sort((a, b) => RANK[a.level!]! - RANK[b.level!]!).map((t) => t.name);
}
