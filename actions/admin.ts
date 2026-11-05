// ADM-1: who is a FocusTime admin. Admins are the members of the Entra security group "FocusTime Admins" (its object
// id is the app setting FOCUSTIME_ADMIN_GROUP_ID, through Bicep). The ID token's groups claim answers at sign-in; when
// the token has too many groups to list (the overage case: no groups claim, `_claim_names` or `hasgroups` instead) or
// has no groups claim at all, or the answer is older than 10 minutes, Graph answers (/me/checkMemberGroups with the
// person's own token). The break-glass list (FOCUSTIME_ADMINS, Entra object ids, from the FT_ADMINS GitHub variable)
// also counts, so FocusTime is never locked out of its own admin area. FocusTime never grants admin itself, and an
// answer Graph couldn't give is "not admin" (never cached, asked again next time). The one check for every admin
// action, always on the server (D522, ADM-1).

/** What the validated ID token said about groups. "none": the registration doesn't emit a groups claim. */
export type SignInGroups = { kind: "list"; ids: readonly string[] } | { kind: "overage" } | { kind: "none" };

/** How someone is an admin, for Admin's list of admins. */
export type AdminVia = "group" | "break_glass" | "demo";

/** How long an answer is kept: at most 10 minutes (ADM-1). */
export const ADMIN_TTL_MS = 10 * 60_000;

/** Whether an Entra object id is in a list (ignoring case). The break-glass check. */
export function inList(userId: string | null, list: readonly string[] | undefined): boolean {
  if (!userId || !list?.length) return false;
  const id = userId.toLowerCase();
  return list.some((a) => a.toLowerCase() === id);
}

/** The groups claim of a validated ID token, read without keeping the token. */
export function groupsOf(claims: Record<string, unknown> | undefined | null): SignInGroups {
  if (!claims) return { kind: "none" };
  if (Array.isArray(claims.groups)) return { kind: "list", ids: claims.groups.filter((g): g is string => typeof g === "string") };
  const names = claims._claim_names as Record<string, unknown> | undefined;
  if ((names && typeof names === "object" && "groups" in names) || claims.hasgroups === true || claims.hasgroups === "true") return { kind: "overage" };
  return { kind: "none" };
}

export type AdminCheckDeps = {
  /** The "FocusTime Admins" group's object id; null: no group set up (only the break-glass list counts). */
  groupId: string | null;
  breakGlass: readonly string[];
  /** Graph's answer for this person (their own token); null when it couldn't say. */
  graph: (userId: string) => Promise<boolean | null>;
  now: () => number;
  /** Remembers the latest answer per person, for Admin's read-only list of admins. */
  seen?: (userId: string, admin: boolean, via: AdminVia | null) => Promise<void>;
  ttlMs?: number;
};

export type AdminCheck = {
  /** At sign-in: what the ID token's groups claim says. */
  signedIn(userId: string, groups: SignInGroups): Promise<void>;
  isAdmin(userId: string | null): Promise<boolean>;
  via(userId: string | null): Promise<AdminVia | null>;
  /** A person left or signed out: their cached answer goes. */
  forget(userId: string): void;
};

export function createAdminCheck(d: AdminCheckDeps): AdminCheck {
  const ttl = Math.min(d.ttlMs ?? ADMIN_TTL_MS, ADMIN_TTL_MS);
  const held = new Map<string, { admin: boolean; at: number }>();
  const key = (id: string) => id.toLowerCase();

  const remember = async (userId: string, admin: boolean) => {
    held.set(key(userId), { admin, at: d.now() });
    await d.seen?.(userId, admin, admin ? "group" : null).catch(() => undefined);
  };

  async function inGroup(userId: string): Promise<boolean> {
    if (!d.groupId) return false;
    const h = held.get(key(userId));
    if (h && d.now() - h.at < ttl) return h.admin;
    const answer = await d.graph(userId).catch(() => null);
    if (answer === null) return false;
    await remember(userId, answer);
    return answer;
  }

  async function via(userId: string | null): Promise<AdminVia | null> {
    if (!userId) return null;
    if (inList(userId, d.breakGlass)) return "break_glass";
    return (await inGroup(userId)) ? "group" : null;
  }

  return {
    async signedIn(userId, groups) {
      if (!d.groupId) return;
      if (groups.kind === "list") await remember(userId, inList(d.groupId, groups.ids));
      // Overage or no claim: Graph answers at the first admin check.
      else held.delete(key(userId));
    },
    isAdmin: async (userId) => (await via(userId)) !== null,
    via,
    forget: (userId) => void held.delete(key(userId)),
  };
}

/** The demo's admin check: the demo person is an admin inside their own demo, and nobody else is. */
export function demoAdminCheck(demoUserId: string): AdminCheck {
  const me = (id: string | null) => !!id && id.toLowerCase() === demoUserId.toLowerCase();
  return {
    signedIn: async () => {},
    isAdmin: async (id) => me(id),
    via: async (id) => (me(id) ? "demo" : null),
    forget: () => {},
  };
}
