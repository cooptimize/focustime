// Quick capture (step 9): pure rules, no AI. A client tag (@nickname), a due date read from plain words, and a
// routing suggestion (loop, draft story or note) that I confirm or change. Nothing here does I/O.
import type { IsoDate } from "../week/types.ts";

export type CaptureClient = { clientKey: string; clientName: string };
export type CaptureKind = "loop" | "draft" | "note";

const WEEKDAYS: Record<string, number> = { mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7 };
const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const FULL_DAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const SHORT_DAY = "mon|tues?|weds?|thu(?:rs?)?|fri|sat|sun";
const PREFIX = "(?:by|on|due|before|until)";

const pd = (d: IsoDate) => Temporal.PlainDate.from(d);
/** The coming given weekday (1 = Monday), today when it is that day. */
const coming = (today: Temporal.PlainDate, dow: number) => today.add({ days: (dow - today.dayOfWeek + 7) % 7 });
const nextMonday = (today: Temporal.PlainDate) => today.add({ days: 8 - today.dayOfWeek });

function validDate(y: number, m: number, d: number): Temporal.PlainDate | null {
  try {
    return Temporal.PlainDate.from({ year: y, month: m, day: d }, { overflow: "reject" });
  } catch {
    return null;
  }
}
/** A month and day without a year: this year, or next year once it has passed. */
function upcoming(today: Temporal.PlainDate, m: number, d: number): Temporal.PlainDate | null {
  const thisYear = validDate(today.year, m, d);
  if (!thisYear) return null;
  return Temporal.PlainDate.compare(thisYear, today) < 0 ? validDate(today.year + 1, m, d) : thisYear;
}

