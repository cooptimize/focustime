// DV-1: central DevOps polling. One job reads each client account's DevOps once for everyone, not once per person:
// a small "changed since" WIQL query (System.ChangedDate with time precision, starting two minutes before the newest
// change seen, so nothing slips past the boundary), then one batch read of only those items. Usually it returns
// nothing. The first read of a client fills the store with its open items and those closed in the last 90 days; the
// first check of each day reconciles (deletes and moves between projects). Screens read the store (sources/devops/
// source.ts `central`), never DevOps per person; writes still go to DevOps and then ask for a check here.
//
// Pace (plan/devops-pace.ts): the Rule "DevOps check interval" (1 minute by default) inside the union of the client's
// followers' working hours, 10 minutes outside them and only while someone is using FocusTime (otherwise nothing, so
// the database can pause; the next check catches up from the watermark). The rate-limit headers of every response
// slow a client down (doubling, up to 15 minutes) and calm checks bring it back; a refusal waits out Retry-After. Each
// client has its own pace, target and check, so one client slowing down or failing never touches another.
//
// The read PAT comes from Dataverse (the app's own access) and stays in memory, per client, for 10 minutes (read again
// on a 401). Never on disk, in the store, in a log or in Status. Logs carry counts and kinds only, never a client name,
// an item, a title or an identity.
import type { TargetsResult, DevOpsTarget } from "../sources/devops/types.ts";
import { DevOpsFailure, type CentralReads, type CentralView, type DevOpsInternal, type FieldSet, type Limiter, type ProcessRaw, type RawValue } from "../sources/devops/source.ts";
import { batchFields, buildChangedWiql, buildScopeWiql } from "../sources/devops/normalize.ts";
import { COMMENTS_FIELD, CREATED_FIELD, PROJECT_FIELD, REV_FIELD, diffItem, revOf, type ChangeEntry } from "../sources/devops/changes.ts";
import { CALM, DEFAULT_MINUTES, NORMAL, intervalMinutes, isDue, nextDue, nextPace, readRate, refreshAllowed, sinceOf, worse, type CheckSignal, type Pace } from "../plan/devops-pace.ts";
import { inUnion, nextUnionStart } from "../plan/requests.ts";
import type { TimeModel } from "../week/hours.ts";
import type { ClientWorkStatus } from "../week/types.ts";
import { plainJob, type Job, type JobRunner } from "../log/operation.ts";
import type { Logger } from "../log/logger.ts";
import type { SnapshotStore } from "../host/types.ts";
import type { StatusRow, StatusSource } from "./status-rows.ts";
import type { ProjectAreas } from "../plan/devops-scope.ts";
import { emptyPoll, type DevOpsStore, type PollRow, type StoredItem } from "../store/devops-store.ts";

/** A target read from Dataverse is kept this long (in memory only). */
export const TARGET_MS = 10 * 60_000;
/** Screens wait this long for a check in flight (a Refresh, a write, the first read) before showing the store. */
export const WAIT_MS = 8_000;
/** The scope and changed-since queries return at most this many ids (the WIQL maximum). */
export const WIQL_MAX = 20_000;
/** Without a change, the poll state is written at most this often (so a quiet minute makes no database call). */
const PERSIST_MS = 10 * 60_000;
/** Followers' hours and the account list are read again after this long. */
const LIST_MS = 5 * 60_000;
/** A client a screen asked for is polled for this long after (until ADM-2's clientAccounts() lists them). */
const ASKED_MS = 7 * 24 * 3600_000;

export type PollerDeps = {
  store: DevOpsStore;
  /** The app-level source's reads (its targets carry the read PAT, and its requests go through `limiter`). */
  source: () => DevOpsInternal;
  limiter: ClientLimiter;
  /**
   * The client accounts to poll (pollAccounts() below; ADM-2's clientAccounts() when it merges): never prospects or
   * hidden ones, only those with DevOps set up. `asked`: clients screens asked for lately, filtered the same way.
   */
  accounts: (asked: readonly string[]) => Promise<string[]>;
  /** Each account's DevOps settings with the read PAT, from Dataverse with the app's own access. */
  targets: (clientKeys: string[]) => Promise<TargetsResult>;
  /** The union of the client's followers' own working hours (as the Teams poller's). */
  hours: (clientKey: string) => Promise<TimeModel[]>;
  /** The Rule "DevOps check interval" in minutes (1 to 30). */
  ruleMinutes: () => Promise<number>;
  /** Whether someone is using FocusTime now (outside hours, checks run only then). */
  active: () => boolean;
  /**
   * DV-2: whether someone who follows this client is using FocusTime now. Outside hours their client is checked at the
   * Rule's interval instead of every 10 minutes. Absent: never (the 10 minutes, as before).
   */
  activeFor?: (clientKey: string) => boolean | Promise<boolean>;
  now: () => Temporal.Instant;
  log: Logger;
  /** HK-1: each check as a job operation for telemetry (devops_check, or devops_reconcile for the day's first). */
  job?: JobRunner;
};

