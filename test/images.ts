// CV-2: small real images (8 x 8, made once with ImageMagick and stripped) and the metadata a phone or an editor puts
// in them, added the way those tools add it: EXIF with a GPS position, XMP and ICC in PNG chunks and JPEG APP segments,
// PNG text chunks, JPEG comments, GIF comments, plain text and application extensions. Fictional values only.
import { crc32, deflateSync } from "node:zlib";

const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

/** An 8 x 8 gradient: IHDR, IDAT, IEND only. */
export const PNG_BASE = b64("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIEAIAAAAb/fWfAAAAQklEQVQY05XQUQ0AIBRC0etmlGcYwzzDaBfLYBetIPyfwSj3YqUoIaYBtqDHP6hneA1VCW0Zk3rAlgFigtIAAM61D5Z2EAM0q4gpAAAAAElFTkSuQmCC");
/** An 8 x 8 baseline JPEG: SOI, a 16-byte JFIF APP0, DQT, SOF0, DHT, SOS, the scan, EOI. */
export const JPEG_BASE = b64("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAWEAEBAQAAAAAAAAAAAAAAAAAAFWL/xAAVAQEBAAAAAAAAAAAAAAAAAAAFB//EABkRAAEFAAAAAAAAAAAAAAAAAAAFFlOR8P/aAAwDAQACEQMRAD8AjdnQCtM1Jj1DLsU5NZ//2Q==");
/** A two-frame 8 x 8 looping GIF: header, NETSCAPE2.0 loop, two graphic controls and images, trailer. */
export const GIF_BASE = b64("R0lGODlhCAAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAACAAIAAACB4SPqcvtXQAAIfkEAAAAAAAsAAAAAAgACACAAAD/AAAAAgeEj6nL7V0AADs=");

/** What the metadata says, so a test can look for it before and after. */
export const SECRET = { place: "47.6205 N 122.3493 W", camera: "Fabrikam Phone 12", author: "Pat Example", comment: "Taken at home" };

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};
const text = (s: string) => new TextEncoder().encode(s);
const u16be = (n: number) => Uint8Array.of(n >> 8, n & 255);
const u32be = (n: number) => Uint8Array.of(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255);
const u16le = (n: number) => Uint8Array.of(n & 255, n >> 8);
const u32le = (n: number) => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24);