type Rule = { re: RegExp; date: (m: RegExpExecArray, today: Temporal.PlainDate) => Temporal.PlainDate | null };
const RULES: Rule[] = [
  { re: new RegExp(`\\b(?:${PREFIX}\\s+)?(\\d{4})-(\\d{2})-(\\d{2})\\b`, "i"), date: (m) => validDate(+m[1]!, +m[2]!, +m[3]!) },
  {
    re: new RegExp(`\\b(?:${PREFIX}\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?(?![\\d/.])`, "i"),
    date: (m, t) => (m[3] ? validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1]!, +m[2]!) : upcoming(t, +m[1]!, +m[2]!)),
  },
  {
    re: new RegExp(`\\b(?:${PREFIX}\\s+)?(${Object.keys(MONTHS).join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"),
    date: (m, t) => (m[3] ? validDate(+m[3], MONTHS[m[1]!.toLowerCase()]!, +m[2]!) : upcoming(t, MONTHS[m[1]!.toLowerCase()]!, +m[2]!)),
  },
  { re: new RegExp(`\\b(?:${PREFIX}\\s+)?(?:today|tonight|eod|end of (?:the )?day)\\b`, "i"), date: (_m, t) => t },
  { re: new RegExp(`\\b(?:${PREFIX}\\s+)?(?:tomorrow|tmrw)\\b`, "i"), date: (_m, t) => t.add({ days: 1 }) },
  { re: new RegExp(`\\b(?:${PREFIX}\\s+)?(?:eow|end of (?:the )?week)\\b`, "i"), date: (_m, t) => coming(t, 5) },
  { re: new RegExp(`\\b(?:${PREFIX}\\s+)?next week\\b`, "i"), date: (_m, t) => nextMonday(t) },
  { re: new RegExp(`\\bnext\\s+(${FULL_DAY}|${SHORT_DAY})\\b`, "i"), date: (m, t) => nextMonday(t).add({ days: WEEKDAYS[m[1]!.toLowerCase()]! - 1 }) },
  // Short day names only after a prefix ("by fri"), so words like "sun" or "sat" alone aren't dates.
  { re: new RegExp(`\\b(?:(?:${PREFIX}|this)\\s+(${FULL_DAY}|${SHORT_DAY})|(${FULL_DAY}))\\b`, "i"), date: (m, t) => coming(t, WEEKDAYS[(m[1] ?? m[2])!.toLowerCase()]!) },
];

/** A due date in plain words ("by Thursday", "tomorrow", "11/14", "Nov 20"), and the phrase it came from. */
export function parseDue(text: string, today: IsoDate): { date: IsoDate; phrase: string } | null {
  const t = pd(today);
  let best: { date: IsoDate; phrase: string; at: number } | null = null;
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (!m) continue;
    const d = r.date(m, t);
    if (d && (!best || m.index < best.at)) best = { date: d.toString(), phrase: m[0], at: m.index };
  }
  return best ? { date: best.date, phrase: best.phrase } : null;
}

const squash = (s: string) => s.replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();

/**
 * The first @tag that names exactly one client (its key or name, any case, or a prefix of three or more letters
 * unique to one client), taken out of the text. An unknown or ambiguous tag is left as text.
 */
export function parseTag(text: string, clients: readonly CaptureClient[]): { clientKey: string | null; text: string } {
  const re = /(^|\s)@([^\s@]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[2]!;
    const word = raw.replace(/[.,;:!?)]+$/, "");
    const tail = raw.slice(word.length);
    const key = matchClient(word, clients);
    if (!key) continue;
    const start = m.index + m[1]!.length;
    return { clientKey: key, text: squash(`${text.slice(0, start)}${tail}${text.slice(start + 1 + raw.length)}`) };
  }
  return { clientKey: null, text };
}

export function matchClient(word: string, clients: readonly CaptureClient[]): string | null {
  const w = word.toLowerCase();
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const exact = clients.filter((c) => c.clientKey.toLowerCase() === w || flat(c.clientName) === w.replace(/\s+/g, ""));
  if (exact.length === 1) return exact[0]!.clientKey;
  if (w.length < 3) return null;
  const pre = clients.filter((c) => c.clientKey.toLowerCase().startsWith(w) || c.clientName.toLowerCase().startsWith(w) || flat(c.clientName).startsWith(w));
  return pre.length === 1 ? pre[0]!.clientKey : null;
}

/** Clients whose key or name starts with what follows a trailing @ (for autocomplete). */
export function tagCompletions(text: string, clients: readonly CaptureClient[]): CaptureClient[] {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
  if (!m) return [];
  const w = m[1]!.toLowerCase();
  return clients.filter((c) => c.clientKey.toLowerCase().startsWith(w) || c.clientName.toLowerCase().startsWith(w));
}

const PROMISE = /\b(?:i'?ll|i will|i'?d|i would|i'm going to|told\s+\S+|promised)\b/i;
const NOTE_MARK = /^\s*(?:fyi|note|idea|thought|remember)\b[:\s-]*/i;
const WORK = /\b(?:stor(?:y|ies)|todo|to-do|need to|needs to)\b/i;
const WORK_LEAD = /^\s*(?:(?:user\s+)?story|todo|to-do|(?:i\s+)?needs?\s+to)\b[:\s-]*/i;
const WHO = /\b(?:[Tt]old|[Pp]romised|[Oo]we|[Aa]sked)\s+([A-Z][\w'-]*(?:\s+(?!I\b|I')[A-Z][\w'-]*)?)/;
const LEADS = /^\s*(?:(?:told|promised)\s+\S+(?:\s+[A-Z][\w'-]*)?\s*)?(?:(?:that\s+)?(?:i'?ll|i will|i'?d|i would|i'm going to)\s+)?/i;

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const clean = (s: string) => cap(squash(s.replace(/^[\s:,-]+|[\s:,.-]+$/g, "")));

export type CaptureSuggestion = {
  kind: CaptureKind;
  clientKey: string | null;
  /** Loop: who it's owed to (a name after "told"/"promised", else the client's name, else empty). */
  who: string;
  /** Loop: what was promised, without the lead-in or the due phrase. */
  what: string;
  due: IsoDate | null;
  /** Draft story: a title without "story:", "todo" or "need to". */
  title: string;
  /** Note: the text as typed (tag taken out; a leading "fyi:" or "note:" too). */
  text: string;
  /** The other two kinds, offered as one-click alternatives. */
  others: CaptureKind[];
};

/**
 * Routing by rules, first match wins: a promise or commitment (I'll, told <name>, promised, or a due date after
 * "by"/"due") is a loop; work for a client (story, todo, need to, or tagged with a client) is a draft story; anything
 * else is a note. A leading "fyi", "note" or "idea" always reads as a note.
 */
export function suggest(text: string, clientKey: string | null, today: IsoDate, clients: readonly CaptureClient[]): CaptureSuggestion {
  const due = parseDue(text, today);
  const name = clientKey ? (clients.find((c) => c.clientKey === clientKey)?.clientName ?? clientKey) : "";
  const noted = NOTE_MARK.test(text);
  const promise = !noted && (PROMISE.test(text) || (!!due && /^(?:by|due|before|until)\b/i.test(due.phrase)));
  const work = !noted && !promise && (WORK.test(text) || !!clientKey);
  const kind: CaptureKind = promise ? "loop" : work ? "draft" : "note";
  const who = WHO.exec(text)?.[1] ?? name;
  const what = clean((due ? text.replace(due.phrase, " ") : text).replace(LEADS, ""));
  const title = clean(text.replace(WORK_LEAD, "").replace(LEADS, ""));
  return { kind, clientKey, who, what, due: due?.date ?? null, title, text: noted ? clean(text.replace(NOTE_MARK, "")) : squash(text), others: (["loop", "draft", "note"] as const).filter((k) => k !== kind) };
}
