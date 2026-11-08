// DM-1: AI in the demo. The demo's data is fictional, so the app's real provider may answer it, under the normal caps
// (the team's AI for FocusTime switch, the app's monthly cap; the demo session's own cap of about a dollar). When the
// provider isn't there, is off, is slow (about 6 seconds) or answers with something that doesn't fit the schema, a
// stored sample answer for the same task is used instead, so the demo never stalls. The guard runs before this
// provider is ever called (ai/service.ts), so a refused request is refused and never gets a sample.
import { demoStandardsAnswer } from "./standards.ts";
import { demoMeetingAnswer } from "./meetings.ts";
import type { AiProvider, ProviderCall, ProviderReply, TranscribeReply } from "../../ai/types.ts";
import { costMicros, micros, type Prices } from "../../ai/cost.ts";
import { sampleOf, validate } from "../../ai/schema.ts";
import { demoAssistantProvider } from "./assistant.ts";

export type RealAi = {
  /** The app's real provider, or null (not set up, or the stub). */
  provider: () => Promise<AiProvider | null>;
  /** Whether a real call may be made now: the team's AI for FocusTime is on and the app's monthly cap isn't reached. */
  allowed: () => Promise<boolean>;
  prices: Prices;
};

export const DEMO_AI_TIMEOUT_MS = 6_000;
/** The demo session's cap on real calls; a little under the cap the demo's rules show, so samples take over first. */
export const DEMO_SESSION_CAP_USD = 0.9;
/** What the sample transcript says (push-to-talk with no real transcription): the script's dictated comment. */
export const DEMO_TRANSCRIPT = "Comment on #1112 saying the date filter works for orders and the export screen is next";

const ZERO = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
const reply = (value: unknown): ProviderReply => ({ ok: true, text: JSON.stringify(value), model: "demo samples", usage: ZERO });
const within = <T>(p: Promise<T>, ms: number): Promise<T | "late"> => Promise.race([p, new Promise<"late">((r) => setTimeout(() => r("late"), ms).unref?.())]);

/** How each answer came: for the preflight and the tests (never the text). */
export type DemoAiLog = { real: number; samples: number; lastReason: string | null };

export function demoAi(o: { real?: RealAi | null; timeoutMs?: number; sessionCapUsd?: number }) {
  const script = demoAssistantProvider();
  const timeoutMs = o.timeoutMs ?? DEMO_AI_TIMEOUT_MS;
  let spent = 0;
  /** While seeding: samples only (never a real call), so every run starts the same. */
  let held = false;
  const log: DemoAiLog = { real: 0, samples: 0, lastReason: null };
  /** SR-1 tests: sees each request's input after the guards (what a provider would get). */
  let spy: ((input: string) => void) | null = null;
  const sample = (c: ProviderCall, why: string): Promise<ProviderReply> => {
    log.samples++;
    log.lastReason = why;
    return samples(c, script);
  };
  /** The real provider when a real call may be made now, else why not. */
  const realNow = async (): Promise<AiProvider | string> => {
    if (held) return "seeding";
    if (!o.real) return "no real provider in this demo";
    if (spent >= micros(o.sessionCapUsd ?? DEMO_SESSION_CAP_USD)) return "the demo session's cap";
    if (!(await o.real.allowed().catch(() => false))) return "AI is off or the app's cap is reached";
    return (await o.real.provider().catch(() => null)) ?? "AI isn't set up";
  };
  const provider: AiProvider = {
    name: "stub",
    async call(c) {
      spy?.(c.input);
      const p = await realNow();
      if (typeof p === "string") return sample(c, p);
      const r = await within(p.call(c).catch((): ProviderReply => ({ ok: false, kind: "provider", status: 0 }) as ProviderReply), timeoutMs);
      if (r === "late") return sample(c, "slow");
      if (r.usage) spent += costMicros(r.usage, o.real!.prices);
      if (!r.ok) return sample(c, "provider error");
      // A tool call goes back as it is; an answer must fit its schema, or the sample stands in.
      if (!r.calls?.length) {
        let fits = false;
        try {
          fits = validate(JSON.parse(r.text), c.schema).length === 0;
        } catch {
          fits = false;
        }
        if (!fits) return sample(c, "answer didn't fit");
      }
      log.real++;
      return r;
    },
    async transcribe(t): Promise<TranscribeReply> {
      const p = await realNow();
      if (typeof p !== "string" && p.transcribe) {
        const r = await within(p.transcribe(t).catch((): TranscribeReply => ({ ok: false, kind: "provider" })), timeoutMs);
        if (r !== "late" && r.ok) {
          log.real++;
          return r;
        }
      }
      log.samples++;
      return { ok: true, text: DEMO_TRANSCRIPT };
    },
  };
  return { provider, log, hold: (on: boolean) => void (held = on), real: () => !!o.real, spy: (f: ((input: string) => void) | null) => void (spy = f) };
}

