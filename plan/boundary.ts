// GD-2: the client boundary, the pure rules (Tanner, Nov 7). Four questions, answered here and nowhere else:
//   chatAudience(members)        who can read a chat: "internal" when every member is a Cooptimizer (home tenant, not a
//                                guest, not an automation account, inside the Cooptimize domains), else "client_facing";
//                                no members known is client-facing (the safe side)
//   mentionedClients(text)       which other clients a text names: whole words, any case, each client's key, its names
//                                and the aliases an admin set (Admin › Clients), never inside a link or an email address
//   replaceMentions(text)        the same text with each other client's name (and, for DevOps text, its projects and
//                                known item ids) as "another client"
//   exitCheck(texts)             what an exit to client eyes would carry: the names, and the text with them replaced
// No client name is written here; every name comes from the directory the caller passes. Nothing logs text or names.
import type { ClientEntry } from "../ai/guard.ts";
import { notCooptimizer } from "./person-match.ts";
import type { ChatMember } from "./chats.ts";

/** What another client's name becomes in AI-written DevOps text and in a one-click replace. */
export const ANOTHER = "another client";
/** The notice on a draft whose AI text had another client's name taken out. */
export const NAME_REMOVED = "Another client's name was removed";
/** The held-back line, for a message in a chat with people outside Cooptimize. */
export const HELD_LINE = "Held back: mentions another client in a chat with people outside Cooptimize.";

/**
 * GD-2 point 5: the line every generator of a client's DevOps text adds to its instructions (Internal's doesn't: its
 * work may name clients). The check after generation (ai/service.ts "scrub") still replaces anything that slips through.
 */
export const NO_OTHER_CLIENTS = "This text goes into one client's DevOps. Never name any other client or company, their projects or their work item ids; where the notes compare with another client, write \"another client\" instead.";

export type Audience = "internal" | "client_facing";

/** The Cooptimizer rule a chat's members are read against (the same rule as Admin › People and every picker). */
export type AudienceRules = {
  /** Cooptimize's Entra tenant id. */
  homeTenant: string | null;
  /** Ids an admin flagged as automation accounts (either id of a person counts). */
  automation: readonly string[];
  /** The Cooptimize email domains (the Rule); empty: tenant and guest only. */
  domains: readonly string[];
  /** A person FocusTime knows who isn't a Cooptimizer by the people rule (a guest, another domain, automation). */
  notCooptimizer?: (userId: string) => boolean;
};

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One member is a Cooptimizer for the audience rule. */
export function memberIsCooptimizer(m: Pick<ChatMember, "userId" | "email" | "tenantId" | "guest">, r: AudienceRules): boolean {
  if (!r.homeTenant || !GUID.test(r.homeTenant)) return false;
  if (m.guest || !m.tenantId || low(m.tenantId) !== low(r.homeTenant)) return false;
  const auto = new Set(r.automation.map(low));
  if (m.userId && auto.has(low(m.userId))) return false;
  if (notCooptimizer({ email: m.email ?? null, automation: false }, r.domains)) return false;
  if (m.userId && r.notCooptimizer?.(m.userId)) return false;
  return true;
}

