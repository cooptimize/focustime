// Shared shell for the Outlook and Google calendar sources: token, one 401 retry, snapshot cache,
// memory TTL and plain failure states. Never throws to callers.
import type { SnapshotStore } from "../../host/types.ts";
import type { Logger } from "../../log/logger.ts";
import type { CalEvent, FailureCause, SourceResult } from "../../week/types.ts";
import { AuthFailure, type ConnectOptions, type ConnectResult, type OAuthClient } from "../oauth/oauth.ts";
import { formatFetchedAt } from "../when.ts";
import { ForeignLinkError, HttpError, NetworkError, PartialError } from "./http.ts";

type Status = SourceResult<unknown>["status"];
type FixAction = NonNullable<SourceResult<unknown>["fixAction"]>;

/** A provider-specific failure with a safe message (e.g. Google calendar not found). */
export class FetchFailure extends Error {
  readonly status: Status;
  readonly fixAction: FixAction | undefined;
  constructor(status: Status, message: string, fixAction?: FixAction) {
    super(message);
    this.status = status;
    this.fixAction = fixAction;
  }
}

export type CalendarSourceDeps = {
  id: "outlook" | "google";
  label: string;
  connectAction: "connect_microsoft" | "connect_google";
  auth: OAuthClient;
  fetchWeek: (weekStart: string, token: string) => Promise<CalEvent[]>;
  snapshots: SnapshotStore;
  log: Logger;
  timeZone: string;
  now?: () => Temporal.Instant;
  memoryTtlMs?: number;
  /** RS-2: how long a read may hold the week before the last good copy answers instead (3 s). */
  answerWithinMs?: number;
};

