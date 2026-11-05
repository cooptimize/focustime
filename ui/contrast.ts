// WT-1 follow-up: a project's type color, readable on the current theme. Only the display changes; the stored color
// (the project's own) is never touched. Non-text graphics need 3:1 (WCAG 1.4.11): a color under that against the page
// is moved toward white on a dark theme or toward black on a light one, just far enough.
import { useSyncExternalStore } from "react";
import { contrast, luminance } from "../config/org.ts";

export const MIN_ICON_CONTRAST = 3;

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const mix = (hex: string, toward: number, t: number) => `#${rgbOf(hex).map((c) => hex2(c + (toward - c) * t)).join("")}`;

/** "#rrggbb" at least `min`:1 against every background given (the nearest such color toward white or black). */
export function readableOn(color: string, backgrounds: readonly string[], min = MIN_ICON_CONTRAST): string {
  const c = color.toLowerCase();
  if (!backgrounds.length || backgrounds.every((bg) => contrast(c, bg) >= min)) return color;
  // A dark page lifts the color, a light one deepens it (from the darkest background given).
  const dark = Math.min(...backgrounds.map(luminance)) < 0.2;
  const toward = dark ? 255 : 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const t = (lo + hi) / 2;
    if (backgrounds.every((bg) => contrast(mix(c, toward, t), bg) >= min)) hi = t;
    else lo = t;
  }
  return mix(c, toward, hi);
}

/** A CSS color ("#rgb", "#rrggbb" or "rgb(r, g, b)") as "#rrggbb", or null. */
export function cssHex(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((x) => x + x).join("")}`;
  const m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  return m ? `#${[m[1], m[2], m[3]].map((x) => hex2(Number(x))).join("")}` : null;
}

// The page's backgrounds (--bg and --surface), read once per theme change: the data-theme attribute or the system's
// light or dark. One observer for the whole app.
let current: readonly string[] = [];
const listeners = new Set<() => void>();
function read(): readonly string[] {
  if (typeof document === "undefined") return [];
  const st = getComputedStyle(document.documentElement);
  const next = ["--bg", "--surface"].map((v) => cssHex(st.getPropertyValue(v))).filter((x): x is string => !!x);
  if (next.join() !== current.join()) current = next;
  return current;
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1 && typeof window !== "undefined") {
    const changed = () => {
      read();
      for (const l of listeners) l();
    };
    const mo = new MutationObserver(changed);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", changed);
    stop = () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", changed);
    };
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) stop();
  };
}
let stop = () => {};

/** The current theme's page backgrounds as "#rrggbb" (empty before the styles load, or outside a browser). */
export const usePageBackgrounds = (): readonly string[] =>
  useSyncExternalStore(
    subscribe,
    () => (current.length ? current : read()),
    () => NONE,
  );
const NONE: readonly string[] = [];
