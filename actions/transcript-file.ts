// MC-1: an uploaded transcript file → lines. A .vtt is text; a .docx is a zip whose word/document.xml holds the
// paragraphs. The zip is read here with node:zlib only (no dependency): the central directory finds the entry, its
// local header the data, stored or deflated. Bounded: the file at most MAX_UPLOAD_BYTES, the XML at most
// MAX_XML_BYTES once inflated. Nothing here logs; the bytes are never kept (the lines are what's stored).
import { inflateRawSync } from "node:zlib";
import { parseDocxXml, parseVtt, TranscriptError, type TranscriptLine } from "../plan/transcript.ts";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_XML_BYTES = 20 * 1024 * 1024;

export type TranscriptFormat = "vtt" | "docx";

/** The format from the file's name or its first bytes (a zip starts "PK"). */
export function formatOf(name: string, bytes: Uint8Array): TranscriptFormat | null {
  const ext = name.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (ext === "vtt") return "vtt";
  if (ext === "docx") return "docx";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx";
  if (new TextDecoder().decode(bytes.subarray(0, 16)).replace(/^﻿/, "").startsWith("WEBVTT")) return "vtt";
  return null;
}

/** One file from a zip by name, or null. Throws TranscriptError for a broken or oversized archive. */
export function zipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: the last 22 bytes, or earlier when there is a comment (at most 64 KB).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new TranscriptError("That .docx file can't be opened");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || v.getUint32(p, true) !== 0x02014b50) throw new TranscriptError("That .docx file can't be opened");
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const entry = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (entry !== name) continue;
    if (local + 30 > zip.length || v.getUint32(local, true) !== 0x04034b50) throw new TranscriptError("That .docx file can't be opened");
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    if (method === 0) return data;
    if (method !== 8) throw new TranscriptError("That .docx file can't be opened");
    try {
      return inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES });
    } catch {
      throw new TranscriptError("That .docx file is too large or damaged");
    }
  }
  return null;
}

/** An uploaded file → lines (the same structure for both formats), or a TranscriptError with plain words. */
export function readTranscriptFile(name: string, bytes: Uint8Array): { format: TranscriptFormat; lines: TranscriptLine[] } {
  if (bytes.length === 0) throw new TranscriptError("That file is empty");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new TranscriptError("That file is over 5 MB");
  const format = formatOf(name, bytes);
  if (!format) throw new TranscriptError("Upload the transcript as a .vtt or .docx file");
  if (format === "vtt") return { format, lines: parseVtt(new TextDecoder().decode(bytes)) };
  const xml = zipEntry(bytes, "word/document.xml");
  if (!xml) throw new TranscriptError("That .docx file has no document in it");
  return { format, lines: parseDocxXml(new TextDecoder().decode(xml)) };
}
