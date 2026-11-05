// CV-2: images from a client chat lose their metadata (EXIF and its GPS, XMP, ICC, PNG text chunks, JPEG comments, GIF
// comments and application data) and still decode; anything that isn't a PNG, JPEG or GIF by its bytes, is over 10 MB
// or doesn't parse is refused. The samples are real 8 x 8 images with metadata added the way phones and editors add it.
import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GIF_BASE, gifWithMetadata, JPEG_BASE, jpegWithMetadata, leaks, PNG_BASE, pngChunk, pngWithMetadata } from "../test/images.ts";
import { MAX_IMAGE_BYTES, sniff, stripMetadata } from "./image-strip.ts";

/** Inflates the IDAT data and checks it holds exactly one filter byte and one row of pixels per row. */
function decodePng(b: Uint8Array): { width: number; height: number } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20), depth = b[24]!, color = b[25]!;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]!;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < b.length; ) {
    const len = view.getUint32(at);
    if (String.fromCharCode(...b.subarray(at + 4, at + 8)) === "IDAT") idat.push(b.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  expect(raw.length).toBe(height * (1 + Math.ceil((width * channels * depth) / 8)));
  return { width, height };
}

/** Decodes every frame's LZW data and checks it gives one index per pixel. */
function decodeGif(b: Uint8Array): number {
  let at = 13 + (b[10]! & 0x80 ? 3 * (1 << ((b[10]! & 7) + 1)) : 0);
  const blocks = () => {
    const parts: number[] = [];
    for (let n = b[at++]!; n; n = b[at++]!) (parts.push(...b.subarray(at, at + n)), (at += n));
    return parts;
  };
  let frames = 0;
  for (;;) {
    const kind = b[at++];
    if (kind === 0x3b) return frames;
    if (kind === 0x21) (at++, blocks());
    else if (kind === 0x2c) {
      const w = b[at + 4]! | (b[at + 5]! << 8), h = b[at + 6]! | (b[at + 7]! << 8), p = b[at + 8]!;
      at += 9 + (p & 0x80 ? 3 * (1 << ((p & 7) + 1)) : 0);
      const min = b[at++]!;
      expect(lzw(min, blocks())).toHaveLength(w * h);
      frames++;
    } else throw new Error("bad block");
  }
}

function lzw(min: number, data: number[]): number[] {
  const clear = 1 << min, end = clear + 1;
  let size = min + 1, dict: number[][] = [], prev: number[] | null = null, bits = 0, acc = 0;
  const reset = () => ((dict = Array.from({ length: clear + 2 }, (_, i) => [i])), (size = min + 1), (prev = null));
  reset();
  const out: number[] = [];
  for (const byte of data) {
    acc |= byte << bits;
    bits += 8;
    while (bits >= size) {
      const code = acc & ((1 << size) - 1);
      acc >>= size;
      bits -= size;
      if (code === clear) (reset());
      else if (code === end) return out;
      else {
        const entry: number[] = code < dict.length ? dict[code]! : [...prev!, prev![0]!];
        out.push(...entry);
        if (prev) dict.push([...prev, entry[0]!]);
        prev = entry;
        if (dict.length === 1 << size && size < 12) size++;
      }
    }
  }
  return out;
}

const magick = spawnSync("magick", ["-version"]).status === 0;
/** Width and height as ImageMagick decodes them, with every property it found (EXIF, comments, profiles). */
function identify(b: Uint8Array) {
  const r = spawnSync("magick", ["identify", "-verbose", "-"], { input: b });
  expect(r.status).toBe(0);
  const out = r.stdout.toString();
  return { size: /Geometry: (\d+x\d+)/.exec(out)?.[1] ?? "", props: out };
}

describe("sniff", () => {
  it("tells PNG, JPEG and GIF from their bytes and nothing else", () => {
    expect([sniff(PNG_BASE), sniff(JPEG_BASE), sniff(GIF_BASE)]).toEqual(["image/png", "image/jpeg", "image/gif"]);
    for (const other of ["<svg xmlns='http://www.w3.org/2000/svg'/>", "<html><script>x</script></html>", "RIFF\0\0\0\0WEBPVP8 ", "BM\0\0\0\0", "%PDF-1.7", ""])
      expect(sniff(new TextEncoder().encode(other))).toBeNull();
  });
});

describe("stripMetadata", () => {
  it("the samples carry the metadata to begin with", () => {
    for (const b of [PNG_BASE, JPEG_BASE, GIF_BASE]) expect(leaks(b)).toEqual([]);
    expect(leaks(pngWithMetadata())).toEqual(expect.arrayContaining(["Pat Example", "Taken at home", "Fabrikam Phone 12", "GPS", "xmpmeta"]));
    expect(leaks(jpegWithMetadata())).toEqual(expect.arrayContaining(["Pat Example", "Taken at home", "47.6205 N 122.3493 W", "Exif", "ICC_PROFILE", "Photoshop"]));
    expect(leaks(gifWithMetadata())).toEqual(expect.arrayContaining(["Taken at home", "47.6205 N 122.3493 W", "xmpmeta", "FABRIKAM"]));
  });

  it("PNG: text chunks, EXIF with GPS, XMP, ICC and the time go; the picture is copied as it was and decodes", () => {
    const r = stripMetadata(pngWithMetadata())!;
    expect(r.type).toBe("image/png");
    expect(leaks(r.bytes)).toEqual([]);
    expect(Buffer.from(r.bytes).equals(Buffer.from(PNG_BASE))).toBe(true);
    expect(decodePng(r.bytes)).toEqual({ width: 8, height: 8 });
  });

  it("JPEG: EXIF with GPS, XMP, ICC, Photoshop, comments and the JFIF thumbnail go; the scan is copied and decodes", () => {
    const r = stripMetadata(jpegWithMetadata())!;
    expect(r.type).toBe("image/jpeg");
    expect(leaks(r.bytes)).toEqual([]);
    expect(Buffer.from(r.bytes).equals(Buffer.from(JPEG_BASE))).toBe(true);
  });

  it("GIF: comments, plain text, XMP and other application data go; the loop and both frames stay and decode", () => {
    const r = stripMetadata(gifWithMetadata())!;
    expect(r.type).toBe("image/gif");
    expect(leaks(r.bytes)).toEqual([]);
    expect(Buffer.from(r.bytes).equals(Buffer.from(GIF_BASE))).toBe(true);
    expect(Buffer.from(r.bytes).toString("latin1")).toContain("NETSCAPE2.0");
    expect(decodeGif(r.bytes)).toBe(2);
  });

  it.skipIf(!magick)("ImageMagick decodes all three after, and finds no EXIF, comment or profile left", () => {
    for (const [before, size] of [[pngWithMetadata(), "8x8"], [jpegWithMetadata(), "8x8"], [gifWithMetadata(), "8x8"]] as const) {
      expect(identify(before).props).toMatch(/exif:|comment:|Pat Example|xmp|Profile-/i);
      const after = identify(stripMetadata(before)!.bytes);
      expect(after.size).toBe(size);
      expect(after.props).not.toMatch(/exif:|comment:|Pat Example|Taken at home|xmp|Profile-|8bim|GPS/i);
    }
  });

  it("refuses what isn't one of the three, is over 10 MB, is cut short, or has a part it can't vouch for", () => {
    expect(stripMetadata(new TextEncoder().encode("<svg onload='x'/>"))).toBeNull();
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG_BASE);
    expect(stripMetadata(big)).toBeNull();
    for (const b of [PNG_BASE, JPEG_BASE, GIF_BASE, pngWithMetadata(), jpegWithMetadata(), gifWithMetadata()]) expect(stripMetadata(b.subarray(0, b.length - 5))).toBeNull();
    // A PNG with an unknown critical chunk, or with no picture at all.
    const odd = new Uint8Array([...PNG_BASE.subarray(0, 33), ...pngChunk("ZZZZ", new Uint8Array(4)), ...PNG_BASE.subarray(33)]);
    expect(stripMetadata(odd)).toBeNull();
    expect(stripMetadata(new Uint8Array([...PNG_BASE.subarray(0, 33), ...pngChunk("IEND", new Uint8Array())]))).toBeNull();
    // A JPEG with no frame, a GIF with no image.
    expect(stripMetadata(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))).toBeNull();
    expect(stripMetadata(new Uint8Array([...GIF_BASE.subarray(0, 19), 0x3b]))).toBeNull();
  });
});