// ---------- the samples, one per task (the schema's name), shaped like a good answer for the demo's data ----------

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const overlap = (a: string, b: string) => [...words(a)].filter((w) => words(b).has(w)).length;
const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  return t ? `${t[0]!.toUpperCase()}${t.slice(1)}` : t;
};
const enumOf = (s: unknown): unknown[] => {
  const x = s as { enum?: unknown[]; anyOf?: { enum?: unknown[] }[] } | undefined;
  return x?.enum ?? x?.anyOf?.flatMap((a) => a.enum ?? []) ?? [];
};

async function samples(c: ProviderCall, script: AiProvider): Promise<ProviderReply> {
  switch (c.schemaName) {
    case "assistant_intent":
    case "assistant_answer":
      return script.call(c);
    case "capture_prepare":
      return reply(capturePrepare(c));
    case "stories_draft":
      return reply(breakDown(c));
    case "conversations_draft_item":
      return reply(conversationDraft(c));
    case "conversations_comment":
      return reply({ lines: conversationComment(c) });
    case "meeting_capture":
      return reply(demoMeetingAnswer(c.input));
    case "status_draft":
      return reply({ drafts: statusDraft(c.input) });
    case "status_suggest": {
      // A fictional slip so GD-2's check after generation shows: Harbor's names Northwind (replaced), Internal's keeps it.
      const drafts = statusSuggest(c.input);
      if (/^Client: (Harbor|Cooptimize)/m.test(c.input) && drafts[0]?.text) drafts[0].text = `${drafts[0].text} Same pattern as Northwind's.`;
      return reply({ drafts });
    }
    // AS-3: a general question about one client, when the real model isn't there: say so plainly, never a made-up fact.
    case "assistant_question":
      return reply({ reply: "In the demo I can't answer that one without the real model. Ask what to look out for next week, which promises are late, or what's not ready next week.", itemIds: [] });
    case "assistant_standards":
      return reply(demoStandardsAnswer(c.input));
    case "loop_draft":
      return reply({ text: loopDraft(c.input) });
    case "conversations_merge_summary": {
      const i = JSON.parse(c.input) as { into?: { title?: string; summary?: string } };
      return reply({ title: i.into?.title ?? "Merged conversation", summary: i.into?.summary ?? "Two threads about the same question, now one." });
    }
    default: {
      const v = sampleOf(c.schema);
      return reply(v);
    }
  }
}

/** CP-1: a captured draft's DevOps-ready version: a clear title, a short description, three acceptance lines. */
function capturePrepare(c: ProviderCall) {
  const i = JSON.parse(c.input) as { kind: "story" | "feature"; note: string; my_title: string; offered_types: string[]; offered_parents: { id: number; title: string }[] };
  const props = (c.schema as { properties: Record<string, unknown> }).properties;
  const types = enumOf(props.type) as string[];
  const ids = enumOf(props.parent_id) as number[];
  const best = [...i.offered_parents].filter((p) => ids.includes(p.id)).sort((a, b) => overlap(b.title, i.note) - overlap(a.title, i.note))[0] ?? null;
  const title = sentence(i.my_title || i.note).slice(0, 80);
  return {
    title,
    description: `${sentence(i.note)}.\n\nWhy: so the team can see and plan this in DevOps instead of in a chat.`,
    acceptance_criteria: i.kind === "feature" ? "" : [`${title} works for a signed-in customer`, "The change is covered by a test", "The client has reviewed it in staging"].join("\n"),
    type: types[0] ?? null,
    parent_id: best?.id ?? null,
    parent_reason: best ? `It is part of "${best.title}"` : "No open feature fits it yet",
    ...("standards_note" in props ? { standards_note: null } : {}),
  };
}