/** A chat's audience from its current members. Unknown members (never read, or none) are client-facing. */
export function chatAudience(members: readonly ChatMember[] | null | undefined, r: AudienceRules): Audience {
  if (!members?.length) return "client_facing";
  return members.every((m) => memberIsCooptimizer(m, r)) ? "internal" : "client_facing";
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string, flags = "iu") => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w.trim()).replace(/\s+/g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`, flags);
/** Links and email addresses: a name inside one isn't a mention (a SharePoint path, someone's address). */
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/giu;
/** The text with every link and email address blanked (same length, so nothing else moves). */
export const withoutLinks = (text: string) => text.replace(LINK, (m) => " ".repeat(m.length));
/** Whole numbers that could be work item ids: not part of a date, time, amount, decimal or version. */
const NUMBER = /(?<![\w.,$€£/:-])#?(\d{3,})(?![\w%]|[.,/:-]\d)/g;

/** A client's words that count as a mention of it: its key, names and aliases, 3 letters or more. */
export const wordsOf = (c: ClientEntry): string[] => [...new Set([c.key, ...c.names, ...(c.aliases ?? [])].map((w) => w.trim()).filter((w) => w.length >= 3))];

function others(client: string, directory: readonly ClientEntry[]) {
  const own = (k: string) => low(k) === low(client);
  const mine = directory.filter((c) => own(c.key));
  const ownWords = new Set([client, ...mine.flatMap((c) => [...wordsOf(c), ...c.projects])].map(low));
  const ownIds = new Set(mine.flatMap((c) => c.itemIds));
  return { list: directory.filter((c) => !own(c.key)), ownWords, ownIds };
}

export type Mention = { key: string; name: string };

/**
 * The other clients a text names (each once, in directory order): whole words, any case, outside links and email
 * addresses. `records`: also another client's DevOps projects and its known item ids (what an exit checks; a chat
 * message's numbers are left alone, D-GD2 "false matches").
 */
export function mentionedClients(text: string, client: string, directory: readonly ClientEntry[], o: { records?: boolean } = {}): Mention[] {
  const t = withoutLinks(text);
  const { list, ownWords, ownIds } = others(client, directory);
  const numbers = o.records ? new Set([...t.matchAll(NUMBER)].map((m) => Number(m[1]))) : new Set<number>();
  const out: Mention[] = [];
  for (const c of list) {
    if (out.some((x) => low(x.key) === low(c.key))) continue;
    const words = [...wordsOf(c), ...(o.records ? c.projects.filter((p) => p.trim().length >= 3) : [])].filter((w) => !ownWords.has(low(w)));
    const hit = words.some((w) => wordRe(w).test(t)) || (o.records && c.itemIds.some((id) => !ownIds.has(id) && numbers.has(id)));
    if (hit) out.push({ key: c.key, name: c.names[0] ?? c.key });
  }
  return out;
}

/**
 * The text with each other client's words as "another client" (longest first, so "Fab Labs" goes before "Fab"),
 * outside links and email addresses, with how many were replaced. `records`: also their projects and known item ids.
 * A link or address that names another client is replaced whole, by "another client's link".
 */
export function replaceMentions(text: string, client: string, directory: readonly ClientEntry[], o: { records?: boolean; token?: string } = {}): { text: string; count: number } {
  const token = o.token ?? ANOTHER;
  const { list, ownWords, ownIds } = others(client, directory);
  const words = [...new Set(list.flatMap((c) => [...wordsOf(c), ...(o.records ? c.projects : [])]).map((w) => w.trim()))]
    .filter((w) => w.length >= 3 && !ownWords.has(low(w)))
    .sort((a, b) => b.length - a.length);
  const theirIds = new Set(o.records ? list.flatMap((c) => c.itemIds).filter((id) => !ownIds.has(id)) : []);
  let count = 0;
  // Links first, whole: replacing a word inside one would leave a broken link.
  const linkNames = (m: string) => words.some((w) => new RegExp(esc(w).replace(/\s+/g, "[\\s%20+_-]+"), "iu").test(m));
  let out = text.replace(LINK, (m) => (linkNames(m) ? (count++, `${token}'s link`) : m));
  // Then words, outside what's left of links.
  const parts = splitLinks(out);
  out = parts
    .map((p) => {
      if (p.link) return p.text;
      let s = p.text;
      for (const w of words) s = s.replace(wordRe(w, "giu"), (_m, pre: string) => (count++, `${pre}${token}`));
      if (theirIds.size) s = s.replace(NUMBER, (m, d: string) => (theirIds.has(Number(d)) ? (count++, token) : m));
      return s;
    })
    .join("");
  return { text: out, count };
}

function splitLinks(text: string): { text: string; link: boolean }[] {
  const out: { text: string; link: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), link: false });
    out.push({ text: m[0], link: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), link: false });
  return out;
}

/** What an exit preview shows: the other clients named, by name, and each text with them replaced. Empty: nothing to flag. */
export type ExitFlag = { names: string[]; replaced: string[] };

/**
 * GD-2 point 6: one check for every exit to client eyes (Close the loop's posts and emails, DevOps writes into a
 * client's org, the status report's lines). Another client's names, aliases, DevOps projects and known item ids, links
 * and addresses included (text going out is checked whole). Internal targets aren't checked. Null: nothing to flag.
 */
export function exitCheck(texts: readonly string[], client: string, directory: readonly ClientEntry[], o: { internal?: boolean } = {}): ExitFlag | null {
  if (o.internal) return null;
  const names: string[] = [];
  for (const t of texts) {
    for (const m of mentionedClients(t, client, directory, { records: true })) if (!names.includes(m.name)) names.push(m.name);
    // A name inside a link counts at the exit: the link goes out with it.
    const linked = [...t.matchAll(LINK)].map((x) => x[0]).join(" ");
    if (linked) for (const c of others(client, directory).list) if (wordsOf(c).some((w) => new RegExp(esc(w).replace(/\s+/g, "[\\s%20+_-]+"), "iu").test(linked))) {
      const n = c.names[0] ?? c.key;
      if (!names.includes(n)) names.push(n);
    }
  }
  if (!names.length) return null;
  return { names, replaced: texts.map((t) => replaceMentions(t, client, directory, { records: true }).text) };
}

/** "Quiddity", "Quiddity and Fabrikam", "Quiddity, Fabrikam and Contoso". */
export const nameList = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