/** The app-level source keeps nothing on disk: its process cache lives in memory (read again after a restart). */
export const NO_SNAPSHOTS: SnapshotStore = { read: async () => null, write: async () => {}, clear: async () => {} };

// ---------- which accounts ----------

/**
 * pollAccounts(): the client accounts FocusTime users work on (Dataverse's Account Workers, as Admin's directory keeps
 * them, for people who use FocusTime) plus the ones screens asked for, that have DevOps set up (an organization and a
 * project in Dataverse). `isClient` is the one place that says what a client account is: today every account; ADM-2's
 * clientAccounts() (no prospects, no hidden accounts) when it merges.
 */
export async function pollAccounts(o: {
  peopleClients: () => Promise<readonly { personId: string; clientKey: string }[]>;
  users: () => Promise<readonly { id: string; deleted: boolean }[]>;
  /** Which accounts have DevOps set up (never with the PAT). */
  targets: (keys: string[]) => Promise<TargetsResult>;
  isClient?: (clientKey: string) => boolean | Promise<boolean>;
  asked: readonly string[];
}): Promise<string[]> {
  const live = new Set((await o.users()).filter((u) => !u.deleted).map((u) => u.id.toLowerCase()));
  const keys = [...new Set([...(await o.peopleClients()).filter((p) => live.has(p.personId.toLowerCase())).map((p) => p.clientKey), ...o.asked])].sort();
  const clients: string[] = [];
  for (const k of keys) if (!o.isClient || (await o.isClient(k))) clients.push(k);
  if (!clients.length) return [];
  const r = await o.targets(clients);
  if (!r.ok) throw new Error("Dataverse couldn't be read");
  return clients.filter((k) => r.targets.some((t) => t.clientKey === k && !!t.org && !!t.project));
}

// ---------- the limiter: one per client ----------

/** The last rate-limit numbers DevOps sent for a client (for Status; absent until it sends them). */
export type RateSeen = { limit: number | null; remaining: number | null; cost: number | null; at: string };

export type ClientLimiter = Limiter & {
  /** The check's worst signal and its call count since the last take, then a fresh start. */
  take(clientKey: string): { signal: CheckSignal; calls: number; rate: RateSeen | null };
  /** No request before this (null clears). */
  hold(clientKey: string, until: string | null): void;
  /** Whether DevOps asked to wait and the time hasn't come. */
  waiting(clientKey: string): boolean;
};

export function createLimiter(now: () => Temporal.Instant): ClientLimiter {
  const m = new Map<string, { until: number | null; signal: CheckSignal; calls: number; rate: RateSeen | null }>();
  const of = (k: string) => m.get(k) ?? m.set(k, { until: null, signal: CALM, calls: 0, rate: null }).get(k)!;
  return {
    before(k) {
      const s = of(k);
      if (s.until !== null && s.until > now().epochMilliseconds) throw new DevOpsFailure("error", "DevOps asked FocusTime to wait");
    },
    after(k, status, headers) {
      const s = of(k);
      const r = readRate(status, headers);
      s.calls++;
      s.signal = worse(s.signal, r);
      if (r.limit !== null || r.remaining !== null || r.cost !== null) s.rate = { limit: r.limit, remaining: r.remaining, cost: r.cost, at: now().toString() };
      // A refusal (or a Retry-After on any answer) stops further requests in this check at once.
      if (s.signal.retryAfterS) s.until = Math.max(s.until ?? 0, now().epochMilliseconds + s.signal.retryAfterS * 1000);
    },
    take(k) {
      const s = of(k);
      const out = { signal: s.signal, calls: s.calls, rate: s.rate };
      s.signal = CALM;
      s.calls = 0;
      return out;
    },
    hold(k, until) {
      of(k).until = until ? Temporal.Instant.from(until).epochMilliseconds : null;
    },
    waiting(k) {
      const u = of(k).until;
      return u !== null && u > now().epochMilliseconds;
    },
  };
}

// ---------- the poller ----------

type Client = {
  key: string;
  row: PollRow;
  pace: Pace;
  items: Map<number, StoredItem>;
  process: ProcessRaw | null;
  fields: FieldSet | null;
  /** AH-2: the project's area tree and teams, as last read. */
  areas: ProjectAreas | null;
  inflight: Promise<void> | null;
  forcedAt: number | null;
  writePending: boolean;
  target: { at: number; target: DevOpsTarget | null; failure: DevOpsFailure | null } | null;
  persistedAt: number;
  rate: RateSeen | null;
  /** DV-2: what the last check found (items added, changed or removed), for Refresh's answer. */
  last: { at: string; changes: number; failed: boolean } | null;
};

