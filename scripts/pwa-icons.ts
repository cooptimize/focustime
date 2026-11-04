// P1: the install icons in public/icons (served at /icons/), made from the WeekMark (assets/brand/icons/
// mark-week-icon.svg) on the dark app background, rendered by the system Chromium:
//   focustime-192.png, focustime-512.png   "any": the rounded tile, the mark at 78% of the width (as the app icon)
//   focustime-maskable-512.png             "maskable": full bleed, the mark inside the 80% safe circle
//   apple-touch-icon.png (180)             iOS home screen: full bleed (iOS rounds it), the mark at 70%
// Run after the mark changes: node scripts/pwa-icons.ts
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHROMIUM } from "../e2e/harness.ts";
import { chromium } from "playwright-core";

const root = join(import.meta.dirname, "..");
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });
/** The dark theme's app background (--p-ink-950). */
const BG = "#0d1318";
const mark = readFileSync(join(root, "assets/brand/icons/mark-week-icon.svg"), "utf8");
const inner = mark.replace(/^[\s\S]*?<desc>[\s\S]*?<\/desc>/, "").replace(/<\/svg>\s*$/, "");
const [mw, mh] = [200, 90];

function icon(size: number, markWidth: number, rounded: boolean): string {
  const w = size * markWidth;
  const k = w / mw;
  const x = (size - w) / 2;
  const y = (size - mh * k) / 2;
  const tile = rounded ? `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${BG}"/>` : `<rect width="${size}" height="${size}" fill="${BG}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${tile}<g transform="translate(${x} ${y}) scale(${k})">${inner}</g></svg>`;
}

const icons: [string, number, number, boolean][] = [
  ["focustime-192.png", 192, 0.78, true],
  ["focustime-512.png", 512, 0.78, true],
  ["focustime-maskable-512.png", 512, 0.6, false],
  ["apple-touch-icon.png", 180, 0.7, false],
];
const browser = await chromium.launch({ ...(CHROMIUM ? { executablePath: CHROMIUM } : {}), args: ["--disable-gpu"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, w, rounded] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${icon(size, w, rounded)}</body></html>`);
  await page.screenshot({ path: join(out, name), omitBackground: true });
  console.log(`public/icons/${name}`);
}
await browser.close();
