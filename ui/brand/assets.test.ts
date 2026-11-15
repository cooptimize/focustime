// BR-1: the week mark is the only brand mark, unchanged, and nothing of Lumen (the mascot, its light bar and beam) is
// left in the source. The week mark's assets and every icon (the hicolor set, the install icons, the Teams app's)
// are pinned to the bytes they had before BR-1. mark-week.svg alone changed: its token block no longer names Lumen's
// two colors (--lime, --beam-blend), which its drawing never used; the drawing itself is pinned below.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

const PINNED: Record<string, string> = {
  "assets/brand/mark-week-mono.svg": "fb73ed8199f175fdf9ce7a4fbd63c11a9ea6a817c504133e33ae39aca27fac4e",
  "assets/brand/focustime-symbolic.svg": "9ed7309a0635bf7dc1dda6d7975dd4554a35af4651e47981063b5274c648bdf6",
  "assets/brand/favicon.svg": "363b0d77465b84ebf1159b856948411593211ad74f3dc0e5aac92782b7885540",
  "assets/brand/wordmark.svg": "b1e144885cfb60e60c9734e867f32de06a5ed744eefba7e3078725d47a1e21a5",
  "assets/brand/baked/dark/focustime-symbolic.svg": "45bd749256fe5ba60c7ef8fb7bc9193b4d04ebffa8fad22cbb3f03ee8560aac0",
  "assets/brand/baked/dark/mark-week-mono.svg": "645254058de4f40384d00c6e42c6e6710d9adc231a3a87851a63659003cfc631",
  "assets/brand/baked/dark/mark-week.svg": "5d64116605f408dcd395e479a75a108cb9950c328acdf4840a1127b7d440a9b2",
  "assets/brand/baked/dark/wordmark.svg": "8f752b1adbd8daaa8550d2a50664b00a2a92aeb8a593aede190e61b4cb7417fd",
  "assets/brand/baked/light/focustime-symbolic.svg": "db09f90e93f997fba8776710fff011391235e5e0aa38ea680bb37a98826dbd72",
  "assets/brand/baked/light/mark-week-mono.svg": "c956d966f2127b85cc27e9e510d3ef70005861cef19124b6ed4a1419b2c3ebb9",
  "assets/brand/baked/light/mark-week.svg": "433a071b9fc00cb41ebad115282c407c04759cd6b19f593c6372e05b7bfb6a7d",
  "assets/brand/baked/light/wordmark.svg": "1e47eda68e555ec42fda8a0f393cebad9a3cb051451c1769e87ecda5a9b6be2a",
  "assets/brand/icons/focustime-128.png": "e63f4cc3ee3d22cc12b54bb84f2a5d64299fa64264f1af8ee6e09f862195d663",
  "assets/brand/icons/focustime-16.png": "9707e5a331cfc690c870861e62fc8c25c6e07a4afcc2b946ee3e36c7e3fd3e1f",
  "assets/brand/icons/focustime-256.png": "a9382598dfcf7a99a80eff0b5b24577a926e4626335aee9f64da78fdddc8c074",
  "assets/brand/icons/focustime-32.png": "5cf995913b2eaf6b2ca666262add5da37853975239176bde29f971d4b89af17e",
  "assets/brand/icons/focustime-48.png": "db7bb41409661d5a37d17ad63a8c339a6f06455c42b904e23f38b026651852e8",
  "assets/brand/icons/focustime-512.png": "bbab1d163f97ef73240170790c309639ace3fd3424ccb18a3dcbda3ccd2c3a41",
  "assets/brand/icons/focustime-64.png": "5b307d6253d15212d4204235ecefcf4ce41b1db91e09fe1da554fa491f1d8298",
  "assets/brand/icons/mark-week-icon.svg": "96dda9f73d1694fed0cd08b9713b1608c019a2ed1f8438fc44d5e1132e2b334b",
  "public/icons/apple-touch-icon.png": "050185a74d7ae657a18ed92ffc87e558082c2a9661633b240af824d370158130",
  "public/icons/focustime-192.png": "4981457a8c00923a0d9a83b1ac024b06a3eed390448666e4aa48b987fe915dd2",
  "public/icons/focustime-512.png": "a4d04ffdc1e4b9d6eceac8a439d2454b6d3c97123c676a509f2d97e98136d384",
  "public/icons/focustime-maskable-512.png": "f9ed590a22898d39a0784daa994fad2397bb4a79b7fd96d6eae1c9c6ffa05115",
  "assets/teams/color.png": "a832c1041f8f58b045baad4e20c8b6f867e576f078dfd2a63fde39cf85be99b1",
  "assets/teams/outline.png": "408beba0cde55027be093d29c9fa6b3dba0f2c9c56ff0672299bf1ce2f7d5937",
};

/** Every file under a folder, skipping what is never source (dependencies, builds, git, screenshots). */
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (/^(node_modules|dist|\.git)$/.test(n)) return [];
    return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
  });

describe("the week mark and the icons (BR-1)", () => {
  it("are byte for byte what they were", () => {
    for (const [f, h] of Object.entries(PINNED)) expect(sha(readFileSync(join(root, f))), f).toBe(h);
  });
  it("mark-week.svg's drawing is unchanged (only Lumen's unused colors left its token block)", () => {
    const s = readFileSync(join(root, "assets/brand/mark-week.svg"), "utf8");
    expect(sha(s.replace(/<style>[\s\S]*?<\/style>/, "")).slice(0, 16)).toBe("5afa30e2930fc89c");
    expect(s).toContain(":root{--brand-am:#1E3A55;--brand-pm:#4FA3DD;--accent:#9CC24F;--ghost:#2B3A4D}");
  });
  it("the brand assets are the week mark's, the wordmark and the favicon only", () => {
    const svgs = readdirSync(join(root, "assets/brand")).filter((n) => n.endsWith(".svg")).sort();
    expect(svgs).toEqual(["favicon.svg", "focustime-symbolic.svg", "mark-week-mono.svg", "mark-week.svg", "wordmark.svg"]);
    for (const t of ["dark", "light"]) expect(readdirSync(join(root, "assets/brand/baked", t)).sort(), t).toEqual(["focustime-symbolic.svg", "mark-week-mono.svg", "mark-week.svg", "wordmark.svg"]);
  });
});

describe("nothing of Lumen is left (BR-1)", () => {
  it("no component, pose, style, token, asset or word for it in what runs or ships", () => {
    const dirs = ["ui", "actions", "assistant", "server", "config", "plan", "week", "store", "sources", "host", "ai", "public", "assets", "scripts", "system", "infra", "docs/technical"];
    const files = [...dirs.flatMap(walk), "index.html"].filter((f) => /\.(tsx?|css|html|svg|json|js|mjs|py|sh|webmanifest|md)$/.test(f) && !/\.test\.tsx?$/.test(f));
    const hits = files.filter((f) => /lumen|mascot|\bbeam|--lime\b|headlight|light bar|bent-?mark|mark-bent|lockup-horizontal|unroll-frame/i.test(readFileSync(join(root, f), "utf8")));
    expect(hits.map((f) => relative(root, join(root, f)))).toEqual([]);
  });
});
