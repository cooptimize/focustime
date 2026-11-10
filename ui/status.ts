// The status bar's model (step 6.1): failures grouped by root cause, so a locked keyring shows once and names
// every source it affects, and the actions each source offers in its current state. Pure, no React.
import type { SourceSummary } from "../actions/types.ts";
import type { ClientWork, FailureCause, IsoDateTime } from "../week/types.ts";

export const SOURCE_NAMES = { dataverse: "Dataverse", pto: "PTO", outlook: "Outlook", google: "Google", ics: "Calendar link" } as const;

/** A source's name on screen: a calendar link by the name its person gave it (CAL-1). */
export const sourceLabel = (s: Pick<SourceSummary, "source" | "link">): string => (s.source === "ics" && s.link ? s.link.name : SOURCE_NAMES[s.source]);
/** A React key that is unique when there are several calendar links. */
export const sourceKey = (s: Pick<SourceSummary, "source" | "link">): string => (s.link ? `ics:${s.link.id}` : s.source);

export type Calendar = "outlook" | "google";
/** What a source's own entry offers. Retry lives on the cause line; Unlock is the user's step, then Retry. */
export type SourceAction = "connect" | "reconnect" | "disconnect";

const isCalendar = (s: SourceSummary): s is SourceSummary & { source: Calendar } => s.source === "outlook" || s.source === "google";
/** A calendar never connected: its entry shows Connect and it is not a failure. */
export const notConnected = (s: SourceSummary) => s.status === "auth_required" && !s.fromCache && !!s.message?.includes("not connected");

/**
 * Actions that make sense for a source now. Disconnect only for a live calendar: when a calendar shows cached
 * data because of a shared failure (a locked keyring, no network), disconnecting would not fix it, and with a
 * locked keyring it could not even forget the sign-in. Connect or Reconnect only when that is the fix.
 */
export function sourceActions(s: SourceSummary): SourceAction[] {
  if (!isCalendar(s) || s.sample) return [];
  const connectFix = s.fixAction === "connect_microsoft" || s.fixAction === "connect_google";
  if (connectFix && s.cause !== "keyring") return [notConnected(s) ? "connect" : "reconnect"];
  if (s.status === "ok") return ["disconnect"];
  return [];
}

/** The chip's state word. Cached data says so; the cause is on its line. */
export function stateOf(s: SourceSummary): { cls: string; label: string } {
  if (s.sample) return { cls: "sample", label: "sample" };
  if (s.status === "ok") return { cls: "live", label: "live" };
  if (s.status === "auth_required") return { cls: "signin", label: "needs sign-in" };
  // CAL-1: a calendar link that stopped working says so, whatever it still shows.
  if (s.link?.broken) return { cls: "error", label: "stopped working" };
  if (s.fromCache) return { cls: "cached", label: "cached" };
  if (s.cause) return { cls: "error", label: "failed" };
  return { cls: "error", label: s.status.replace("_", " ") };
}

export type Fix = { kind: "retry" } | { kind: "connect" | "reconnect"; calendar: Calendar } | { kind: "replace_link"; id: string };

export type CauseLine = {
  /** Stable key: the shared cause, or the source for a failure of its own. */
  key: string;
  cause: FailureCause | null;
  /** Names of everything it affects, in status bar order ("DevOps (4 clients)" for DevOps). */
  affected: string[];
  /** One plain sentence: what happened. */
  text: string;
  /** The step the user takes before the fix, if any ("Unlock the keyring"). */
  step: string | null;
  /** Oldest saved data still shown for the affected sources; null when nothing saved is shown. */
  since: IsoDateTime | null;
  /** True when at least one affected source has no saved data to show. */
  missing: boolean;
  fixes: Fix[];
};

