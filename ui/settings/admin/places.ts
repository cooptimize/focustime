// SA-4: Admin is its own place (#/admin), in five parts, a page per client with tabs. The tabs' names, beside the
// addresses (paths.ts, which the first download carries): the shell, the rail, Search Admin and the pointer check
// (ui/places.ts) read it. Pure, no React. The words here are what the screens draw.

export * from "./paths.ts";
import { ADMIN_PARTS, PART_NAME, isTabbed, type AdminPart, type TabbedPart } from "./paths.ts";

/** A client's page: seven tabs, as [address word, name]. */
export const CLIENT_TABS = [
  ["overview", "Overview"],
  ["chats", "Chats"],
  ["calls", "Calls"],
  ["ai", "AI"],
  ["code", "Code"],
  ["deployments", "Deployments"],
  ["backlog", "Backlog rules"],
] as const;
export type ClientTab = (typeof CLIENT_TABS)[number][0];
// The names follow paths.ts's ids, in order (places.test.ts).

/** The tabs of the parts that have them (Clients' are on each client's page; Health has none). */
export const PART_TABS = {
  people: [
    ["people", "People"],
    ["setup", "Who's set up"],
    ["logins", "Client logins"],
    ["levels", "Levels"],
    ["admins", "Admins"],
  ],
  defaults: [
    ["ai", "AI"],
    ["chats", "Client chats"],
    ["planning", "Planning and new people"],
    ["standards", "Standards"],
  ],
  audit: [
    ["changes", "Settings changes"],
    ["code", "Code views"],
  ],
} as const;
/** A part's tab's name (null: no such tab). */
export function tabName(part: AdminPart, tab: string): string | null {
  const list: readonly (readonly [string, string])[] = part === "clients" ? CLIENT_TABS : isTabbed(part) ? PART_TABS[part] : [];
  return list.find(([t]) => t === tab)?.[1] ?? null;
}

/** Every place's name a pointer may give after "Admin ›": the parts, and a part's tabs after it ("Team defaults › AI"). */
export const ADMIN_POINTER_NAMES: readonly string[] = ADMIN_PARTS.map(([, n]) => n);
export const ADMIN_POINTER_TABS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  (Object.keys(PART_TABS) as TabbedPart[]).map((p) => [PART_NAME[p], PART_TABS[p].map(([, n]) => n)]),
);
