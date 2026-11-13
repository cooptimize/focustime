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
  { id: "day", name: "Day", group: "tabs" },
  { id: "week", name: "Week", group: "tabs" },
  { id: "ahead", name: "Backlog", group: "tabs" },
  { id: "status", name: "Status", group: "tabs" },
  { id: "inbox", name: "Inbox", group: "tabs" },
  { id: "writing", name: "Writing work a builder can use", group: "more" },
  { id: "capture", name: "Capture and Break down", group: "more" },
  { id: "assistant", name: "The assistant", group: "more" },
  { id: "ask", name: "Ask", group: "more" },
  { id: "teams", name: "FocusTime in Teams", group: "more" },
  { id: "calls", name: "Client calls", group: "more" },
  { id: "code", name: "Reading another client's code", group: "more" },
  { id: "settings", name: "Settings, phone and keys", group: "more" },
  { id: "renamed", name: "Renamed", group: "more" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * GU-1: the five tab sections, in the app's own tab order, with the tab each stands for (ui/nav.ts `TABS`), so the rail
 * can draw the tab's icon and a test can check every tab has a section.
 */
export const TAB_SECTIONS: Readonly<Record<string, "today" | "week" | "ahead" | "status" | "inbox">> = { day: "today", week: "week", ahead: "ahead", status: "status", inbox: "inbox" };

/** Older addresses, from bookmarks and old links, to where that content lives now (G1's chapters; GU-1: Today is Day). */
export const OLD_SECTIONS: Readonly<Record<string, SectionId>> = {
  today: "day",
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
