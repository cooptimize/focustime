// AS-1: the demo's assistant: a scripted provider (no network, no key, nothing leaves FocusTime) that turns a few
// plain requests into the same tool calls a model would make, so the demo shows the panel's lookups, proposals and
// previews through the real service, its allowlist and its confirm checks. Only the assistant uses it; the demo's other
// AI features stay off. Its transcript is a fixed sentence: no audio goes anywhere.
import type { AiProvider, ProviderCall, ProviderReply, ToolCall } from "../../ai/types.ts";

const usage = (c: ProviderCall, out: string) => ({ inputTokens: Math.ceil((c.instructions.length + c.input.length) / 4), cachedTokens: 0, outputTokens: Math.ceil(out.length / 4) });
const text = (c: ProviderCall, value: unknown): ProviderReply => {
  const t = JSON.stringify(value);
  return { ok: true, text: t, model: "demo assistant", usage: usage(c, t) };
};

/** The request (the person's own words) and the day, from the service's input. */
function requestOf(input: string): { said: string; today: string | null } {
  const i = input.indexOf("The person's request:\n");
  return { said: i >= 0 ? input.slice(i + "The person's request:\n".length) : input, today: /Today is (\d{4}-\d{2}-\d{2})/.exec(input)?.[1] ?? null };
}

function monday(d: string): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/** The calls for a request, in order (the first round); none when the demo doesn't know it. */
function callsFor(said: string, today: string | null): { name: string; arguments: Record<string, unknown> }[] {
  const s = said.toLowerCase();
  const id = Number(/#(\d+)/.exec(said)?.[1] ?? 0);
  const quoted = /"([^"]+)"|“([^”]+)”/.exec(said);
  if (id && /\bcomment\b/.test(s)) {
    const words = quoted?.[1] ?? quoted?.[2] ?? said.replace(/^.*?\b(saying|that|:)\s*/i, "");
    return [{ name: "comment", arguments: { itemId: id, text: words.trim() } }];
  }
  if (/\bconfirm\b.*\bweek\b/.test(s) && today) return [{ name: "confirm_week", arguments: { weekStart: monday(today) } }];
  if (/\bconfirm\b/.test(s) && today) return [{ name: "confirm_day", arguments: { date: today } }];
  if (/\bcapture\b|\bremember to\b/.test(s)) return [{ name: "capture", arguments: { text: said.replace(/^.*?\b(capture|remember to)\b:?\s*/i, "").trim() || said, as: "sort_later" } }];
  if (id) return [{ name: "item", arguments: { id } }];
  if (/\bgaps?\b|\bmissing\b/.test(s)) return [{ name: "gaps", arguments: {} }];
  if (/\bsen[dt]s?\b/.test(s)) return [{ name: "sends", arguments: {} }];
  if (/\bcommit(ted|ments?)\b|\bpromised\b/.test(s)) return [{ name: "commitments", arguments: { person: null } }];
  if (/\btonight\b/.test(s)) return [{ name: "today", arguments: { when: "tonight" } }];
  if (/\bdue\b|\btoday\b/.test(s)) return [{ name: "today", arguments: { when: "today" } }];
  if (/\bnext\b|\bnow\b/.test(s)) return [{ name: "today", arguments: { when: "now" } }];
  return [];
}

const REPLY: Record<string, string> = {
  comment: "Here's the comment. Check it, then Confirm to add it in DevOps.",
  confirm_day: "Here's today's plan to confirm.",
  confirm_week: "Here's the week to confirm.",
  capture: "Here's the capture. Confirm to save it.",
  item: "Here's the item.",
  gaps: "These need something before they're ready.",
  sends: "Here's what you sent and what was sent to you.",
  commitments: "Here's what people committed to.",
  today: "Here's what's on.",
};

export function demoAssistantProvider(): AiProvider {
  return {
    name: "stub",
    async call(c) {
      const { said, today } = requestOf(c.input);
      const calls = callsFor(said, today);
      if (c.schema && typeof c.schema === "object" && "properties" in c.schema && (c.schema.properties as Record<string, unknown>).tools) {
        // The intent round: only the proposals the words ask for (reads are always allowed), or close_loop.
        const s = said.toLowerCase();
        if (/\bclose\b.*\b(loop|follow-?up)\b/.test(s)) return text(c, { tools: ["close_loop"] });
        const named = calls.map((x) => x.name);
        return text(c, { tools: named.length ? named : [] });
      }
      if (!c.rounds?.length && calls.length) {
        const made: ToolCall[] = calls.map((x, i) => ({ callId: `demo_${i}`, name: x.name, arguments: JSON.stringify(x.arguments) }));
        return { ok: true, text: "", model: "demo assistant", usage: usage(c, ""), calls: made, items: made.map((m) => ({ type: "function_call", call_id: m.callId, name: m.name, arguments: m.arguments })) };
      }
      const cannot = c.rounds?.flatMap((r) => r.outputs).map((o) => (JSON.parse(o.output) as { cannot?: string }).cannot).find(Boolean);
      return text(c, { reply: cannot ? `I couldn't: ${cannot}.` : (REPLY[calls[0]?.name ?? ""] ?? "In the demo I can show what's next, an item (#id), gaps, sends, a comment on an item, confirming today and a capture.") });
    },
    async transcribe() {
      return { ok: true, text: "What's next today?" };
    },
  };
}
