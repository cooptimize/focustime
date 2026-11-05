// CV-2: a person as the PersonPicker stores them, beside the text (follow_ups.who_ref): a Cooptimizer by their Entra
// object id (or the directory's id for one who hasn't signed in), or someone outside Cooptimize by their chat member
// id, each with the name shown when it was chosen. No reference: a plain name, "not linked to a person". Never an
// email address. Pure.

export type PersonRef = { kind: "cooptimizer"; id: string; name: string } | { kind: "external"; memberId: string; name: string };

const ID = /^[A-Za-z0-9:._@-]{1,100}$/;
const name = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 100 ? v.trim() : null);

/** A reference from the page or the store, or null when it isn't one (anything else is dropped, never guessed). */
export function personRef(v: unknown): PersonRef | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const n = name(o.name);
  if (!n) return null;
  if (o.kind === "cooptimizer" && typeof o.id === "string" && ID.test(o.id) && Object.keys(o).length === 3) return { kind: "cooptimizer", id: o.id.toLowerCase(), name: n };
  if (o.kind === "external" && typeof o.memberId === "string" && ID.test(o.memberId) && Object.keys(o).length === 3) return { kind: "external", memberId: o.memberId.toLowerCase(), name: n };
  return null;
}

export const refJson = (r: PersonRef | null) => (r ? JSON.stringify(r) : null);
export function refOf(json: unknown): PersonRef | null {
  if (typeof json !== "string" || !json) return null;
  try {
    return personRef(JSON.parse(json));
  } catch {
    return null;
  }
}
export const sameRef = (a: PersonRef | null, b: PersonRef | null) => !!a && !!b && a.kind === b.kind && (a.kind === "cooptimizer" ? a.id === (b as typeof a).id : a.memberId === (b as Extract<PersonRef, { kind: "external" }>).memberId);
