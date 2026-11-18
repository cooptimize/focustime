// SA-4: Admin is its own place (#/admin), in five parts, a page per client with tabs. Its parts, each part's tabs and
// every address in and out, in one pure file (no React): the shell, the rail, Search Admin, the pointer check
// (ui/places.ts) and the old Settings addresses all read it. The words here are what the screens draw.

/** The five parts, in rail order, as [address word, name]. */
export const ADMIN_PARTS = [
  ["clients", "Clients"],
  ["people", "People"],
  ["defaults", "Team defaults"],
  ["health", "Health"],
  ["audit", "Audit"],
] as const;
export type AdminPart = (typeof ADMIN_PARTS)[number][0];
export const PART_NAME: Record<AdminPart, string> = Object.fromEntries(ADMIN_PARTS) as Record<AdminPart, string>;

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
export type TabbedPart = keyof typeof PART_TABS;
export const isTabbed = (p: AdminPart): p is TabbedPart => p in PART_TABS;

/**
 * Where Admin is. `client` set: that client's page (part is clients); `tab` null: the part's first tab, or on a
 * client's page the tab last used on a client this visit. `part` null: the phone's list of parts (on a computer, Clients).
 */
export type AdminAt = { part: AdminPart | null; tab: string | null; client: string | null };

const PART_WORDS = new Set<string>(ADMIN_PARTS.map(([p]) => p));
const tabWords = (part: AdminPart): readonly string[] => (part === "clients" ? CLIENT_TABS.map(([t]) => t) : isTabbed(part) ? PART_TABS[part].map(([t]) => t) : []);
/** A client key in an address (Dataverse nicknames: letters, digits, spaces and a little punctuation; never "/"). */
const CLIENT_KEY = /^[\p{L}\p{N} ._&'()@-]{1,100}$/u;

/** The path after #/admin/ ("" for Admin itself), as the overlay keeps it. Client keys are kept as they are, decoded. */
export function adminPath(at: AdminAt): string {
  if (!at.part) return "";
  if (at.client) return ["clients", at.client, at.tab].filter(Boolean).join("/");
  return [at.part, at.tab].filter(Boolean).join("/");
}

/** The place a path names, or null for anything unknown. */
export function parseAdminPath(path: string | null | undefined): AdminAt | null {
  if (!path) return { part: null, tab: null, client: null };
  const parts = path.split("/");
  const [part, b, c, ...rest] = parts;
  if (rest.length || !part || !PART_WORDS.has(part)) return null;
  const p = part as AdminPart;
  if (p === "clients") {
    if (b === undefined) return c === undefined ? { part: p, tab: null, client: null } : null;
    if (!CLIENT_KEY.test(b)) return null;
    if (c === undefined) return { part: p, tab: null, client: b };
    return tabWords(p).includes(c) ? { part: p, tab: c, client: b } : null;
  }
  if (c !== undefined) return null;
  if (b === undefined) return { part: p, tab: null, client: null };
  return tabWords(p).includes(b) ? { part: p, tab: b, client: null } : null;
}

/** The address for a place: #/admin, #/admin/<part>, #/admin/<part>/<tab>, #/admin/clients/<client>[/<tab>]. */
export function adminHref(at: Partial<AdminAt> & { part: AdminPart | null }): string {
  const path = adminPath({ part: at.part, tab: at.tab ?? null, client: at.client ?? null });
  return path ? `#/admin/${path.split("/").map(encodeURIComponent).join("/")}` : "#/admin";
}

/**
 * The Settings addresses Admin had before SA-4 (#/settings/admin-<x>[/<setting>]), and where each lands now. A
 * retired one (Work templates, TP-1b) lands where it did: Admin's first page, or Profile for someone who isn't an admin.
 */
export const OLD_ADMIN_SECTIONS: Readonly<Record<string, AdminAt>> = {
  "admin-clients": { part: "clients", tab: null, client: null },
  "admin-ai": { part: "defaults", tab: "ai", client: null },
  "admin-conversations": { part: "defaults", tab: "chats", client: null },
  "admin-people": { part: "people", tab: null, client: null },
  "admin-organization": { part: "defaults", tab: "planning", client: null },
  "admin-standards": { part: "defaults", tab: "standards", client: null },
  "admin-status": { part: "health", tab: null, client: null },
  "admin-audit": { part: "audit", tab: null, client: null },
};
/** An old address's setting that named a tab of its own. */
const OLD_SETTINGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "admin-people": { "whos-set-up": "setup" },
  "admin-audit": { "code-views": "code" },
};
export const RETIRED_ADMIN_SECTIONS: readonly string[] = ["admin-templates"];

/** Where an old Settings address for Admin lands (null: it isn't one). */
export function oldAdminAt(section: string, setting: string | null | undefined): AdminAt | null {
  const at = OLD_ADMIN_SECTIONS[section];
  if (!at) return null;
  // DP-2's old link to a client's deployment settings: #/settings/admin-clients/deploy-<client>.
  const deploy = section === "admin-clients" && setting ? /^deploy-(.+)$/.exec(setting) : null;
  if (deploy) {
    const client = (() => {
      try {
        return decodeURIComponent(deploy[1]!);
      } catch {
        return null;
      }
    })();
    if (client && parseAdminPath(`clients/${client}/deployments`)) return { part: "clients", tab: "deployments", client };
  }
  const tab = setting ? OLD_SETTINGS[section]?.[setting] : undefined;
  return tab ? { ...at, tab } : at;
}

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
