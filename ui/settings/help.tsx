// SA-5: a help line's length and its "More about this", on their own so a screen in the first download (Account) can
// keep its help to two lines without bringing all of Settings' parts (ui/settings/parts.tsx re-exports these).
import type { ReactNode } from "react";
import { useTextScale } from "../textsize.ts";
import { usePhone } from "../viewport.ts";

export const MORE = "More about this";

/**
 * SA-5: how long one help line may be before the rest goes behind More about this: about two lines on a computer, and
 * on a phone two lines at the Text size in use (fewer characters as the text grows).
 */
export function useHelpMax(): number {
  const phone = usePhone();
  const scale = useTextScale();
  return phone ? Math.round(72 / scale) : 80;
}

/**
 * SA-2: a help line keeps to about two lines on a phone: past `max` characters it ends at a sentence (or, failing
 * that, a clause) and the rest goes behind "More about this", word for word. Cut inside a sentence, the shown part
 * ends with "…" and the rest starts with it, so neither reads as finished (SA-2 review).
 */
export function splitHelp(t: string, max = 80, longest = max + 10, first = max): [string, string | null] {
  if (t.length <= max) return [t, null];
  const dot = t.lastIndexOf(". ", max);
  if (dot > 20) return [t.slice(0, dot + 1), t.slice(dot + 2)];
  for (const sep of [": ", "; ", ", "]) {
    const j = t.lastIndexOf(sep, max);
    if (j > 20) return [`${t.slice(0, j)}…`, `…${t.slice(j + 2)}`];
  }
  for (const word of [" (", " when ", " with "]) {
    const j = t.lastIndexOf(word, max);
    if (j > 20) return [`${t.slice(0, j)}…`, `…${t.slice(j + 1)}`];
  }
  if (max < longest) return splitHelp(t, max + 12, longest, first);
  // SA-5: no clause ends near enough: the line ends at a word, the rest goes behind More about this.
  const sp = t.lastIndexOf(" ", first);
  return sp > 20 ? [`${t.slice(0, sp)}…`, `…${t.slice(sp + 1)}`] : [t, null];
}

/** What doesn't fit in a row's one help line, word for word, behind "More about this". */
export function More({ children }: { children: ReactNode }) {
  return (
    <details className="sp-more">
      <summary>{MORE}</summary>
      <span className="sp-more-text">{children}</span>
    </details>
  );
}

/**
 * SA-5: a help line written in a section of its own (not a Row's): two lines at most, the rest behind More about this.
 * `as` keeps the element and class the section used.
 */
export function HelpLine({ text, className = "muted", as = "p" }: { text: string; className?: string; as?: "p" | "span" }) {
  const max = useHelpMax();
  const [shown, spill] = splitHelp(text, max);
  const El = as;
  return (
    <>
      <El className={className}>{shown}</El>
      {spill && <More>{spill}</More>}
    </>
  );
}