/** KB-1: a data feature, split the way the standards say: Gold tables apart, Silver regenerated, model, report, then the app. */
function demoDataBreakdown(_c: ProviderCall, featureId: number, card: (id: string, title: string, description: string, acceptance: string[], size: "S" | "M" | "L" | null, depends?: string[]) => unknown) {
  return {
    kind: "story_proposals",
    version: 1,
    feature_id: featureId,
    proposals: [
      card("p1", "Configure or regenerate Silver for the sales source tables", "Bring the sales order tables into Silver through the generator's configuration.", ["The sales order tables are present in Silver and match the source"], "S"),
      card("p2", "Build fact.Sales in Gold", "One row per sales order line, keyed to the customer and date dimensions.", ["Follows Gold Fact Tables: fact schema, PascalCase, FK{Dimension} keys", "Follows SQL Conventions: no SELECT *, every column named"], "L", ["p1"]),
      card("p3", "Build dim.Customer in Gold", "One row per customer with a surrogate key.", ["Follows Gold Dimension Tables: dim schema, one surrogate key"], "M", ["p1"]),
      card("p4", "Add the sales semantic model", "Tables and relationships over fact.Sales and dim.Customer, with base measures.", ["Follows Power BI Fact Tables: foreign keys hidden from report authors"], "M", ["p2", "p3"]),
      card("p5", "Build the sales report pages", "An overview page and a customer page.", ["Follows Power BI Report Visuals: every visual titled with its measure"], "M", ["p4"]),
      card("p6", "Publish the app with the sales report", "Update the workspace app so people see the new report.", ["Follows Power BI App Deployment: published through the workspace app"], "S", ["p5"]),
    ],
    rationale: "Split along the standards' layers: Silver is regenerated, each Gold table is its own story, then the model, the report and the app.\nClient override: Gold Dimension Tables: Northwind keeps its existing dim.Customer key name, because its finance reports read it.",
    set_aside: [],
  };
}

/** BD-1: proposals for the feature asked about (Supplier onboarding has its own; others get a general split). */
function breakDown(c: ProviderCall) {
  const i = JSON.parse(c.input) as { feature: { id: number; title: string }; regenerate_only?: { id: string; previous_title: string } };
  const card = (id: string, title: string, description: string, acceptance: string[], size: "S" | "M" | "L" | null, depends: string[] = []) => ({ id, title, description, acceptance_criteria: acceptance, depends_on: depends, size, evidence: ["From the feature's description"], open_questions: [] as string[] });
  if (/gold|semantic model/i.test(i.feature.title)) return demoDataBreakdown(c, i.feature.id, card);
  const supplier = /supplier/i.test(i.feature.title);
  const all = supplier
    ? [
        card("p1", "Supplier sign-up form", "A supplier enters company details and a contact, and can save a draft to finish later.", ["A draft can be saved and reopened", "Required fields are checked before submit"], "M"),
        card("p2", "Upload supplier certificates", "PDF or image certificates, up to 10 MB each, attached to the supplier's application.", ["PDF, PNG and JPG up to 10 MB", "Each file shows its name and size after upload"], "M", ["p1"]),
        card("p3", "Choose payment terms", "The supplier picks payment terms from the ones purchasing offers.", ["Only the terms purchasing set up are offered"], "S", ["p1"]),
        card("p4", "Purchasing review and approval", "Purchasing sees new applications, approves or sends one back with a note.", ["Approve and Send back are logged with who and when", "Sent back applications reopen for the supplier"], "L", ["p1", "p2"]),
        card("p5", "Notify purchasing of a new supplier", "One notification per submitted application.", ["Exactly one notification per application"], "S", ["p4"]),
      ]
    : [
        card("p1", `${i.feature.title}: first usable version`, "The smallest version a user can try end to end.", ["A user can complete the main path"], "M"),
        card("p2", `${i.feature.title}: edge cases and errors`, "What happens when input is missing or wrong.", ["Errors say what to do next"], "S", ["p1"]),
        card("p3", `${i.feature.title}: review with the client`, "A walkthrough in staging and the changes it asks for.", ["The client has signed off in staging"], "S", ["p1"]),
      ];
  const proposals = i.regenerate_only ? [{ ...all[1]!, id: i.regenerate_only.id, title: `${all[1]!.title} (another take)` }] : all;
  return { kind: "story_proposals", version: 1, feature_id: i.feature.id, proposals, rationale: supplier ? "One story per step a supplier and purchasing go through, so each can ship and be tested on its own." : "A first usable slice, then the edges, then the client's review.", set_aside: [] };
}

