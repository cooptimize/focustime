// MC-1 tests: a minimal .docx (a zip with word/document.xml) built in memory, deflated or stored.
import { crc32, deflateRawSync } from "node:zlib";

export function zipOf(files: Record<string, string>, o: { store?: boolean } = {}): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(enc.encode(text));
    const data = o.store ? raw : deflateRawSync(raw);
    const nameB = Buffer.from(enc.encode(name));
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(o.store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    locals.push(local, nameB, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(o.store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameB.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

/** A Teams-style transcript .docx: "Name   m:ss" then the words, per cue. */
export function transcriptDocx(cues: readonly { speaker: string; at: string; text: string }[], o: { store?: boolean } = {}): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const body = cues.map((c) => p(`${c.speaker}   ${c.at}`) + p(c.text)).join("");
  return zipOf({ "[Content_Types].xml": "<Types/>", "word/document.xml": `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>` }, o);
}

export function transcriptVtt(cues: readonly { speaker: string; at: string; text: string }[]): string {
  const t = (at: string) => {
    const [m, s] = at.split(":");
    return `00:${m!.padStart(2, "0")}:${s}.000`;
  };
  return `WEBVTT\n\n${cues.map((c) => `${t(c.at)} --> ${t(c.at)}\n<v ${c.speaker}>${c.text}</v>`).join("\n\n")}\n`;
}
