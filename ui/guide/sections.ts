// UI-5: the Guide's sections, in rail order. Kept apart from content.ts so the command menu and nav can list them
// without loading the Guide's words.

export const SECTION_GROUPS = [
  { id: "start", label: "Start" },
  { id: "tabs", label: "The five tabs" },
  { id: "more", label: "Everything else" },
] as const;

export const SECTIONS = [
  { id: "start", name: "Start here", group: "start" },
  { id: "first-day", name: "Your first day", group: "start" },
  { id: "today", name: "Today", group: "tabs" },
  { id: "week", name: "Week", group: "tabs" },
  { id: "ahead", name: "Ahead", group: "tabs" },
  { id: "inbox", name: "Inbox", group: "tabs" },
  { id: "capture", name: "Capture and Break down", group: "more" },
  { id: "assistant", name: "The assistant", group: "more" },
  { id: "ask", name: "Ask", group: "more" },
  { id: "teams", name: "FocusTime in Teams", group: "more" },
  { id: "calls", name: "Client calls", group: "more" },
  { id: "settings", name: "Settings, phone and keys", group: "more" },
  { id: "renamed", name: "Renamed", group: "more" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** G1's chapter ids, from bookmarks and old links, to where that content lives now. */
export const OLD_SECTIONS: Readonly<Record<string, SectionId>> = {
  basics: "start",
  rhythm: "start",
  sizing: "week",
  devops: "capture",
  keys: "settings",
  phone: "settings",
  asks: "inbox",
  team: "week",
  questions: "first-day",
};

/** The phone's list of sections (PanelShell's list page). On a big screen it opens Start here. */
export const CONTENTS = "contents";

/** The section an address names: an old id mapped, anything unknown is Start here. */
export function sectionFor(id: string | null): SectionId | null {
  if (id === CONTENTS) return null;
  const s = SECTIONS.find((x) => x.id === id)?.id ?? (id ? OLD_SECTIONS[id] : undefined);
  return s ?? "start";
}
