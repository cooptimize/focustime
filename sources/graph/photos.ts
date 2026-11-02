// Profile photos through Microsoft Graph (step 16.4), delegated ProfilePhoto.Read.All on its own token (asked for
// incrementally with "Allow photos"; the permission needs an admin's consent in Entra).
// - GET /me/photos/96x96/$value and /users/{id}/photos/96x96/$value: the photo's bytes; 404 when there is none.
// Only images (JPEG, PNG, GIF or WebP) up to 256 KB are kept. Nothing is logged beyond the status, count and duration:
// never the person, the address or the bytes.
import type { Logger } from "../../log/logger.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** The size asked for: small, crisp at 2x for avatars shown at 24 to 48 px. */
export const PHOTO_SIZE = "96x96";
export const MAX_PHOTO_BYTES = 256 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PhotoDeps = { fetch: typeof fetch; token: () => Promise<string>; invalidate: () => void; log: Logger; timeoutMs?: number };
export type Photo = { type: string; bytes: Uint8Array };

export function createPhotoClient(d: PhotoDeps) {
  async function get(url: string, retried = false): Promise<Photo | null> {
    const token = await d.token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, { headers: { accept: "image/*", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(d.timeoutMs ?? 15_000) });
    } catch {
      d.log({ source: "outlook", op: "photo", kind: "network" });
      throw new NetworkError("network");
    }
    d.log({ source: "outlook", op: "photo", status: res.status, durationMs: performance.now() - started });
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return get(url, true);
    }
    // No photo (404), or none Graph can give for this person: initials.
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(res.status);
    }
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!TYPES.has(type)) {
      await res.body?.cancel();
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length && bytes.length <= MAX_PHOTO_BYTES ? { type, bytes } : null;
  }
  return {
    /** My own photo, or null when I have none. */
    mine: () => get(`${GRAPH}/me/photos/${PHOTO_SIZE}/$value`),
    /** A teammate's photo by Entra object ID, or null when there is none. */
    person(oid: string): Promise<Photo | null> {
      if (!GUID.test(oid)) return Promise.reject(new HttpError(400));
      return get(`${GRAPH}/users/${oid.toLowerCase()}/photos/${PHOTO_SIZE}/$value`);
    },
  };
}
export type PhotoClient = ReturnType<typeof createPhotoClient>;
