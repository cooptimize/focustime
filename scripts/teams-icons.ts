// TB-1: the Teams app's two icons in assets/teams, made from the WeekMark like the install icons (scripts/pwa-icons.ts),
// rendered by the system Chromium:
//   color.png    192 x 192, full color: the mark on the dark app background (Teams rounds the corners itself)
//   outline.png  32 x 32, white on transparent: the mono mark (Teams' rule for the outline icon)
// Run after the mark changes: node scripts/teams-icons.ts. scripts/teams-package.ts puts them in the app package.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHROMIUM } from "../e2e/harness.ts";
import { chromium } from "playwright-core";

const root = join(import.meta.dirname, "..");
const out = join(root, "assets", "teams");
mkdirSync(out, { recursive: true });
const BG = "#0d1318";
const body = (file: string) => readFileSync(join(root, file), "utf8").replace(/^[\s\S]*?<desc>[\s\S]*?<\/desc>/, "").replace(/<\/svg>\s*$/, "");
const color = body("assets/brand/icons/mark-week-icon.svg");
const mono = body("assets/brand/mark-week-mono.svg").replaceAll("currentColor", "#ffffff");
const [mw, mh] = [200, 90];

function icon(size: number, inner: string, markWidth: number, bg: string | null): string {
  const w = size * markWidth;
  const k = w / mw;
  const x = (size - w) / 2;
  const y = (size - mh * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ""}<g transform="translate(${x} ${y}) scale(${k})">${inner}</g></svg>`;
}

const browser = await chromium.launch({ ...(CHROMIUM ? { executablePath: CHROMIUM } : {}), args: ["--disable-gpu"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, svg] of [
  ["color.png", 192, icon(192, color, 0.7, BG)],
  ["outline.png", 32, icon(32, mono, 0.94, null)],
] as const) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`);
  await page.screenshot({ path: join(out, name), omitBackground: true });
  console.log(`assets/teams/${name}`);
}
await browser.close();
