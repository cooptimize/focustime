// MC-1: a meeting transcript as FocusTime keeps it, from either source: Graph's text/vtt (Automatic) or a file a
// reviewer uploads (.vtt, or the .docx Teams' meeting recap offers). Both parse into the same lines: a speaker, the
// time from the start of the meeting and the words, consecutive cues of one speaker merged. Pure: no I/O. The .docx
// container (a zip) is opened in actions/transcript-file.ts; this file reads its word/document.xml.
//
// Transcripts are client data: never logged, never in an error message. Nothing here logs.

export type TranscriptLine = {
  /** 1-based, stable for the stored transcript: what proposals refer to. */
  n: number;
  speaker: string;
  /**
   * Seconds from the start of the meeting; PK-1: null when the source has no times (a Pocket export), and then nothing
   * shows or sends a time for the line, never a made-up one.
   */
  at: number | null;
  text: string;
};

/** The most lines kept from one transcript (a long meeting merges to far fewer). */
export const MAX_LINES = 4000;
/** The longest one line may be after merging; longer is split at a sentence end. */
export const MAX_LINE_CHARS = 1200;

/** A character reference's character; one past Unicode's end is the replacement mark, never an error (PK-1 review). */
const charOf = (n: number) => (n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd");

/**
 * Every `<open ...>...</close>` in order, by plain scans (PK-1 review: a lazy regex over an unclosed tag is quadratic,
 * so 1 MB of "<w:p " held the server for over a minute). An open tag with no close after it ends the scan: none later
 * can close either.
 */
function blocks(s: string, open: RegExp, close: string): string[] {
  const out: string[] = [];
  const re = new RegExp(open.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const end = s.indexOf(close, m.index + m[0].length);
    if (end < 0) break;
    out.push(s.slice(m.index, end + close.length));
    re.lastIndex = end + close.length;
  }
  return out;
}

/** A cue's voice tag, `<v Name>` or `<v.class Name>`: the first one, by plain scans. */
function voiceOf(raw: string): string | null {
  const i = raw.search(/<v[\s.]/);
  if (i < 0) return null;
  const j = raw.indexOf(">", i);
  if (j < 0) return null;
  const m = /^(?:\.\S*)?\s+([\s\S]*)$/.exec(raw.slice(i + 2, j));
  return m ? m[1]! : null;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d{1,8});/g, (_, d: string) => charOf(Number(d)))
    .replace(/&#x([0-9a-f]{1,8});/gi, (_, h: string) => charOf(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "00:01:02.345" or "01:02.345" (or with a comma) → seconds; null for anything else. */
export function timeOf(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? "0").padEnd(3, "0")) / 1000;
}

type Cue = { speaker: string; at: number | null; text: string };

/** Merge consecutive cues of one speaker, split overlong lines, number them (at most `cap` lines; MC-7 counts past it). */
export function linesOf(cues: readonly Cue[], cap = MAX_LINES): TranscriptLine[] {
  const merged: Cue[] = [];
  for (const c of cues) {
    const text = clean(c.text);
    if (!text) continue;
    const speaker = clean(c.speaker) || "Unknown";
    const last = merged.at(-1);
    if (last && last.speaker === speaker && last.text.length + text.length + 1 <= MAX_LINE_CHARS) last.text = `${last.text} ${text}`;
    else merged.push({ speaker, at: c.at === null ? null : Math.max(0, Math.floor(c.at)), text });
  }
  const out: TranscriptLine[] = [];
  for (const c of merged) {
    let rest = c.text;
    while (rest.length > MAX_LINE_CHARS) {
      const cut = rest.lastIndexOf(". ", MAX_LINE_CHARS);
      const at = cut > MAX_LINE_CHARS / 2 ? cut + 1 : MAX_LINE_CHARS;
      out.push({ n: 0, speaker: c.speaker, at: c.at, text: rest.slice(0, at).trim() });
      rest = rest.slice(at).trim();
    }
    if (rest) out.push({ n: 0, speaker: c.speaker, at: c.at, text: rest });
    if (out.length >= cap) break;
  }
  return out.slice(0, cap).map((l, i) => ({ ...l, n: i + 1 }));
}

/**
 * WebVTT as Teams and Graph write it: cues of "start --> end" then the text, the speaker as a voice tag
 * (`<v Name>words</v>`) or, in older files, "Name: words". Notes, styles and cue ids are skipped.
 */
export function parseVtt(text: string): TranscriptLine[] {
  const lines = linesOf(vttCues(text));
  if (!lines.length) throw new TranscriptError("That transcript has no spoken lines");
  return lines;
}

