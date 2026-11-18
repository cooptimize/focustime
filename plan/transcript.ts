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

/** Merge consecutive cues of one speaker, split overlong lines, number them. */
export function linesOf(cues: readonly Cue[]): TranscriptLine[] {
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
    if (out.length >= MAX_LINES) break;
  }
  return out.slice(0, MAX_LINES).map((l, i) => ({ ...l, n: i + 1 }));
}

/**
 * WebVTT as Teams and Graph write it: cues of "start --> end" then the text, the speaker as a voice tag
 * (`<v Name>words</v>`) or, in older files, "Name: words". Notes, styles and cue ids are skipped.
 */
export function parseVtt(text: string): TranscriptLine[] {
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
  const lines = linesOf(cues);
  if (!lines.length) throw new TranscriptError("That transcript has no spoken lines");
  return lines;
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