/** DV-2: what a person's page may know about a client's DevOps: its version and how fresh it is. Never an item. */
export type Freshness = {
  clientKey: string;
  /** Moves whenever a change for the client reaches the store (null: none yet). */
  version: string | null;
  checkedAt: string | null;
  okAt: string | null;
  /** When the next check is due (null: now, or not known). */
  nextAt: string | null;
  problem: FreshProblem | null;
};
export type FreshProblem = { kind: "slowed" | "refused" | "failed" | "first"; words: string };
/** DV-2: Refresh's answer for one client. `changes` is what the check it ran (or the one just before) found. */
export type ForcedCheck = Freshness & { forced: boolean; pending: boolean; changes: number | null };
/** DV-2: Find an item's one read by id. `elsewhere`: DevOps has it, in a project this client isn't set up with. */
export type FoundRaw = { status: "found"; value: RawValue } | { status: "missing" } | { status: "elsewhere" } | { status: "unavailable"; words: string };

/** A version strictly after the one before (two changes in one millisecond still move it). */
export function nextVersion(prev: string | null, t: Temporal.Instant): string {
  const p = prev ? Date.parse(prev) : Number.NEGATIVE_INFINITY;
  return Number.isFinite(p) && p >= t.epochMilliseconds ? new Date(p + 1).toISOString() : t.toString();
}

/** DV-2: a client's freshness problem in plain words, from its poll row and pace. */
export function problemOf(row: Pick<PollRow, "errorKind" | "error" | "loadedAt">, pace: Pick<Pace, "slow" | "retryAt" | "reason">, now: Temporal.Instant): FreshProblem | null {
  if (row.errorKind === "auth_failed") return { kind: "refused", words: "DevOps sign-in was refused" };
  if (row.errorKind) return { kind: "failed", words: failureWords(row.errorKind, row.error) ?? "DevOps couldn't be read" };
  const waiting = pace.retryAt && Temporal.Instant.compare(Temporal.Instant.from(pace.retryAt), now) > 0;
  if (pace.slow > 1 || waiting) return { kind: "slowed", words: "slowed by DevOps" };
  if (!row.loadedAt) return { kind: "first", words: "being read for the first time" };
  return null;
}

/** One status row per client (Admin › Status, through the status rows registry). */
export type DevOpsStatusRow = {
  clientKey: string;
  checkedAt: string | null;
  okAt: string | null;
  changedToday: number;
  callsToday: number;
  minutes: number;
  slowed: string | null;
  error: string | null;
  rate: RateSeen | null;
};

const today = (t: Temporal.Instant) => t.toString().slice(0, 10);

/** Plain words for a failure kind on Status. */
export function failureWords(kind: string | null, message: string | null): string | null {
  if (!kind) return null;
  if (kind === "auth_failed") return "Token not valid";
  if (kind === "no_access") return "No access to the DevOps project";
  if (kind === "unreachable") return "DevOps couldn't be reached";
  return message ?? "DevOps couldn't be read";
}

