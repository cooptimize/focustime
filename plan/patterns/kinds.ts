// WP-2: the kind of work each work item type holds, per client: Build work, Tickets and support, or Leave out. The page
// guesses from the data and shows the numbers behind the guess; a person can change any type's kind, and that choice is
// kept for later runs. Pure.
//
// The guess: a type is Tickets and support when it looks like a queue: a leaf (few of its items have children), mostly
// without a parent, mostly created and closed the same day, and large in number. Everything else is Build work. Leave
// out is never guessed: only a person chooses it.
import { PARENT_SHARE, typeLinks } from "./levels.ts";
import type { PatternItem } from "./types.ts";

export type Kind = "build" | "tickets" | "leave_out";
export const KINDS: readonly Kind[] = ["build", "tickets", "leave_out"];
export const KIND_WORDS: Record<Kind, string> = { build: "Build work", tickets: "Tickets and support", leave_out: "Leave out" };

/** The thresholds of the guess, stated on the page. */
export const TICKET_RULE = { noParent: 0.8, sameDay: 0.5, minItems: 50, minShare: 0.25, minClosed: 10 } as const;
export const TICKET_RULE_WORDS = "Guessed Tickets and support when a type has few children, at least 80% of its items have no parent, at least half of its closed items closed the day they were created, and it has at least 50 items and a quarter of the client's items. Everything else is guessed Build work.";

export type KindFacts = {
  type: string;
  items: number;
  /** Share of the client's items in scope. */
  share: number;
  /** Shares of this type's items: with a child of another type, with no parent of another type. */
  withChildren: number;
  noParent: number;
  /** Of its closed items, the share created and closed the same day (null: none closed). */
  sameDay: number | null;
  closed: number;
  guess: Kind;
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The facts and the guess for every type among a client's items in scope (`all` also holds parents read for structure). */
export function kindFacts(all: readonly PatternItem[]): KindFacts[] {
  const items = all.filter((i) => i.inWindow);
  const links = typeLinks(all);
  const types = [...new Set(items.map((i) => i.type))];
  return types
    .map((type): KindFacts => {
      const of = items.filter((i) => i.type === type);
      const l = links.get(type) ?? { items: of.length, withChildren: 0, withParent: 0 };
      const closed = of.filter((i) => i.facts.closed && i.createdAt && i.closedAt);
      const same = closed.filter((i) => i.createdAt!.slice(0, 10) === i.closedAt!.slice(0, 10)).length;
      const f = { type, items: of.length, share: items.length ? r3(of.length / items.length) : 0, withChildren: l.items ? r3(l.withChildren / l.items) : 0, noParent: l.items ? r3(1 - l.withParent / l.items) : 1, sameDay: closed.length ? r3(same / closed.length) : null, closed: closed.length };
      return { ...f, guess: guessKind(f) };
    })
    .sort((a, b) => b.items - a.items || a.type.localeCompare(b.type));
}

export function guessKind(f: Omit<KindFacts, "guess">): Kind {
  const queue = f.withChildren < PARENT_SHARE && f.noParent >= TICKET_RULE.noParent && f.closed >= TICKET_RULE.minClosed && (f.sameDay ?? 0) >= TICKET_RULE.sameDay && f.items >= TICKET_RULE.minItems && f.share >= TICKET_RULE.minShare;
  return queue ? "tickets" : "build";
}

/** The numbers behind a guess, in plain words. */
export function guessWords(f: KindFacts): string {
  const p = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
  return `${f.items} item${f.items === 1 ? "" : "s"} (${p(f.share)} of the client's) · ${p(f.withChildren)} with children · ${p(f.noParent)} with no parent · ${f.closed ? `${p(f.sameDay)} of ${f.closed} closed the day they were created` : "none closed"}`;
}

/** Each type's kind: the person's choice when there is one, else the guess. */
export function kindsOf(facts: readonly KindFacts[], chosen: Readonly<Record<string, Kind>>): Record<string, Kind> {
  const out: Record<string, Kind> = {};
  for (const f of facts) out[f.type] = chosen[f.type] ?? f.guess;
  for (const [t, k] of Object.entries(chosen)) out[t] ??= k;
  return out;
}

/** An item's kind, by its type (a type not seen yet is Build work). */
export const kindOfType = (kinds: Readonly<Record<string, Kind>>, type: string): Kind => kinds[type] ?? "build";
