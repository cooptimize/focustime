// MC-1, PK-1: an uploaded transcript file → lines. What a file is comes from its content, never its name: a WebVTT
// text, a .docx (a zip whose word/document.xml holds the paragraphs), a PDF (PK-1: a Pocket export), or a zip holding
// one of those (PK-1: Pocket's download). Zips are read here with node:zlib only (no dependency): the central
// directory lists the entries, each local header finds its data, stored or deflated. Nothing is written to disk and
// no entry's name is ever used as a path (names are only compared, for word/document.xml and folders).
//
// Bounds, before anything is read as a transcript: the upload at most MAX_UPLOAD_BYTES (the server's limit). A zip that
// isn't a .docx: at most ZIP_ENTRIES entries and ZIP_UNPACKED bytes unpacked in all (counted as each entry inflates,
// whatever its header says), no archive inside, and exactly one file FocusTime reads; a .docx's document at most
// MAX_XML_BYTES once inflated. A PDF goes to `readPdf` (server/pdf-text.ts: a worker thread, 500 pages, 10 seconds,
// text only). Refusals say what was found by kind and count, never a name or a word. Nothing here logs; the bytes are
// never kept (the lines are what's stored).
import { inflateRawSync } from "node:zlib";
import { NoTextError, parsePocket, type Recorded } from "../plan/pocket.ts";
import { parseDocxXml, parseVtt, TranscriptError, type TranscriptLine } from "../plan/transcript.ts";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_XML_BYTES = 20 * 1024 * 1024;
/** PK-1: a zip that isn't a .docx (Pocket's download): its entries and its unpacked size in all. */
export const ZIP_ENTRIES = 20;
export const ZIP_UNPACKED = 20 * 1024 * 1024;
/** A .docx's own directory is read only to find its document; this bounds the walk. */
const DOCX_ENTRIES = 5000;

export type TranscriptFormat = "vtt" | "docx" | "pocket";

/** PK-1: the PDF reader the server hands in (server/pdf-text.ts). */
export type PdfRead = { ok: true; pages: number; lines: string[] } | { ok: false; reason: "pages" | "locked" | "damaged" | "large" | "slow" | "busy"; pages?: number };
export type ReadPdf = (bytes: Uint8Array) => Promise<PdfRead>;

/** What FocusTime reads, as every refusal ends. */
export const READS = "FocusTime reads a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf)";

/** A refusal with a code for the log (kinds and counts only). */
export class IntakeError extends TranscriptError {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** What a file is, from its first bytes. */
export type Kind = "pdf" | "vtt" | "zip" | "archive" | "other";
export function kindOf(b: Uint8Array): Kind {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x50, 0x4b, 0x03, 0x04) || at(0, 0x50, 0x4b, 0x05, 0x06)) return "zip";
  // A .vtt starts with WEBVTT; checked before the PDF header, which may sit anywhere in the first 1 KB.
  if (new TextDecoder().decode(b.subarray(0, 16)).replace(/^\ufeff/, "").startsWith("WEBVTT")) return "vtt";
  // A PDF's header may follow up to 1024 bytes of something else (the PDF reference allows it).
  const head = new TextDecoder("latin1").decode(b.subarray(0, 1024 + 5));
  if (head.includes("%PDF-")) return "pdf";
  if (at(0, 0x1f, 0x8b) || at(0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) || at(0, 0x52, 0x61, 0x72, 0x21) || at(0, 0x42, 0x5a, 0x68) || at(0, 0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00) || at(0, 0x28, 0xb5, 0x2f, 0xfd) || at(0, 0x50, 0x4b, 0x07, 0x08)) return "archive";
  if (b.length > 262 && new TextDecoder("latin1").decode(b.subarray(257, 262)) === "ustar") return "archive";
  return "other";
}

type Entry = { name: string; method: number; flags: number; csize: number; usize: number; local: number };

const broken = () => new IntakeError("zip_broken", "That zip can't be opened: it may be damaged or locked with a password");

