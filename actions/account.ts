// The app's user (step 15.4): one Microsoft sign-in (the "Coopilot Desktop" app registration in Entra, its display name kept in R1, delegated, PKCE over
// loopback) is who FocusTime works for. Its refresh token stays in the keyring (account outlook-refresh-token, kept
// from step 3 so an existing Outlook connection carries over); who signed in (name, username, ids) and the Dataverse
// user found for them are kept in the plan store's account state. "Me" comes from the sign-in; config's my_email and
// my_systemuserid stay as the fallback while signed out. The launch token and Host/Origin checks still apply.
import type { ParseResult } from "../config/schema.ts";
import { workEmail, type IdClaims } from "../sources/oauth/idtoken.ts";
import type { MeetingsClient } from "../sources/graph/meetings.ts";
import { AuthFailure, type ConnectOptions, type ConnectResult, type ScopeProbe, type TokenKind, type WriteAccess } from "../sources/oauth/oauth.ts";
import type { ChatMessagesClient, ChatsClient } from "../sources/graph/chats.ts";
import type { PlanStore } from "../store/plan-store.ts";
import type { PresenceClient } from "../sources/graph/presence.ts";
import type { PhotoClient } from "../sources/graph/photos.ts";
import type { ActionResponse } from "./types.ts";
import type { AuthStatus, Person } from "./account-types.ts";

export const IDENTITY_KEY = "ms_identity";
/** Who signed in, as kept locally. `systemUserId` is the Dataverse user found for `systemUserEmail`. */
export type StoredIdentity = IdClaims & { signedInAt: string; systemUserId: string | null; systemUserEmail: string | null };

/** The Microsoft sign-in, as the actions see it (the Outlook source's auth client in the app, a fake in tests and demo). */
export type MicrosoftAccount = {
  signIn: (o: ConnectOptions) => Promise<ConnectResult>;
  identity: () => Promise<IdClaims>;
  /** The Azure Resource Manager token (memory only). */
  armToken: () => Promise<string>;
  writeAccess: () => Promise<WriteAccess>;
  /** Step 16.3: Teams presence (my status during focus, teammates' presence) on its own token. Absent: not available here. */
  presence?: PresenceClient;
  /** Step 16.4: profile photos (ProfilePhoto.Read.All) on their own token. Absent: not available here. */
  photos?: PhotoClient;
  /** T-2: Teams group chats, names and members only (Chat.ReadBasic), on their own token. Absent: not available here. */
  chats?: ChatsClient;
  /** AP-1: a registered chat's new messages (Chat.Read, allowed by each person), on their own token. Absent: not available here. */
  chatMessages?: ChatMessagesClient;
  /** MC-1: registered meetings' series, instances and transcripts, behind the registered-meeting gate. Absent: not available here. */
  meetings?: MeetingsClient;
  /** T-2: whether a token for one scope set can be had, for Settings > Connections. Absent: can't tell here. */
  probe?: (kind: TokenKind) => Promise<ScopeProbe>;
  /** Forgets the refresh token and anything in memory; the calendar cache too. */
  signOut: () => Promise<void>;
};

export type { AuthStatus, Person };

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, " ").split(/[\s,]+/).filter((p) => /^\p{L}/u.test(p));
  const two = parts.length > 1 ? [parts[0]!, parts.at(-1)!] : parts.slice(0, 1);
  return two.map((p) => p[0]!.toUpperCase()).join("") || "?";
}
export const personOf = (c: Pick<IdClaims, "name" | "username">): Person => ({ name: c.name, username: c.username, initials: initials(c.name) });

/**
 * Config with "me" from the sign-in: the signed-in work email, and the Dataverse user found for it (null until found,
 * then resolved like before). Signed out, or no usable email: config as it is (my_email, my_systemuserid).
 */
export function withMe(parsed: ParseResult, me: StoredIdentity | null): ParseResult {
  if (!parsed.ok || !me) return parsed;
  const email = workEmail(me);
  if (!email) return parsed;
  const dv = parsed.config.dataverse;
  if (dv.myEmail.toLowerCase() === email && dv.mySystemUserId && !me.systemUserId) return parsed;
  const id = me.systemUserEmail === email ? me.systemUserId : null;
  return { ...parsed, config: { ...parsed.config, dataverse: { ...dv, myEmail: email, mySystemUserId: id } } };
}

/** Keeps a newly signed-in identity; a different person starts without a Dataverse user. */
export async function rememberIdentity(plan: PlanStore | undefined, c: IdClaims, at: string): Promise<StoredIdentity> {
  const prev = (await plan?.accountState<StoredIdentity>(IDENTITY_KEY)) ?? null;
  const same = prev?.oid === c.oid && prev.tid === c.tid;
  const next: StoredIdentity = { ...c, signedInAt: same ? prev.signedInAt : at, systemUserId: same ? prev.systemUserId : null, systemUserEmail: same ? prev.systemUserEmail : null };
  (await plan?.setAccountState(IDENTITY_KEY, next));
  return next;
}
export const storedIdentity = async (plan: PlanStore | undefined) => (await plan?.accountState<StoredIdentity>(IDENTITY_KEY)) ?? null;

