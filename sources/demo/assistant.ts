// AS-1: the demo's assistant: a scripted provider (no network, no key, nothing leaves FocusTime) that turns a few
// plain requests into the same tool calls a model would make, so the demo shows the panel's lookups, proposals and
// previews through the real service, its allowlist and its confirm checks. DM-1: it is the stored sample for the
// assistant's two tasks (sources/demo/ai.ts uses it when the real provider isn't there or is slow), and it knows the
// demo script's steps: a lookup (what's next), a move ("Move Northwind's date filter to Wednesday afternoon": it reads
// today's picks, then proposes moving the one the words name) and a dictated comment on an item.
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
  if (/\bmove\b/.test(s) && today) return [{ name: "today", arguments: { when: "today" } }];
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

/** DM-1: the day a move names ("Wednesday", "tomorrow"), this week or the next, and its half (afternoon is PM). */
function moveTarget(said: string, today: string): { date: string; half: "AM" | "PM" } {
  const s = said.toLowerCase();
  const half = /\b(afternoon|pm)\b/.test(s) ? "PM" : /\b(morning|am)\b/.test(s) ? "AM" : "PM";
  const t = new Date(`${today}T12:00:00Z`);
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const named = names.findIndex((n) => s.includes(n));
  const add = /\btomorrow\b/.test(s) ? 1 : named >= 0 ? (named - t.getUTCDay() + 7) % 7 || 7 : 0;
  t.setUTCDate(t.getUTCDate() + add);
  return { date: t.toISOString().slice(0, 10), half };
}

/** DM-1: the pick a move names, from the read's facts (the one whose title shares the most words with the request). */
function pickFrom(outputs: string[], said: string): number | null {
  const ws = new Set(said.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  let best: { id: number; score: number } | null = null;
  for (const o of outputs) {
    const data = (JSON.parse(o) as { data?: { picks?: { pickId: number; title: string }[]; next?: { pickId: number; title: string } | null } }).data;
    for (const p of [...(data?.picks ?? []), ...(data?.next ? [data.next] : [])]) {
      const score = p.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => ws.has(w)).length;
      if (score > 0 && (!best || score > best.score)) best = { id: p.pickId, score };
    }
  }
  return best?.id ?? null;
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
  move_pick: "Here's the move. Confirm to move it.",
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
        if (/\bmove\b/.test(s)) return text(c, { tools: ["move_pick"] });
        const named = calls.map((x) => x.name);
        return text(c, { tools: named.length ? named : [] });
      }
      if (!c.rounds?.length && calls.length) {
        const made: ToolCall[] = calls.map((x, i) => ({ callId: `demo_${i}`, name: x.name, arguments: JSON.stringify(x.arguments) }));
        return { ok: true, text: "", model: "demo assistant", usage: usage(c, ""), calls: made, items: made.map((m) => ({ type: "function_call", call_id: m.callId, name: m.name, arguments: m.arguments })) };
      }
      // DM-1: a move reads today's picks first, then proposes moving the one the words name (once).
      if (c.rounds?.length && /\bmove\b/i.test(said) && today && !c.rounds.some((r) => r.items.some((i) => (i as { name?: string }).name === "move_pick"))) {
        const pickId = pickFrom(c.rounds.flatMap((r) => r.outputs.map((o) => o.output)), said);
        if (pickId) {
          const m: ToolCall = { callId: "demo_move", name: "move_pick", arguments: JSON.stringify({ pickId, ...moveTarget(said, today) }) };
          return { ok: true, text: "", model: "demo assistant", usage: usage(c, ""), calls: [m], items: [{ type: "function_call", call_id: m.callId, name: m.name, arguments: m.arguments }] };
        }
        return text(c, { reply: "I couldn't find that pick on today's plan. Name the pick as it reads, and its client." });
      }
      const moved = c.rounds?.some((r) => r.items.some((i) => (i as { name?: string }).name === "move_pick"));
      const cannot = c.rounds?.flatMap((r) => r.outputs).map((o) => (JSON.parse(o.output) as { cannot?: string }).cannot).find(Boolean);
      return text(c, { reply: cannot ? `I couldn't: ${cannot}.` : (REPLY[moved ? "move_pick" : (calls[0]?.name ?? "")] ?? "In the demo I can show what's next, an item (#id), gaps, sends, moving a pick, a comment on an item, confirming today and a capture.") });
    },
    // DM-1: the script's dictated comment (sources/demo/ai.ts answers transcriptions; this is kept for its tests).
    async transcribe() {
      return { ok: true, text: "Comment on #1112 saying the date filter works for orders and the export screen is next" };
    },
  };
}