const CAUSE_TEXT: Record<FailureCause, { text: (names: string) => string; step: string }> = {
  keyring: { text: (n) => `Keyring locked or unavailable, so ${n} can't sign in`, step: "Unlock the keyring" },
  network: { text: (n) => `Can't reach ${n} (offline, or the service is down)`, step: "Check the connection" },
};

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const older = (a: string | null, b: string | null) => (!a ? b : !b ? a : Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b)) <= 0 ? a : b);

/**
 * One line per root cause. Sources failing for a shared cause (keyring, network) collapse into one line that
 * names each of them, DevOps included when its Dataverse settings failed for that cause. Every other failure
 * keeps its own line with its own message (identical messages once). DevOps failures of its own (a PAT, a
 * project) stay in the DevOps popover, as before.
 */
export function causeLines(sources: readonly SourceSummary[], devops: readonly ClientWork[] | null): CauseLine[] {
  const lines = new Map<string, CauseLine>();
  const add = (key: string, cause: FailureCause | null, name: string, fetchedAt: string | null, fromCache: boolean, own: Omit<CauseLine, "key" | "cause" | "affected" | "since" | "missing" | "fixes"> | null, fix: Fix) => {
    let line = lines.get(key);
    if (!line) {
      line = { key, cause, affected: [], text: own?.text ?? "", step: own?.step ?? null, since: null, missing: false, fixes: [] };
      lines.set(key, line);
    }
    if (!line.affected.includes(name)) line.affected.push(name);
    if (fromCache) line.since = older(line.since, fetchedAt);
    else line.missing = true;
    if (!line.fixes.some((f) => JSON.stringify(f) === JSON.stringify(fix))) line.fixes.push(fix);
  };

  for (const s of sources) {
    if (s.sample || s.status === "ok" || notConnected(s)) continue;
    const name = sourceLabel(s);
    const connect = sourceActions(s).find((a) => a === "connect" || a === "reconnect");
    // CAL-1: a link that stopped working is replaced, not retried.
    const fix: Fix = connect && isCalendar(s) ? { kind: connect, calendar: s.source } : s.link?.broken ? { kind: "replace_link", id: s.link.id } : { kind: "retry" };
    if (s.cause) add(s.cause, s.cause, name, s.fetchedAt, s.fromCache, null, fix);
    else add(`msg:${s.link ? `${s.link.id}:` : ""}${s.message ?? `${name} ${s.status}`}`, null, name, s.fetchedAt, s.fromCache, { text: s.link ? `${name}: ${ownText(s)}` : ownText(s), step: null }, fix);
  }
  const shared = (devops ?? []).filter((c) => c.status !== "ok" && c.cause);
  for (const cause of new Set(shared.map((c) => c.cause!))) {
    const mine = shared.filter((c) => c.cause === cause);
    const name = `DevOps (${mine.length} ${mine.length === 1 ? "client" : "clients"})`;
    for (const c of mine) add(cause, cause, name, c.fetchedAt, c.fromCache, null, { kind: "retry" });
  }
  for (const line of lines.values()) {
    if (line.cause) {
      line.text = CAUSE_TEXT[line.cause].text(joinNames(line.affected));
      line.step = CAUSE_TEXT[line.cause].step;
    }
  }
  // Shared causes first: they explain the most.
  return [...lines.values()].sort((a, b) => Number(!!b.cause) - Number(!!a.cause) || b.affected.length - a.affected.length);
}

/** A source's own failure in one sentence, without the "Showing data from" tail (the line shows that). */
function ownText(s: SourceSummary): string {
  const m = s.message ?? `${sourceLabel(s)} ${s.status.replace("_", " ")}`;
  return m.replace(/\.?\s*Replace it\?$/, "").replace(/\.\s*(Showing (data|PTO|items) from .*|No cached (data|PTO|items) yet)$/, "");
}

const CAUSE_WORD: Record<FailureCause, string> = { keyring: "keyring locked", network: "offline" };

/** The true cause in a few words for a source or a client, e.g. "keyring locked". */
export const causeWord = (c: FailureCause) => CAUSE_WORD[c];
