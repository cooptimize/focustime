// The words for "who am I in Dataverse" problems, shared by Settings › Clients and the week's Dataverse status. Two
// cases a person can tell apart: Dataverse didn't answer (auth, a missing secret, the network, a wrong environment), or
// it answered and no Cooptimize staff record (a Dataverse user) has their work email or sign-in name.
// Never "sign in" words: whoever sees these is signed in already.

export const DATAVERSE_UNREACHABLE = "Couldn't reach Dataverse. Try again, or tell the FocusTime team.";

export const noDataverseMatch = (email: string | null) => `No Cooptimize staff record matches ${email || "your work email"}. Ask the FocusTime team.`;

export const manyDataverseMatches = (email: string) => `More than one Cooptimize staff record matches ${email}. Ask the FocusTime team.`;

/** What matchMe found: the Dataverse user, or why not. */
export type MatchResult = { ok: true; id: string } | { ok: false; reason: "none" | "many" | "failed"; message: string };
