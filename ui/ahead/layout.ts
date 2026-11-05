// AH-3: how Ahead lays out at a window size. The breakpoints are window widths at Default text; a larger Text size
// counts as a narrower window (width / text scale), so the Item column keeps its minimum at Larger too.
//
//   wide    1400 and up: State, Start, Target, Assigned to, Size and Readiness chips beside Item
//   dates   1200 to 1400: Start and Target as one Dates column ("Apr 1 → Apr 30")
//   dots    900 to 1200: Readiness as small dots, the words in a tooltip
//   cards   under 900 and on the phone: each row a two-line card
import { useEffect, useState } from "react";

export type GridLayout = "wide" | "dates" | "dots" | "cards";

/** The Item column's minimum at Default text (it scales with the text). */
export const ITEM_MIN = 320;

export function gridLayout(windowWidth: number, textScale = 1): GridLayout {
  const w = windowWidth / (textScale > 0 ? textScale : 1);
  return w >= 1400 ? "wide" : w >= 1200 ? "dates" : w >= 900 ? "dots" : "cards";
}

/** The Gantt's label column: a readable minimum (240 at Default), about a quarter of the box, at most 440; the timeline scrolls. */
export function ganttLabelW(boxWidth: number, textScale = 1): number {
  const s = textScale > 0 ? textScale : 1;
  return Math.round(Math.max(240 * s, Math.min(440 * s, boxWidth * 0.26)));
}

const scaleNow = () => {
  if (typeof document === "undefined") return 1;
  const v = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-scale"));
  return Number.isFinite(v) && v > 0 ? v : 1;
};

/** The window width and the text scale, following resizes and Text size changes. */
export function useWindowScale(): { width: number; scale: number } {
  const read = () => ({ width: typeof window === "undefined" ? 1920 : window.innerWidth, scale: scaleNow() });
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV((o) => {
      const n = read();
      return n.width === o.width && n.scale === o.scale ? o : n;
    });
    window.addEventListener("resize", on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-size", "style", "class"] });
    on();
    return () => (window.removeEventListener("resize", on), mo.disconnect());
  }, []);
  return v;
}
