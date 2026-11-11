// QT-2: the words that tell a person they planned too much, and the phrases with "over" or "fit" that mean something
// else. Used by assistant/over-words.test.ts (answers, Teams cards, notices, the Guide) and e2e/qt2.test.ts (the
// demo's screens). "overdue", "leftover", "hover", "overview", "override" and "overflow" are other words: the word
// boundaries below never match inside them (a promise can be overdue).

/** Phrases that use "over", "fit" or "too much" about something other than how much is planned. */
export const NOT_ABOUT_THE_PLAN: readonly { re: RegExp; why: string }[] = [
  { re: /\b(take|takes|taking|took|taken) (it |them |this |that )?over\b/gi, why: "a promise or item changing hands (Take it over)" },
  { re: /\bcarr(y|ies|ied|ying) over\b/gi, why: "last week's work coming forward (Carry over)" },
  { re: /\bstart over\b/gi, why: "the Guide's try-its reset" },
  { re: /\bbreak over\b/gi, why: "the focus timer's break ended" },
  { re: /\bmorning over afternoon\b|\bAM over PM\b|\bthe line over Week\b/gi, why: "layout: one thing drawn above another" },
  { re: /\bover half a day\b/gi, why: "a send waiting for an answer" },
  { re: /\bover a whole morning\b/gi, why: "out of office covering a half-day" },
  { re: /\b(still )?don['’]t fit, the day\b|\bdoesn['’]t fit a mode\b/gi, why: "the window's layout (narrow screens, Ahead's toolbar)" },
  { re: /\bDoes FocusTime tell me I planned too much\?/g, why: "the Guide's FAQ that answers no" },
  { re: /\bAlready over\b/g, why: "Week's drop refusal on a day that has ended (time, not the plan)" },
];

/** What a person must never read about their plan (QT-2's list, plus QT-1's status words). Any case. */
export const PLAN_WORDS = /\b(over|overloaded|over-?plann(ed|ing)|too much|doesn['’]t fit|won['’]t fit|room for [a-z0-9 ]{1,20}more)\b/gi;
/** "Full" and "Fits" as status words: capitalized ("full width" or "the free time that fits" are sentences). */
export const STATUS_WORDS = /\b(Full|Fits)\b(?! (width|text|name|date|list|address|page|screen))/g;

/** Each place in `text` that tells a person they planned too much, with a little context; [] when none. */
export function planWordsIn(text: string): string[] {
  let t = text;
  for (const x of NOT_ABOUT_THE_PLAN) t = t.replace(x.re, " ");
  return [...t.matchAll(PLAN_WORDS), ...t.matchAll(STATUS_WORDS)].map((m) => t.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 30).replace(/\s+/g, " "));
}
