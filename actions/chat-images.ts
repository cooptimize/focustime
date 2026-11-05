// CV-2, CV-4: the images pasted into client chats (Graph hostedContents). CV-4: FocusTime never keeps their bytes. An
// image is read from Teams only when it is needed, always with a chat member's own delegated Chat.Read token:
//   - viewing: GET /media/chat-images/<id> (FocusTime's member and client checks first, the main gate), then the
//     viewer's own token. The stripped bytes are held in memory for 5 minutes per image and viewer (about 64 MB in
//     all, the oldest out first), never on disk; a failure is remembered for 5 minutes too.
//   - the AI's description: the poll's token for the batch's new images, only with the client's "Send attachments to
//     AI" on (actions/conversations-pipeline.ts).
//   - a DevOps create from a conversation: the creator's own token (actions/devops-write-actions.ts).
// The bytes go straight to the stripper (plan/image-strip.ts: PNG, JPEG or GIF by their bytes, 10 MB at most, metadata
// gone). What is kept is only the type, the size, why one can't be shown and the AI's short description. Never logged
// but as counts.
import { MAX_IMAGE_BYTES, stripMetadata, type ImageType } from "../plan/image-strip.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import type { MessageImage, TeamsStore } from "../store/teams-store.ts";
import { visibleChats, type RequestContext } from "./request-actions.ts";

export type ImageReadStore = Pick<TeamsStore, "imageSource" | "setImage">;
/** An image read now, stripped; or why not ("skipped": not one we show, kept so; "gone": refused, removed or unreachable). */
export type ReadImage = { ok: true; type: ImageType; bytes: Uint8Array; animated: boolean } | { ok: false; why: "skipped" | "gone" };

/** Teams asked to slow down: wait this long at most before the one retry. */
const MAX_THROTTLE_WAIT_MS = 5_000;
const throttled = (e: unknown) => e instanceof HttpError && (e.status === 429 || e.status === 503);

/**
 * One image from Teams with this member's token: read (10 MB at most, streamed), stripped, its type and size noted on
 * its row (only when they change). One retry when Teams throttles. Never stored.
 */
export async function readImage(teams: ImageReadStore, client: ChatMessagesClient, row: Pick<MessageImage, "id" | "state" | "contentType" | "byteSize">, o: { sleep?: (ms: number) => Promise<void> } = {}): Promise<ReadImage> {
  const src = await teams.imageSource(row.id);
  if (!src || !client.hostedContent) return { ok: false, why: "gone" };
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let got: { bytes: Uint8Array } | { tooBig: true };
  try {
    try {
      got = await client.hostedContent(src.chatId, src.messageId, src.hostedId);
    } catch (e) {
      if (!throttled(e)) throw e;
      await sleep(Math.min(MAX_THROTTLE_WAIT_MS, ((e as HttpError).retryAfter ?? 1) * 1000));
      got = await client.hostedContent(src.chatId, src.messageId, src.hostedId);
    }
  } catch (e) {
    if (e instanceof HttpError || e instanceof NetworkError) return { ok: false, why: "gone" };
    throw e;
  }
  if ("tooBig" in got) {
    await teams.setImage(row.id, { state: "skipped", reason: "too big" });
    return { ok: false, why: "skipped" };
  }
  const clean = stripMetadata(got.bytes);
  if (!clean) {
    await teams.setImage(row.id, { state: "skipped", reason: "not a PNG, JPEG or GIF" });
    return { ok: false, why: "skipped" };
  }
  if (row.state !== "ok" || row.contentType !== clean.type || row.byteSize !== clean.bytes.length) await teams.setImage(row.id, { state: "ok", contentType: clean.type, byteSize: clean.bytes.length });
  return { ok: true, ...clean };
}

/** How long a viewed image (or a failure to read one) is held in memory, per image and viewer. */
export const VIEW_CACHE_MS = 5 * 60_000;
/** The most bytes held for viewing at once, all viewers together; the oldest go first. */
export const VIEW_CACHE_BYTES = 64 * 1024 * 1024;

