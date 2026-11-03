// Profile photos (step 16.4): mine and the Cooptimizers on screen, from Graph (ProfilePhoto.Read.All, read only),
// cached 7 days in the cache folder and refreshed in the background. No photo, no permission or no sign-in: the UI
// shows initials. Never logged: not the person, the address or the image.
import type { AppConfig } from "../config/schema.ts";
import { dataUrl, MAX_PHOTO_PEOPLE, photoAge } from "../plan/photos.ts";
import type { PhotoCache } from "../host/types.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import type { Photo } from "../sources/graph/photos.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { storedIdentity, type MicrosoftAccount } from "./account.ts";
import type { PresenceTeammate } from "./presence-actions.ts";
import type { ActionResponse, PhotoAccess, PhotosData } from "./types.ts";

export type { PhotoAccess, PhotosData };
export type PhotoContext = {
  plan?: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  account: MicrosoftAccount | null;
  team: (cfg: AppConfig) => Promise<PresenceTeammate[] | null>;
  /** The photo cache (null: none, as in demo mode, where nothing is written). */
  cache: PhotoCache | null;
  now: () => string;
};

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });

/** Whether photos can be read for this sign-in, from what a read threw. */
export function photoAccessOf(e: unknown): PhotoAccess {
  if (e instanceof AuthFailure) return e.kind === "consent" ? "consent" : e.kind === "not_connected" || e.kind === "expired" ? "signed_out" : "unavailable";
  if (e instanceof HttpError) return e.status === 403 || e.status === 401 ? "consent" : "unavailable";
  if (e instanceof NetworkError) return "unavailable";
  return "unavailable";
}

// Background refreshes in flight, by cache key, so one person is read once at a time.
const inFlight = new Set<string>();

type Got = { photo: Photo | null } | { error: PhotoAccess };

async function readOne(ctx: PhotoContext, key: string, fetchOne: () => Promise<Photo | null>): Promise<Got> {
  const now = ctx.now();
  const cached = ctx.cache ? await ctx.cache.read(key) : null;
  const age = photoAge(cached, now);
  const refresh = async (): Promise<Got> => {
    try {
      const photo = await fetchOne();
      await ctx.cache?.write(key, { fetchedAt: now, photo }).catch(() => {});
      return { photo };
    } catch (e) {
      return { error: photoAccessOf(e) };
    }
  };
  if (age === "fresh") return { photo: cached!.photo };
  if (age === "stale") {
    // Shown as it is; read again in the background.
    if (!inFlight.has(key)) {
      inFlight.add(key);
      void refresh().finally(() => inFlight.delete(key));
    }
    return { photo: cached!.photo };
  }
  return refresh();
}

/** Runs `f` over `items`, at most `n` at once. */
async function pool<T, R>(items: readonly T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await f(items[k]!);
    }
  }));
  return out;
}

export async function photoAction(ctx: PhotoContext, input: unknown): Promise<ActionResponse> {
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => k !== "emails" && k !== "me")))
    return bad("people.photos takes { emails?, me? }");
  const o = (input ?? {}) as { emails?: unknown; me?: unknown };
  if (o.me !== undefined && typeof o.me !== "boolean") return bad("me must be true or false");
  if (o.emails !== undefined && (!Array.isArray(o.emails) || o.emails.some((e) => typeof e !== "string" || !e.includes("@") || e.length > 200))) return bad("emails must be a list of addresses");
  const emails = [...new Set(((o.emails as string[] | undefined) ?? []).map((e) => e.trim().toLowerCase()))];
  if (emails.length > MAX_PHOTO_PEOPLE) return bad(`At most ${MAX_PHOTO_PEOPLE} people at once`);
  const none = (reason: PhotoAccess): ActionResponse => ({ ok: true, data: { available: false, reason, me: null, people: [] } satisfies PhotosData });
  const client = ctx.account?.photos ?? null;
  const me = storedIdentity(ctx.plan);
  if (!client || !me) return none("signed_out");

  let access: PhotoAccess | null = null;
  const url = (g: Got): string | null => {
    if ("error" in g) {
      access ??= g.error;
      return null;
    }
    return g.photo ? dataUrl(g.photo.type, g.photo.bytes) : null;
  };
  const mine = o.me ? url(await readOne(ctx, `me:${me.oid}`, () => client.mine())) : null;

  const people: PhotosData["people"] = [];
  if (emails.length) {
    const cfg = await ctx.config().catch(() => null);
    const team = cfg ? await ctx.team(cfg).catch(() => null) : null;
    // Only Cooptimizers (the Dataverse team) with an Entra object ID, matched by email.
    const wanted = emails.map((e) => ({ email: e, t: team?.find((x) => x.email.toLowerCase() === e) ?? null })).filter((w) => w.t?.aadId);
    const got = await pool(wanted, 6, (w) => readOne(ctx, w.t!.aadId!, () => client.person(w.t!.aadId!)));
    wanted.forEach((w, i) => people.push({ email: w.email, photo: url(got[i]!) }));
  }
  // A consent problem with nothing to show: say so, so Settings can offer Allow photos.
  if (access === "consent" && mine === null && people.every((p) => !p.photo)) return none("consent");
  return { ok: true, data: { available: true, reason: access, me: mine, people } satisfies PhotosData };
}

/** Sign-out: the photo cache goes with the sign-in. */
export async function clearPhotos(cache: PhotoCache | null): Promise<void> {
  await cache?.clear().catch(() => {});
}