/** A zip's directory, at most `max` entries (more is refused before any is read). */
export function zipDirectory(zip: Uint8Array, max: number): Entry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: the last 22 bytes, or earlier when there is a comment (at most 64 KB).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw broken();
  const count = v.getUint16(eocd + 10, true);
  // 0xFFFF (or a 0xFFFFFFFF offset) is Zip64, which no transcript needs.
  if (count === 0xffff || v.getUint32(eocd + 16, true) === 0xffffffff) throw broken();
  if (count > max) throw new IntakeError("zip_entries", `That zip holds ${count} files. FocusTime opens a zip of at most ${max}, with the transcript in it`);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || v.getUint32(p, true) !== 0x02014b50) throw broken();
    const nameLen = v.getUint16(p + 28, true);
    const e: Entry = { flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true), csize: v.getUint32(p + 20, true), usize: v.getUint32(p + 24, true), name: dec.decode(zip.subarray(p + 46, p + 46 + nameLen)), local: v.getUint32(p + 42, true) };
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    out.push(e);
  }
  return out;
}

/** One entry's bytes, inflating at most `budget` bytes (a bomb stops there, whatever its header said). */
function entryBytes(zip: Uint8Array, e: Entry, budget: number, tooLarge: () => Error): Uint8Array {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (e.flags & 0x1) throw broken(); // encrypted
  if (e.local + 30 > zip.length || v.getUint32(e.local, true) !== 0x04034b50) throw broken();
  const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
  if (start + e.csize > zip.length) throw broken();
  const data = zip.subarray(start, start + e.csize);
  if (e.method === 0) {
    if (data.length > budget) throw tooLarge();
    return data;
  }
  if (e.method !== 8) throw broken();
  if (budget <= 0) throw tooLarge();
  try {
    return inflateRawSync(data, { maxOutputLength: budget });
  } catch (x) {
    if ((x as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || x instanceof RangeError) throw tooLarge();
    throw broken();
  }
}

/** One file from a zip by name, or null (a .docx's document). Throws TranscriptError for a broken or oversized archive. */
export function zipEntry(zip: Uint8Array, name: string, budget = MAX_XML_BYTES): Uint8Array | null {
  let entries: Entry[];
  try {
    entries = zipDirectory(zip, DOCX_ENTRIES);
  } catch {
    throw new IntakeError("docx_broken", "That .docx file can't be opened");
  }
  const e = entries.find((x) => x.name === name);
  if (!e) return null;
  try {
    return entryBytes(zip, e, budget, () => new IntakeError("docx_large", "That .docx file is too large or damaged"));
  } catch (x) {
    if (x instanceof IntakeError && x.code === "docx_large") throw x;
    throw new IntakeError("docx_broken", "That .docx file can't be opened");
  }
}

const isDocx = (zip: Uint8Array) => {
  try {
    return zipDirectory(zip, DOCX_ENTRIES).some((e) => e.name === "word/document.xml");
  } catch {
    return false;
  }
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const KIND_WORD: Record<"pdf" | "vtt" | "docx", [string, string]> = { pdf: ["PDF", "PDFs"], vtt: [".vtt file", ".vtt files"], docx: [".docx file", ".docx files"] };

/** What came in, for the log line (kinds, sizes and counts only). */
export type IntakeFacts = { kind: string; bytes: number; unpacked: number; entries: number; pages: number };

export type TranscriptRead = { format: TranscriptFormat; lines: TranscriptLine[]; recorded: Recorded | null; facts: IntakeFacts };

/** PK-1: Pocket's download: a zip with exactly one file FocusTime reads. */
function unzipOne(zip: Uint8Array): { kind: "pdf" | "vtt" | "docx"; bytes: Uint8Array; unpacked: number; entries: number } {
  const entries = zipDirectory(zip, ZIP_ENTRIES);
  const files = entries.filter((e) => !e.name.endsWith("/"));
  const mb = ZIP_UNPACKED / 1024 / 1024;
  const tooLarge = () => new IntakeError("zip_large", `That zip is over ${mb} MB unpacked. FocusTime opens a zip of up to ${mb} MB, with the transcript in it`);
  if (files.reduce((n, e) => n + e.usize, 0) > ZIP_UNPACKED) throw tooLarge();
  let used = 0;
  const found: { kind: "pdf" | "vtt" | "docx"; bytes: Uint8Array }[] = [];
  let archives = 0;
  let others = 0;
  for (const e of files) {
    const b = entryBytes(zip, e, ZIP_UNPACKED - used, tooLarge);
    used += b.length;
    const k = kindOf(b);
    if (k === "pdf" || k === "vtt") found.push({ kind: k, bytes: b });
    else if (k === "zip" && isDocx(b)) found.push({ kind: "docx", bytes: b });
    else if (k === "zip" || k === "archive") archives++;
    else others++;
  }
  if (archives) throw new IntakeError("zip_nested", `That zip has ${archives === 1 ? "another archive" : `${archives} other archives`} inside it. FocusTime opens a zip with the transcript file directly in it`);
  if (!found.length) throw new IntakeError("zip_none", `That zip has no transcript in it${others ? ` (${plural(others, "other file")})` : ""}. ${READS}`);
  if (found.length > 1) {
    const by = (["pdf", "vtt", "docx"] as const).map((k) => [k, found.filter((f) => f.kind === k).length] as const).filter(([, n]) => n);
    const what = by.map(([k, n]) => `${n} ${n === 1 ? KIND_WORD[k][0] : KIND_WORD[k][1]}`).join(" and ");
    throw new IntakeError("zip_several", `That zip holds ${what}. FocusTime reads one transcript at a time: upload a zip with one in it, or the file by itself`);
  }
  return { ...found[0]!, unpacked: used, entries: entries.length };
}

const PDF_WORDS: Record<Exclude<PdfRead, { ok: true }>["reason"], (pages?: number) => string> = {
  pages: (n) => `That PDF has ${n ?? "too many"} pages. FocusTime reads a PDF of up to 500`,
  slow: () => "That PDF took over 10 seconds to read, so FocusTime stopped. Nothing was kept",
  locked: () => "That PDF is locked with a password. Export it from Pocket again without one",
  damaged: () => "That PDF can't be opened: it may be damaged",
  large: () => "That PDF has far more text than a call's transcript. Nothing was kept",
  busy: () => "FocusTime is reading other PDFs right now. Try again in a minute",
};

/** An uploaded file → lines (the same structure for every format), or a TranscriptError with plain words. */
export async function readTranscriptFile(bytes: Uint8Array, o: { readPdf?: ReadPdf | undefined } = {}): Promise<TranscriptRead> {
  if (bytes.length === 0) throw new IntakeError("empty", "That file is empty");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new IntakeError("large", "That file is over 5 MB");
  const facts: IntakeFacts = { kind: "", bytes: bytes.length, unpacked: 0, entries: 0, pages: 0 };
  let kind: Kind | "docx" = kindOf(bytes);
  let body = bytes;
  let zipped = false;
  if (kind === "zip") {
    if (isDocx(bytes)) kind = "docx";
    else {
      const one = unzipOne(bytes);
      body = one.bytes;
      facts.unpacked = one.unpacked;
      facts.entries = one.entries;
      zipped = true;
      kind = one.kind;
    }
  }
  if (kind === "vtt") {
    facts.kind = zipped ? "vtt.zip" : "vtt";
    return { format: "vtt", lines: parseVtt(new TextDecoder().decode(body)), recorded: null, facts };
  }
  if (kind === "docx") {
    facts.kind = zipped ? "docx.zip" : "docx";
    // Inside a zip, the document counts against the zip's 20 MB too, never a second allowance.
    const xml = zipEntry(body, "word/document.xml", zipped ? Math.max(0, ZIP_UNPACKED - facts.unpacked) : MAX_XML_BYTES);
    if (!xml) throw new IntakeError("docx_empty", "That .docx file has no document in it");
    return { format: "docx", lines: parseDocxXml(new TextDecoder().decode(xml)), recorded: null, facts };
  }
  if (kind === "pdf") {
    facts.kind = zipped ? "pocket.zip" : "pocket.pdf";
    if (!o.readPdf) throw new IntakeError("pdf_off", "FocusTime can't read a PDF here");
    const r = await o.readPdf(body);
    if (!r.ok) throw new IntakeError(`pdf_${r.reason}`, PDF_WORDS[r.reason](r.pages));
    facts.pages = r.pages;
    try {
      const p = parsePocket(r.lines);
      return { format: "pocket", lines: p.lines, recorded: p.recorded, facts };
    } catch (e) {
      if (e instanceof NoTextError) throw new IntakeError("pdf_no_text", e.message);
      if (e instanceof TranscriptError) throw new IntakeError("pdf_no_turns", e.message);
      throw e;
    }
  }
  throw new IntakeError(kind === "archive" ? "archive" : "unknown", `That file isn't one FocusTime reads. ${READS}`);
}
