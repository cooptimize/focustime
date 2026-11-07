// DOC-1: the Technical docs' pages, in rail order: ids and labels only, so the command menu, the address and the ⋯
// menu can name them without loading the pages (scripts/tech-docs.ts TECH_PAGES has the files; a test keeps the two
// the same). The words are in docs/technical/*.md, bundled into the lazily loaded panel (ui/docs/TechDocs.tsx).

export const DOC_PAGES = [
  { id: "overview", label: "Overview", aka: ["docs", "technical", "readme", "glossary"] },
  { id: "architecture", label: "Architecture", aka: ["architecture", "components", "modules", "jobs"] },
  { id: "data", label: "Data", aka: ["tables", "retention", "database", "storage"] },
  { id: "integrations", label: "Integrations", aka: ["graph", "permissions", "devops", "dataverse", "api"] },
  { id: "security", label: "Security", aka: ["security", "secrets", "privacy", "it"] },
  { id: "operations", label: "Operations", aka: ["deploy", "rollback", "logs", "troubleshooting"] },
  { id: "development", label: "Development", aka: ["tests", "ci", "worktree", "contributing"] },
] as const;

/** The panel's own words. */
export const DOCS_TEXT = {
  name: "Technical docs",
  search: "Search the technical docs",
  none: (q: string) => `Nothing in the technical docs for "${q}". Try fewer words.`,
  results: (n: number) => (n === 1 ? "1 result" : `${n} results`),
  in: (page: string) => `in ${page}`,
  build: (sha: string) => `This build: ${sha}`,
  edit: "Edit on GitHub",
  checking: "Checking your account…",
  automation: "The technical docs aren't available for automation accounts.",
  unknown: "The technical docs can't be opened just now: your account couldn't be checked. Try again in a moment.",
};

export type DocPageId = (typeof DOC_PAGES)[number]["id"];
/** The phone's list of pages (the panel shell's list page). On a big screen it opens the Overview. */
export const DOC_CONTENTS = "contents";
/** A heading's anchor in an address: lowercase letters, digits, hyphens and underscores. */
export const DOC_ANCHOR = /^[\p{Ll}\p{N}][\p{Ll}\p{N}_-]{0,99}$/u;

export const docPageLabel = (id: string) => DOC_PAGES.find((p) => p.id === id)?.label ?? "Technical docs";

/** The page an address names: unknown is the Overview; `contents` is the phone's list (null). */
export function docPageFor(id: string | null): DocPageId | null {
  if (id === DOC_CONTENTS) return null;
  return DOC_PAGES.find((p) => p.id === id)?.id ?? "overview";
}