/** CV-5: a DevOps item drafted from a conversation (the delivery fee one has its own; others get a general one). */
function conversationDraft(c: ProviderCall) {
  const i = JSON.parse(c.input) as { conversation: { title: string; summary: string }; open_features: { id: number; title: string }[]; open_items: { id: number; title: string }[] };
  const t = i.conversation.title;
  const parent = [...i.open_features].sort((a, b) => overlap(b.title, `${t} ${i.conversation.summary}`) - overlap(a.title, `${t} ${i.conversation.summary}`))[0];
  const fee = /delivery fee/i.test(t);
  return {
    // KB-1: the field exists only when standards went with the request.
    ...("standards" in i ? { standards_note: null } : {}),
    title: fee ? "Add the delivery fee as its own column in the order export" : sentence(t),
    asked: fee ? "Finance wants the delivery fee as a separate column in the order history export, before the month-end close." : sentence(i.conversation.summary.split("\n")[0] ?? t),
    check_first: fee ? ["Where the fee is stored on an order today", "Whether refunds change the fee"] : ["What the client expects to see"],
    likely_change: fee ? "Add a Delivery fee column to the CSV export and keep the order total as it is." : "A small change to the feature the conversation is about.",
    open_questions: fee ? ["Should orders without a fee show 0 or stay empty?"] : [],
    level: "story",
    parent_feature: parent && overlap(parent.title, `${t} ${i.conversation.summary}`) > 0 ? parent.id : (i.open_features[0]?.id ?? null),
    likely_item: null,
    acceptance_criteria: fee ? ["The export has a Delivery fee column", "Order totals are unchanged", "Orders with no fee show 0"] : ["The client has confirmed the change"],
  };
}

function conversationComment(c: ProviderCall): string[] {
  const i = JSON.parse(c.input) as { conversation?: { title?: string; summary?: string } };
  return (i.conversation?.summary ?? "Discussed with the client in Teams.").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3);
}

/**
 * SR-1: a status line per feature from its facts (the input lists "Feature #id: title" and "- fact: ..." lines): the
 * newest state change and what's done, in plain words; no facts, no line.
 */
