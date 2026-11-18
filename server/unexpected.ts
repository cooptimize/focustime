// VM-4: an action that fails in a way the server didn't expect (Nov 17: a check-in answer the database refused) is
// answered as a server error in plain words, never the bare "bad request" it used to get: that it didn't work, to try
// again, and to tell an admin if it keeps happening, with a short reference. The same reference is in the log beside
// the action's name and the error's kind (its type), and nothing else: never a name, an id, a token or a message.
import { randomInt } from "node:crypto";

export const UNEXPECTED_CODE = "unexpected";
/** Letters and digits that can't be mistaken for one another when read out (no 0/O, 1/I/L, U/V). */
const ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
/** A 6-character reference, random: it says nothing about the person, the request or the data. */
export const newRef = (): string => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const isRef = (s: string) => /^[A-HJ-NP-TW-Z2-9]{6}$/.test(s);

/** The error's kind for the log: its type's name when it is one plain word (RequestError, TypeError), else "Error". */
export function errorKind(e: unknown): string {
  const n = e instanceof Error ? (e.constructor?.name && e.constructor.name !== "Error" ? e.constructor.name : e.name) : typeof e;
  return typeof n === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(n) ? n : "Error";
}

/** The words the person sees (docs/design/wording.md). */
export const unexpectedWords = (ref: string) => `That didn't work: FocusTime ran into a problem it didn't expect. Try again, and if it keeps happening, tell an admin (reference ${ref}).`;
/** A request FocusTime couldn't read at all (not JSON): its own answer, a 400, in plain words. */
export const MALFORMED_WORDS = "FocusTime couldn't read that request. Reload the page and try again.";

export type UnexpectedAnswer = { ok: false; status: 500; code: typeof UNEXPECTED_CODE; ref: string; error: string };
export const unexpectedAnswer = (ref: string): UnexpectedAnswer => ({ ok: false, status: 500, code: UNEXPECTED_CODE, ref, error: unexpectedWords(ref) });