function vttCues(text: string): Cue[] {
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT/.test(body.trimStart())) throw new TranscriptError("That isn't a WebVTT file");
  const cues: Cue[] = [];
  for (const block of body.split(/\n{2,}/)) {
    const rows = block.split("\n").filter((r) => r.trim());
    const ti = rows.findIndex((r) => r.includes("-->"));
    if (ti < 0) continue;
    const at = timeOf(rows[ti]!.split("-->")[0]!.trim()) ?? 0;
    const raw = rows.slice(ti + 1).join(" ");
    let speaker = "";
    let words = raw;
    const v = voiceOf(raw);
    if (v !== null) speaker = v;
    else {
      const named = /^([^:<>]{1,80}):\s+(.*)$/.exec(raw);
      if (named) {
        speaker = named[1]!;
        words = named[2]!;
      }
    }
    words = decode(words.replace(/<[^<>]*>/g, ""));
    cues.push({ speaker: decode(speaker), at, text: words });
  }
  return cues;
}

/**
 * The document.xml of a Teams transcript .docx: one paragraph per cue, the speaker and time ("Name   0:03") in one
 * paragraph and the words in the next, or "Name 0:03" followed by the words in the same paragraph. Paragraphs are
 * <w:p>, text runs <w:t>, tabs and breaks become spaces.
 */
export function parseDocxXml(xml: string): TranscriptLine[] {
  const paras: string[] = [];
  for (const para of blocks(xml, /<w:p[ >]/, "</w:p>")) {
    const p = para.replace(/<w:(tab|br)\b[^<>]*\/>/g, " ");
    const runs = blocks(p, /<w:t(?:\s[^<>]*)?>/, "</w:t>").map((r) => decode(r.slice(r.indexOf(">") + 1, -"</w:t>".length)));
    const t = clean(runs.join(""));
    if (t) paras.push(t);
  }
  // A heading line: a name, then a time (h:mm:ss or m:ss), optionally the end of a range.
  const HEAD = /^(.{1,80}?)\s+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*(.*)$/;
  const cues: Cue[] = [];
  let cur: Cue | null = null;
  for (const p of paras) {
    const h = HEAD.exec(p);
    if (h && /\p{L}/u.test(h[1]!)) {
      if (cur) cues.push(cur);
      cur = { speaker: h[1]!, at: timeOf(h[2]!) ?? 0, text: h[3] ?? "" };
    } else if (cur) cur.text = `${cur.text} ${p}`;
  }
  if (cur) cues.push(cur);
  const lines = linesOf(cues);
  if (!lines.length) throw new TranscriptError("That document doesn't look like a Teams transcript");
  return lines;
}

export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptError";
  }
}

/** "1:02:03" or "2:03": a line's time as the review shows it. */
export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** MC-6: the seconds in a "1:02:03" or "2:03" time (the reverse of clock), or null for "" or anything else. */
export function secondsOf(at: string): number | null {
  const m = /^(?:(\d+):)?(\d+):(\d\d)$/.exec(at.trim());
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Quotes for a proposal: at most 2 of the cited lines (in range, in order), each cut to 200 characters. */
export const QUOTE_LINES = 2;
export const QUOTE_CHARS = 200;
/** A quote's time ("4:05"), or "" for a line with none (PK-1: a Pocket export's lines). */
export const atOf = (l: Pick<TranscriptLine, "at">) => (l.at === null ? "" : clock(l.at));
export function quotesOf(lines: readonly TranscriptLine[], refs: readonly number[]): { n: number; speaker: string; at: string; text: string }[] {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const picked = [...new Set(refs)].filter((n) => byN.has(n)).sort((a, b) => a - b).slice(0, QUOTE_LINES);
  return picked.map((n) => {
    const l = byN.get(n)!;
    return { n, speaker: l.speaker, at: atOf(l), text: l.text.length > QUOTE_CHARS ? `${l.text.slice(0, QUOTE_CHARS - 1)}…` : l.text };
  });
}

/** The lines as the AI gets them: "L12 [4:05] Name: words"; PK-1: "L12 Speaker 1: words" for a line with no time. */
export function numbered(lines: readonly TranscriptLine[]): string {
  return lines.map((l) => `L${l.n}${l.at === null ? "" : ` [${clock(l.at)}]`} ${l.speaker}: ${l.text}`).join("\n");
}

/** Rough tokens of a text (4 characters a token), for chunking. */
export const tokensOf = (s: string) => Math.ceil(s.length / 4);

/** One request takes the whole transcript up to this; past it, windows of WINDOW_TOKENS overlapping by OVERLAP lines. */
export const ONE_REQUEST_TOKENS = 40_000;
export const WINDOW_TOKENS = 25_000;
export const OVERLAP_LINES = 20;

/** The windows a transcript is sent in: one for a normal meeting, overlapping windows for a very long one. */
export function windowsOf(lines: readonly TranscriptLine[]): TranscriptLine[][] {
  if (tokensOf(numbered(lines)) <= ONE_REQUEST_TOKENS) return [lines.slice()];
  const out: TranscriptLine[][] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let tokens = 0;
    while (end < lines.length && tokens <= WINDOW_TOKENS) tokens += tokensOf(numbered([lines[end++]!]));
    out.push(lines.slice(start, end));
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - OVERLAP_LINES);
  }
  return out;
}

