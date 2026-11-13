// TP-1b: three plain questions on the New form and the draft editor, all optional, in place of TP-1's request type and
// four lines. Their words live here and nowhere else (the form, the draft editor, the Guide and the create all read
// them). At create only, the first two answers go into the description as short paragraphs under bold labels, and the
// third into the acceptance criteria where the type's process has that field, else into the description too. No tag,
// no headings, no AI. A draft saved under TP-1 keeps every word: its first three lines become the answers, and the
// rest (the fourth line and its choices) is offered once as plain words at the end of the draft's description.
import { textToHtml } from "./devopswrite.ts";

export const QUESTION_KEYS = ["where", "change", "check"] as const;
export type QuestionKey = (typeof QUESTION_KEYS)[number];

/** The label above each box, the grey text inside it, and the bold label it is written under in DevOps. */
export const QUESTIONS: Readonly<Record<QuestionKey, { label: string; hint: string; written: string }>> = {
  where: { label: "Where is it?", hint: "The report and page, model, table or pipeline", written: "Where" },
  change: { label: "What should change?", hint: "Before and after, or the rule", written: "What should change" },
  check: { label: "How will we know it's right?", hint: "One example and the answer it should give", written: "How we'll know it's right" },
};

/** What a person typed in the three boxes ("" for an empty one). */
export type Answers = Record<QuestionKey, string>;
export const NO_ANSWERS: Answers = { where: "", change: "", check: "" };
/** The longest answer kept (DevOps' own fields hold far more; this keeps a create's patch small). */
export const ANSWER_MAX = 2000;

const tidy = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
export const answersEmpty = (a: Answers | null | undefined): boolean => !a || QUESTION_KEYS.every((k) => !tidy(a[k] ?? ""));

export class AnswersError extends Error {}

/** The answers as the server takes them (the New form, a draft): each optional, plain text, capped. Null when empty. */
export function parseAnswers(v: unknown): Answers | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new AnswersError("answers must be an object");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(QUESTION_KEYS as readonly string[]).includes(k)) throw new AnswersError(`answers has an unknown field ${k}`);
  const a = { ...NO_ANSWERS };
  for (const k of QUESTION_KEYS) {
    const x = o[k];
    if (x === undefined || x === null) continue;
    if (typeof x !== "string") throw new AnswersError(`${QUESTIONS[k].label} must be text`);
    const t = tidy(x);
    if (t.length > ANSWER_MAX) throw new AnswersError(`${QUESTIONS[k].label} is at most ${ANSWER_MAX} characters`);
    a[k] = t;
  }
  return answersEmpty(a) ? null : a;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const para = (label: string, text: string) => `<p><strong>${esc(label)}:</strong> ${text.split("\n").map(esc).join("<br>")}</p>`;

/** What a create writes, as DevOps gets it (HTML) and as the preview shows it (plain text). */
export type Written = { descriptionHtml: string | null; descriptionText: string | null; acceptance: string | null };

/**
 * The description and acceptance a create writes. The description is what was typed in Description (a <div> per line,
 * as DevOps keeps plain text), then one paragraph per answer that has text: "Where:" and "What should change:", and
 * "How we'll know it's right:" only when the type has no acceptance field. With the field, the third answer is the
 * acceptance criteria, after any acceptance a draft already held. Empty answers are left out; nothing at all is null.
 */
export function written(o: { description: string | null | undefined; answers: Answers | null | undefined; acceptance?: string | null | undefined; acField: boolean }): Written {
  const typed = o.description?.trim() || null;
  const a = o.answers ?? NO_ANSWERS;
  const inDescription = QUESTION_KEYS.filter((k) => tidy(a[k]) && (k !== "check" || !o.acField));
  const html = (typed ? textToHtml(typed) : "") + inDescription.map((k) => para(QUESTIONS[k].written, tidy(a[k]))).join("");
  const text = [typed, ...inDescription.map((k) => `${QUESTIONS[k].written}: ${tidy(a[k])}`)].filter(Boolean).join("\n\n");
  const acceptance = o.acField ? [o.acceptance?.trim() || null, tidy(a.check) || null].filter(Boolean).join("\n\n") || null : (o.acceptance?.trim() || null);
  return { descriptionHtml: html || null, descriptionText: text || null, acceptance };
}

// ---- what a draft keeps (draft_stories.brief) ----

/** A draft's answers, and anything a TP-1 draft held beyond them, as plain words not yet saved into its description. */
export type Kept = { answers: Answers | null; carried: string | null };

const str = (v: unknown): string => (typeof v === "string" ? tidy(v) : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const who = (v: unknown): string => (v && typeof v === "object" && !Array.isArray(v) ? str((v as { name?: unknown }).name) : "");
const sentence = (s: string) => (/[.!?:]$/.test(s) ? s : `${s}.`);

/**
 * The draft column, read leniently (it never throws): the three answers, from this step's shape or from a TP-1 brief
 * (its What and where, What changes and How we'll check), and the rest of a TP-1 brief as plain words, one per line:
 * Environment, Touches, Checked by, How far and who signs off, Done when it is, Signed off by, Not without asking. The
 * request type isn't carried (it was a choice of the form's, not words of the person's).
 */
export function keptOf(json: string | null | undefined): Kept {
  if (!json) return { answers: null, carried: null };
  let raw: Record<string, unknown>;
  try {
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { answers: null, carried: null };
    raw = v as Record<string, unknown>;
  } catch {
    return { answers: null, carried: null };
  }
  const answers: Answers = { where: str(raw.where), change: str(raw.change), check: str(raw.check) };
  const env = str(raw.env);
  const touches = list(raw.touches);
  const checkedBy = who(raw.checkedBy);
  const done = str(raw.done);
  const doneWhen = str(raw.doneWhen);
  const signedOffBy = who(raw.signedOffBy);
  const notWithout = list(raw.notWithout);
  const lines = [
    env && sentence(`Environment: ${env}`),
    touches.length > 0 && sentence(`Touches: ${touches.join(", ")}`),
    checkedBy && sentence(`Checked by: ${checkedBy}`),
    done && `How far and who signs off: ${done}`,
    doneWhen && sentence(`Done when it is: ${doneWhen}`),
    signedOffBy && sentence(`Signed off by: ${signedOffBy}`),
    notWithout.length > 0 && sentence(`Not without asking: ${notWithout.join(", ")}`),
  ].filter((x): x is string => typeof x === "string" && !!x);
  return { answers: answersEmpty(answers) ? null : answers, carried: lines.length ? [CARRIED_HEAD, ...lines].join("\n") : null };
}

/** The line above a TP-1 draft's carried words, so the person knows where they came from. */
export const CARRIED_HEAD = "From your earlier draft:";

/** What the draft column holds for these answers (null for none): only the three, so a TP-1 build can still read it. */
export const storedOf = (a: Answers | null | undefined): string | null => (answersEmpty(a) ? null : JSON.stringify({ where: tidy(a!.where), change: tidy(a!.change), check: tidy(a!.check) }));

/** The description cap, 8000 characters, plus room for a TP-1 draft's carried words, so a draft near the cap still saves. */
export const descriptionMax = (carried: string | null | undefined): number => 8000 + (carried ? carried.length + 2 : 0);

/** A draft's description as the person sees it: their own text, then a TP-1 draft's carried words once. */
export const withCarried = (description: string | null | undefined, carried: string | null | undefined): string | null => [description?.trim() || null, carried?.trim() || null].filter(Boolean).join("\n\n") || null;