type Cached = { at: number; image: { contentType: string; bytes: Uint8Array } | null };
/** Memory only: never written anywhere, gone with the process. Keyed by image and viewer, so a member never gets bytes read with someone else's token. */
export class ImageCache {
  private map = new Map<string, Cached>();
  private total = 0;
  private readonly ttlMs: number;
  private readonly capBytes: number;
  constructor(ttlMs = VIEW_CACHE_MS, capBytes = VIEW_CACHE_BYTES) {
    this.ttlMs = ttlMs;
    this.capBytes = capBytes;
  }
  private drop(k: string) {
    const c = this.map.get(k);
    if (!c) return;
    this.total -= c.image?.bytes.length ?? 0;
    this.map.delete(k);
  }
  get(id: number, viewer: string, now = Date.now()): Cached | undefined {
    const k = `${id}:${viewer.toLowerCase()}`;
    const c = this.map.get(k);
    if (c && now - c.at >= this.ttlMs) {
      this.drop(k);
      return undefined;
    }
    return c;
  }
  set(id: number, viewer: string, image: Cached["image"], now = Date.now()) {
    const k = `${id}:${viewer.toLowerCase()}`;
    this.drop(k);
    const size = image?.bytes.length ?? 0;
    if (size > this.capBytes) return;
    this.map.set(k, { at: now, image });
    this.total += size;
    // Map keeps insertion order: the first entries are the oldest.
    for (const old of this.map.keys()) {
      if (this.total <= this.capBytes) break;
      this.drop(old);
    }
  }
  get bytes() {
    return this.total;
  }
  get size() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
    this.total = 0;
  }
}
const viewCache = new ImageCache();
export const clearImageCache = () => viewCache.clear();

/** What FocusTime's image endpoint answers: the stripped bytes, or a status with nothing about the image. */
export type ServedImage = { status: 200; contentType: string; bytes: Uint8Array } | { status: 403 | 404 };

/**
 * GET /media/chat-images/<id>: only for someone in its chat now (the cached member list) who follows its client;
 * anyone else gets 403. Then read from Teams with the viewer's own token (or from the 5 minute memory). A failure is
 * 404, and the page shows "Image in Teams" with Open in Teams.
 */
export async function serveChatImage(ctx: Pick<RequestContext, "requests" | "me" | "followed" | "chatMessages">, id: number, o: { cache?: ImageCache; now?: number } = {}): Promise<ServedImage> {
  const cache = o.cache ?? viewCache;
  const port = ctx.requests;
  const me = await ctx.me();
  if (!port || !me) return { status: 403 };
  const row = await port.teams.image(id);
  if (!row) return { status: 404 };
  const chats = await visibleChats(port.teams.viewer(me), await ctx.followed().catch(() => null));
  if (!chats.some((c) => c.chatId === row.chatId)) return { status: 403 };
  if (row.state === "skipped") return { status: 404 };
  const hit = cache.get(id, me, o.now);
  if (hit) return hit.image ? { status: 200, ...hit.image } : { status: 404 };
  const client = await ctx.chatMessages?.().catch(() => null);
  const r: ReadImage = client ? await readImage(port.teams, client, row).catch((): ReadImage => ({ ok: false, why: "gone" })) : { ok: false, why: "gone" };
  if (!r.ok) {
    cache.set(id, me, null, o.now);
    return { status: 404 };
  }
  cache.set(id, me, { contentType: r.type, bytes: r.bytes }, o.now);
  return { status: 200, contentType: r.type, bytes: r.bytes };
}

/** CV-4: images sent with one conversations.update request, at most: per message, and in the whole call. */
export const AI_IMAGES_PER_MESSAGE = 4;
export const AI_IMAGES_PER_CALL = 10;
/** One image as the AI gets it: its alias (i1, i2), the message it sits under, and the stripped bytes as a data URL. */
export type AiImage = { ref: string; id: number; messageId: string; dataUrl: string };

/**
 * The batch's images for the AI: read with the poll's token, stripped, in message and body order, at most 4 per message
 * and 10 in all (the rest get no description); animated GIFs are left out (the AI takes only still images). Images
 * that already have a description are not sent again.
 */
export async function imagesForAi(teams: ImageReadStore & Pick<TeamsStore, "images">, client: ChatMessagesClient, chatId: string, messageIds: readonly string[]): Promise<{ images: AiImage[]; skipped: number }> {
  const out: AiImage[] = [];
  let skipped = 0;
  const rows = await teams.images(chatId, messageIds);
  for (const mid of messageIds) {
    const mine = rows.filter((r) => r.messageId === mid && r.state !== "skipped" && !r.description).sort((a, b) => a.position - b.position);
    skipped += Math.max(0, mine.length - AI_IMAGES_PER_MESSAGE);
    for (const r of mine.slice(0, AI_IMAGES_PER_MESSAGE)) {
      if (out.length >= AI_IMAGES_PER_CALL) {
        skipped++;
        continue;
      }
      const got = await readImage(teams, client, r).catch((): ReadImage => ({ ok: false, why: "gone" }));
      if (!got.ok || got.animated || got.bytes.length > MAX_IMAGE_BYTES) {
        skipped++;
        continue;
      }
      out.push({ ref: `i${out.length + 1}`, id: r.id, messageId: mid, dataUrl: `data:${got.type};base64,${Buffer.from(got.bytes).toString("base64")}` });
    }
  }
  return { images: out, skipped };
}
