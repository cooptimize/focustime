// AS-1: the demo's assistant: a scripted provider (no network, no key, nothing leaves FocusTime) that turns a few
// plain requests into the same tool calls a model would make, so the demo shows the panel's lookups, proposals and
// previews through the real service, its allowlist and its confirm checks. DM-1: it is the stored sample for the
// assistant's two tasks (sources/demo/ai.ts uses it when the real provider isn't there or is slow), and it knows the
// demo script's steps: a lookup (what's next), a move ("Move Northwind's date filter to Wednesday afternoon": it reads
// today's picks, then proposes moving the one the words name) and a dictated comment on an item. AS-2: a move by
// feature or by day ("Move the order history export stories to Friday", "Push everything from today to tomorrow":
// move_plan, the server finds the to-dos) and a compound update ("Mark #1112 done and comment that it's in review").
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

/** AS-2: a move the server builds (by feature or by day), not one named to-do. */
const planMove = (s: string) => /\b(move|push)\b/.test(s) && /\b(stories|everything|all)\b/.test(s);
/** AS-2: a done and a comment on one item, in one card. */
const compound = (s: string, id: number) => !!id && /\b(done|complete|close)\b/.test(s) && /\bcomment\b/.test(s);

/** The calls for a request, in order (the first round); none when the demo doesn't know it. */
function callsFor(said: string, today: string | null): { name: string; arguments: Record<string, unknown> }[] {
  const s = said.toLowerCase();
  const id = Number(/#(\d+)/.exec(said)?.[1] ?? 0);
  const quoted = /"([^"]+)"|“([^”]+)”/.exec(said);
  if (planMove(s) && today) {
    const from = /\bfrom today\b/.test(s) ? today : null;
    const to = moveTarget(said.replace(/\bfrom today\b/i, ""), today);
    const toHalf = /\b(afternoon|pm|morning|am)\b/.test(s) ? to.half : null;
    return [{ name: "move_plan", arguments: { fromDate: from, fromHalf: null, toDate: to.date, toHalf, which: /\beverything|\ball\b/.test(s) ? "all" : "named" } }];
  }
  if (compound(s, id)) {
    const words = said.replace(/^.*?\bcomment\b\s*(that|saying)?\s*/i, "").trim();
    return [{ name: "item_update", arguments: { itemId: id, done: true, comment: words ? words[0]!.toUpperCase() + words.slice(1) : null, target: null } }];
  }
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

/** AS-3: the demo's question routing (the real model does this from the instructions): a topic and a period. */
export function demoQuestion(said: string, today: string | null): { topic: string; period: string; date: string | null; lateOnly: boolean } | null {
  const s = said.toLowerCase();
  const period = /\bnext week\b/.test(s) ? "next_week" : /\blast week\b/.test(s) ? "last_week" : /\btomorrow\b/.test(s) ? "tomorrow" : /\bweekend\b/.test(s) ? "weekend" : /\btoday\b/.test(s) ? "today" : "this_week";
  const q = (topic: string, lateOnly = false) => ({ topic, period, date: null, lateOnly });
  void today;
  if (/\bstandards?\b|\bformatted\b/.test(s)) return q("standards");
  if (/\b(help me with|can you do|can you help|what can you)\b/.test(s)) return q("capabilities");
  if (/\blook out for\b|\bwatch out\b|\bplanning\b.*\?|\banything i should know\b/.test(s)) return q("plan_check");
  if (/\bpromises?\b/.test(s)) return q("promises", /\blate\b|\boverdue\b/.test(s));
  if (/\bwaiting on\b/.test(s)) return q("waiting");
  if (/\bnot ready\b|\breadiness\b/.test(s)) return q("readiness");
  if (/\bdeploy|\brelease|\bgo-live|\bafter hours\b/.test(s)) return q("deployments");
  if (/\bupdate for monday\b|\bneed an update\b|\bstatus report\b/.test(s)) return q("status_updates");
  if (/\bget done\b|\bgot done\b|\bfinished\b/.test(s)) return q("done");
  if (/\bclient calls?\b|\bto review\b/.test(s)) return q("calls");
  if (/\bon my plate\b|\bschedule\b|\bwhat's on\b/.test(s)) return q("agenda");
  if (/\bfeature\b.*\b(name|under)\b|\bunder the\b/.test(s)) return q("items");
  if (/\?\s*$/.test(s) && !/#\d+/.test(s)) return q("general");
  return null;
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
  move_plan: "Here's the move. Confirm to move them; Undo puts them back.",
  item_update: "Here's the update. Confirm to write both parts in DevOps.",
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
        const none = { ask: null, followUp: false };
        if (/\bclose\b.*\b(loop|follow-?up)\b/.test(s)) return text(c, { tools: ["close_loop"], ...none });
        if (planMove(s)) return text(c, { tools: ["move_plan"], ...none });
        if (compound(s, Number(/#(\d+)/.exec(said)?.[1] ?? 0))) return text(c, { tools: ["item_update"], ...none });
        if (/\bmove\b/.test(s)) return text(c, { tools: ["move_pick"], ...none });
        // AS-3: a question: its topic and period, answered from my own data on the server.
        const q = demoQuestion(said, today);
        if (q) return text(c, { tools: [], ask: q, followUp: /^(can't you|no,|i meant|those|they)\b/i.test(said.trim()) });
        const named = calls.map((x) => x.name);
        return text(c, { tools: named.length ? named : [], ...none });
      }
      if (!c.rounds?.length && calls.length) {
        const made: ToolCall[] = calls.map((x, i) => ({ callId: `demo_${i}`, name: x.name, arguments: JSON.stringify(x.arguments) }));
        return { ok: true, text: "", model: "demo assistant", usage: usage(c, ""), calls: made, items: made.map((m) => ({ type: "function_call", call_id: m.callId, name: m.name, arguments: m.arguments })) };
      }
      // DM-1: a move reads today's picks first, then proposes moving the one the words name (once).
      if (c.rounds?.length && /\bmove\b/i.test(said) && !planMove(said.toLowerCase()) && today && !c.rounds.some((r) => r.items.some((i) => (i as { name?: string }).name === "move_pick"))) {
        const pickId = pickFrom(c.rounds.flatMap((r) => r.outputs.map((o) => o.output)), said);
        if (pickId) {
          const m: ToolCall = { callId: "demo_move", name: "move_pick", arguments: JSON.stringify({ pickId, ...moveTarget(said, today) }) };
          return { ok: true, text: "", model: "demo assistant", usage: usage(c, ""), calls: [m], items: [{ type: "function_call", call_id: m.callId, name: m.name, arguments: m.arguments }] };
        }
        return text(c, { reply: "I couldn't find that to-do on today's plan. Name the to-do as it reads, and its client." });
      }
      const moved = c.rounds?.some((r) => r.items.some((i) => (i as { name?: string }).name === "move_pick"));
      const cannot = c.rounds?.flatMap((r) => r.outputs).map((o) => (JSON.parse(o.output) as { cannot?: string }).cannot).find(Boolean);
      return text(c, { reply: cannot ? `I couldn't: ${cannot}.` : (REPLY[moved ? "move_pick" : (calls[0]?.name ?? "")] ?? "In the demo I can show what's next, an item (#id), gaps, sends, moving a to-do, a comment on an item, confirming today and a capture.") });
    },
    // DM-1: the script's dictated comment (sources/demo/ai.ts answers transcriptions; this is kept for its tests).
    async transcribe() {
      return { ok: true, text: "Comment on #1112 saying the date filter works for orders and the export screen is next" };
    },
  };
}
