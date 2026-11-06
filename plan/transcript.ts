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
  /** Seconds from the start of the meeting (0 when the source has no times). */
  at: number;
  text: string;
};

/** The most lines kept from one transcript (a long meeting merges to far fewer). */
export const MAX_LINES = 4000;
/** The longest one line may be after merging; longer is split at a sentence end. */
export const MAX_LINE_CHARS = 1200;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "00:01:02.345" or "01:02.345" (or with a comma) → seconds; null for anything else. */
export function timeOf(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? "0").padEnd(3, "0")) / 1000;
}

type Cue = { speaker: string; at: number; text: string };

/** Merge consecutive cues of one speaker, split overlong lines, number them. */
export function linesOf(cues: readonly Cue[]): TranscriptLine[] {
  const merged: Cue[] = [];
  for (const c of cues) {
    const text = clean(c.text);
    if (!text) continue;
    const speaker = clean(c.speaker) || "Unknown";
    const last = merged.at(-1);
    if (last && last.speaker === speaker && last.text.length + text.length + 1 <= MAX_LINE_CHARS) last.text = `${last.text} ${text}`;
    else merged.push({ speaker, at: Math.max(0, Math.floor(c.at)), text });
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
    const v = /<v(?:\.[^\s>]*)?\s+([^>]*)>/.exec(raw);
    if (v) speaker = v[1]!;
    else {
      const named = /^([^:<>]{1,80}):\s+(.*)$/.exec(raw);
      if (named) {
        speaker = named[1]!;
        words = named[2]!;
      }
    }
    words = decode(words.replace(/<[^>]*>/g, ""));
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
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0].replace(/<w:(tab|br)\b[^>]*\/>/g, " ");
    const runs = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((r) => decode(r[1]!));
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
export function quotesOf(lines: readonly TranscriptLine[], refs: readonly number[]): { n: number; speaker: string; at: string; text: string }[] {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const picked = [...new Set(refs)].filter((n) => byN.has(n)).sort((a, b) => a - b).slice(0, QUOTE_LINES);
  return picked.map((n) => {
    const l = byN.get(n)!;
    return { n, speaker: l.speaker, at: clock(l.at), text: l.text.length > QUOTE_CHARS ? `${l.text.slice(0, QUOTE_CHARS - 1)}…` : l.text };
  });
}

/** The lines as the AI gets them: "L12 [4:05] Name: words". */
export function numbered(lines: readonly TranscriptLine[]): string {
  return lines.map((l) => `L${l.n} [${clock(l.at)}] ${l.speaker}: ${l.text}`).join("\n");
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
