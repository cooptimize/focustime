// CV-3b: a follow-up's Who (and a promise's "to whom") is never the person who owns it. Pure: no store, no I/O.
// The owner is known by their Entra id and the names they go by (their FocusTime name, their name in the chat).
import type { PersonRef } from "./person-ref.ts";

export type Owner = { id: string | null; names: readonly (string | null | undefined)[] };
export type Who = { who: string | null; whoRef: PersonRef | null };

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Whether this Who names the owner: by their person (a Cooptimizer ref with their id) or by one of their names. */
export function isOwner(w: { who?: string | null; whoRef?: PersonRef | null }, o: Owner): boolean {
  if (w.whoRef?.kind === "cooptimizer" && o.id && w.whoRef.id.toLowerCase() === o.id.toLowerCase()) return true;
  if (w.whoRef?.kind === "external" && o.id && w.whoRef.memberId.toLowerCase() === o.id.toLowerCase()) return true;
  const t = norm(w.who);
  return !!t && o.names.some((n) => !!norm(n) && norm(n) === t);
}

/** The Who to keep: the one given unless it's the owner, else the fallback (the asker) unless that's the owner too, else none. */
export function whoNotOwner(given: Who, fallback: Who | null, o: Owner): Who {
  if (given.who && !isOwner(given, o)) return given;
  if (fallback?.who && !isOwner(fallback, o)) return fallback;
  return { who: null, whoRef: null };
}