export function createDevOpsPoller(d: PollerDeps) {
  const clients = new Map<string, Client>();
  const asked = new Map<string, number>();
  let list: { at: number; asked: string; keys: string[] } | null = null;
  const hoursMemo = new Map<string, { at: number; hours: TimeModel[] }>();
  const log = (op: string, extra: { count?: number; kind?: string } = {}) => d.log({ source: "devops", op, ...extra });
  const nowMs = () => d.now().epochMilliseconds;

  async function stateOf(key: string): Promise<Client> {
    const hit = clients.get(key);
    if (hit) return hit;
    const [row, items] = await Promise.all([d.store.state(key), d.store.items(key)]);
    // Two callers may have raced; the first one in wins.
    const again = clients.get(key);
    if (again) return again;
    const r = row ?? emptyPoll(key);
    const c: Client = { key, row: r, pace: { ...NORMAL, slow: r.slow, reason: r.slowReason, retryAt: r.retryAt }, items: new Map(items.map((i) => [i.id, i])), process: null, fields: null, areas: null, inflight: null, forcedAt: null, writePending: false, target: null, persistedAt: nowMs(), rate: null, last: null };
    if (r.retryAt) d.limiter.hold(key, r.retryAt);
    clients.set(key, c);
    return c;
  }

  /** The accounts polled now: pollAccounts() and the ones screens asked for in the last week. */
  async function keys(): Promise<string[]> {
    const t = nowMs();
    for (const [k, at] of asked) if (t - at >= ASKED_MS) asked.delete(k);
    const want = [...asked.keys()].sort().join("|");
    if (!list || t - list.at >= LIST_MS || list.asked !== want) list = { at: t, asked: want, keys: await d.accounts([...asked.keys()]).catch(() => list?.keys ?? []) };
    return list.keys;
  }

  async function hoursOf(key: string): Promise<TimeModel[]> {
    const hit = hoursMemo.get(key);
    if (hit && nowMs() - hit.at < LIST_MS) return hit.hours;
    const hours = await d.hours(key).catch(() => hit?.hours ?? []);
    hoursMemo.set(key, { at: nowMs(), hours });
    return hours;
  }

  async function targetOf(c: Client, fresh = false): Promise<DevOpsTarget> {
    if (!fresh && c.target && nowMs() - c.target.at < TARGET_MS) {
      if (c.target.failure) throw c.target.failure;
      return c.target.target!;
    }
    const r = await d.targets([c.key]).catch((): TargetsResult => ({ ok: false, message: "Dataverse read failed" }));
    // Dataverse failing isn't remembered: the next check asks again.
    if (!r.ok) throw new DevOpsFailure(r.cause === "keyring" ? "error" : "unreachable", `DevOps settings unavailable (${r.message})`, r.cause);
    const t = r.targets.find((x) => x.clientKey === c.key);
    const failure = d.source().check(t, { clientKey: c.key, clientName: c.key });
    c.target = { at: nowMs(), target: failure ? null : t!, failure };
    if (failure) throw failure;
    return t!;
  }

  /** The fields the store keeps: the ones screens read, plus the revision, the comment count and the created date. */
  const fieldsOf = (process: ProcessRaw, f: FieldSet) => [...new Set([...batchFields(process.orderField), "System.AssignedTo", "System.AreaPath", "System.IterationPath", ...Object.values(f.fields), ...Object.values(f.starts), ...(f.size ? [f.size] : []), ...Object.values(f.sizes ?? {}), REV_FIELD, COMMENTS_FIELD, CREATED_FIELD, PROJECT_FIELD])];

  const stored = (v: RawValue): StoredItem => ({ id: v.id, project: typeof v.fields[PROJECT_FIELD] === "string" ? (v.fields[PROJECT_FIELD] as string) : "", rev: revOf(v.fields), changedAt: typeof v.fields["System.ChangedDate"] === "string" ? (v.fields["System.ChangedDate"] as string) : "", fields: v.fields });
  const latest = (a: string | null, b: string) => (!b ? a : !a || Date.parse(b) > Date.parse(a) ? b : a);

  type Write = { upsert: StoredItem[]; remove: number[]; changes: ChangeEntry[] };

  /**
   * One check of one client: what changed since the watermark, the first full read, or the daily reconcile. Returns
   * what to write and the next poll state; the memory follows only once the store has it.
   */
  async function once(c: Client, base: PollRow, target: DevOpsTarget): Promise<{ write: Write | null; row: PollRow }> {
    const src = d.source();
    const t = d.now();
    const m = await src.meta(target);
    c.process = m.process;
    c.fields = m.fields;
    // AH-2: the area tree and teams (a day in the source's memory). Never fails the check: the last known stays.
    c.areas = await src.areas(target).catch((e: unknown) => {
      if (e instanceof DevOpsFailure && e.status === "auth_failed") throw e;
      return c.areas;
    });
    const fields = fieldsOf(m.process, m.fields);
    const projects = [target.project!];
    const typeFields = (v: RawValue) => {
      const type = typeof v.fields["System.WorkItemType"] === "string" ? (v.fields["System.WorkItemType"] as string) : "";
      return { targetField: m.fields.fields[type] ?? null, startField: m.fields.starts[type] ?? null, sizeField: m.fields.sizes?.[type] ?? null };
    };
    const upsert: StoredItem[] = [];
    const remove: number[] = [];
    const changes: ChangeEntry[] = [];
    let watermark = base.watermark;
    const row: PollRow = { ...base };
    const full = !row.loadedAt;
    const read = new Set<number>();

    if (full) {
      // The first read: the scope, every item in it, and no change log (nothing is news yet).
      const { ids, asOf } = await src.ids(target, buildScopeWiql(projects, m.meta.categories), WIQL_MAX);
      if (ids.length >= WIQL_MAX) log("scope", { kind: "capped", count: ids.length });
      const values = await src.batch(target, ids, fields);
      for (const v of values) {
        upsert.push(stored(v));
        read.add(v.id);
      }
      // The watermark is DevOps's own time of the query (its clock, not ours); without one, the newest change seen.
      watermark = asOf ?? values.reduce<string | null>((w, v) => latest(w, stored(v).changedAt), null) ?? t.toString();
      row.loadedAt = t.toString();
      row.reconciledOn = today(t);
    } else if (row.reconciledOn !== today(t)) {
      // The first check of the day: what's in scope now against the store. Items gone from it are read by id: not
      // returned means deleted (or no longer visible); another project means moved; else closed long ago (kept out).
      const { ids } = await src.ids(target, buildScopeWiql(projects, m.meta.categories), WIQL_MAX);
      const scope = new Set(ids);
      const gone = [...c.items.keys()].filter((id) => !scope.has(id));
      const found = new Map((gone.length ? await src.batch(target, gone, fields) : []).map((v) => [v.id, v]));
      for (const id of gone) {
        const v = found.get(id);
        remove.push(id);
        if (!v) {
          const before = c.items.get(id)!;
          changes.push({ itemId: id, kind: "removed", oldValue: null, newValue: null, byName: null, byUnique: null, changedAt: t.toString(), rev: before.rev });
        }
      }
      const fresh = ids.filter((id) => !c.items.has(id));
      for (const v of fresh.length ? await src.batch(target, fresh, fields) : []) {
        upsert.push(stored(v));
        read.add(v.id);
      }
      row.reconciledOn = today(t);
      if (remove.length) log("reconcile", { count: remove.length });
    }

    if (!full) {
      // Changed since the watermark, less the overlap: only those items are read. One already stored at this revision
      // (the overlap) is skipped, so nothing is logged twice.
      const since = sinceOf(watermark ?? t.subtract({ hours: 24 }).toString({ smallestUnit: "second" }));
      const { ids, asOf } = await src.ids(target, buildChangedWiql(projects, since), WIQL_MAX);
      if (ids.length >= WIQL_MAX) {
        // Too much to catch up on: read everything again next time.
        row.loadedAt = null;
        log("changed", { kind: "capped", count: ids.length });
      }
      const want = ids.filter((id) => !read.has(id));
      const values = want.length ? await src.batch(target, want, fields) : [];
      let seen: string | null = null;
      for (const v of values) {
        const s = stored(v);
        seen = latest(seen, s.changedAt);
        const before = c.items.get(v.id) ?? null;
        if (before && before.rev >= s.rev) continue;
        changes.push(...diffItem({ id: v.id, before: before?.fields ?? null, after: v.fields, ...typeFields(v), newSince: since }));
        upsert.push(s);
      }
      // Next time from this query's own time (less the overlap); without one, from the newest change seen.
      watermark = asOf ?? latest(watermark, seen ?? "");
    }

    row.watermark = watermark;
    if (!full) row.changedToday += upsert.length + remove.length;
    return { write: upsert.length || remove.length || changes.length ? { upsert, remove, changes } : null, row };
  }

  /**
   * A check, unless one is already running for the client (then that one). Never throws. DV-2: `c.inflight` is set
   * before this returns, so a caller can wait for it at once (before, it was set a tick later and Refresh's 8 s wait
   * never happened).
   */
  function start(c: Client): Promise<void> {
    if (c.inflight) return c.inflight;
    c.inflight = (d.job ?? plainJob)("devops_check", { client: c.key }, (job) => run(c, job)).catch(() => log("check", { kind: "unexpected" })).finally(() => {
      c.inflight = null;
      c.writePending = false;
    });
    return c.inflight;
  }
  function check(key: string): Promise<void> {
    const hit = clients.get(key);
    return hit ? start(hit) : stateOf(key).then(start);
  }

  async function run(c: Client, job: Job = { set: () => {} }): Promise<void> {
    // DevOps asked to wait: no check at all (not even a Refresh or a write's), and nothing changes.
    if (d.limiter.waiting(c.key)) return job.set({ outcome: "skipped", flags: { reason: "retry_after" } });
    const t = d.now();
    const before = { ...c.row };
    // The next state is kept aside until the store has it, so a failed write never moves the watermark.
    let next: PollRow = c.row.day !== today(t) ? { ...c.row, day: today(t), changedToday: 0, callsToday: 0 } : c.row;
    let write: Write | null = null;
    let failure: DevOpsFailure | null = null;
    try {
      let target = await targetOf(c);
      let r: { write: Write | null; row: PollRow };
      try {
        r = await once(c, next, target);
      } catch (e) {
        // A refused token: read it from Dataverse again once (it may have been replaced), then give up for now.
        if (!(e instanceof DevOpsFailure) || e.status !== "auth_failed") throw e;
        target = await targetOf(c, true);
        r = await once(c, next, target);
      }
      write = r.write;
      next = r.row;
    } catch (e) {
      failure = e instanceof DevOpsFailure ? e : new DevOpsFailure("error", "DevOps couldn't be read");
      if (failure.status === "auth_failed") c.target = null;
    }
    const taken = d.limiter.take(c.key);
    if (taken.rate) c.rate = taken.rate;
    c.pace = nextPace(c.pace, taken.signal, t);
    d.limiter.hold(c.key, c.pace.retryAt);
    const row: PollRow = {
      ...next,
      checkedAt: t.toString(),
      ...(failure ? { errorKind: failure.status, error: failure.message } : { okAt: t.toString(), errorKind: null, error: null }),
      slow: c.pace.slow,
      slowReason: c.pace.reason,
      retryAt: c.pace.retryAt,
      callsToday: next.callsToday + taken.calls,
      // DV-2: the version moves only when the store's items change (added, changed or removed).
      versionAt: write && (write.upsert.length || write.remove.length) ? nextVersion(c.row.versionAt, t) : c.row.versionAt,
    };
    const changedState = before.errorKind !== row.errorKind || before.error !== row.error || before.slow !== row.slow || before.retryAt !== row.retryAt || before.loadedAt !== row.loadedAt || before.reconciledOn !== row.reconciledOn || before.day !== row.day;
    if (write || changedState || nowMs() - c.persistedAt >= PERSIST_MS) {
      await d.store.apply(c.key, { upsert: write?.upsert ?? [], remove: write?.remove ?? [], changes: write?.changes ?? [], state: row });
      c.persistedAt = nowMs();
    }
    c.row = row;
    c.last = { at: t.toString(), changes: before.loadedAt ? (write?.upsert.length ?? 0) + (write?.remove.length ?? 0) : 0, failed: !!failure };
    for (const u of write?.upsert ?? []) c.items.set(u.id, u);
    for (const id of write?.remove ?? []) c.items.delete(id);
    log("check", { count: (write?.upsert.length ?? 0) + (write?.remove.length ?? 0), ...(failure ? { kind: failure.status } : c.pace.reason ? { kind: "slowed" } : {}) });
    // HK-1: what the check did, for its job operation (counts and short words only).
    const reconciled = !!before.loadedAt && row.reconciledOn !== before.reconciledOn;
    job.set({
      ...(reconciled ? { name: "devops_reconcile" } : {}),
      outcome: failure ? "failed" : "ok",
      counts: { changed: write?.upsert.length ?? 0, removed: write?.remove.length ?? 0, changes: write?.changes.length ?? 0, calls: taken.calls },
      flags: { slowed: c.pace.slow > 1 || c.pace.retryAt ? "yes" : "no", load: !before.loadedAt ? "full" : "changed", ...(failure ? { error: failure.status } : {}) },
    });
  }

  /** DV-2: someone who follows the client is using FocusTime (outside hours: the Rule's interval, not 10 minutes). */
  const activeHere = async (key: string) => (d.activeFor ? !!(await Promise.resolve(d.activeFor(key)).catch(() => false)) : false);

  async function minutesFor(c: Client, inHours: boolean): Promise<number> {
    const rule = await d.ruleMinutes().catch(() => DEFAULT_MINUTES);
    return intervalMinutes({ ruleMinutes: rule, inHours, pace: c.pace, badToken: c.row.errorKind === "auth_failed" });
  }

  /** One pass of the job: starts every due check without waiting for it (a slow client never holds up the pass). */
  async function tick(): Promise<string[]> {
    const t = d.now();
    const started: string[] = [];
    for (const key of await keys()) {
      const c = await stateOf(key);
      if (c.inflight) continue;
      const inHours = inUnion(t, await hoursOf(key));
      // Outside hours only while someone is using FocusTime; otherwise nothing (the database can pause).
      if (!inHours && !d.active()) continue;
      // DV-2: outside hours, a client someone working late follows is checked as often as in hours.
      const pace = inHours || (await activeHere(key));
      if (!isDue({ checkedAt: c.row.checkedAt, minutes: await minutesFor(c, pace), retryAt: c.pace.retryAt }, t)) continue;
      started.push(key);
      void check(key);
    }
    return started;
  }

  /** When the job next has work while nobody is using FocusTime: the earliest client due in hours, or the next start of hours. */
  async function wake(): Promise<Temporal.Instant | null> {
    const t = d.now();
    let best: Temporal.Instant | null = null;
    for (const key of await keys()) {
      const hours = await hoursOf(key);
      const c = await stateOf(key);
      let due: Temporal.Instant | null;
      if (inUnion(t, hours)) due = nextDue({ checkedAt: c.row.checkedAt, minutes: await minutesFor(c, true), retryAt: c.pace.retryAt }) ?? t;
      else due = nextUnionStart(t, hours);
      if (due && (!best || Temporal.Instant.compare(due, best) < 0)) best = due;
    }
    return best;
  }

  const within = (p: Promise<void>, ms: number) => Promise.race([p, new Promise<void>((ok) => setTimeout(ok, ms).unref?.())]);

  const reads: CentralReads = {
    async view(key, o): Promise<CentralView> {
      asked.set(key, nowMs());
      const c = await stateOf(key);
      if (o.force && refreshAllowed(c.forcedAt, nowMs())) {
        c.forcedAt = nowMs();
        void start(c);
      }
      // Nothing to show yet (the first read, or a restart before the process is known): check now.
      if (!c.process && !c.inflight) void start(c);
      if (c.inflight && (o.force || c.writePending || !c.process || !c.row.loadedAt)) await within(c.inflight, WAIT_MS);
      const failure = c.row.errorKind ? { status: c.row.errorKind as ClientWorkStatus, message: c.row.error ?? "DevOps couldn't be read" } : null;
      return { values: [...c.items.values()].map((i) => ({ id: i.id, fields: i.fields })), process: c.process, fields: c.fields, okAt: c.row.okAt, failure, loaded: !!c.row.loadedAt, areas: c.areas };
    },
    async byIds(key, ids) {
      const c = await stateOf(key);
      const want = ids.filter((id) => Number.isInteger(id) && id > 0 && !c.items.has(id)).slice(0, 200);
      if (!want.length || !c.process || !c.fields) return [];
      try {
        const values = await d.source().batch(await targetOf(c), want, fieldsOf(c.process, c.fields));
        const got = values.map(stored);
        for (const g of got) c.items.set(g.id, g);
        if (got.length) await d.store.apply(key, { upsert: got, changes: [], state: c.row });
        d.limiter.take(key);
        return values;
      } catch {
        return [];
      }
    },
    async target(key) {
      try {
        return await targetOf(await stateOf(key));
      } catch {
        return null;
      }
    },
    async stateChanges(key, since) {
      const c = await stateOf(key);
      // The log covers the span only when the first full load came before it (nothing before that is news).
      const known = !!c.row.loadedAt && Temporal.Instant.compare(Temporal.Instant.from(c.row.loadedAt), Temporal.Instant.from(since)) <= 0;
      if (!known) return { known: false, itemIds: [] };
      const ids = new Set((await d.store.changes(key, since)).filter((x) => x.kind === "state").map((x) => x.itemId));
      return { known: true, itemIds: [...ids].sort((a, b) => a - b) };
    },
    async lastChanges(key, since) {
      // BH-1: the newest row per item wins; the changer stays in the store.
      const out: Record<number, { kind: import("../plan/backlog.ts").LastChangeKind; at: string }> = {};
      for (const x of await d.store.changes(key, since)) if (!out[x.itemId] || out[x.itemId]!.at <= x.changedAt) out[x.itemId] = { kind: x.kind, at: x.changedAt };
      return out;
    },
    async activity(key, since, emails) {
      const c = await stateOf(key);
      const known = !!c.row.loadedAt && Temporal.Instant.compare(Temporal.Instant.from(c.row.loadedAt), Temporal.Instant.from(since)) <= 0;
      const me = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
      // SR-1: the change log's uniqueName is compared here and goes no further (D591's narrow use: matching me).
      const rows = (await d.store.changes(key, since)).flatMap((x) => (x.kind === "state" || x.kind === "comments" ? [{ itemId: x.itemId, kind: x.kind, oldValue: x.oldValue, newValue: x.newValue, changedAt: x.changedAt, mine: !!x.byUnique && me.has(x.byUnique.trim().toLowerCase()) }] : []));
      return { known, rows };
    },
    async stored(key, v) {
      // AH-1 (D660): a write's read-back goes straight in, with its change log entries, so every screen shows it now.
      const c = await stateOf(key);
      if (!c.process || !c.fields) return;
      const keep = new Set(fieldsOf(c.process, c.fields));
      const was = c.row;
      const before = c.items.get(v.id) ?? null;
      const fields = Object.fromEntries(Object.entries({ ...(before?.fields ?? {}), ...v.fields }).filter(([k]) => keep.has(k)));
      const s = stored({ id: v.id, fields });
      if (before && before.rev >= s.rev) return;
      const type = typeof fields["System.WorkItemType"] === "string" ? (fields["System.WorkItemType"] as string) : "";
      const changes = diffItem({ id: v.id, before: before?.fields ?? null, after: fields, targetField: c.fields.fields[type] ?? null, startField: c.fields.starts[type] ?? null, sizeField: c.fields.sizes?.[type] ?? null, newSince: d.now().subtract({ hours: 1 }).toString() });
      c.items.set(s.id, s);
      // DV-2: a write's read-back is a change too: other tabs and people see it on their next versions ask.
      c.row = { ...was, versionAt: nextVersion(was.versionAt, d.now()) };
      await d.store.apply(key, { upsert: [s], changes, state: c.row });
    },
    // DV-2 (declared below; function declarations are hoisted).
    freshness: (keys) => freshness(keys),
    force: (key) => force(key),
    find: (key, id) => find(key, id),
    storedOf: (key, id) => storedOf(key, id),
    afterWrite(key) {
      void stateOf(key).then((c) => {
        c.writePending = true;
        if (c.inflight) void c.inflight.then(() => check(key));
        else void check(key);
      });
    },
  };

  /** Admin › Status: one row per client polled. */
  async function status(): Promise<DevOpsStatusRow[]> {
    const t = d.now();
    const out: DevOpsStatusRow[] = [];
    for (const key of await keys()) {
      const c = await stateOf(key);
      const inHours = inUnion(t, await hoursOf(key));
      out.push({
        clientKey: key,
        checkedAt: c.row.checkedAt,
        okAt: c.row.okAt,
        changedToday: c.row.day === today(t) ? c.row.changedToday : 0,
        callsToday: c.row.day === today(t) ? c.row.callsToday : 0,
        minutes: await minutesFor(c, inHours),
        slowed: c.pace.slow > 1 || c.pace.retryAt ? (c.pace.reason ?? "DevOps asked FocusTime to slow down") : null,
        error: failureWords(c.row.errorKind, c.row.error),
        rate: c.rate,
      });
    }
    return out;
  }

  async function freshnessOf(c: Client): Promise<Freshness> {
    const t = d.now();
    const inHours = inUnion(t, await hoursOf(c.key));
    const minutes = await minutesFor(c, inHours || (await activeHere(c.key)));
    const due = c.inflight ? null : nextDue({ checkedAt: c.row.checkedAt, minutes, retryAt: c.pace.retryAt });
    return { clientKey: c.key, version: c.row.versionAt, checkedAt: c.row.checkedAt, okAt: c.row.okAt, nextAt: due ? due.toString() : null, problem: problemOf(c.row, c.pace, t) };
  }

  /**
   * DV-2: each client's version and freshness, from memory (a client not yet in memory is read once). No check is
   * started and nothing counts as use; a client's items are never in the answer.
   */
  async function freshness(keys: readonly string[]): Promise<Freshness[]> {
    return Promise.all(keys.map(async (k) => freshnessOf(await stateOf(k))));
  }

  /**
   * DV-2: Refresh for one client: a check now unless one ran in the last 30 s (shared by everyone, D592) or DevOps asked
   * to wait, then up to 8 s for it. The answer says what the check (or the one just before) found.
   */
  async function force(key: string): Promise<ForcedCheck> {
    asked.set(key, nowMs());
    const c = await stateOf(key);
    let forced = false;
    if (!d.limiter.waiting(key) && refreshAllowed(c.forcedAt, nowMs())) {
      c.forcedAt = nowMs();
      forced = true;
      void start(c);
    }
    if (c.inflight) await within(c.inflight, WAIT_MS);
    const recent = !!c.last && nowMs() - Date.parse(c.last.at) < 60_000;
    return { ...(await freshnessOf(c)), forced, pending: !!c.inflight, changes: c.last && !c.last.failed && (forced || recent) && !c.inflight ? c.last.changes : null };
  }

  /**
   * DV-2: Find an item: one read by id through the client's limiter, whether or not the store has it. Never stored.
   * An item in a project the client isn't set up with is "elsewhere", with nothing about it.
   */
  async function find(key: string, id: number): Promise<FoundRaw> {
    if (!Number.isInteger(id) || id <= 0) return { status: "missing" };
    const c = await stateOf(key);
    if (d.limiter.waiting(key)) return { status: "unavailable", words: "DevOps asked FocusTime to wait" };
    if (!c.process || !c.fields) return { status: "unavailable", words: "FocusTime hasn't read this client's DevOps yet" };
    try {
      const target = await targetOf(c);
      const v = (await d.source().batch(target, [id], fieldsOf(c.process, c.fields))).find((x) => x.id === id);
      if (!v) return { status: "missing" };
      const project = typeof v.fields[PROJECT_FIELD] === "string" ? (v.fields[PROJECT_FIELD] as string) : "";
      if (project.toLowerCase() !== (target.project ?? "").toLowerCase()) return { status: "elsewhere" };
      return { status: "found", value: v };
    } catch (e) {
      if (e instanceof DevOpsFailure && e.status === "auth_failed") return { status: "unavailable", words: "DevOps sign-in was refused" };
      return { status: "unavailable", words: e instanceof DevOpsFailure ? (failureWords(e.status, e.message) ?? "DevOps couldn't be read") : "DevOps couldn't be read" };
    }
  }

  /** DV-2: what the store holds of one item (for Find an item), and the client's last check. */
  async function storedOf(key: string, id: number): Promise<{ item: StoredItem | null; checkedAt: string | null; okAt: string | null }> {
    const c = await stateOf(key);
    return { item: c.items.get(id) ?? null, checkedAt: c.row.checkedAt, okAt: c.row.okAt };
  }

  /** Admin's Check now: a check at once (a pending Retry-After still holds). */
  async function checkNow(key: string): Promise<void> {
    if (!(await keys()).includes(key)) return;
    await check(key);
  }

  /** Waits for every check in flight (tests, and a clean stop). */
  async function idle(): Promise<void> {
    await Promise.all([...clients.values()].map((c) => c.inflight ?? Promise.resolve()));
  }

  return { tick, wake, reads, status, checkNow, idle, check, freshness, force, find, storedOf };
}

