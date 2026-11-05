// AI-0: the stub provider, for the developer loop and CI when no key is configured: no network, no cost beyond the
// estimate from its made-up token counts. It answers with the simplest value that fits the task's schema (or what a
// test gives it), so every path through the service runs the same as with OpenAI.
import { sampleOf } from "./schema.ts";
import type { AiProvider, ProviderCall, ProviderReply, TranscribeCall, TranscribeReply } from "./types.ts";

export type StubOptions = {
  /** A test's answer for a call (text, or a whole reply); default: a value made from the schema. */
  respond?: (c: ProviderCall) => string | ProviderReply | Promise<string | ProviderReply>;
  /** AS-1: a test's transcript (or failure); default: a fixed sentence. */
  transcript?: (t: TranscribeCall) => TranscribeReply | Promise<TranscribeReply>;
};

/**
 * CV-4: an image's input tokens in the stub: a 1024 x 1024 screenshot at high detail on a patch-counted model
 * (1024 patches x 1.2, OpenAI's images-vision guide, Nov 5).
 */
export const STUB_IMAGE_TOKENS = 1229;
/** About four characters a token, like OpenAI's rule of thumb. */
const tokens = (s: string) => Math.ceil(s.length / 4);

export function stubProvider(o: StubOptions = {}): AiProvider {
  return {
    name: "stub",
    async call(c) {
      const r = o.respond ? await o.respond(c) : JSON.stringify(sampleOf(c.schema));
      if (typeof r !== "string") return r;
      return { ok: true, text: r, model: `${c.model} (stub)`, usage: { inputTokens: tokens(c.instructions) + tokens(c.input) + (c.images?.length ?? 0) * STUB_IMAGE_TOKENS, cachedTokens: 0, outputTokens: tokens(r) } };
    },
    async transcribe(t) {
      return o.transcript ? o.transcript(t) : { ok: true, text: "What's next today?" };
    },
  };
}
