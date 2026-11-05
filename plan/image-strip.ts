// CV-2: an image from a client chat, made safe to keep and show. Only PNG, JPEG and GIF, told apart by their magic
// bytes (never by a header or a name), at most 10 MB. Metadata is stripped by rebuilding the file from an allowlist of
// the parts that draw the picture, so whatever isn't listed goes: EXIF (and its GPS), XMP, ICC profiles, comments,
// text chunks, timestamps, thumbnails, application data. The picture itself is copied byte for byte, never decoded or
// re-encoded. Anything that doesn't parse cleanly is refused (null), never passed through. Pure: no I/O.

export type ImageType = "image/png" | "image/jpeg" | "image/gif";
export const IMAGE_TYPES: readonly ImageType[] = ["image/png", "image/jpeg", "image/gif"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (b: Uint8Array, sig: readonly number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** The image's type from its first bytes, or null when it isn't PNG, JPEG or GIF. */
export function sniff(b: Uint8Array): ImageType | null {
  if (startsWith(b, PNG_SIG)) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "image/gif";
  return null;
}

/** The image without its metadata, with its type from the bytes; null when it isn't one of the three or doesn't parse. */
export function stripMetadata(b: Uint8Array): { type: ImageType; bytes: Uint8Array } | null {
  if (b.length > MAX_IMAGE_BYTES) return null;
  const type = sniff(b);
  try {
    const bytes = type === "image/png" ? png(b) : type === "image/jpeg" ? jpeg(b) : type === "image/gif" ? gif(b) : null;
    return type && bytes ? { type, bytes } : null;
  } catch {
    return null;
  }
}

class Parts {
  private list: Uint8Array[] = [];
  add(b: Uint8Array) {
    this.list.push(b);
  }
  join(): Uint8Array {
    const out = new Uint8Array(this.list.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of this.list) (out.set(x, at), (at += x.length));
    return out;
  }
}
const need = (b: Uint8Array, end: number) => {
  if (end > b.length) throw new Error("truncated");
};

// ---- PNG: chunks (length, type, data, CRC); only the ones that draw the picture are kept, each copied as it was ----

/** Critical chunks, plus the ancillary ones that change how it looks (transparency, gamma, colors, animation). */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "pHYs", "bKGD", "acTL", "fcTL", "fdAT"]);

function png(b: Uint8Array): Uint8Array | null {
  const out = new Parts();
  out.add(b.subarray(0, 8));
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 8;
  let first = true;
  let idat = false;
  for (;;) {
    need(b, at + 8);
    const len = view.getUint32(at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + len;
    need(b, end);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (first && type !== "IHDR") return null;
    first = false;
    if (type === "IDAT") idat = true;
    if (PNG_KEEP.has(type)) out.add(b.subarray(at, end));
    // An unknown critical chunk (uppercase first letter) means a picture we can't vouch for.
    else if (type[0]! >= "A" && type[0]! <= "Z") return null;
    at = end;
    if (type === "IEND") break;
  }
  return idat ? out.join() : null;
}

// ---- JPEG: marker segments; APPn (EXIF, XMP, ICC, ...) and COM go, except a minimal JFIF and Adobe header ----

function jpeg(b: Uint8Array): Uint8Array | null {
  const out = new Parts();
  out.add(Uint8Array.of(0xff, 0xd8));
  let at = 2;
  let frame = false;
  let scan = false;
  for (;;) {
    need(b, at + 2);
    if (b[at] !== 0xff) return null;
    let m = b[at + 1]!;
    // Fill bytes before a marker.
    while (m === 0xff) {
      at++;
      need(b, at + 2);
      m = b[at + 1]!;
    }
    if (m === 0xd9) {
      out.add(Uint8Array.of(0xff, 0xd9));
      break;
    }
    if (m === 0xd8 || m === 0x00) return null;
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      out.add(b.subarray(at, at + 2));
      at += 2;
      continue;
    }
    need(b, at + 4);
    const len = (b[at + 2]! << 8) | b[at + 3]!;
    if (len < 2) return null;
    const end = at + 2 + len;
    need(b, end);
    const data = b.subarray(at + 4, end);
    if (m === 0xe0) {
      // JFIF: version, units and density only, never its thumbnail.
      if (data.length >= 12 && ascii(data, 0, 5) === "JFIF\u0000") out.add(Uint8Array.of(0xff, 0xe0, 0x00, 0x10, ...data.subarray(0, 12), 0x00, 0x00));
    } else if (m === 0xee) {
      // Adobe: its color transform flag decides how the picture decodes; the 12 bytes of it only.
      if (data.length >= 12 && ascii(data, 0, 5) === "Adobe") out.add(Uint8Array.of(0xff, 0xee, 0x00, 0x0e, ...data.subarray(0, 12)));
    } else if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) {
      // EXIF and its GPS, XMP, ICC, Photoshop, comments: gone.
    } else {
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) frame = true;
      out.add(b.subarray(at, end));
    }
    at = end;
    if (m === 0xda) {
      if (!frame) return null;
      scan = true;
      // The entropy-coded data runs to the next marker that isn't a stuffed byte or a restart.
      let j = at;
      for (;;) {
        need(b, j + 2);
        if (b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1]! >= 0xd0 && b[j + 1]! <= 0xd7) && b[j + 1] !== 0xff) break;
        j++;
      }
      out.add(b.subarray(at, j));
      at = j;
    }
  }
  return frame && scan ? out.join() : null;
}

// ---- GIF: blocks; image data and graphic control kept, comments, plain text and application data go (but looping) ----

function gif(b: Uint8Array): Uint8Array | null {
  const out = new Parts();
  need(b, 13);
  const packed = b[10]!;
  let at = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
  need(b, at);
  out.add(b.subarray(0, at));
  const subBlocks = (from: number): number => {
    let j = from;
    for (;;) {
      need(b, j + 1);
      const n = b[j]!;
      if (n === 0) return j + 1;
      j += 1 + n;
    }
  };
  let images = 0;
  for (;;) {
    need(b, at + 1);
    const kind = b[at]!;
    if (kind === 0x3b) {
      out.add(Uint8Array.of(0x3b));
      break;
    }
    if (kind === 0x2c) {
      need(b, at + 10);
      const p = b[at + 9]!;
      const table = p & 0x80 ? 3 * (1 << ((p & 7) + 1)) : 0;
      const dataAt = at + 10 + table + 1;
      const end = subBlocks(dataAt);
      out.add(b.subarray(at, end));
      images++;
      at = end;
      continue;
    }
    if (kind === 0x21) {
      need(b, at + 2);
      const label = b[at + 1]!;
      const end = subBlocks(at + 2);
      const app = label === 0xff && b[at + 2] === 11 ? ascii(b, at + 3, 11) : null;
      if (label === 0xf9 || app === "NETSCAPE2.0" || app === "ANIMEXTS1.0") out.add(b.subarray(at, end));
      at = end;
      continue;
    }
    return null;
  }
  return images ? out.join() : null;
}
