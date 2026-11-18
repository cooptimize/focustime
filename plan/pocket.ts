// PK-1: a Pocket export's text → a transcript's lines. Pure: no I/O. The PDF itself is opened in a worker thread
// (server/pdf-text.ts); this file gets its text as lines, top to bottom, page after page, and reads them.
//
// What Pocket's export holds (one invented example in the tests; the real one seen on Nov 17, 2026): on the first page
// the date and the recording's length at the top right ("Nov 16, 2026 • 27:02"), a title line, then the heading
// "Transcript", then turns. A turn starts with Pocket's label, SPEAKER_ and a number, then a colon, then words that
// wrap across lines and pages. No time on any turn, no names, no page numbers.
//
// The rules (decisions under "PK-1"): only what follows the "Transcript" heading is transcript (with no heading, what
// follows the first label). A turn starts only at a label Pocket writes; every other line belongs to the turn before
// it, so a wrapped line holding a colon is never a speaker. Labels show as "Speaker 1", "Speaker 2" in the order of
// Pocket's numbers. The title is never kept. Nothing here guesses who a speaker is, and nothing here logs.
import { linesOf, TranscriptError, type TranscriptLine } from "./transcript.ts";
import type { IsoDate } from "../week/types.ts";

/** A text item as pdf.js gives it: the string, its matrix (x at 4, y at 5) and width. */
export type PdfItem = { str: string; transform: number[]; width: number; hasEOL?: boolean };

/** One page's text items → its lines, top to bottom, each left to right (items on one baseline are one line). */
export function pageLines(items: readonly PdfItem[]): string[] {
  const rows: { y: number; parts: { x: number; w: number; s: string; size: number }[] }[] = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
    const y = Number(it.transform[5]);
    const x = Number(it.transform[4]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let row = rows.find((r) => Math.abs(r.y - y) < 2);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, w: Number(it.width) || 0, s: it.str, size: Math.abs(Number(it.transform[3]) || Number(it.transform[0]) || 10) });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let out = "";
      let end = -Infinity;
      for (const p of r.parts) {
        // A gap wider than a fifth of the text's size between two pieces is a space the PDF didn't write.
        if (out && !/\s$/.test(out) && !/^\s/.test(p.s) && p.x - end > p.size * 0.2) out += " ";
        out += p.s;
        end = p.x + p.w;
      }
      return out.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

/** Pocket's label at the start of a line: SPEAKER_ and a number, a colon, then the turn's first words. */
export const POCKET_LABEL = /^SPEAKER_(\d{1,4})\s*:\s*(.*)$/;
const HEADING = /^transcript$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "Nov 16, 2026 • 27:02" (the length is optional; a middle dot or bullet between). */
const RECORDED = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})(?:\s*[•·|-]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}))?/;

/** What the export says about the recording: its date and its length as written ("27:02"); never its title. */
export type Recorded = { date: IsoDate; length: string | null };

export function recordedOf(header: readonly string[]): Recorded | null {
  for (const l of header) {
    const m = RECORDED.exec(l);
    if (!m) continue;
    const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
    try {
      const date = Temporal.PlainDate.from({ year: Number(m[3]), month, day: Number(m[2]) }, { overflow: "reject" }).toString();
      return { date, length: m[4] ?? null };
    } catch {
      continue;
    }
  }
  return null;
}

/** The text has no words at all: a scan, or a PDF of pictures. */
export class NoTextError extends TranscriptError {}

/** A Pocket export's lines → transcript lines (no times, numbered speakers) and the recording's date and length. */
export function parsePocket(text: readonly string[]): { lines: TranscriptLine[]; recorded: Recorded | null; speakers: number } {
  const rows = text.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!rows.length) throw new NoTextError("That PDF has no text in it: it may be a scan. FocusTime reads a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf)");
  const h = rows.findIndex((l) => HEADING.test(l));
  const firstLabel = rows.findIndex((l, i) => i > h && POCKET_LABEL.test(l));
  const header = rows.slice(0, h >= 0 ? h : Math.max(0, firstLabel));
  const body = firstLabel >= 0 ? rows.slice(firstLabel) : [];
  const turns: { n: number; text: string }[] = [];
  for (const l of body) {
    const m = POCKET_LABEL.exec(l);
    if (m) turns.push({ n: Number(m[1]), text: m[2] ?? "" });
    else turns.at(-1)!.text += ` ${l}`;
  }
  const order = [...new Set(turns.map((t) => t.n))].sort((a, b) => a - b);
  const label = new Map(order.map((n, i) => [n, `Speaker ${i + 1}`]));
  const lines = linesOf(turns.map((t) => ({ speaker: label.get(t.n)!, at: null, text: t.text })));
  if (!lines.length) throw new TranscriptError("FocusTime found no transcript in that PDF. It reads a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf)");
  return { lines, recorded: recordedOf(header), speakers: new Set(lines.map((l) => l.speaker)).size };
}
