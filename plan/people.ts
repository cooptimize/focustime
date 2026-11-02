// Matching people from DevOps to Cooptimizers (step 16.4): by email (DevOps uniqueName to the Dataverse/Entra user),
// falling back to the display name only when there is no email, and then only when exactly one Cooptimizer has it.
// Pure: no I/O.

export type Teammate = { name: string; email: string };

/** The Cooptimizer a DevOps person is, or null (not a Cooptimizer, or not sure). */
export function matchCooptimizer<T extends Teammate>(team: readonly T[], who: { email?: string | null; name?: string | null }): T | null {
  const email = who.email?.trim().toLowerCase();
  // An email decides: a different display name doesn't matter, and a same-named non-Cooptimizer never matches.
  if (email) return team.find((t) => t.email.trim().toLowerCase() === email) ?? null;
  const name = who.name?.trim().toLowerCase();
  if (!name) return null;
  const same = team.filter((t) => t.name.trim().toLowerCase() === name);
  return same.length === 1 ? same[0]! : null;
}
