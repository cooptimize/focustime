// Text size (U5, D401): three presets off one base (--text-base in styles.css), not a slider. The UI applies the
// saved one at start (mirrored locally so the first paint is right), Settings > Display changes it live, and
// Ctrl+plus, Ctrl+minus and Ctrl+0 step through it when no text field has focus.
import { useEffect, useState } from "react";
import { TEXT_SIZES, type TextSize } from "../config/schema.ts";

export const TEXT_SIZE_NAMES: Record<TextSize, string> = { default: "Default", large: "Large", larger: "Larger" };
/** What each preset sets --text-base to (the body size; the four steps are base − 2, − 1, base, + 2). */
export const TEXT_BASE_PX: Record<TextSize, number> = { default: 13, large: 15, larger: 17 };

/** One step up or down, stopping at Default and Larger. */
export function stepTextSize(cur: TextSize, dir: 1 | -1): TextSize {
  const i = TEXT_SIZES.indexOf(cur) + dir;
  return TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, i))]!;
}

/** --text-scale: base / 13, for spacing that pairs with text (line heights, row heights, the day timeline). */
export const textScale = (s: TextSize): number => TEXT_BASE_PX[s] / TEXT_BASE_PX.default;

type KeyIn = { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };
/** Ctrl+plus (or Ctrl+=), Ctrl+minus and Ctrl+0; Cmd on a Mac. Null for anything else. */
export function textSizeKey(e: KeyIn): "up" | "down" | "reset" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") return "up";
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") return "down";
  if (e.key === "0" || e.code === "Numpad0") return "reset";
  return null;
}

const KEY = "focustime.textSize";
const isSize = (v: unknown): v is TextSize => typeof v === "string" && (TEXT_SIZES as readonly string[]).includes(v);

/** The size the last session saw, for the first paint before the config arrives. */
export function storedTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    return isSize(v) ? v : "default";
  } catch {
    return "default";
  }
}

const EVENT = "focustime:text-size";
const current = (): TextSize => {
  const v = typeof document === "undefined" ? null : document.documentElement.getAttribute("data-text-size");
  return isSize(v) ? v : "default";
};

/** --text-scale for layout done in script (the day timeline's minutes to pixels); follows live changes. */
export function useTextScale(): number {
  const [s, setS] = useState(current);
  useEffect(() => {
    const on = () => setS(current());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return textScale(s);
}

/** Sets <html data-text-size> (none for Default) and remembers it locally. */
export function applyTextSize(s: TextSize): void {
  if (s === "default") document.documentElement.removeAttribute("data-text-size");
  else document.documentElement.setAttribute("data-text-size", s);
  try {
    if (s === "default") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, s);
  } catch {
    // Private windows and blocked storage: the config still has it.
  }
  window.dispatchEvent(new Event(EVENT));
}