export type AccountContext = { plan?: PlanStore; account: MicrosoftAccount | null; now: () => string; /** Step 16.4: cleared on sign-out. */ clearPhotos?: () => Promise<void>; /** R1: the keyring move failed. */ renameNote?: string | null };

export async function authStatus(ctx: AccountContext): Promise<AuthStatus> {
  const s = await statusOf(ctx);
  return ctx.renameNote ? { ...s, renameNote: ctx.renameNote } : s;
}

async function statusOf(ctx: AccountContext): Promise<Omit<AuthStatus, "renameNote">> {
  if (!ctx.account) return { configured: false, state: "signed_out", person: null, message: null };
  const stored = (await storedIdentity(ctx.plan));
  try {
    const c = await ctx.account.identity();
    const me = (await rememberIdentity(ctx.plan, c, ctx.now()));
    return { configured: true, state: "signed_in", person: personOf(me), message: null };
  } catch (e) {
    const kind = e instanceof AuthFailure ? e.kind : "error";
    if (kind === "network" || kind === "keyring") return { configured: true, state: "unavailable", person: stored ? personOf(stored) : null, message: (e as Error).message };
    if (kind === "not_connected") (await ctx.plan?.setAccountState(IDENTITY_KEY, null));
    const message = kind === "not_connected" ? null : kind === "expired" || kind === "consent" ? "Your Microsoft sign-in needs renewing. Sign in again" : "Microsoft sign-in isn't working right now. Sign in again";
    return { configured: true, state: "signed_out", person: kind === "not_connected" || !stored ? null : personOf(stored), message };
  }
}

const noInputOr = (input: unknown, keys: string[]) =>
  input === undefined || input === null || (typeof input === "object" && !Array.isArray(input) && Object.keys(input as object).every((k) => keys.includes(k)));

export async function accountAction(ctx: AccountContext, action: "auth.status" | "auth.sign_in" | "auth.sign_out", input: unknown): Promise<ActionResponse> {
  switch (action) {
    case "auth.status":
      if (!noInputOr(input, [])) return { ok: false, status: 400, error: "auth.status takes no input" };
      return { ok: true, data: await authStatus(ctx) };
    case "auth.sign_in": {
      if (!noInputOr(input, ["azure", "teams", "photos"])) return { ok: false, status: 400, error: "auth.sign_in takes { azure?, teams?, photos? }" };
      const azure = (input as { azure?: unknown } | null)?.azure;
      if (azure !== undefined && typeof azure !== "boolean") return { ok: false, status: 400, error: "azure must be true or false" };
      // Step 16.3: Allow Teams status adds the presence scopes (asked for only then; consent stays with the account).
      const teams = (input as { teams?: unknown } | null)?.teams;
      if (teams !== undefined && typeof teams !== "boolean") return { ok: false, status: 400, error: "teams must be true or false" };
      // Step 16.4: Allow photos adds ProfilePhoto.Read.All (asked for only then; it needs an admin's consent in Entra).
      const photos = (input as { photos?: unknown } | null)?.photos;
      if (photos !== undefined && typeof photos !== "boolean") return { ok: false, status: 400, error: "photos must be true or false" };
      if (!ctx.account) return { ok: true, data: { status: "failed", message: "Add outlook.client_id (the app registration) to config first" } };
      const stored = (await storedIdentity(ctx.plan));
      // Keep calendar changes if this sign-in already had them; prefill the account for an incremental consent.
      const write = (await ctx.account.writeAccess().catch(() => null))?.status === "write";
      const r = await ctx.account.signIn({ azure: azure ?? true, ...(write ? { write } : {}), ...(teams ? { teams } : {}), ...(photos ? { photos } : {}), ...(stored ? { loginHint: stored.username } : {}) });
      if (r.status !== "connected") return { ok: true, data: r };
      const c = r.identity ?? (await ctx.account.identity().catch(() => null));
      if (!c) return { ok: true, data: { status: "failed", message: "Signed in, but Microsoft didn't say who you are. Try again" } };
      const me = (await rememberIdentity(ctx.plan, c, ctx.now()));
      return { ok: true, data: { status: "connected", person: personOf(me) } };
    }
    case "auth.sign_out": {
      if (!noInputOr(input, [])) return { ok: false, status: 400, error: "auth.sign_out takes no input" };
      // The local plan stays; so do my VM choice (kept per person) and any schedule change still to put back.
      await ctx.account?.signOut();
      (await ctx.plan?.setAccountState(IDENTITY_KEY, null));
      // Step 16.4: the photo cache goes with the sign-in.
      await ctx.clearPhotos?.().catch(() => {});
      return { ok: true, data: { status: "signed_out" } };
    }
  }
}