export function createCalendarSource(d: CalendarSourceDeps) {
  const now = d.now ?? (() => Temporal.Now.instant());
  const ttl = d.memoryTtlMs ?? 5 * 60_000;
  const answerWithin = d.answerWithinMs ?? 3000;
  const memory = new Map<string, { at: number; result: SourceResult<CalEvent> }>();
  /** RS-2: a week's read under way, which a second load joins instead of starting another. */
  const reading = new Map<string, Promise<SourceResult<CalEvent>>>();
  const L = d.label;

  type Mapped = { status: Status; message: string; fixAction?: FixAction; useCache: boolean; cause?: FailureCause };
  function map(e: unknown): Mapped {
    if (e instanceof AuthFailure) {
      switch (e.kind) {
        case "not_connected": return { status: "auth_required", message: `${L} is not connected yet`, fixAction: d.connectAction, useCache: false };
        case "expired": return { status: "auth_required", message: `${L} needs reconnecting`, fixAction: d.connectAction, useCache: true };
        case "consent": return { status: "auth_required", message: `${L} needs you to sign in again`, fixAction: d.connectAction, useCache: true };
        case "network": return { status: "unreachable", message: `${L} unreachable`, useCache: true, cause: "network" };
        case "keyring": return { status: "error", message: e.message, useCache: true, cause: "keyring" };
        case "misconfigured": return { status: "misconfigured", message: e.message, fixAction: "open_settings", useCache: true };
        default: return { status: "error", message: e.message, useCache: true };
      }
    }
    if (e instanceof FetchFailure) return { status: e.status, message: e.message, ...(e.fixAction ? { fixAction: e.fixAction } : {}), useCache: true };
    if (e instanceof HttpError) {
      if (e.status === 401) return { status: "auth_required", message: `${L} needs reconnecting`, fixAction: d.connectAction, useCache: true };
      if (e.status === 403) return { status: "misconfigured", message: `${L} refused access: check the calendar permission for FocusTime`, fixAction: "open_settings", useCache: true };
      return { status: "error", message: `${L} error (HTTP ${e.status})`, useCache: true };
    }
    if (e instanceof NetworkError) return { status: "unreachable", message: `${L} unreachable`, useCache: true, cause: "network" };
    if (e instanceof PartialError) return { status: "error", message: `${L} returned only part of the results, so none were used`, useCache: true };
    if (e instanceof ForeignLinkError) return { status: "error", message: `${L} returned a next-page link to another host, so it was not followed`, useCache: true };
    d.log({ source: d.id, op: "load", kind: "unexpected" });
    return { status: "error", message: `${L} load failed`, useCache: true };
  }

  async function fetchLive(weekStart: string): Promise<SourceResult<CalEvent>> {
    let token = await d.auth.accessToken();
    let events: CalEvent[];
    try {
      events = await d.fetchWeek(weekStart, token);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 401)) throw e;
      d.log({ source: d.id, op: "retry_after_401" });
      d.auth.invalidate();
      token = await d.auth.accessToken();
      events = await d.fetchWeek(weekStart, token);
    }
    const fetchedAt = now().toZonedDateTimeISO(d.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
    await d.snapshots.write(d.id, weekStart, { fetchedAt, items: events }).catch(() => d.log({ source: d.id, op: "cache_write", kind: "failed" }));
    return { source: d.id, status: "ok", fetchedAt, fromCache: false, items: events };
  }

  /** One read of a week: live, else what failed with the last good copy (if any). Never throws; remembered for the TTL. */
  async function read(weekStart: string): Promise<SourceResult<CalEvent>> {
    const t = now().epochMilliseconds;
    let result: SourceResult<CalEvent>;
    try {
      result = await fetchLive(weekStart);
    } catch (e) {
      const m = map(e);
      const snap = m.useCache ? await d.snapshots.read<CalEvent>(d.id, weekStart).catch(() => null) : null;
      const at = snap ? formatFetchedAt(snap.fetchedAt, d.timeZone, now()) : null;
      const message = !m.useCache
        ? m.message
        : at
          ? m.status === "unreachable" ? `Offline, showing data from ${at}` : `${m.message}. Showing data from ${at}`
          : `${m.message}. No cached data yet`;
      result = { source: d.id, status: m.status, fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: snap?.items ?? [], message };
      if (m.fixAction) result.fixAction = m.fixAction;
      if (m.cause) result.cause = m.cause;
    }
    memory.set(weekStart, { at: t, result });
    return result;
  }

  /**
   * RS-2: a slow or failing calendar never holds the week. When the read isn't in after `answerWithin` and there is an
   * earlier good copy, that copy answers, marked as a failed read is (unreachable, with its age); the read finishes
   * behind it and the next load has its result. With no earlier copy the week waits for the read, as before.
   */
  async function load(weekStart: string, opts: { refresh?: boolean } = {}): Promise<SourceResult<CalEvent>> {
    const t = now().epochMilliseconds;
    const hit = memory.get(weekStart);
    if (hit && !opts.refresh && t - hit.at < ttl) return hit.result;
    let live = reading.get(weekStart);
    if (!live) {
      live = read(weekStart).finally(() => reading.delete(weekStart));
      reading.set(weekStart, live);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<null>((r) => (timer = setTimeout(() => r(null), answerWithin)));
    const first = await Promise.race([live, slow]);
    clearTimeout(timer);
    if (first) return first;
    const snap = await d.snapshots.read<CalEvent>(d.id, weekStart).catch(() => null);
    if (!snap) return live;
    d.log({ source: d.id, op: "load", kind: "answered_from_cache" });
    const at = formatFetchedAt(snap.fetchedAt, d.timeZone, now());
    return { source: d.id, status: "unreachable", fetchedAt: snap.fetchedAt, fromCache: true, items: snap.items, message: `${L} unreachable. Showing data from ${at}`, cause: "network" };
  }

  async function connect(opts: ConnectOptions = {}): Promise<ConnectResult> {
    const r = await d.auth.connect(opts);
    memory.clear();
    return r;
  }

  /** Forget this source: its refresh token, its cache folder and anything in memory. Nothing else. */
  async function disconnect(): Promise<void> {
    memory.clear();
    await d.auth.disconnect();
    await d.snapshots.clear(d.id);
    d.log({ source: d.id, op: "disconnect" });
  }

  return { id: d.id, load, connect, disconnect };
}

export type CalendarSource = ReturnType<typeof createCalendarSource>;
