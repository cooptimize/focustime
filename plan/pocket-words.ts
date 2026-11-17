// PK-2: every word of Settings › Accounts and calendars › Pocket recorder, in one place (docs/design/wording.md,
// "PK-2 words"), the failures' too: the client (sources/pocket/client.ts) throws these, so the server and the page say
// the same thing.

/** Where a person reads how Pocket's API keys work (Pocket's own page; the guide links it). */
export const POCKET_KEYS_DOC = "https://docs.heypocketai.com/docs/api";

export type PocketFailure = "refused" | "not_accepted" | "no_answer" | "busy" | "unexpected";

/** Plain words for each failure, with what to do (wording.md, "PK-2 words"). */
export const POCKET_FAILURE_TEXT: Record<PocketFailure, string> = {
  refused: "FocusTime doesn't make that call to Pocket. It only counts your recordings",
  not_accepted: "Pocket didn't accept this key. Check that you copied all of it, or make a new one in Pocket and paste that",
  no_answer: "Pocket didn't answer in time. Try again in a few minutes",
  busy: "Pocket is busy right now. Try again in a few minutes",
  unexpected: "Pocket answered in a way FocusTime doesn't understand. Pocket's API is new and may have changed; try again later, and tell your FocusTime admin if it keeps happening",
};

export const POCKET_WORDS = {
  title: "Pocket recorder",
  /** What connecting does, in one sentence. */
  intro:
    "Connect your own Pocket so FocusTime can bring in a recording of a client call when you ask (that comes in a later update). For now FocusTime only checks that your key works by counting your recordings from the last 7 days; it never reads their titles, words or audio.",
  stepsLabel: "How to connect",
  steps: [
    "In Pocket, make an API key for yourself, from your own Pocket account. Don't use a key someone shares with a team.",
    "If Pocket asks what the key may do, choose only reading recordings (recordings:read).",
    "Copy the whole key. It starts with pk_, and Pocket may show it only once.",
    "Paste it below and press Check and save. Nothing is saved unless Pocket answers.",
  ],
  docsLink: "Pocket's guide to API keys",
  field: "Your Pocket key",
  fieldHint: "Paste your Pocket key (pk_…)",
  checkAndSave: "Check and save",
  checking: "Checking with Pocket…",
  connected: "Connected",
  checkAgain: "Check again",
  replace: "Use a new key",
  replaceHint: "The new key replaces this one only if Pocket accepts it.",
  disconnect: "Disconnect",
  /** Disconnect asks first. */
  disconnectAsk: "Disconnect Pocket? FocusTime forgets your key now. Your recordings stay in Pocket; you can also delete the key there.",
  keep: "Keep it",
  cancel: "Cancel",
  kept: "FocusTime keeps your key encrypted, only for you, and never shows it again. It asks Pocket only when you press a button here.",
  notChecked: "Not checked yet",
  saved: "Connected. Pocket answered.",
  checkedNow: "Checked. Pocket answered.",
  gone: "Disconnected. FocusTime forgot your key.",
} as const;

/** "6 recordings in the last 7 days" (never which, never their titles). */
export const recordingsLine = (n: number) => `${n} ${n === 1 ? "recording" : "recordings"} in the last 7 days`;

/** "checked just now", "checked 5 min ago", "checked 2 h ago", "checked Nov 12". */
export function checkedAgo(at: string, nowMs: number, timeZone: string): string {
  const i = Temporal.Instant.from(at);
  const mins = Math.floor((nowMs - i.epochMilliseconds) / 60_000);
  if (mins < 1) return "checked just now";
  if (mins < 60) return `checked ${mins} min ago`;
  if (mins < 24 * 60) return `checked ${Math.floor(mins / 60)} h ago`;
  return `checked ${i.toZonedDateTimeISO(timeZone).toPlainDate().toLocaleString("en-US", { month: "short", day: "numeric" })}`;
}
