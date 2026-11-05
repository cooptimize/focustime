// CV-2: fetching the images pasted into client chats (Graph hostedContents) on the server, with a chat member's own
// delegated token: in the poll cycle with the token that read the chat, or on first view with the viewer's own. The
// bytes go straight to the stripper (plan/image-strip.ts: PNG, JPEG or GIF by their bytes, 10 MB at most, metadata
// gone) and into the shared store; anything else is kept as "skipped" with a plain reason and never fetched again. A
// refused token marks it failed (tried again on later cycles, IMAGE_ATTEMPTS in all); a throttle or an unreachable
// Teams leaves it pending. Never logged but as counts; never sent to an AI; never in an export.
import { stripMetadata } from "../plan/image-strip.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import { IMAGE_ATTEMPTS, type TeamsStore } from "../store/teams-store.ts";
import { visibleChats, type RequestContext } from "./request-actions.ts";

/** Images fetched at most per chat in one poll cycle (the rest wait for the next cycle or a viewer). */
export const IMAGES_PER_CYCLE = 10;

export type ImageFetchStore = Pick<TeamsStore, "imagesToFetch" | "imageSource" | "setImage" | "image">;
export type ImageCounts = { ok: number; skipped: number; failed: number };

/** Teams is slow or away: stop for now, try later, count nothing against the image. */
const waitable = (e: unknown) => e instanceof NetworkError || (e instanceof HttpError && (e.status === 429 || e.status === 503 || e.status >= 500));

/** One image: fetched, stripped and stored. "wait" when Teams asked to slow down or couldn't be reached. */
export async function fetchImage(teams: ImageFetchStore, client: ChatMessagesClient, id: number): Promise<"ok" | "skipped" | "failed" | "wait"> {
  const src = await teams.imageSource(id);
  if (!src || !client.hostedContent) return "failed";
  let got;
  try {
    got = await client.hostedContent(src.chatId, src.messageId, src.hostedId);
  } catch (e) {
    if (waitable(e)) return "wait";
    await teams.setImage(id, { state: "failed", reason: "refused" });
    return "failed";
  }
  if ("tooBig" in got) {
    await teams.setImage(id, { state: "skipped", reason: "too big" });
    return "skipped";
  }
  const clean = stripMetadata(got.bytes);
  if (!clean) {
    await teams.setImage(id, { state: "skipped", reason: "not a PNG, JPEG or GIF" });
    return "skipped";
  }
  await teams.setImage(id, { state: "ok", contentType: clean.type, bytes: clean.bytes });
  return "ok";
}

/** A chat's images still to fetch, up to `limit`, with one token; stops at the first wait. */
export async function fetchChatImages(teams: ImageFetchStore, client: ChatMessagesClient, chatId: string, limit = IMAGES_PER_CYCLE): Promise<ImageCounts> {
  const out: ImageCounts = { ok: 0, skipped: 0, failed: 0 };
  if (!client.hostedContent) return out;
  for (const i of await teams.imagesToFetch(chatId, limit)) {
    const r = await fetchImage(teams, client, i.id);
    if (r === "wait") break;
    out[r]++;
  }
  return out;
}

/** What FocusTime's image endpoint answers: the stripped bytes, or a status with nothing about the image. */
export type ServedImage = { status: 200; contentType: string; bytes: Uint8Array } | { status: 403 | 404 };

/**
 * GET /media/chat-images/<id>: the image only for someone in its chat now (the cached member list) who follows its
 * client; anyone else gets 403. Fetched first with the viewer's own token when the poll hasn't yet.
 */
export async function serveChatImage(ctx: Pick<RequestContext, "requests" | "me" | "followed" | "chatMessages">, id: number): Promise<ServedImage> {
  const port = ctx.requests;
  const me = await ctx.me();
  if (!port || !me) return { status: 403 };
  const row = await port.teams.image(id);
  if (!row) return { status: 404 };
  const chats = await visibleChats(port.teams.viewer(me), await ctx.followed().catch(() => null));
  if (!chats.some((c) => c.chatId === row.chatId)) return { status: 403 };
  const send = async (): Promise<ServedImage> => {
    const b = await port.teams.imageBytes(id);
    return b ? { status: 200, contentType: b.contentType, bytes: b.bytes } : { status: 404 };
  };
  if (row.state === "ok") return send();
  if (row.state === "skipped" || (row.state === "failed" && row.attempts >= IMAGE_ATTEMPTS)) return { status: 404 };
  const client = await ctx.chatMessages?.().catch(() => null);
  if (!client) return { status: 404 };
  return (await fetchImage(port.teams, client, id).catch(() => "wait" as const)) === "ok" ? send() : { status: 404 };
}
