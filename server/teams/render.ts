// TB-3: the Teams renderer for the Assistant's channel-neutral result (assistant/types.ts HandleResult). The panel
// (ui/Assistant.tsx) is the other renderer; nothing here decides what to say. Every Card kind must have a case: a new
// kind doesn't type-check until it does, and assistant/parity.test.ts runs every golden question and action through it.
// What a card can't hold (a very long answer) shows its first part and "Open in FocusTime", a link to the same answer.
import type { Card as AsCard, HandleResult as AsResult, Link } from "../../assistant/types.ts";
import type { Question } from "./assistant.ts";
import { card, muted, openUrl, safeLinks, text, title, type Card } from "./cards.ts";

/** Teams refuses an activity over about 28 KB; the answer's cards stay under this, and the rest are a link. */
export const MAX_MESSAGE_BYTES = 24_000;
export const MAX_RESULT_CARDS = 9;

const base = (publicUrl: string) => publicUrl.replace(/\/+$/, "");
/** An app address on the public URL; a full address stays as it is. */
export const toUrl = (publicUrl: string, href: string) => (/^https?:/i.test(href) ? href : `${base(publicUrl)}/${href}`);
/** The panel opened on one turn: "Open in FocusTime" for what didn't fit. */
export const askLink = (publicUrl: string, turnId: number | string) => `${base(publicUrl)}/#/ask/${turnId}`;

const urls = (links: readonly (Link | undefined)[], publicUrl: string) => safeLinks(links.flatMap((l) => (l ? [{ label: l.label, url: toUrl(publicUrl, l.href) }] : [])), publicUrl);

/** A card's own links as the Assistant gave them (a result card's Open …, an item's DevOps link). */
export function cardLinks(c: AsCard): Link[] {
  if (c.kind === "question" || c.kind === "suggest") return [];
  if (c.kind === "section") return c.lines.flatMap((l) => (l.link ? [l.link] : []));
  const own = c.link ? [c.link] : [];
  return c.kind === "item" && c.devopsUrl ? [...own, { label: "Open in DevOps", href: c.devopsUrl }] : own;
}

const small = (t: string) => text(t, { spacing: "Small" });

/** One result card, or null for the two kinds that are buttons (renderQuestion). Exhaustive on purpose. */
export function renderCard(c: AsCard, publicUrl: string): Card | null {
  const actions = (...l: (Link | undefined)[]) => urls(l, publicUrl).map(openUrl);
  switch (c.kind) {
    case "note":
      return card([text(c.text)], actions(c.link));
    case "section":
      return card([
        title(c.title),
        ...c.lines.map((l) => {
          const [u] = urls([l.link], publicUrl);
          return u ? { type: "Container", spacing: "Small", selectAction: openUrl(u), items: [text(l.text, { color: "Accent" })] } : small(l.text);
        }),
      ]);
    case "item": {
      const dates = c.start || c.target ? [small(`${c.start ?? "No start"} to ${c.target ?? "no target"}`)] : [];
      const kids = c.children.map((k) => small(`#${k.id} ${k.title} · ${k.state}${k.owner ? ` · ${k.owner}` : ""}`));
      return card([title(`#${c.id} ${c.title}`), muted(`${c.clientName} · ${c.type} · ${c.state} · ${c.owner ?? "Unassigned"}`), ...dates, ...kids], actions(...cardLinks(c)));
    }
    case "block":
      return card([title(`${c.clientName} · ${c.date} ${c.half}`), muted(`${c.time} · ${c.status}`), ...c.picks.map((p) => small(`${p.done ? "✓ " : "• "}${p.title} (${p.size})`))], actions(c.link));
    case "pick":
      return card([title(`${c.done ? "Done: " : ""}${c.title}`), muted(`${c.clientName} · ${c.date} ${c.half}${c.time ? ` · ${c.time}` : ""}`)], actions(c.link));
    case "send":
      return card([title(c.title), muted(`${c.clientName} · ${c.from} to ${c.to} · ${c.tier === "must" ? "Must" : "Suggested"} · week of ${c.weekStart} · ${c.state}`)], actions(c.link));
    case "promise":
      return card([title(c.what), muted(`${c.clientName} · ${c.who}${c.toWhom ? ` to ${c.toWhom}` : ""}${c.due ? ` · due ${c.due}` : ""}`)], actions(c.link));
    case "question":
    case "suggest":
      return null;
    default: {
      const none: never = c;
      return none;
    }
  }
}

/** A question or the suggested steps, for questionCard's buttons. */
export function renderQuestion(c: AsCard): Question | null {
  if (c.kind !== "question" && c.kind !== "suggest") return null;
  return { text: c.text, choices: c.choices, expiresAt: c.expiresAt, ...(c.kind === "suggest" ? { suggest: true } : {}), ...(c.asked !== undefined ? { asked: c.asked } : {}) };
}

export type Rendered = {
  /** The reply's words, sent with the cards. */
  text: string;
  cards: Card[];
  question: Question | null;
  /** How many parts didn't fit and are behind "Open in FocusTime". */
  hidden: number;
};

const size = (c: Card) => JSON.stringify(c).length;

/** The Assistant's answer as Teams messages: its words, one card per part, the links, and what to do with what's left over. */
export function renderAnswer(r: Pick<AsResult, "turnId" | "reply" | "cards" | "links">, publicUrl: string): Rendered {
  const cards: Card[] = [];
  let bytes = 0;
  let hidden = 0;
  for (const c of r.cards) {
    const shown = renderCard(c, publicUrl);
    if (!shown) continue;
    const s = size(shown);
    if (cards.length >= MAX_RESULT_CARDS || bytes + s > MAX_MESSAGE_BYTES) {
      hidden++;
      continue;
    }
    bytes += s;
    cards.push(shown);
  }
  const bottom = urls(r.links, publicUrl).map(openUrl);
  if (hidden) cards.push(card([muted(`${hidden} more ${hidden === 1 ? "part" : "parts"} of this answer ${hidden === 1 ? "doesn't" : "don't"} fit here.`)], [openUrl({ label: "Open in FocusTime", url: askLink(publicUrl, r.turnId) })]));
  if (bottom.length) {
    const last = cards.at(-1);
    if (last) last.actions = [...(last.actions ?? []), ...bottom].slice(0, 6);
    else cards.push(card([muted("In FocusTime")], bottom));
  }
  const q = r.cards.map(renderQuestion).find((x) => x !== null) ?? null;
  return { text: r.reply, cards, question: q, hidden };
}
