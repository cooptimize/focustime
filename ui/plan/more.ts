// fix/planday-pane: the right pane's "More from <client>'s DevOps · N" section in Plan the day. Its words, when it
// opens on its own, and a fold or unfold by hand remembered per client for the session (sessionStorage, so a reload
// keeps it and a new window starts fresh). Pure apart from that storage.

/** "Proseware's", "Atlas'": the client's name as a possessive. */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** The section's label; FoldLine adds " · N". */
export const moreLabel = (clientName: string) => `More from ${possessive(clientName)} DevOps`;

/** Open on its own only when nothing is above it: no musts for this client this week and no follow-ups. */
export const moreOpenByDefault = (musts: number, followUps: number) => musts === 0 && followUps === 0;

/** The line at its top when nothing is planned for the client this week, in three parts: the middle one links to Plan the week. */
export const NOTHING_PLANNED = [(clientName: string) => `Nothing planned for ${clientName} this week. Pick from DevOps, or `, "plan the week", " first."] as const;

const KEY = (clientKey: string) => `focustime.planday.more.${clientKey}`;

/** A fold or unfold by hand for this client this session, or null when there's none. */
export function sessionFold(clientKey: string, store: Pick<Storage, "getItem"> | null = safeSession()): boolean | null {
  try {
    const v = store?.getItem(KEY(clientKey));
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

export function rememberFold(clientKey: string, open: boolean, store: Pick<Storage, "setItem"> | null = safeSession()): void {
  try {
    store?.setItem(KEY(clientKey), open ? "1" : "0");
  } catch {
    // Storage can be unavailable (private window, blocked site data): the fold just isn't remembered.
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