/**
 * MC-2c: a chat call's transcripts (more than one when transcription stopped and started) as one transcript, in time
 * order: each piece parsed (text/vtt, or Graph's format without speaker names, which has no WEBVTT header), its times
 * moved on by how long after the first piece it started (or after the previous piece's last line when that isn't
 * known), then numbered again. A piece with no spoken lines is skipped; none at all is a TranscriptError.
 */
export function joinTranscriptParts(parts: readonly { createdAt: string | null; text: string }[], named = true): TranscriptLine[] {
  const first = parts.find((p) => p.createdAt)?.createdAt ?? null;
  const out: TranscriptLine[] = [];
  for (const p of parts) {
    let text = /^﻿?\s*WEBVTT/.test(p.text) ? p.text : `WEBVTT\n\n${p.text}`;
    // Without speaker names, nothing in a line is taken for a speaker ("Note: ..." stays words): an empty voice tag.
    if (!named) text = unnamedCues(text);
    let lines: TranscriptLine[];
    try {
      // Without names, each cue stays its own line (one speaker would join them all): numbered while parsing, then Unknown.
      lines = parseVtt(text).map((l) => (named ? l : { ...l, speaker: "Unknown" }));
    } catch (e) {
      if (e instanceof TranscriptError) continue;
      throw e;
    }
    const after = out.reduce((m, l) => Math.max(m, l.at ?? 0), 0);
    const shift = first && p.createdAt ? Math.max(0, Math.round((Date.parse(p.createdAt) - Date.parse(first)) / 1000)) : out.length ? after + 1 : 0;
    for (const l of lines) out.push({ ...l, at: l.at === null ? null : l.at + shift });
  }
  if (!out.length) throw new TranscriptError("That transcript has no spoken lines");
  return out.slice(0, MAX_LINES).map((l, i) => ({ ...l, n: i + 1 }));
}

/**
 * Graph's format without speaker names ("start --> end", then the words, sometimes after a blank line, as Microsoft's
 * example shows) as WebVTT cues whose words sit behind a numbered voice tag (each cue its own line; the caller names
 * them all Unknown), so the "Name: words" reading never names a speaker from the words.
 */
function unnamedCues(text: string): string {
  const cues: { time: string; words: string[] }[] = [];
  for (const row of text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const r = row.trim();
    if (!r || /^WEBVTT/.test(r)) continue;
    if (r.includes("-->")) cues.push({ time: r, words: [] });
    else cues.at(-1)?.words.push(r);
  }
  return `WEBVTT\n\n${cues.filter((c) => c.words.length).map((c, i) => `${c.time}\n<v Cue ${i + 1}>${c.words.join(" ")}`).join("\n\n")}\n`;
}

// ---- MC-7: a transcript or notes pasted into a call ----

/** What a pasted text is taken for: a transcript (speakers, perhaps times) or the reviewer's own notes. */
export type PasteAs = "transcript" | "notes";

/** The most a pasted text may be: what a file may be (5 MB), and at most MAX_LINES lines once read. */
export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
/** The least: a few words. */
export const PASTE_MIN_WORDS = 3;

/** "Speaker 1", "Speaker B", "Participant 2": a voice numbered or lettered by a tool, not a person (as Pocket's). */
const NUMBERED = /^(?:speaker|participant|voice|person|guest|unknown speaker|unidentified speaker)\s*(?:\d{1,3}|[a-z])$/i;
export const numberedSpeaker = (s: string) => NUMBERED.test(s.trim());