/** A little-endian TIFF block (what EXIF is) with a camera make, an artist and a GPS IFD with a latitude and longitude. */
export function exifTiff(): Uint8Array {
  // Layout: header (8), IFD0 at 8 with 3 entries (2 + 36 + 4 = 42) -> 50, GPS IFD at 50 with 4 entries (2 + 48 + 4 = 54)
  // -> 104, then the values: make, artist, latitude (3 rationals), longitude (3 rationals).
  const make = text(SECRET.camera + "\0");
  const artist = text(SECRET.author + "\0");
  const at = { make: 104, artist: 104 + make.length, lat: 104 + make.length + artist.length };
  const lon = at.lat + 24;
  const entry = (tag: number, type: number, count: number, value: Uint8Array) => concat(u16le(tag), u16le(type), u32le(count), value);
  const rationals = (xs: number[]) => concat(...xs.flatMap((x) => [u32le(x), u32le(1)]));
  return concat(
    text("II"), u16le(42), u32le(8),
    u16le(3), entry(0x010f, 2, make.length, u32le(at.make)), entry(0x013b, 2, artist.length, u32le(at.artist)), entry(0x8825, 4, 1, u32le(50)), u32le(0),
    u16le(4), entry(1, 2, 2, text("N\0\0\0")), entry(2, 5, 3, u32le(at.lat)), entry(3, 2, 2, text("W\0\0\0")), entry(4, 5, 3, u32le(lon)), u32le(0),
    make, artist, rationals([47, 37, 13]), rationals([122, 20, 57]),
  );
}

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="${SECRET.author}" exif:GPSLatitude="${SECRET.place}" xmlns:exif="http://ns.adobe.com/exif/1.0/"/></rdf:RDF></x:xmpmeta>`;

// ---- PNG ----

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const td = concat(text(type), data);
  return concat(u32be(data.length), td, u32be(crc32(td)));
}

/** PNG_BASE with tEXt, zTXt and iTXt (XMP) text chunks, an eXIf chunk with GPS, a tIME and an iCCP profile name, all after IHDR as editors write them. */
export function pngWithMetadata(base = PNG_BASE): Uint8Array {
  const ihdrEnd = 8 + 25;
  return concat(
    base.subarray(0, ihdrEnd),
    pngChunk("tEXt", concat(text("Author\0"), text(SECRET.author))),
    pngChunk("tEXt", concat(text("Comment\0"), text(SECRET.comment))),
    pngChunk("zTXt", concat(text("Description\0\0"), deflateSync(text(SECRET.place)))),
    pngChunk("iTXt", concat(text("XML:com.adobe.xmp\0\0\0\0\0"), text(XMP))),
    pngChunk("eXIf", exifTiff()),
    pngChunk("tIME", Uint8Array.of(0x07, 0xea, 11, 4, 21, 13, 0)),
    pngChunk("iCCP", concat(text("Pat's display\0\0"), deflateSync(text("not a real profile")))),
    base.subarray(ihdrEnd),
  );
}

// ---- JPEG ----

const segment = (marker: number, data: Uint8Array) => concat(Uint8Array.of(0xff, marker), u16be(data.length + 2), data);

/** JPEG_BASE with an EXIF APP1 (with GPS), an XMP APP1, an ICC APP2, a Photoshop APP13 and two comments, after its JFIF, plus a JFIF thumbnail. */
export function jpegWithMetadata(base = JPEG_BASE): Uint8Array {
  const jfifEnd = 2 + 18;
  // The same JFIF header, now with a 1 x 1 thumbnail (3 bytes of RGB), as some cameras write it.
  const jfif = segment(0xe0, concat(base.subarray(6, 6 + 12), Uint8Array.of(1, 1, 0x47, 0x50, 0x53)));
  return concat(
    base.subarray(0, 2),
    jfif,
    segment(0xe1, concat(text("Exif\0\0"), exifTiff())),
    segment(0xe1, concat(text("http://ns.adobe.com/xap/1.0/\0"), text(XMP))),
    segment(0xe2, concat(text("ICC_PROFILE\0"), Uint8Array.of(1, 1), text("not a real profile"))),
    segment(0xed, concat(text("Photoshop 3.0\0"), text(SECRET.author))),
    segment(0xfe, text(SECRET.comment)),
    base.subarray(jfifEnd, jfifEnd + 69),
    segment(0xfe, text(SECRET.place)),
    base.subarray(jfifEnd + 69),
  );
}

// ---- GIF ----

const subBlocks = (data: Uint8Array) => {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const piece = data.subarray(i, i + 255);
    parts.push(Uint8Array.of(piece.length), piece);
  }
  return concat(...parts, Uint8Array.of(0));
};

/** GIF_BASE with a comment, an XMP application extension, a plain text extension and an unknown application block, before its frames. */
export function gifWithMetadata(base = GIF_BASE): Uint8Array {
  // The header and global color table (2 colors) end at 13 + 6 = 19; the NETSCAPE block follows.
  const head = 19;
  return concat(
    base.subarray(0, head),
    Uint8Array.of(0x21, 0xfe), subBlocks(text(SECRET.comment)),
    Uint8Array.of(0x21, 0xff, 11), text("XMP DataXMP"), subBlocks(text(XMP)),
    Uint8Array.of(0x21, 0x01, 12), Uint8Array.of(0, 0, 0, 0, 8, 0, 8, 0, 8, 8, 1, 0), subBlocks(text(SECRET.place)),
    Uint8Array.of(0x21, 0xff, 11), text("FABRIKAM1.0"), subBlocks(text(SECRET.camera)),
    base.subarray(head),
  );
}

/** Whether any of the secrets (or the GPS markers) are still in the bytes. */
export function leaks(b: Uint8Array): string[] {
  const s = Buffer.from(b).toString("latin1");
  return [...Object.values(SECRET), "GPS", "Exif", "xmpmeta", "ICC_PROFILE", "Photoshop", "FABRIKAM"].filter((x) => s.includes(x));
}