/** LP-1: Close the loop's message from the promise, the conversation and the item's state (fictional demo people only). */
function loopDraft(input: string): string {
  const line = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(input)?.[1]?.trim() ?? "";
  const to = line("To") || "there";
  const from = line("From");
  const what = sentence(line("Promise")).replace(/^I'll /i, "").replace(/^I will /i, "");
  const item = /^Work item #(\d+): (.*) \((.*)\), state now: (.*)$/m.exec(input);
  const state = item ? ` #${item[1]} is ${item[4]} now, so you can check it whenever suits you.` : "";
  // "Tell Priya the export is ready" says itself; anything else is closed out as done.
  const told = /^(?:tell|let) \S+ (?:know )?(?:that )?(.+)$/i.exec(what.replace(/\.$/, ""));
  // "Send Marcus the updated spec" → "the updated spec"; "Confirm the go-live date" → "the go-live date".
  const thing = what.replace(/\.$/, "").replace(new RegExp(`^\\w+ (?:${to.split(" ")[0]} )?`, "i"), "");
  const body = told ? `${sentence(told[1]!)}.` : `Closing the loop on ${thing}: it's done.`;
  return `Hi ${to},\n\n${body}${state} Let me know if anything looks off.${from ? `\n\n${from}` : ""}`;
}

/**
 * SR-3: the demo's "AI suggests" lines for the features I worked on: what moved (state changes), what I'm on (to-dos and
 * stories worked on), in one or two short sentences. Fictional data only; the real model writes better ones.
 */
function statusSuggest(input: string): { itemId: number; text: string }[] {
  const out: { itemId: number; text: string }[] = [];
  let cur: { itemId: number; facts: string[] } | null = null;
  const name = (f: string) => f.replace(/^(Worked on |To-do in FocusTime: |Done in FocusTime: )?#\d+ /, "").replace(/:.*$/, "");
  const flush = () => {
    if (!cur) return;
    const done = [...new Set(cur.facts.filter((f) => /→ (Resolved|Closed|Done)/.test(f) || f.startsWith("Done in FocusTime: ")).map(name))];
    const review = [...new Set(cur.facts.filter((f) => /→ (In Review|Review|Testing)/.test(f)).map(name))];
    const on = [...new Set(cur.facts.filter((f) => /→ Active/.test(f) || f.startsWith("To-do in FocusTime: ") || f.startsWith("Worked on ")).map(name))].filter((t) => !done.includes(t) && !review.includes(t));
    const parts = [...(done.length ? [`Finished ${done.slice(0, 2).join(" and ")}`] : []), ...(review.length ? [`moved ${review.slice(0, 2).join(" and ")} to review`] : []), ...(on.length ? [`${done.length || review.length ? "next is" : "Working on"} ${on.slice(0, 2).join(" and ")}`] : [])];
    out.push({ itemId: cur.itemId, text: parts.length ? `${sentence(parts.join("; "))}.` : "" });
  };
  for (const line of input.split("\n")) {
    const m = /^Feature #(\d+): /.exec(line);
    if (m) {
      flush();
      cur = { itemId: Number(m[1]), facts: [] };
    } else if (cur && line.startsWith("- fact: ")) cur.facts.push(line.slice(8));
  }
  flush();
  return out;
}

function statusDraft(input: string): { itemId: number; text: string }[] {
  const out: { itemId: number; text: string }[] = [];
  let cur: { itemId: number; facts: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const done = cur.facts.filter((f) => /→ (Resolved|Closed|Done)/.test(f)).map((f) => f.replace(/^#\d+ /, "").replace(/:.*$/, ""));
    const moving = cur.facts.filter((f) => /→ Active/.test(f)).map((f) => f.replace(/^#\d+ /, "").replace(/:.*$/, ""));
    const picks = cur.facts.filter((f) => f.startsWith("Done in FocusTime: ")).map((f) => f.replace(/^Done in FocusTime: #\d+ /, ""));
    const parts = [...(done.length ? [`Finished ${done.join(" and ")}`] : []), ...(picks.length && !done.length ? [`Worked through ${picks.join(" and ")}`] : []), ...(moving.length ? [`started on ${moving.join(" and ")}`] : [])];
    out.push({ itemId: cur.itemId, text: parts.length ? `${sentence(parts.join("; "))}.` : "" });
  };
  for (const line of input.split("\n")) {
    const m = /^Feature #(\d+): /.exec(line);
    if (m) {
      flush();
      cur = { itemId: Number(m[1]), facts: [] };
    } else if (cur && line.startsWith("- fact: ")) cur.facts.push(line.slice(8));
  }
  flush();
  // GD-2: the demo's sample slips once, comparing Northwind's first feature with another demo client, so the check
  // after generation has something to replace ("Another client's name was removed" on the draft).
  const first = out.find((d) => d.text);
  if (first && /Northwind/.test(input)) first.text = `${first.text} Same approach as Harbor Health's intake form.`;
  return out;
}
