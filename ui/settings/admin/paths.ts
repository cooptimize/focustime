// SA-4: Admin's addresses, in the first download (ui/nav.ts reads them): the parts, each part's tab ids and every
// address in and out, with no tab names (those are in places.ts, loaded with Admin). Pure: no React.

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
/** Each tab's address word; places.ts names them in the same order (places.test.ts checks). */
export const CLIENT_TAB_IDS = ["overview", "chats", "calls", "ai", "code", "deployments", "backlog"] as const;
export const PART_TAB_IDS = { people: ["people", "setup", "logins", "levels", "admins"], defaults: ["ai", "chats", "planning", "standards"], audit: ["changes", "code"] } as const;
export type TabbedPart = keyof typeof PART_TAB_IDS;
export const isTabbed = (p: AdminPart): p is TabbedPart => p in PART_TAB_IDS;

/**
 * Where Admin is. `client` set: that client's page (part is clients); `tab` null: the part's first tab, or on a
 * client's page the tab last used on a client this visit. `part` null: the phone's list of parts (on a computer, Clients).
 */
export type AdminAt = { part: AdminPart | null; tab: string | null; client: string | null };

const PART_WORDS = new Set<string>(ADMIN_PARTS.map(([p]) => p));
const tabWords = (part: AdminPart): readonly string[] => (part === "clients" ? CLIENT_TAB_IDS : isTabbed(part) ? PART_TAB_IDS[part] : []);
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