export type DevOpsPoller = ReturnType<typeof createDevOpsPoller>;

/** DV-1: the poller's rows for Admin › Status (the status rows registry): one per client, with Check now. */
export function devopsStatusSource(poller: Pick<DevOpsPoller, "status" | "checkNow">): StatusSource {
  const mins = (n: number) => (n === 1 ? "every minute" : `every ${n} minutes`);
  return {
    id: "devops",
    title: "DevOps",
    note: "Each client's DevOps is read once for everyone. Names, states and counts only.",
    async rows() {
      return (await poller.status()).map((r): StatusRow => {
        const parts = [
          ...(r.error ? [r.error] : []),
          `${r.changedToday} changed today`,
          r.slowed ? `${mins(r.minutes)}, slowed down: ${r.slowed}` : mins(r.minutes),
          `${r.callsToday} ${r.callsToday === 1 ? "call" : "calls"} today`,
          ...(r.rate && (r.rate.cost !== null || r.rate.remaining !== null) ? [[r.rate.cost !== null ? `last call cost ${r.rate.cost} TSTU` : null, r.rate.remaining !== null && r.rate.limit !== null ? `${r.rate.remaining} of ${r.rate.limit} left` : null].filter(Boolean).join(", ")] : []),
        ];
        return { id: r.clientKey, label: r.clientKey, state: r.error ? "error" : r.slowed ? "warn" : r.checkedAt ? "ok" : "idle", detail: parts.join(" · "), lastCheck: r.checkedAt, action: { id: "check_now", label: "Check now" } };
      });
    },
    async act(rowId, actionId) {
      if (actionId === "check_now") await poller.checkNow(rowId);
    },
  };
}