/** Words people put before a colon in notes, which are never a speaker ("Decision: CSV only"). Compared in lower case. */
const NOT_NAMES = new Set(["action", "actions", "action item", "action items", "agenda", "attendees", "background", "blocker", "blockers", "cc", "context", "date", "decision", "decisions", "done", "due", "eta", "follow up", "follow-up", "follow ups", "fyi", "goal", "goals", "idea", "ideas", "issue", "issues", "item", "items", "link", "next", "next step", "next steps", "note", "notes", "open", "outcome", "owner", "problem", "ps", "q", "question", "questions", "re", "risk", "risks", "status", "subject", "summary", "time", "to do", "todo", "topic", "topics", "update", "updates", "when", "where", "who", "why", "what", "how", "wip", "http", "https"]);
/** Lower-case words a name may hold (van, de, bin). */
const PARTICLES = new Set(["al", "bin", "da", "de", "del", "der", "di", "du", "la", "le", "van", "von"]);

/** A speaker as pasted: a name of one to five words, each capitalised (or a particle), or a numbered voice. */
function nameOf(s: string): string | null {
  const t = clean(s);
  if (!t || t.length > 60) return null;
  if (numberedSpeaker(t)) return t;
  if (NOT_NAMES.has(t.toLowerCase())) return null;
  const words = t.split(" ");
  if (words.length > 5) return null;
  if (!words.every((w) => /^[\p{L}][\p{L}\p{M}'’.\-]*$/u.test(w) && (/^\p{Lu}/u.test(w) || PARTICLES.has(w)))) return null;
  return t;
}

/** A time in pasted text: "0:03", "00:01:02", "1:02.5", in brackets or parentheses; a clock time ("10:03 AM") is no time into the call. */
const T = String.raw`[\[(]?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(\s*[AaPp]\.?[Mm]\.?)?[\])]?`;
const TIME_ONLY = new RegExp(String.raw`^${T}(?:\s*-->\s*${T})?$`);
const TIME_FIRST = new RegExp(String.raw`^${T}\s*[-–|]?\s*(.+?)\s*:\s*(.*)$`);
const NAME_FIRST = new RegExp(String.raw`^(.+?)\s*(?:[-–|,]\s*)?(?:${T})?\s*:\s*(.*)$`);
const HEAD_NAME_TIME = new RegExp(String.raw`^(.+?)\s*[-–|,]?\s*${T}$`);
const HEAD_TIME_NAME = new RegExp(String.raw`^${T}\s*[-–|]?\s*(.+)$`);
/** The seconds of a matched time, or null for a clock time (AM or PM). */
const secOf = (t: string | undefined, ampm: string | undefined) => (t && !ampm ? timeOf(t) : null);

/** `timed`: the line had a time, even a clock time that isn't kept. */
type Row = { kind: "said" | "head"; speaker: string; at: number | null; timed: boolean; text: string } | { kind: "time"; at: number | null } | { kind: "text"; text: string };

function rowOf(line: string, next: string | undefined): Row {
  let m = TIME_ONLY.exec(line);
  if (m) return { kind: "time", at: secOf(m[1], m[2]) };
  m = TIME_FIRST.exec(line);
  if (m) {
    const who = nameOf(m[3]!);
    if (who) return { kind: m[4]!.trim() ? "said" : "head", speaker: who, at: secOf(m[1], m[2]), timed: true, text: m[4]! };
  }
  m = NAME_FIRST.exec(line);
  if (m) {
    const who = nameOf(m[1]!);
    if (who) return { kind: m[4]!.trim() ? "said" : "head", speaker: who, at: secOf(m[2], m[3]), timed: !!m[2], text: m[4]! };
  }
  m = HEAD_NAME_TIME.exec(line);
  if (m) {
    const who = nameOf(m[1]!);
    if (who) return { kind: "head", speaker: who, at: secOf(m[2], m[3]), timed: true, text: "" };
  }
  m = HEAD_TIME_NAME.exec(line);
  if (m) {
    const who = nameOf(m[3]!);
    if (who) return { kind: "head", speaker: who, at: secOf(m[1], m[2]), timed: true, text: "" };
  }
  // A name alone, its time on the next line (as Teams' transcript pane copies).
  if (next !== undefined && TIME_ONLY.test(next)) {
    const who = nameOf(line);
    if (who) return { kind: "head", speaker: who, at: null, timed: true, text: "" };
  }
  return { kind: "text", text: line };
}

/** What reading a pasted text gives: its lines, how many speakers, and the counts that decide which reading it is. */
export type PasteRead = { as: PasteAs; lines: TranscriptLine[]; speakers: number; numbered: boolean; tooLong: boolean; tooShort: boolean };

/**
 * A pasted transcript's cues, as a file's would be: a pasted .vtt as the .vtt; otherwise each line is "Name: words",
 * a name and a time with the words under it, a time then a name then words, or a numbered voice; a time alone sets the
 * next speaker's; a line that fits no shape joins the line before it. Also how many lines carried a speaker (`marked`),
 * how many of those are sure (their speaker comes back, or they have a time), and how many didn't (`loose`).
 */
function pastedCues(text: string): { cues: Cue[]; marked: number; sure: number; loose: number; vtt: boolean } {
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (/^WEBVTT/.test(body.trimStart())) {
    const cues = vttCues(body);
    return { cues, marked: cues.length, sure: cues.length, loose: 0, vtt: true };
  }
  const rows = body.split("\n").map(clean).filter(Boolean);
  const cues: Cue[] = [];
  let cur: Cue | null = null;
  let underHead = false;
  let pending: number | null = null;
  let loose = 0;
  const marks: { speaker: string; timed: boolean }[] = [];
  for (let i = 0; i < rows.length; i++) {
    // A cue's number on its own line before a time (an .srt or a .vtt without its header): skipped.
    if (/^\d{1,5}$/.test(rows[i]!) && rows[i + 1] !== undefined && TIME_ONLY.test(rows[i + 1]!)) continue;
    const r = rowOf(rows[i]!, rows[i + 1]);
    if (r.kind === "time") {
      // Right under a name with no words yet: that name's time (a name alone, its time on the next line).
      if (cur && underHead && !cur.text && cur.at === null) cur.at = r.at;
      else pending = r.at;
      continue;
    }
    if (r.kind === "text") {
      if (!underHead) loose++;
      if (cur) cur.text = `${cur.text} ${r.text}`;
      else cues.push((cur = { speaker: "Unknown", at: pending, text: r.text }));
      continue;
    }
    const at = r.at ?? pending;
    pending = null;
    cues.push((cur = { speaker: r.speaker, at, text: r.text }));
    underHead = r.kind === "head";
    marks.push({ speaker: r.speaker.toLowerCase(), timed: r.timed || at !== null });
  }
  const seen = new Map<string, number>();
  for (const x of marks) seen.set(x.speaker, (seen.get(x.speaker) ?? 0) + 1);
  const sure = marks.filter((x) => x.timed || (seen.get(x.speaker) ?? 0) > 1).length;
  return { cues, marked: marks.length, sure, loose, vtt: false };
}

/** Notes: each line the reviewer wrote, bullet marks and blank lines dropped; no speaker, no time. */
function noteLines(text: string, cap: number): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const row of text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")) {
    let rest = clean(row.replace(/^\s*(?:[-*•‣◦▪●○·–—>]+|\d{1,3}[.)]|[a-zA-Z][.)]|\[[ xX]?\])\s+/, ""));
    while (rest.length > MAX_LINE_CHARS) {
      const cut = rest.lastIndexOf(". ", MAX_LINE_CHARS);
      const at = cut > MAX_LINE_CHARS / 2 ? cut + 1 : MAX_LINE_CHARS;
      out.push({ n: 0, speaker: "", at: null, text: rest.slice(0, at).trim() });
      rest = rest.slice(at).trim();
    }
    if (rest) out.push({ n: 0, speaker: "", at: null, text: rest });
    if (out.length > cap) break;
  }
  return out.slice(0, cap).map((l, i) => ({ ...l, n: i + 1 }));
}

