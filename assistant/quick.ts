// TB-3: the few phrases the Assistant answers with no AI call, for the panel and Teams alike (they were the Teams bot's
// own commands until TB-3). Help and open always; what's next and today when the AI can't run (off, not set up, a cap),
// so AI off behaves the same in both.
export type Quick = "next" | "today" | "help" | "open";

/** The phrase a message is, or null. Mentions, case, punctuation and extra spaces don't matter. */
export function quickOf(text: string): Quick | null {
  const t = text.replace(/<at>[^<]*<\/at>/gi, " ").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (["whats next", "what is next", "next", "whats up next"].includes(t)) return "next";
  if (["today", "my day", "todays plan", "what about today"].includes(t)) return "today";
  if (["help", "commands", "what can you do"].includes(t) || text.trim() === "?") return "help";
  if (["open focustime", "open focus time", "open", "open the app", "link"].includes(t)) return "open";
  return null;
}
