// Outlines the live <text> in the wordmark and lockup to paths, in IBM Plex Sans from @fontsource (step 17.5).
// Run after gen.py and before bake.py:  python3 tools/gen.py && node tools/outline.mjs && python3 tools/bake.py
// opentype.js is a devDependency for this script only; it reads the .woff files (it can't read woff2).
import opentype from "opentype.js";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, "..");
const require = createRequire(import.meta.url);
const fontDir = dirname(require.resolve("@fontsource/ibm-plex-sans/package.json"));
const font = (w) => opentype.loadSync(join(fontDir, "files", `ibm-plex-sans-latin-${w}-normal.woff`));
const fonts = { 400: font(400), 600: font(600) };

const attr = (s, name) => s.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** One <text> as a path: glyph by glyph, kerning plus the delivered letter-spacing (tracking). */
function outline(tag, content) {
  const f = fonts[attr(tag, "font-weight") ?? "400"];
  if (!f) throw new Error(`no Plex Sans weight for ${tag}`);
  const size = Number(attr(tag, "font-size"));
  const track = Number(attr(tag, "letter-spacing") ?? 0);
  let x = Number(attr(tag, "x"));
  const y = Number(attr(tag, "y"));
  const glyphs = f.stringToGlyphs(content);
  const scale = size / f.unitsPerEm;
  const parts = [];
  glyphs.forEach((g, i) => {
    parts.push(g.getPath(x, y, size).toPathData(2));
    x += g.advanceWidth * scale + track;
    if (glyphs[i + 1]) x += f.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  const keep = ["fill", "opacity"].map((a) => (attr(tag, a) != null ? ` ${a}="${attr(tag, a)}"` : "")).join("");
  return `<path aria-label="${content}" d="${parts.join(" ")}"${keep}/>`;
}

for (const name of ["wordmark.svg", "lockup-horizontal.svg"]) {
  const p = join(brand, name);
  const svg = readFileSync(p, "utf8");
  const out = svg.replace(/<text([^>]*)>([^<]*)<\/text>/g, (_, tag, content) => outline(tag, content));
  if (out.includes("<text")) throw new Error(`${name}: text left`);
  writeFileSync(p, out);
  console.log(`outlined ${name}`);
}