/**
 * MC-7: a pasted text read as a transcript or as notes. Without `as`, it is taken for a transcript when most of its
 * lines carry a speaker (a pasted .vtt always), at least two do, and most of those are sure (the speaker speaks again,
 * or the line has a time); otherwise for notes. `tooLong`: over MAX_LINES lines (or the bytes a file may be);
 * `tooShort`: fewer than a few words. Speakers' names are kept as pasted; `numbered` when any is a numbered voice.
 */
export function readPaste(text: string, as?: PasteAs): PasteRead {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const bytes = new TextEncoder().encode(text).length;
  const c = pastedCues(text);
  const looks: PasteAs = c.vtt || (c.marked >= 2 && c.marked >= c.loose && c.sure * 2 >= c.marked) ? "transcript" : "notes";
  const took = as ?? looks;
  const lines = took === "transcript" ? linesOf(c.cues, MAX_LINES + 1) : noteLines(text, MAX_LINES + 1);
  const speakers = took === "transcript" ? new Set(lines.map((l) => l.speaker).filter((s) => s !== "Unknown")) : new Set<string>();
  return {
    as: took,
    lines: lines.slice(0, MAX_LINES),
    speakers: speakers.size,
    numbered: [...speakers].some(numberedSpeaker),
    tooLong: lines.length > MAX_LINES || bytes > MAX_TRANSCRIPT_BYTES,
    tooShort: words < PASTE_MIN_WORDS || !lines.length,
  };
}
