// Themes (step 6b, D120): one attribute on <html> swaps every semantic and domain token, live. The config's
// [ui] theme is the truth; a copy in localStorage only avoids a flash of the default theme while loading.
import { DEFAULT_UI, THEMES, type Theme } from "../config/schema.ts";

const KEY = "focustime.theme";
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Storage can be unavailable (private window, blocked site data): the config still has it.
  }
}

/** The theme to paint before the first load: the last one seen, else the default. */
export function initialTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (isTheme(v)) return v;
  } catch {
    // ignore, see above
  }
  return DEFAULT_UI.theme;
}
