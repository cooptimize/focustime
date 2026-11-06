// Read-only Azure DevOps source: open work items assigned to me, per client.
// Each client is fetched, fails and is cached on its own. PATs arrive from Dataverse for one fetch,
// wrapped in Pat, and are used only to build the Authorization header right at the request. They are
// never logged, cached, returned or put in a message. Only the normalized items are cached.
import { createHash } from "node:crypto";
import type { RawReportComment } from "../../plan/status-report.ts";
import type { SnapshotStore } from "../../host/types.ts";
import type { Logger } from "../../log/logger.ts";
import type { ClientPortfolio, ClientWork, ClientWorkStatus, FailureCause, PortfolioItem, WorkItem } from "../../week/types.ts";
import { formatFetchedAt } from "../when.ts";
import { batchFields, buildAllChildrenWiql, buildChildrenWiql, buildWiql, detectOrderField, identityEmail, detectSizeField, detectTargetField, detectTypeSizeField, fieldNames, identityName, dateOnly, workItemUrl, START_DATE_FIELD, ACCEPTANCE_FIELD, htmlToText, normalizeWorkItems, type BacklogLevels, type FieldInfo, type NormalizeContext, type StateCategories } from "./normalize.ts";
import { buildProcessModel, isClosed, isOpen, looksOf, type TypeLook, planningLevels, stateCategories, typeOf, type ProcessModel, type ProcessOverrides, type RawProcess } from "../../plan/process.ts";
import { Pat } from "./pat.ts";
import { scopeCounts, scopeOf, type DevOpsScope, type ProjectAreas, type ScopeCounts, type ScopeItem, type ScopeResult } from "../../plan/devops-scope.ts";
import type { DevOpsTarget, TargetsResult } from "./types.ts";
import type { ExemplarCandidate, FeatureSignals } from "../../plan/stories.ts";
import { CHILD_FIELDS, childrenWiql, COMMENTS_API, COMMENTS_TOP, EPIC_FIELDS, FEATURE_FIELDS, parseChild, parseComments, parseReportComments, parseEpic, parseFeature, POOL_FEATURE_FIELDS, POOL_FEATURES, poolCandidates, poolStoriesWiql, poolStoryFields, poolWiql } from "./signals.ts";

export const API_VERSION = "7.1";
const BATCH_MAX = 200; // documented maximum ids per workitemsbatch call
const WIQL_TOP = 1000;
const CHILD_DEPTH = 2; // epic → feature → story
const MAX_PARENTS = 200; // keeps the IN (...) list far under the 32K WIQL limit
const MAX_ANCESTOR_DEPTH = 4; // feature → epic → any custom levels above, Q49

export type DevOpsDeps = {
  fetch: typeof fetch;
  log: Logger;
  snapshots: SnapshotStore;
  timeZone: string;
  /** Dataverse → DevOps: settings and PATs for these clients, read live. */
  targets: (clientKeys: string[]) => Promise<TargetsResult>;
  now?: () => Temporal.Instant;
  timeoutMs?: number;
  /** Pause before the one retry after a network error (tests use 0). */
  retryDelayMs?: number;
  /** A normal load (e.g. changing weeks) reuses results this fresh. */
  memoryTtlMs?: number;
  /** A forced refresh refetches a client at most this often. */
  minRefreshMs?: number;
  /** Work item types, states and the order field change rarely. */
  metadataTtlMs?: number;
  /**
   * WT-1, ADM-1: a client's process overrides, its Rules from Admin › Clients, read at each fetch: parent or top types
   * that don't need breakdown (so they can be picked) and background types (no hours).
   */
  processOverrides?: (clientKey: string) => ProcessOverrides;
  /** A client's "treat as open" states (config [clients], step 6b). Read at each fetch. */
  openStates?: (clientKey: string) => readonly string[];
  /** AP-2: the ids of a client's items just read from DevOps (never from the cache), for the AI guard's map. */
  onItems?: (clientKey: string, ids: number[]) => void;
  /** DV-1: the per-client limiter around every request (sources/devops/poller.ts): a pending Retry-After refuses at once. */
  limiter?: Limiter;
  /** DV-1: screens read the central store (the poller's) instead of DevOps; `targets` then gives visibility and identity only. */
  central?: CentralReads;
  /**
   * AH-2: a client's scope (Admin › Clients' "Cooptimize's work in this project", null for automatic) and who is a
   * Cooptimizer (by email). Absent or null: no scope (every item, as before AH-2).
   */
  scope?: (clientKey: string) => Promise<ScopeDeps | null>;
  /**
   * AH-3: this person's other DevOps addresses on a client (linked client logins), and a Cooptimizer's FocusTime name
   * for a DevOps email there. Emails only to match, never kept or shown. Absent: only the Dataverse identity is me.
   */
  identities?: (clientKey: string) => Promise<SourceIdentities | null>;
};

export type SourceIdentities = { mine: readonly string[]; nameOf(email: string): string | null };

/** AH-2: what the scope needs from the org runtime. */
export type ScopeDeps = { rule: DevOpsScope | null; isCooptimizer: (email: string) => boolean };

/** DV-1: one client's limits. `before` throws a DevOpsFailure while DevOps asked to wait; `after` reads the headers. */
export type Limiter = { before(clientKey: string): void; after(clientKey: string, status: number, headers: Headers): void };

/** A stored item as the batch call returned it. */
export type RawValue = { id: number; fields: Readonly<Record<string, unknown>> };

/** DV-1: what the central store gives one reader for a client. */
export type CentralView = {
  /** Every stored item of the client (open, or closed in the last 90 days, and those read by id). */
  values: readonly RawValue[];
  /** The process responses and fields the poller read with (null until the first check got them). */
  process: ProcessRaw | null;
  fields: FieldSet | null;
  /** The last check that worked, and the current failure (plain words), if any. */
  okAt: string | null;
  failure: { status: ClientWorkStatus; message: string } | null;
  loaded: boolean;
  /** AH-2: the project's area tree and teams (read once a day; null until read). */
  areas?: ProjectAreas | null;
};

export type CentralReads = {
  /** The client's store; `force` (Refresh) asks for a check first (once per 30 s per client, shared). */
  view(clientKey: string, o: { force: boolean }): Promise<CentralView>;
  /** Items not in the store, read by id once and kept (follow-ups about old items). */
  byIds(clientKey: string, ids: readonly number[]): Promise<RawValue[]>;
  /** The poller's target (with the read PAT, memory only) for a read on demand. */
  target(clientKey: string): Promise<DevOpsTarget | null>;
  /** After a write: check the client now, so the next read shows the change. */
  afterWrite(clientKey: string): void;
  /** AH-1: a write's read-back, into the store and its change log now (not on the next check). */
  stored?(clientKey: string, value: RawValue): Promise<void>;
  /** PL-1: items whose state changed since an instant (the change log), and whether the log covers that span. */
  stateChanges?(clientKey: string, since: string): Promise<{ known: boolean; itemIds: number[] }>;
  /**
   * SR-1: state and comment changes since an instant, each with whether one of `emails` made it (the change log's
   * uniqueName is compared here and never returned), and whether the log covers that span.
   */
  activity?(clientKey: string, since: string, emails: readonly string[]): Promise<{ known: boolean; rows: Activity[] }>;
  /** BH-1: the newest change log row per item since an instant (what changed and when; never who). */
  lastChanges?(clientKey: string, since: string): Promise<Record<number, import("../../plan/backlog.ts").LastChange>>;
};
/** SR-1: one change log row as Status uses it: never who made it, only whether it was me. */
export type Activity = { itemId: number; kind: "state" | "comments"; oldValue: string | null; newValue: string | null; changedAt: string; mine: boolean };

/** The fields a project has for Plan the week, cached an hour. */
export type FieldSet = {
  fields: Record<string, string>;
  starts: Record<string, string>;
  size: string | null;
  ac: boolean;
  /** AH-1: each type's own size field (Story Points, Effort, Size or Original Estimate); absent: none. Older caches lack it. */
  sizes?: Record<string, string>;
  /** AH-1: display names of the date and size fields ("Story Points"), by reference name. */
  names?: Record<string, string>;
};

export type ClientRef = { clientKey: string; clientName: string };

/** A safe, plain failure. Never carries bodies, headers or PATs. */
export class DevOpsFailure extends Error {
  readonly status: ClientWorkStatus;
  /** Shared root cause (keyring, network), so the status bar names it once. */
  readonly rootCause: FailureCause | undefined;
  constructor(status: ClientWorkStatus, message: string, cause?: FailureCause) {
    super(message);
    this.status = status;
    this.rootCause = cause;
  }
}

type Metadata = { orderField: string | null; /** WT-1: the project's process model, with the person's overrides. */ model: ProcessModel; categories: StateCategories; levels: BacklogLevels; /** Plan the week (step 8): portfolio tiers from the backlog levels. */ tiers: { feature: Set<string>; epic: Set<string> }; /** DS-1: the child level's default type, the type Draft stories creates by default. */ storyType: string | null; requirementTypes: string[] };

/** WT-1: what is cached per project (a day): the raw process responses and the board order field, never a PAT. */
export type ProcessRaw = { raw: RawProcess; orderField: string | null };
const DAY_MS = 24 * 60 * 60_000;
/** WT-1: the history behind Admin's "75% broken down": items past Proposed in the last 12 months. */
const HISTORY_DAYS = 365;

/** What the cache file holds for Plan the week per client: normalized portfolio items only (no descriptions). */
type PortfolioSnapshot = { fetchedAt: string; items: PortfolioItem[]; targetFields: Record<string, string>; startFields?: Record<string, string>; sizeField?: string | null; acceptanceField?: boolean };

/** What the cache file holds per client: normalized items only. */
type WorkSnapshot = { fetchedAt: string; items: WorkItem[]; children?: WorkItem[]; /** PV-1: my stories' parents read by id. */ parents?: WorkItem[]; /** WT-1: each type's icon, color and level. */ types?: TypeLook[] };

/** Items cached before step 5 have no level; treat them as story level so nothing becomes unpickable by accident. */
const withLevel = (i: WorkItem): WorkItem => (i.level ? i : { ...i, level: "story" });

const ORG = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;
/** DV-1: a reader on the central store has no PAT: its views never call DevOps (reads on demand use the poller's). */
const NO_PAT = new Pat("");

export function cacheKey(clientKey: string): string {
  const slug = clientKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
  return `${slug}-${createHash("sha256").update(clientKey).digest("hex").slice(0, 8)}`;
}

/** WT-1: one client's process model, or a plain reason it can't be read. */
export type ProcessModelResult = { clientKey: string; ok: true; model: ProcessModel } | { clientKey: string; ok: false; message: string };

/** DS-1: a plain reason Draft stories can't read what it needs (never a body, a header or a PAT). */
export type SignalsResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function createDevOpsSource(d: DevOpsDeps) {
  const now = d.now ?? (() => Temporal.Now.instant());
  const timeoutMs = d.timeoutMs ?? 15_000;
  const retryDelayMs = d.retryDelayMs ?? 500;
  const ttl = d.memoryTtlMs ?? 5 * 60_000;
  const minRefresh = d.minRefreshMs ?? 60_000;
  const metaTtl = d.metadataTtlMs ?? 60 * 60_000;
  /** WT-1: the process model is refreshed daily (and on demand). */
  const processTtl = d.metadataTtlMs ?? DAY_MS;
  const memory = new Map<string, { at: number; result: ClientWork; /** The committed features it was read with, sorted ids. */ features: string }>();
  const metadata = new Map<string, { at: number; raw: ProcessRaw }>();
  const histories = new Map<string, { at: number; history: NonNullable<RawProcess["history"]> }>();
  /** AH-2: each project's area tree and teams, a day in memory (never a PAT). */
  const areaMemo = new Map<string, { at: number; areas: ProjectAreas }>();
  /** Each client's DevOps organization name (not secret), from its last Dataverse settings. */
  const orgs = new Map<string, string>();
  const log = (op: string, extra: { status?: number; durationMs?: number; count?: number; kind?: string } = {}) => d.log({ source: "devops", op, ...extra });

  /** Tells the caller which item ids were read for a client; a failure there never fails the read. */
  const reportItems = (clientKey: string, items: readonly { id: number }[]) => {
    if (!d.onItems || !items.length) return;
    try {
      d.onItems(clientKey, items.map((i) => i.id));
    } catch {
      log("item_map", { kind: "failed" });
    }
  };

  type Ctx = { client: string; /** The client key (process overrides are per client). */ clientKey: string; org: string; base: string; projectName: string; pat: Pat; /** My identity here (not secret), for changedByMe. */ me: string | null; /** AH-3: my other addresses here. */ alsoMe?: readonly string[]; nameOf?: (email: string) => string | null };

  /** One request. Errors are mapped to plain messages; response bodies of failures are never read. */
  async function call<T>(c: Ctx, op: string, path: string, body?: unknown): Promise<T> {
    // DS-1: a path may name its own api-version (the comments API is a preview version).
    const url = path.includes("api-version=") ? `${c.base}/${path}` : `${c.base}/${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`;
    const started = performance.now();
    // DV-1: a client DevOps asked to wait gets no request until then (a plain failure instead, no tight loop).
    d.limiter?.before(c.clientKey);
    let res: Response | null = null;
    // Every call is a read, so one retry after a network blip is safe (step 6c live run: one failed request
    // made a whole client "unreachable"). A host that doesn't exist is not retried.
    for (let attempt = 1; !res; attempt++) {
      try {
        res = await d.fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: { accept: "application/json", authorization: c.pat.basicAuth(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const notFound = (e as { cause?: { code?: unknown } })?.cause?.code === "ENOTFOUND";
        log(op, { kind: notFound ? "host_not_found" : attempt === 1 ? "network_retry" : "network" });
        if (notFound || attempt >= 2) throw new DevOpsFailure("unreachable", `DevOps organization ${c.org} unreachable`, "network");
        await new Promise((ok) => setTimeout(ok, retryDelayMs));
      }
    }
    log(op, { status: res.status, durationMs: performance.now() - started });
    d.limiter?.after(c.clientKey, res.status, res.headers);
    if (res.status === 429 || res.status === 503) throw new DevOpsFailure("error", "DevOps asked FocusTime to wait");
    // Azure DevOps answers a bad PAT with 401, or with a 203 or a redirect to a sign-in page.
    if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect")
      throw new DevOpsFailure("auth_failed", `DevOps PAT expired or invalid for ${c.client}`);
    if (res.status === 403 || res.status === 404) throw new DevOpsFailure("no_access", `No access to DevOps project ${c.projectName} for ${c.client}`);
    if (!res.ok) throw new DevOpsFailure("error", `DevOps error (HTTP ${res.status}) for ${c.client}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) throw new DevOpsFailure("auth_failed", `DevOps PAT expired or invalid for ${c.client}`);
    return (await res.json()) as T;
  }

  /**
   * AH-2: the project's area tree (classification nodes, 14 levels) and its teams with their team field values (area
   * paths and "include sub areas"). Each part fails on its own with a plain reason: reading teams needs the Project
   * read scope, which a read token may not have. A day in memory; never throws but for a refused token.
   */
  async function loadAreas(c: Ctx, project: string, refresh = false): Promise<ProjectAreas> {
    const key = `${c.org.toLowerCase()}/${project.toLowerCase()}`;
    const hit = areaMemo.get(key);
    const t = now().epochMilliseconds;
    if (!refresh && hit && t - hit.at < processTtl) return hit.areas;
    const p = encodeURIComponent(project);
    type Node = { name?: unknown; children?: Node[] | null };
    let root: string | null = null;
    const paths: string[] = [];
    let areasProblem: string | null = null;
    try {
      const tree = await call<Node>(c, "areas", `${p}/_apis/wit/classificationnodes/Areas?$depth=14`);
      const walk = (n: Node, at: string | null) => {
        if (typeof n.name !== "string" || paths.length >= 2000) return;
        const path = at === null ? n.name : `${at}\\${n.name}`;
        paths.push(path);
        for (const k of n.children ?? []) walk(k, path);
      };
      walk(tree, null);
      root = paths[0] ?? null;
    } catch (e) {
      if (e instanceof DevOpsFailure && e.status === "auth_failed") throw e;
      areasProblem = "The project's area paths couldn't be read";
    }
    let teams: ProjectAreas["teams"] = null;
    let teamsProblem: string | null = null;
    try {
      const list = await call<{ value?: { name?: unknown }[] }>(c, "teams", `_apis/projects/${p}/teams?$top=200`);
      const names = (list.value ?? []).map((x) => x.name).filter((n): n is string => typeof n === "string").slice(0, 200);
      teams = [];
      for (const name of names) {
        const v = await call<{ field?: { referenceName?: unknown } | null; values?: { value?: unknown; includeChildren?: unknown }[] }>(c, "teamfieldvalues", `${p}/${encodeURIComponent(name)}/_apis/work/teamsettings/teamfieldvalues`).catch(() => null);
        if (!v) continue;
        const otherField = typeof v.field?.referenceName === "string" && v.field.referenceName !== "System.AreaPath";
        teams.push({ name, otherField, areas: otherField ? [] : (v.values ?? []).filter((x) => typeof x.value === "string").map((x) => ({ path: x.value as string, sub: x.includeChildren === true })) });
      }
      teams.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // A token without the Project read scope is refused here (401 or a sign-in page), and only here.
      teamsProblem = "The project's teams couldn't be read with the company's DevOps token (it needs Project read). Area paths still work";
    }
    const areas: ProjectAreas = { root, paths, areasProblem, teams, teamsProblem, readAt: now().toString() };
    areaMemo.set(key, { at: t, areas });
    return areas;
  }

  /** WT-1: the process model's raw responses for a project: memory, then the snapshot (both a day), else DevOps. */
  async function loadProcess(c: Ctx, project: string, refresh = false): Promise<ProcessRaw> {
    const key = `${c.org.toLowerCase()}/${project.toLowerCase()}`;
    const hit = metadata.get(key);
    const t = now().epochMilliseconds;
    if (!refresh && hit && t - hit.at < processTtl) return hit.raw;
    const snapKey = `process-${cacheKey(key)}`;
    if (!refresh && !hit) {
      const snap = (await d.snapshots.read<never>("devops", snapKey).catch(() => null)) as unknown as (ProcessRaw & { fetchedAt: string }) | null;
      const age = snap ? t - Temporal.Instant.from(snap.raw.fetchedAt).epochMilliseconds : Infinity;
      if (snap && age >= 0 && age < processTtl) {
        metadata.set(key, { at: t - age, raw: { raw: snap.raw, orderField: snap.orderField } });
        return metadata.get(key)!.raw;
      }
    }
    const p = encodeURIComponent(project);
    const [pc, types, proj] = await Promise.all([
      call<unknown>(c, "processconfiguration", `${p}/_apis/work/processconfiguration`),
      call<{ value?: { name?: unknown; icon?: { id?: unknown } | null; color?: unknown; isDisabled?: unknown; states?: unknown }[] }>(c, "workitemtypes", `${p}/_apis/wit/workitemtypes`),
      call<{ defaultTeam?: { name?: unknown }; capabilities?: { processTemplate?: { templateName?: unknown } } }>(c, "project", `_apis/projects/${p}?includeCapabilities=true`).catch((e: unknown) => {
        if (e instanceof DevOpsFailure && e.status === "auth_failed") throw e;
        return null;
      }),
    ]);
    const list = (types.value ?? []).filter((x) => typeof x.name === "string");
    // Some responses list states with each type; otherwise ask the per-type states endpoint.
    const withStates = await Promise.all(
      list.map(async (x) => {
        if (Array.isArray(x.states) && x.states.length) return x;
        const s = await call<{ value?: unknown[] }>(c, "states", `${p}/_apis/wit/workitemtypes/${encodeURIComponent(x.name as string)}/states`);
        return { ...x, states: s.value ?? [] };
      }),
    );
    // The default team's backlog levels (ranked) and bugs behavior. Without them, process configuration decides.
    const team = typeof proj?.defaultTeam?.name === "string" ? encodeURIComponent(proj.defaultTeam.name) : null;
    const soft = <T,>(x: Promise<T>) => x.catch((e: unknown) => {
      if (e instanceof DevOpsFailure && e.status === "auth_failed") throw e;
      return null;
    });
    const [teamBacklogs, teamSettings] = team ? await Promise.all([soft(call<unknown>(c, "backlogs", `${p}/${team}/_apis/work/backlogs`)), soft(call<unknown>(c, "teamsettings", `${p}/${team}/_apis/work/teamsettings`))]) : [null, null];
    const fetchedAt = now().toString();
    const tpl = proj?.capabilities?.processTemplate?.templateName;
    const raw: ProcessRaw = { orderField: detectOrderField(pc), raw: { org: c.org, project: c.projectName || project, process: typeof tpl === "string" ? tpl : null, fetchedAt, teamBacklogs, processConfig: pc, teamSettings, types: withStates } };
    metadata.set(key, { at: t, raw });
    await d.snapshots.write("devops", snapKey, { ...raw, fetchedAt } as never).catch(() => log("cache_write", { kind: "failed" }));
    return raw;
  }

  /** The model with the client's overrides (ADM-1: its Rules), and the planning shapes the rest of the source uses. */
  function metaOf(r: ProcessRaw, clientKey: string, history?: RawProcess["history"]): Metadata {
    const model = buildProcessModel(history ? { ...r.raw, history } : r.raw, d.processOverrides?.(clientKey) ?? {});
    const pl = planningLevels(model);
    const parentDefault = model.levels.parent.map((t) => typeOf(model, t)?.defaultChild).find(Boolean) ?? model.levels.child[0] ?? null;
    return { orderField: r.orderField, model, categories: stateCategories(model), levels: { known: pl.known, story: pl.story, portfolio: pl.portfolio }, tiers: pl.tiers, storyType: parentDefault, requirementTypes: model.levels.child };
  }

  async function loadMetadata(c: Ctx, project: string): Promise<Metadata> {
    return metaOf(await loadProcess(c, project), c.clientKey);
  }

  /**
   * WT-1: per parent or top type, its items past Proposed (and not Removed) created in the last 12 months, how many have
   * children, and how often each valid child type appears. Reads only ids and types (link queries); cached a day.
   */
  async function loadHistory(c: Ctx, project: string, model: ProcessModel, refresh = false): Promise<NonNullable<RawProcess["history"]>> {
    const key = `${c.org.toLowerCase()}/${project.toLowerCase()}`;
    const hit = histories.get(key);
    const t = now().epochMilliseconds;
    if (!refresh && hit && t - hit.at < processTtl) return hit.history;
    const p = encodeURIComponent(project);
    const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
    const out: NonNullable<RawProcess["history"]> = {};
    for (const type of model.types.filter((x) => x.level === "top" || x.level === "parent")) {
      const skip = type.states.filter((s) => s.category === "Proposed" || s.category === "Removed").map((s) => s.name);
      const source = `[Source].[System.TeamProject] = @project AND [Source].[System.WorkItemType] = ${q(type.name)} AND [Source].[System.CreatedDate] >= @today - ${HISTORY_DAYS}${skip.length ? ` AND [Source].[System.State] NOT IN (${skip.map(q).join(", ")})` : ""}`;
      const link = `[System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward'`;
      const r = await call<{ workItemRelations?: { source?: { id?: unknown } | null; target?: { id?: unknown } | null }[] }>(c, "wiql_links", `${p}/_apis/wit/wiql?$top=20000`, { query: `SELECT [System.Id] FROM WorkItemLinks WHERE (${source}) AND (${link}) MODE (MayContain)` });
      const all = new Set<unknown>();
      const parents = new Set<unknown>();
      for (const x of r.workItemRelations ?? []) {
        if (!x.source && x.target) all.add(x.target.id);
        if (x.source && x.target) all.add(x.source.id), parents.add(x.source.id);
      }
      const childTypes: Record<string, number> = {};
      // Only when there is a choice: how often each valid child type sits under this type.
      if (type.validChildren.length > 1)
        for (const child of type.validChildren) {
          const k = await call<{ workItemRelations?: { source?: unknown; target?: { id?: unknown } | null }[] }>(c, "wiql_links", `${p}/_apis/wit/wiql?$top=20000`, { query: `SELECT [System.Id] FROM WorkItemLinks WHERE (${source}) AND (${link}) AND ([Target].[System.WorkItemType] = ${q(child)}) MODE (MustContain)` });
          childTypes[child] = new Set((k.workItemRelations ?? []).filter((x) => x.source && x.target).map((x) => x.target!.id)).size;
        }
      out[type.name] = { items: all.size, withChildren: parents.size, childTypes };
    }
    log("process_history", { count: Object.keys(out).length });
    histories.set(key, { at: t, history: out });
    return out;
  }

  /**
   * DV-1: the four reads the item views are built from, either from DevOps (WIQL for ids, then the batch call in
   * chunks of 200) or from the central store. Both give raw values ({ id, fields }); normalizing stays with the caller.
   */
  type Reads = {
    /** Open items assigned to this identity (types the process knows). */
    mine(email: string, fields: string[]): Promise<unknown[]>;
    /** Open children of these parents. */
    openChildren(parents: readonly number[], fields: string[]): Promise<unknown[]>;
    /** Every child of these parents, closed ones too. */
    allChildren(parents: readonly number[], fields: string[]): Promise<unknown[]>;
    byIds(ids: readonly number[], fields: string[]): Promise<unknown[]>;
  };

  const ASSIGNED_FIELD = "System.AssignedTo";

  function httpReads(ctx: Ctx, project: string, meta: Metadata): Reads {
    const p = encodeURIComponent(project);
    const byIds = async (ids: readonly number[], fields: string[]) => {
      const values: unknown[] = [];
      for (let i = 0; i < ids.length; i += BATCH_MAX) {
        const page = await call<{ value?: unknown[] }>(ctx, "workitemsbatch", `${p}/_apis/wit/workitemsbatch`, { ids: ids.slice(i, i + BATCH_MAX), fields, errorPolicy: "omit" });
        values.push(...(page.value ?? []));
      }
      return values;
    };
    const viaWiql = async (query: string, fields: string[]) => {
      const wiql = await call<{ workItems?: { id?: unknown }[] }>(ctx, "wiql", `${p}/_apis/wit/wiql?$top=${WIQL_TOP}`, { query });
      return byIds((wiql.workItems ?? []).map((w) => w.id).filter((id): id is number => typeof id === "number" && Number.isInteger(id)), fields);
    };
    return {
      mine: (email, fields) => viaWiql(buildWiql(email, meta.categories, meta.orderField), fields),
      openChildren: (parents, fields) => viaWiql(buildChildrenWiql([...parents], meta.categories, meta.orderField), fields),
      allChildren: (parents, fields) => viaWiql(buildAllChildrenWiql([...parents], meta.orderField), fields),
      byIds,
    };
  }

  /** DV-1: the same reads over a client's stored items. Items read by id that the store lacks are read once and kept. */
  /** AH-2: what the scope rules need of stored items (the level from the process model, never a type name). */
  function scopeItems(values: readonly RawValue[], model: ProcessModel): ScopeItem[] {
    return values.map((v) => {
      const f = v.fields;
      const level = typeof f["System.WorkItemType"] === "string" ? (typeOf(model, f["System.WorkItemType"] as string)?.level ?? null) : null;
      return { id: v.id, parentId: typeof f["System.Parent"] === "number" ? (f["System.Parent"] as number) : null, area: typeof f["System.AreaPath"] === "string" ? (f["System.AreaPath"] as string) : null, assigneeEmail: identityEmail(f[ASSIGNED_FIELD]), portfolio: level === "top" || level === "parent" };
    });
  }

  /**
   * AH-2: the one scope function. Which of a client's stored items are Cooptimize's work in its project, by the
   * client's scope (plan/devops-scope.ts), my items always in. Null: no scope here (every item). Ahead, Fix next,
   * Week's lists and Admin's counts all read it.
   */
  async function scopeFor(clientKey: string, view: Pick<CentralView, "values" | "areas">, model: ProcessModel, me: string | null): Promise<ScopeResult | null> {
    if (!d.scope) return null;
    const deps = await d.scope(clientKey).catch(() => null);
    if (!deps) return null;
    return scopeOf(scopeItems(view.values, model), deps.rule, { areas: view.areas ?? null, isCooptimizer: deps.isCooptimizer, me });
  }
  const keepOf = (sc: ScopeResult | null) => (sc && !sc.all ? (v: RawValue) => sc.ids.has(v.id) : () => true);

  /** `keep` (AH-2): the scope; my items and items read by id aren't filtered by it. */
  function storeReads(clientKey: string, values: readonly RawValue[], meta: Metadata, keep: (v: RawValue) => boolean = () => true): Reads {
    const byId = new Map(values.map((v) => [v.id, v]));
    const open = (v: RawValue) => {
      const type = typeof v.fields["System.WorkItemType"] === "string" ? (v.fields["System.WorkItemType"] as string) : "";
      const states = meta.categories.get(type);
      if (!states) return false;
      const state = typeof v.fields["System.State"] === "string" ? (v.fields["System.State"] as string).toLowerCase() : "";
      return !isClosed(states.get(state) ?? "Unknown");
    };
    const parentIn = (ids: ReadonlySet<number>) => (v: RawValue) => typeof v.fields["System.Parent"] === "number" && ids.has(v.fields["System.Parent"] as number);
    return {
      mine: async (email) => values.filter((v) => open(v) && identityEmail(v.fields[ASSIGNED_FIELD]) === email.toLowerCase()),
      openChildren: async (parents) => values.filter((v) => open(v) && keep(v) && parentIn(new Set(parents))(v)),
      allChildren: async (parents) => values.filter((v) => keep(v) && parentIn(new Set(parents))(v)),
      byIds: async (ids) => {
        const missing = ids.filter((id) => !byId.has(id));
        const got = missing.length && d.central ? await d.central.byIds(clientKey, missing) : [];
        for (const g of got) byId.set(g.id, g);
        return ids.map((id) => byId.get(id)).filter((v): v is RawValue => !!v);
      },
    };
  }

  /** Normalized. `people` (PV-1): also the assignee (display name, and the email only to match a Cooptimizer), for children. */
  function normalized(ctx: Ctx, meta: Metadata, values: unknown[], o: { people?: boolean; keepDone?: boolean; tiers?: boolean } = {}): WorkItem[] {
    const { items, skipped } = normalizeWorkItems(values, { org: ctx.org, projectName: ctx.projectName, orderField: meta.orderField, categories: meta.categories, levels: meta.levels, ...(o.tiers === false ? {} : { tiers: meta.tiers }), me: ctx.me, ...idOpts(ctx), ...(o.people ? { people: true } : {}), ...(o.keepDone ? { keepDone: true } : {}) });
    if (skipped) log("normalize", { kind: "skipped", count: skipped });
    return items;
  }

  const idOpts = (ctx: Ctx) => ({ ...(ctx.alsoMe?.length ? { alsoMe: ctx.alsoMe } : {}), ...(ctx.nameOf ? { nameOf: ctx.nameOf } : {}) });
  /** AH-3: the context with my linked logins and the FocusTime names for this client. */
  async function withIdentities(ctx: Ctx): Promise<Ctx> {
    const ids = d.identities ? await d.identities(ctx.clientKey).catch(() => null) : null;
    if (!ids) return ctx;
    const me = ctx.me?.toLowerCase() ?? null;
    return { ...ctx, alsoMe: ids.mine.map((e) => e.toLowerCase()).filter((e) => e !== me), nameOf: ids.nameOf };
  }
  function contextOf(ref: ClientRef, target: DevOpsTarget): { ctx: Ctx; project: string } {
    const org = target.org!;
    return { ctx: { client: ref.clientName, clientKey: ref.clientKey, org, base: `https://dev.azure.com/${encodeURIComponent(org)}`, projectName: target.projectName ?? target.project!, pat: target.pat ?? NO_PAT, me: target.email }, project: target.project! };
  }

  /** Q47: without a story level the backlog levels can't tell stories from features, so the client fails instead of guessing. */
  function needStoryLevel(meta: Metadata, ctx: Ctx, project: string) {
    if (meta.levels.story.size === 0)
      throw new DevOpsFailure("error", `The process for ${ctx.projectName || project} (${ctx.client}) has no story level in its backlog levels, so FocusTime can't tell stories from features there. Nothing is guessed; check the project's backlog configuration`);
  }

  type ClientRead = { items: WorkItem[]; children: WorkItem[]; watched: WorkItem[]; committed: WorkItem[]; parents: WorkItem[]; model: ProcessModel };

  /** One client's views of my work, from the given reads (DevOps or the store). */
  async function readClient(ctx0: Ctx, raw: Metadata, r: (meta: Metadata) => Reads, watch: readonly number[] = [], features: readonly number[] = []): Promise<ClientRead> {
    const ctx = await withIdentities(ctx0);
    needStoryLevel(raw, ctx, ctx.projectName);
    const meta = { ...raw, categories: stateCategories(raw.model, d.openStates?.(ctx.clientKey) ?? []) };
    const reads = r(meta);
    const base = batchFields(meta.orderField);
    // WT-1 safety net: a bug assigned to me is always at child level, even when the team has bugs off.
    // PV-1: mine by the query (the assignee is me), so the Week panel can tell them from teammates' children.
    const myItems = await reads.mine(ctx.me!, base);
    // AH-3: and what's assigned to my linked client logins here.
    for (const e of ctx.alsoMe ?? []) {
      const seen = new Set(myItems.map((v) => (v as { id?: unknown }).id));
      for (const v of await reads.mine(e, base)) if (!seen.has((v as { id?: unknown }).id)) myItems.push(v);
    }
    const items = normalized(ctx, meta, myItems).map((i) => ({ ...(i.level === "other" && typeOf(meta.model, i.type)?.bug ? { ...i, level: "story" as const } : i), assignedToMe: true }));
    log("items", { count: items.length });
    // Features committed to a week (step 8) that aren't mine: read by id (open ones), so their stories can be offered.
    const mineIds = new Set(items.map((i) => i.id));
    const wanted = features.filter((id) => Number.isInteger(id) && id > 0 && !mineIds.has(id)).slice(0, BATCH_MAX);
    const committed = wanted.length ? normalized(ctx, meta, await reads.byIds(wanted, base), { tiers: false }).filter((i) => wanted.includes(i.id)) : [];
    // Epics and features can't be picked: read their open children (any assignee), up to two levels down, read-only.
    const children: WorkItem[] = [];
    const seen = new Set([...items.map((i) => i.id), ...committed.map((i) => i.id)]);
    let parents = [...items.filter((i) => i.level === "portfolio").map((i) => i.id), ...committed.map((i) => i.id)];
    for (let depth = 0; depth < CHILD_DEPTH && parents.length; depth++) {
      const found = normalized(ctx, meta, await reads.openChildren(parents.slice(0, MAX_PARENTS), [...base, ASSIGNED_FIELD]), { people: true }).filter((c) => !seen.has(c.id));
      for (const c of found) seen.add(c.id);
      children.push(...found);
      parents = found.filter((c) => c.level === "portfolio").map((c) => c.id);
    }
    if (children.length) log("children", { count: children.length });
    // Items read by id (step 7): those an open follow-up is about that aren't among my open items, completed ones too.
    const missing = watch.filter((id) => Number.isInteger(id) && id > 0 && !seen.has(id)).slice(0, BATCH_MAX);
    const watched = missing.length ? normalized(ctx, meta, await reads.byIds(missing, base), { keepDone: true }).filter((i) => missing.includes(i.id)) : [];
    if (watched.length) log("watched", { count: watched.length });
    // PV-1 (D570): the parents of my stories that no read above has (a feature that's neither mine nor committed), by
    // id, so the Week panel can group every story under its feature.
    const known = new Set([...seen, ...watched.map((w) => w.id)]);
    const up = [...new Set([...items, ...children].filter((i) => i.assignedToMe && i.level === "story" && i.parentId !== null && !known.has(i.parentId)).map((i) => i.parentId!))].slice(0, BATCH_MAX);
    const parentItems = up.length ? normalized(ctx, meta, await reads.byIds(up, base), { tiers: false }).filter((i) => up.includes(i.id)) : [];
    if (parentItems.length) log("parents", { count: parentItems.length });
    return { items, children, watched, committed, parents: parentItems, model: meta.model };
  }

  async function fetchClient(ref: ClientRef, target: DevOpsTarget, watch: readonly number[] = [], features: readonly number[] = []): Promise<ClientRead> {
    const { ctx, project } = contextOf(ref, target);
    const raw = await loadMetadata(ctx, project);
    return readClient(ctx, raw, (meta) => httpReads(ctx, project, meta), watch, features);
  }

  // ---- Plan the week (step 8): features and epics, read-only ----
  const portfolioMemory = new Map<string, { at: number; result: ClientPortfolio }>();
  const targetFieldMemory = new Map<string, FieldSet & { at: number }>();

  /**
   * The target date field per portfolio type (and, D461, per story type, for the dates in Plan the week) for a project, and (step 16) the size field on stories, cached like the
   * metadata. None found: no target dates, no sizes.
   */
  async function targetFieldsFor(c: Ctx, project: string, types: readonly string[], storyTypes: readonly string[] = []): Promise<FieldSet> {
    const key = `${c.org.toLowerCase()}/${project.toLowerCase()}`;
    const hit = targetFieldMemory.get(key);
    const t = now().epochMilliseconds;
    if (hit && t - hit.at < metaTtl) return { fields: hit.fields, starts: hit.starts, size: hit.size, ac: hit.ac, sizes: hit.sizes ?? {}, names: hit.names ?? {} };
    const p = encodeURIComponent(project);
    const out: Record<string, string> = {};
    const starts: Record<string, string> = {};
    let size: string | null = null;
    let ac = false;
    const sizes: Record<string, string> = {};
    let names: Record<string, string> = {};
    try {
      const all = await call<{ value?: FieldInfo[] }>(c, "fields", `${p}/_apis/wit/fields`);
      size = detectSizeField(all.value ?? []);
      // D461: story types too, for their target dates in Plan the week (Start Date stays a portfolio field).
      for (const type of [...types, ...storyTypes.filter((x) => !types.includes(x))]) {
        const tf = await call<{ value?: { referenceName?: unknown }[] }>(c, "typefields", `${p}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields`);
        const has = new Set((tf.value ?? []).map((f) => f.referenceName).filter((r): r is string => typeof r === "string"));
        const found = detectTargetField(all.value ?? [], has);
        if (found) out[type] = found;
        // Step 17: Start Date where the process has it (detected per process, per type).
        if (has.has(START_DATE_FIELD) && types.includes(type)) starts[type] = START_DATE_FIELD;
        // AH-1 (D657): the type's own size field.
        const sz = detectTypeSizeField(has);
        if (sz) sizes[type] = sz;
      }
      names = fieldNames(all.value ?? [], new Set([...Object.values(out), ...Object.values(starts), ...Object.values(sizes)]));
      // Step 15.3: whether the first story type has acceptance criteria (the draft editor shows the field only then).
      const story = storyTypes[0];
      if (story) {
        const sf = await call<{ value?: { referenceName?: unknown }[] }>(c, "typefields", `${p}/_apis/wit/workitemtypes/${encodeURIComponent(story)}/fields`);
        ac = (sf.value ?? []).some((f) => f.referenceName === ACCEPTANCE_FIELD);
      }
    } catch (e) {
      // A refused field list only means no target dates; a bad PAT fails the reads that follow anyway.
      if (e instanceof DevOpsFailure && e.status === "auth_failed") throw e;
      log("target_fields", { kind: "unavailable" });
      return { fields: {}, starts: {}, size: null, ac: false };
    }
    targetFieldMemory.set(key, { at: t, fields: out, starts, size, ac, sizes, names });
    return { fields: out, starts, size, ac, sizes, names };
  }

  type PortfolioRead = { items: PortfolioItem[]; targetFields: Record<string, string>; startFields: Record<string, string>; sizeField: string | null; acceptanceField: boolean };

  async function fetchPortfolio(ref: ClientRef, target: DevOpsTarget, mine: readonly WorkItem[]): Promise<PortfolioRead> {
    const { ctx, project } = contextOf(ref, target);
    const raw = await loadMetadata(ctx, project);
    const portfolioTypes = [...raw.tiers.feature, ...raw.tiers.epic];
    return readPortfolio(ctx, raw, mine, (meta) => httpReads(ctx, project, meta), () => targetFieldsFor(ctx, project, portfolioTypes, [...raw.levels.story]));
  }

  /** Features and epics for my items (step 8), from the given reads and fields (DevOps or the store). */
  /** `only` (PL-1): exactly these features and epics by id, in any state (closed ones too), without the ones above. */
  async function readPortfolio(ctx0: Ctx, raw: Metadata, mine: readonly WorkItem[], r: (meta: Metadata) => Reads, fieldsOf: () => Promise<FieldSet>, only?: readonly number[]): Promise<PortfolioRead> {
    const ctx = await withIdentities(ctx0);
    const project = ctx.projectName;
    needStoryLevel(raw, ctx, project);
    const categories = stateCategories(raw.model, d.openStates?.(ctx.clientKey) ?? []);
    const portfolioTypes = new Set([...raw.tiers.feature, ...raw.tiers.epic]);
    // Assigned to me, or the parent of a story-level item assigned to me (raw backlog levels, not the pickable list).
    const assigned = new Set(mine.filter((i) => portfolioTypes.has(i.type)).map((i) => i.id));
    const parents = new Set(mine.filter((i) => raw.levels.story.has(i.type) && i.parentId !== null).map((i) => i.parentId!));
    const ids = [...new Set(only ?? [...assigned, ...parents])].filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_PARENTS);
    if (!ids.length) return { items: [], targetFields: {}, startFields: {}, sizeField: null, acceptanceField: false };
    const { fields: targetFields, starts: startFields, size: sizeField, ac: acceptanceField } = await fieldsOf();
    const reads = r({ ...raw, categories });
    const readByIds = async (ids: readonly number[], f: string[], n: Omit<NormalizeContext, "org" | "projectName">) => normalizeWorkItems(await reads.byIds(ids, f), { org: ctx.org, projectName: ctx.projectName, ...n }).items;
    const fields = [...batchFields(raw.orderField), "System.AssignedTo", "System.AreaPath", "System.IterationPath", ...new Set([...Object.values(targetFields), ...Object.values(startFields)]), ...(sizeField ? [sizeField] : [])];
    const n = { orderField: raw.orderField, categories, levels: raw.levels, keepDone: true, me: ctx.me, ...idOpts(ctx), people: true, targetFields, startFields, timeZone: d.timeZone, sizeField, paths: true };
    const found = (await readByIds(ids, fields, n)).filter((i) => portfolioTypes.has(i.type) && (!!only || !isClosed(i.stateCategory)));
    // Q49: follow parent links up to the top portfolio level, so the epics above my features are read too.
    const above = new Set<number>();
    for (let depth = 0; !only && depth < MAX_ANCESTOR_DEPTH; depth++) {
      const have = new Set(found.map((i) => i.id));
      const up = [...new Set(found.map((i) => i.parentId).filter((id): id is number => id !== null && !have.has(id)))].slice(0, MAX_PARENTS);
      if (!up.length) break;
      const got = (await readByIds(up, fields, n)).filter((i) => portfolioTypes.has(i.type) && !isClosed(i.stateCategory) && !have.has(i.id));
      if (!got.length) break;
      for (const i of got) above.add(i.id);
      found.push(...got);
    }
    found.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
    const kids: WorkItem[] = [];
    if (found.length) kids.push(...normalizeWorkItems(await reads.allChildren(found.map((i) => i.id), fields), { org: ctx.org, projectName: ctx.projectName, ...n }).items);
    log("portfolio", { count: found.length });
    const items: PortfolioItem[] = found.map((i) => ({
      id: i.id,
      title: i.title,
      type: i.type,
      state: i.state,
      stateCategory: i.stateCategory,
      tier: raw.tiers.feature.has(i.type) ? "feature" : "epic",
      order: i.order,
      parentId: i.parentId,
      url: i.url,
      targetDate: i.targetDate ?? null,
      ...(startFields[i.type] ? { startDate: i.startDate ?? null } : {}),
      assignedTo: i.assignedTo ?? null,
      mine: !!i.assignedToMe,
      why: [...(assigned.has(i.id) ? ["assigned" as const] : []), ...(parents.has(i.id) ? ["parent" as const] : []), ...(above.has(i.id) && !assigned.has(i.id) && !parents.has(i.id) ? ["above" as const] : [])],
      areaPath: i.areaPath ?? null,
      iterationPath: i.iterationPath ?? null,
      needsBreakdown: typeOf(raw.model, i.type)?.needsBreakdown ?? true,
      children: kids.filter((k) => k.parentId === i.id).map((k) => ({ id: k.id, title: k.title, type: k.type, state: k.state, stateCategory: k.stateCategory, open: isOpen(k.stateCategory), level: k.level, order: k.order, url: k.url, assignedTo: k.assignedTo ?? null, assignedToEmail: k.assignedToEmail ?? null, mine: !!k.assignedToMe, changedAt: k.changedAt, size: k.size ?? null, blocked: !!k.blocked, ...(targetFields[k.type] ? { targetDate: k.targetDate ?? null } : {}) })),
    }));
    return { items, targetFields, startFields, sizeField, acceptanceField };
  }

  /** Features and epics per followed client (step 8), after the usual read of my items. Cached for five minutes. */
  async function portfolio(clients: ClientRef[], opts: { refresh?: boolean } = {}): Promise<ClientPortfolio[]> {
    if (d.central) return centralPortfolio(clients, opts);
    const t = now().epochMilliseconds;
    const fresh = (ref: ClientRef) => {
      const hit = portfolioMemory.get(ref.clientKey);
      return hit && (opts.refresh ? t - hit.at < minRefresh : t - hit.at < ttl) ? hit.result : null;
    };
    const need = clients.filter((c) => !fresh(c));
    if (need.length) {
      // The same committed features the last read had, so this reuses it instead of reading again.
      const features = Object.fromEntries(need.map((c) => [c.clientKey, (memory.get(c.clientKey)?.features ?? "").split(",").filter(Boolean).map(Number)]));
      const works = await load(need, { ...opts, features });
      let targets: TargetsResult;
      try {
        targets = await d.targets(need.map((c) => c.clientKey));
      } catch {
        targets = { ok: false, message: "Dataverse read failed" };
      }
      const results = await Promise.all(
        need.map(async (ref, i): Promise<ClientPortfolio> => {
          const w = works[i]!;
          const key = `portfolio-${cacheKey(ref.clientKey)}`;
          const fallback = async (status: ClientWorkStatus, message: string, cause?: FailureCause): Promise<ClientPortfolio> => {
            const snap = (await d.snapshots.read<PortfolioItem>("devops", key)) as PortfolioSnapshot | null;
            const msg = snap ? `${message}. Showing features from ${formatFetchedAt(snap.fetchedAt, d.timeZone, now())}` : message;
            return { clientKey: ref.clientKey, clientName: ref.clientName, status, message: msg, ...(cause ? { cause } : {}), fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: snap?.items ?? [], targetFields: snap?.targetFields ?? {}, startFields: snap?.startFields ?? {}, sizeField: snap?.sizeField ?? null, acceptanceField: snap?.acceptanceField ?? false };
          };
          if (w.status !== "ok" || w.fromCache) return fallback(w.status, w.message ?? `DevOps unavailable for ${ref.clientName}`, w.cause);
          try {
            const target = targets.ok ? targets.targets.find((x) => x.clientKey === ref.clientKey) : undefined;
            const pre = precheck(ref, target);
            if (pre) throw pre;
            const { items, targetFields, startFields, sizeField, acceptanceField } = await fetchPortfolio(ref, target!, w.items);
            reportItems(ref.clientKey, [...items, ...items.flatMap((i) => i.children)]);
            const fetchedAt = now().toZonedDateTimeISO(d.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
            await d.snapshots.write("devops", key, { fetchedAt, items, targetFields, startFields, sizeField, acceptanceField } as unknown as WorkSnapshot).catch(() => log("cache_write", { kind: "failed" }));
            return { clientKey: ref.clientKey, clientName: ref.clientName, status: "ok", fetchedAt, fromCache: false, items, targetFields, startFields, sizeField, acceptanceField };
          } catch (e) {
            if (!(e instanceof DevOpsFailure)) log("portfolio", { kind: "unexpected" });
            const f = e instanceof DevOpsFailure ? e : new DevOpsFailure("error", `DevOps load failed for ${ref.clientName}`);
            return fallback(f.status, f.message, f.rootCause);
          }
        }),
      );
      need.forEach((ref, i) => portfolioMemory.set(ref.clientKey, { at: t, result: results[i]! }));
    }
    return clients.map((c) => portfolioMemory.get(c.clientKey)!.result);
  }

  /** One work item's description as plain text, read when asked (the Coop brief). Never cached or logged. */
  async function description(clientKey: string, id: number): Promise<string | null> {
    if (!Number.isInteger(id) || id <= 0) return null;
    let ref: ClientRef;
    let target: DevOpsTarget | undefined;
    if (d.central) {
      const c = await centralTarget(clientKey);
      if (typeof c === "string") return null;
      ({ ref, target } = c);
    } else {
      const targets = await d.targets([clientKey]).catch(() => null);
      target = targets?.ok ? targets.targets.find((x) => x.clientKey === clientKey) : undefined;
      ref = { clientKey, clientName: target?.clientName ?? clientKey };
      if (!target || precheck(ref, target)) return null;
    }
    const { ctx, project } = contextOf(ref, target);
    const page = await call<{ value?: { id?: unknown; fields?: Record<string, unknown> }[] }>(ctx, "workitemsbatch", `${encodeURIComponent(project)}/_apis/wit/workitemsbatch`, { ids: [id], fields: ["System.Id", "System.Description"], errorPolicy: "omit" });
    const html = page.value?.find((v) => v.id === id)?.fields?.["System.Description"];
    return typeof html === "string" ? htmlToText(html) : "";
  }

  /** DS-1: the client's target and context for a read on demand (Draft stories), or a plain reason. */
  async function onDemand(clientKey: string): Promise<{ ctx: Ctx; project: string; meta: Metadata } | string> {
    if (d.central) {
      const c = await centralTarget(clientKey);
      if (typeof c === "string") return c;
      const { ctx, project } = contextOf(c.ref, c.target);
      const view = await d.central.view(clientKey, { force: false }).catch(() => null);
      return { ctx, project, meta: view?.process ? metaOf(view.process, clientKey) : await loadMetadata(ctx, project) };
    }
    const targets = await d.targets([clientKey]).catch(() => null);
    if (!targets?.ok) return `DevOps settings can't be read from Dataverse now${targets && !targets.ok ? ` (${targets.message})` : ""}`;
    const target = targets.targets.find((x) => x.clientKey === clientKey);
    const ref = { clientKey, clientName: target?.clientName ?? clientKey };
    const pre = precheck(ref, target);
    if (pre) return pre.message;
    const { ctx, project } = contextOf(ref, target!);
    return { ctx, project, meta: await loadMetadata(ctx, project) };
  }
  const plainFailure = (e: unknown, what: string) => (e instanceof DevOpsFailure ? e.message : `${what} failed`);

  /**
   * DS-1: what Draft stories reads about one feature, read only: its fields, its epic, every child item and its
   * comments (newest first, one page). Read when asked, never cached or logged (counts only).
   */
  async function featureSignals(clientKey: string, id: number): Promise<SignalsResult<FeatureSignals>> {
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, message: "Not a work item id" };
    try {
      const on = await onDemand(clientKey);
      if (typeof on === "string") return { ok: false, message: on };
      const { ctx, project, meta } = on;
      const p = encodeURIComponent(project);
      const batch = async (ids: number[], fields: string[]) => (ids.length ? ((await call<{ value?: { id?: unknown; fields?: Record<string, unknown> }[] }>(ctx, "workitemsbatch", `${p}/_apis/wit/workitemsbatch`, { ids, fields, errorPolicy: "omit" })).value ?? []) : []);
      const raw = (await batch([id], FEATURE_FIELDS)).find((v) => v.id === id);
      const url = `https://dev.azure.com/${encodeURIComponent(ctx.org)}/${encodeURIComponent(ctx.projectName)}/_workitems/edit/${id}`;
      const feature = raw ? parseFeature(raw, url) : null;
      if (!feature) return { ok: false, message: `#${id} isn't in ${ctx.projectName}, or you can't see it` };
      // BD-1: any type the process model says needs breaking down (parent or top level, no override), not only features.
      const ft = typeOf(meta.model, feature.type);
      if (!ft?.needsBreakdown) return { ok: false, message: `#${id} is a ${feature.type}, which isn't broken down in ${ctx.projectName}` };
      // WT-1: the child types this type takes, the most common in this project's history first.
      const valid = ft?.validChildren ?? [];
      const def = valid.length > 1 ? typeOf(metaOf(await loadProcess(ctx, project), ctx.clientKey, await loadHistory(ctx, project, meta.model)).model, feature.type)?.defaultChild : valid[0];
      const childTypes = def ? [def, ...valid.filter((t) => t !== def)] : valid;
      if (!childTypes.length) return { ok: false, message: `The process for ${ctx.projectName} has no level under ${feature.type}, so there is no type to create` };
      const [epicRaw, kidIds, commentsBody] = await Promise.all([
        feature.parentId ? batch([feature.parentId], EPIC_FIELDS) : Promise.resolve([]),
        call<{ workItems?: { id?: unknown }[] }>(ctx, "wiql", `${p}/_apis/wit/wiql?$top=200`, { query: childrenWiql(id) }).then((w) => (w.workItems ?? []).map((x) => x.id).filter((n): n is number => typeof n === "number")),
        call<unknown>(ctx, "comments", `${p}/_apis/wit/workItems/${id}/comments?$top=${COMMENTS_TOP}&order=desc&api-version=${COMMENTS_API}`),
      ]);
      const children = (await batch(kidIds.slice(0, 200), CHILD_FIELDS)).map(parseChild).filter((c): c is NonNullable<typeof c> => !!c);
      const epic = epicRaw.map(parseEpic).find((e) => e && e.id === feature.parentId) ?? null;
      const comments = parseComments(commentsBody);
      log("story_signals", { count: children.length + comments.length });
      return { ok: true, value: { feature, epic, children, comments, storyType: childTypes[0]!, childTypes } };
    } catch (e) {
      return { ok: false, message: plainFailure(e, "Reading the feature") };
    }
  }

  /**
   * SR-1: each feature's comments for Status (one call a feature, newest first, up to 200), with the company read PAT
   * through the client's limiter, read when Status asks and never stored or logged (counts only). A feature that
   * can't be read is left out of `comments` and listed in `failed`.
   */
  async function featureComments(clientKey: string, ids: readonly number[]): Promise<{ ok: true; comments: Record<number, RawReportComment[]>; failed: number[] } | { ok: false; message: string }> {
    const want = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 60);
    try {
      const on = await onDemand(clientKey);
      if (typeof on === "string") return { ok: false, message: on };
      const p = encodeURIComponent(on.project);
      const comments: Record<number, RawReportComment[]> = {};
      const failed: number[] = [];
      // A few at a time: the limiter paces the org; a feature that fails doesn't stop the rest.
      for (let i = 0; i < want.length; i += 4) {
        await Promise.all(want.slice(i, i + 4).map(async (id) => {
          try {
            comments[id] = parseReportComments(await call<unknown>(on.ctx, "comments", `${p}/_apis/wit/workItems/${id}/comments?$top=200&order=desc&api-version=${COMMENTS_API}`));
          } catch {
            failed.push(id);
          }
        }));
      }
      log("status_comments", { count: Object.values(comments).reduce((n, l) => n + l.length, 0), ...(failed.length ? { kind: `failed ${failed.length}` } : {}) });
      return { ok: true, comments, failed };
    } catch (e) {
      return { ok: false, message: plainFailure(e, "Reading the comments") };
    }
  }

  /** SR-1: the change log's state and comment changes since an instant, with only whether each was mine. */
  async function activity(clientKey: string, since: string, emails: readonly string[]): Promise<{ known: boolean; rows: Activity[] }> {
    if (!d.central?.activity) return { known: false, rows: [] };
    const targets = await viewerTargets([clientKey], false);
    if (!targets.ok || precheck({ clientKey, clientName: clientKey }, targets.targets.find((t) => t.clientKey === clientKey), { pat: false })) return { known: false, rows: [] };
    return d.central.activity(clientKey, since, emails).catch(() => ({ known: false, rows: [] }));
  }

  /** DS-1: the example pool, a client's own project only, kept in memory for an hour per client and look-back. */
  const poolMemory = new Map<string, { at: number; pool: ExemplarCandidate[] }>();
  async function exemplarPool(clientKey: string, o: { months: number }): Promise<SignalsResult<ExemplarCandidate[]>> {
    const t = now().epochMilliseconds;
    const key = `${clientKey}|${o.months}`;
    const hit = poolMemory.get(key);
    if (hit && t - hit.at < metaTtl) return { ok: true, value: hit.pool };
    try {
      const on = await onDemand(clientKey);
      if (typeof on === "string") return { ok: false, message: on };
      const { ctx, project, meta } = on;
      const p = encodeURIComponent(project);
      const featureTypes = [...meta.tiers.feature];
      if (!featureTypes.length || !meta.requirementTypes.length) return { ok: true, value: [] };
      const since = now().toZonedDateTimeISO("UTC").toPlainDate().subtract({ months: Math.max(1, Math.min(36, Math.round(o.months))) }).toString();
      const wiql = await call<{ workItems?: { id?: unknown }[] }>(ctx, "wiql", `${p}/_apis/wit/wiql?$top=${POOL_FEATURES}`, { query: poolWiql({ project: ctx.projectName || project, featureTypes, categories: meta.categories, since }) });
      const fids = (wiql.workItems ?? []).map((w) => w.id).filter((n): n is number => typeof n === "number").slice(0, POOL_FEATURES);
      if (!fids.length) return { ok: true, value: [] };
      const read = async (ids: number[], fields: string[]) => {
        const out: { id?: unknown; fields?: Record<string, unknown> }[] = [];
        for (let i = 0; i < ids.length; i += BATCH_MAX) out.push(...((await call<{ value?: { id?: unknown; fields?: Record<string, unknown> }[] }>(ctx, "workitemsbatch", `${p}/_apis/wit/workitemsbatch`, { ids: ids.slice(i, i + BATCH_MAX), fields, errorPolicy: "omit" })).value ?? []));
        return out;
      };
      const features = await read(fids, POOL_FEATURE_FIELDS);
      const sw = await call<{ workItems?: { id?: unknown }[] }>(ctx, "wiql", `${p}/_apis/wit/wiql?$top=${WIQL_TOP}`, { query: poolStoriesWiql(fids, meta.requirementTypes) });
      const sids = (sw.workItems ?? []).map((w) => w.id).filter((n): n is number => typeof n === "number");
      const { size } = await targetFieldsFor(ctx, project, [...meta.tiers.feature, ...meta.tiers.epic], [...meta.levels.story]);
      const stories = await read(sids, poolStoryFields(size));
      const pool = poolCandidates(features, stories, size);
      log("story_pool", { count: pool.length });
      poolMemory.set(key, { at: t, pool });
      return { ok: true, value: pool };
    } catch (e) {
      return { ok: false, message: plainFailure(e, "Reading the examples") };
    }
  }

  /**
   * WT-1: the process model per client (types, levels, state categories, valid and default children, needs breakdown
   * with its history), read with the company read PAT at fetch time. Read only. ADM-1 shows these; Draft stories uses
   * the default child. Cached a day; `refresh` reads again.
   */
  async function processModels(clientKeys: string[], opts: { refresh?: boolean } = {}): Promise<ProcessModelResult[]> {
    if (d.central)
      return Promise.all(
        clientKeys.map(async (clientKey): Promise<ProcessModelResult> => {
          const c = await centralTarget(clientKey);
          if (typeof c === "string") return { clientKey, ok: false, message: c };
          try {
            const { ctx, project } = contextOf(c.ref, c.target);
            const view = opts.refresh ? null : await d.central!.view(clientKey, { force: false }).catch(() => null);
            const raw = view?.process ?? (await loadProcess(ctx, project, opts.refresh));
            const history = await loadHistory(ctx, project, metaOf(raw, clientKey).model, opts.refresh);
            return { clientKey, ok: true, model: metaOf(raw, clientKey, history).model };
          } catch (e) {
            return { clientKey, ok: false, message: plainFailure(e, "Reading the process") };
          }
        }),
      );
    let targets: TargetsResult;
    try {
      targets = await d.targets(clientKeys);
    } catch {
      targets = { ok: false, message: "Dataverse read failed" };
    }
    return Promise.all(
      clientKeys.map(async (clientKey): Promise<ProcessModelResult> => {
        if (!targets.ok) return { clientKey, ok: false, message: `DevOps settings unavailable (${targets.message})` };
        const target = targets.targets.find((x) => x.clientKey === clientKey);
        const ref = { clientKey, clientName: target?.clientName ?? clientKey };
        const pre = precheck(ref, target);
        if (pre) return { clientKey, ok: false, message: pre.message };
        try {
          const { ctx, project } = contextOf(ref, target!);
          const raw = await loadProcess(ctx, project, opts.refresh);
          const history = await loadHistory(ctx, project, metaOf(raw, clientKey).model, opts.refresh);
          return { clientKey, ok: true, model: metaOf(raw, clientKey, history).model };
        } catch (e) {
          return { clientKey, ok: false, message: plainFailure(e, "Reading the process") };
        }
      }),
    );
  }

  /**
   * Check the target is usable. Identity is never guessed. DV-1: a reader on the central store needs no PAT (the
   * poller has it), and the poller needs no identity (it reads everyone's items).
   */
  function precheck(ref: ClientRef, target: DevOpsTarget | undefined, o: { pat?: boolean; identity?: boolean } = {}): DevOpsFailure | null {
    if (!target) return new DevOpsFailure("not_set_up", o.identity === false ? `DevOps isn't set up for ${ref.clientName} in Dataverse` : `No Account Worker for ${ref.clientName} in Dataverse`);
    if (target.problem) return new DevOpsFailure("error", target.problem);
    if (o.identity !== false && !target.email) return new DevOpsFailure("identity_missing", `DevOps identity missing for ${ref.clientName}`);
    const missing = [!target.org && "organization", !target.project && "project", o.pat !== false && !target.pat && "PAT"].filter(Boolean);
    if (missing.length) return new DevOpsFailure("not_set_up", `DevOps not set up for ${ref.clientName} (missing ${missing.join(", ")})`);
    if (!ORG.test(target.org!)) return new DevOpsFailure("not_set_up", `DevOps organization for ${ref.clientName} is not a valid name`);
    return null;
  }

  async function fromCache(ref: ClientRef, f: DevOpsFailure): Promise<ClientWork> {
    // Identity missing or not set up: nothing to fall back to that would be right to show.
    const useCache = f.status !== "identity_missing" && f.status !== "not_set_up";
    const snap = useCache ? ((await d.snapshots.read<WorkItem>("devops", cacheKey(ref.clientKey))) as WorkSnapshot | null) : null;
    const message = snap ? `${f.message}. Showing items from ${formatFetchedAt(snap.fetchedAt, d.timeZone, now())}` : useCache ? `${f.message}. No cached items yet` : f.message;
    return { clientKey: ref.clientKey, clientName: ref.clientName, status: f.status, message, ...(f.rootCause ? { cause: f.rootCause } : {}), fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: (snap?.items ?? []).map(withLevel), children: Array.isArray(snap?.children) ? snap.children.map(withLevel) : [], ...(Array.isArray(snap?.parents) ? { parents: snap.parents.map(withLevel) } : {}), ...(Array.isArray(snap?.types) ? { types: snap.types } : {}) };
  }

  async function loadOne(ref: ClientRef, targets: TargetsResult, watch: readonly number[], features: readonly number[]): Promise<ClientWork> {
    try {
      // The settings come from Dataverse, so its root cause (a locked keyring, no network) is DevOps's too.
      if (!targets.ok) throw new DevOpsFailure(targets.cause === "keyring" ? "error" : "unreachable", `DevOps settings unavailable (${targets.message})`, targets.cause);
      const target = targets.targets.find((t) => t.clientKey === ref.clientKey);
      // The organization is known from Dataverse even when identity or the PAT is missing.
      if (target?.org && ORG.test(target.org)) orgs.set(ref.clientKey, target.org);
      const pre = precheck(ref, target);
      if (pre) throw pre;
      const { items, children, watched, committed, parents, model } = await fetchClient(ref, target!, watch, features);
      reportItems(ref.clientKey, [...items, ...children, ...(watched ?? []), ...(committed ?? []), ...parents]);
      const fetchedAt = now().toZonedDateTimeISO(d.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
      const types = looksOf(model);
      const snap: WorkSnapshot = { fetchedAt, items, children, parents, types };
      await d.snapshots.write("devops", cacheKey(ref.clientKey), snap).catch(() => log("cache_write", { kind: "failed" }));
      return { clientKey: ref.clientKey, clientName: ref.clientName, status: "ok", fetchedAt, fromCache: false, items, children, watched, committed, parents, types };
    } catch (e) {
      if (!(e instanceof DevOpsFailure)) log("load", { kind: "unexpected" });
      return fromCache(ref, e instanceof DevOpsFailure ? e : new DevOpsFailure("error", `DevOps load failed for ${ref.clientName}`));
    }
  }

  /** One result per client, in the order given. A client never sees another client's items. */
  async function load(clients: ClientRef[], opts: { refresh?: boolean; watch?: Readonly<Record<string, readonly number[]>>; features?: Readonly<Record<string, readonly number[]>> } = {}): Promise<ClientWork[]> {
    if (d.central) return (await centralLoad(clients, opts)).map((r) => r.work);
    const t = now().epochMilliseconds;
    // What was asked for besides my items (committed features, items read by id): asking for other ones reads again.
    const ids = (r?: Readonly<Record<string, readonly number[]>>, k = "") => (r?.[k] ?? []).slice().sort((a, b) => a - b).join(",");
    const askedKey = (k: string) => `${ids(opts.features, k)}|${ids(opts.watch, k)}`;
    const fresh = (ref: ClientRef) => {
      const hit = memory.get(ref.clientKey);
      if (!hit) return null;
      // Read with other committed features (step 8) or other items by id (step 11): read again.
      const asked = askedKey(ref.clientKey);
      if (asked !== hit.features) return null;
      const age = t - hit.at;
      return (opts.refresh ? age < minRefresh : age < ttl) ? hit.result : null;
    };
    const need = clients.filter((c) => !fresh(c));
    if (need.length) {
      let targets: TargetsResult;
      try {
        targets = await d.targets(need.map((c) => c.clientKey));
      } catch {
        targets = { ok: false, message: "Dataverse read failed" };
      }
      const results = await Promise.all(need.map((ref) => loadOne(ref, targets, opts.watch?.[ref.clientKey] ?? [], opts.features?.[ref.clientKey] ?? [])));
      need.forEach((ref, i) => memory.set(ref.clientKey, { at: t, result: results[i]!, features: askedKey(ref.clientKey) }));
    }
    return clients.map((c) => memory.get(c.clientKey)!.result);
  }

  /** An item from the last result for a client (mine or a child), so picks can be checked on the server. */
  function lookup(clientKey: string, id: number): WorkItem | null {
    const r = memory.get(clientKey)?.result;
    return r?.items.find((i) => i.id === id) ?? r?.children.find((i) => i.id === id) ?? r?.committed?.find((i) => i.id === id) ?? null;
  }

  /** The last result per client in memory (step 7: Close out's follow-up rules use what was already fetched). */
  function last(clientKey: string): ClientWork | null {
    return memory.get(clientKey)?.result ?? null;
  }

  /** The client's DevOps organization, so a link can be checked against it. From cached items when the fetch failed. */
  function orgOf(clientKey: string): string | null {
    const known = orgs.get(clientKey);
    if (known) return known;
    const r = memory.get(clientKey)?.result;
    const found = new Set([...(r?.items ?? []), ...(r?.children ?? [])].map((i) => i.url.match(/^https:\/\/dev\.azure\.com\/([^/]+)\//)?.[1]?.toLowerCase()).filter(Boolean));
    return found.size === 1 ? decodeURIComponent([...found][0]!) : null;
  }

  /** Step 14: after a write, drop what is remembered for the client so the next read shows the change. */
  function forget(clientKey: string) {
    memory.delete(clientKey);
    portfolioMemory.delete(clientKey);
    // DV-1: the store is brought up to date from DevOps now, so the next read shows the change.
    d.central?.afterWrite(clientKey);
  }

  // ---- DV-1: reading the central store ----
  /**
   * Who may see a client is decided as before: `targets` (here without the PAT) lists only accounts the person is an
   * active Account Worker on, with their DevOps identity. Kept 5 minutes per client; Refresh reads it again.
   */
  const visible = new Map<string, { at: number; target: DevOpsTarget | null }>();
  async function viewerTargets(keys: readonly string[], force: boolean): Promise<TargetsResult> {
    const t = now().epochMilliseconds;
    const stale = keys.filter((k) => force || !visible.has(k) || t - visible.get(k)!.at >= ttl);
    if (stale.length) {
      let r: TargetsResult;
      try {
        r = await d.targets([...stale]);
      } catch {
        r = { ok: false, message: "Dataverse read failed" };
      }
      if (!r.ok) {
        // Nothing known yet: the failure is the answer. Known before: keep what was known.
        if (stale.some((k) => !visible.has(k))) return r;
      } else for (const k of stale) visible.set(k, { at: t, target: r.targets.find((x) => x.clientKey === k) ?? null });
    }
    return { ok: true, targets: keys.map((k) => visible.get(k)?.target).filter((x): x is DevOpsTarget => !!x) };
  }

  const stamp = (at: string | null) => (at ? Temporal.Instant.from(at).toZonedDateTimeISO(d.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" }) : null);
  const firstRead = (ref: ClientRef) => `FocusTime is reading ${ref.clientName}'s DevOps for the first time. Try again in a minute`;

  type CentralRead = { work: ClientWork; ctx: Ctx | null; meta: Metadata | null; view: CentralView | null };

  /** One client's work from the store, for this person. */
  async function centralWork(ref: ClientRef, targets: TargetsResult, o: { force: boolean; watch: readonly number[]; features: readonly number[] }): Promise<CentralRead> {
    const failed = (status: ClientWorkStatus, message: string, cause?: FailureCause): CentralRead => ({ work: { clientKey: ref.clientKey, clientName: ref.clientName, status, message, ...(cause ? { cause } : {}), fetchedAt: null, fromCache: false, items: [], children: [] }, ctx: null, meta: null, view: null });
    if (!targets.ok) return failed(targets.cause === "keyring" ? "error" : "unreachable", `DevOps settings unavailable (${targets.message})`, targets.cause);
    const target = targets.targets.find((t) => t.clientKey === ref.clientKey);
    if (target?.org && ORG.test(target.org)) orgs.set(ref.clientKey, target.org);
    const pre = precheck(ref, target, { pat: false });
    if (pre) return failed(pre.status, pre.message, pre.rootCause);
    const view = await d.central!.view(ref.clientKey, { force: o.force });
    const fetchedAt = stamp(view.okAt);
    if (!view.process || !view.loaded) {
      const f = view.failure ?? { status: "error" as const, message: firstRead(ref) };
      return { ...failed(f.status, f.message), view };
    }
    const { ctx } = contextOf(ref, { ...target!, pat: null });
    const meta = metaOf(view.process, ref.clientKey);
    try {
      const keep = keepOf(await scopeFor(ref.clientKey, view, meta.model, target!.email));
      const r = await readClient(ctx, meta, (m) => storeReads(ref.clientKey, view.values, m, keep), o.watch, o.features);
      reportItems(ref.clientKey, [...r.items, ...r.children, ...r.watched, ...r.committed, ...r.parents]);
      const types = looksOf(r.model);
      const f = view.failure;
      const message = f ? `${f.message}. Showing items from ${formatFetchedAt(fetchedAt ?? "", d.timeZone, now())}` : undefined;
      return { work: { clientKey: ref.clientKey, clientName: ref.clientName, status: f ? f.status : "ok", ...(message ? { message } : {}), fetchedAt, fromCache: !!f, items: r.items, children: r.children, watched: r.watched, committed: r.committed, parents: r.parents, types }, ctx, meta, view };
    } catch (e) {
      const f = e instanceof DevOpsFailure ? e : new DevOpsFailure("error", `DevOps load failed for ${ref.clientName}`);
      if (!(e instanceof DevOpsFailure)) log("load", { kind: "unexpected" });
      return { ...failed(f.status, f.message, f.rootCause), view };
    }
  }

  /** PL-1: what a by-id read of one client's store needs (no read of my items), or null when DevOps can't say now. */
  async function centralCtx(ref: ClientRef, targets: TargetsResult): Promise<{ ctx: Ctx; meta: Metadata; view: CentralView } | null> {
    if (!targets.ok || !d.central) return null;
    const target = targets.targets.find((t) => t.clientKey === ref.clientKey);
    if (precheck(ref, target, { pat: false })) return null;
    const view = await d.central.view(ref.clientKey, { force: false });
    if (!view.process || !view.loaded) return null;
    const { ctx } = contextOf(ref, { ...target!, pat: null });
    return { ctx, meta: metaOf(view.process, ref.clientKey), view };
  }

  /**
   * PL-1: these features as the store has them now, in any state, each with every child (assignee and state); null
   * for a client DevOps can't say anything about right now (not loaded, failing, or not this person's to see).
   */
  async function featureTrees(clients: ClientRef[], ids: Readonly<Record<string, readonly number[]>>): Promise<{ clientKey: string; items: PortfolioItem[] | null }[]> {
    if (!d.central) return clients.map((c) => ({ clientKey: c.clientKey, items: null }));
    const targets = await viewerTargets(clients.map((c) => c.clientKey), false);
    return Promise.all(
      clients.map(async (ref) => {
        const want = ids[ref.clientKey] ?? [];
        if (!want.length) return { clientKey: ref.clientKey, items: [] };
        const c = await centralCtx(ref, targets);
        if (!c) return { clientKey: ref.clientKey, items: null };
        try {
          const p = await readPortfolio(c.ctx, c.meta, [], (m) => storeReads(ref.clientKey, c.view.values, m), async () => c.view.fields ?? { fields: {}, starts: {}, size: null, ac: false }, want);
          return { clientKey: ref.clientKey, items: p.items };
        } catch {
          return { clientKey: ref.clientKey, items: null };
        }
      }),
    );
  }

  /**
   * AH-1 (D653): every item of each client the store has that isn't closed, at any level, with its revision, assignee
   * and the fields its type has (start, target, size), plus the parents of those items. For Ahead's grid and Gantt.
   */
  async function aheadItems(clients: ClientRef[], o: { refresh?: boolean; /** AH-2: "Show the whole project": items outside the scope too (marked). */ whole?: boolean } = {}): Promise<import("../../actions/types.ts").AheadClient[]> {
    const fail = (ref: ClientRef, status: ClientWorkStatus, message: string): import("../../actions/types.ts").AheadClient => ({ clientKey: ref.clientKey, clientName: ref.clientName, status, message, fetchedAt: null, project: null, me: null, startFields: {}, targetFields: {}, sizeFields: {}, fieldNames: {}, types: [], items: [] });
    if (!d.central) return clients.map((c) => fail(c, "error", "Ahead reads the shared DevOps store, which isn't running here"));
    const targets = await viewerTargets(clients.map((c) => c.clientKey), !!o.refresh);
    return Promise.all(
      clients.map(async (ref) => {
        if (!targets.ok) return fail(ref, targets.cause === "keyring" ? "error" : "unreachable", `DevOps settings unavailable (${targets.message})`);
        const target = targets.targets.find((t) => t.clientKey === ref.clientKey);
        const pre = precheck(ref, target, { pat: false });
        if (pre) return fail(ref, pre.status, pre.message);
        const view = await d.central!.view(ref.clientKey, { force: !!o.refresh });
        if (!view.process || !view.loaded) return fail(ref, view.failure?.status ?? "error", view.failure?.message ?? `FocusTime is reading ${ref.clientName}'s DevOps for the first time. Try again in a minute`);
        const { ctx } = contextOf(ref, { ...target!, pat: null });
        const meta = metaOf(view.process, ref.clientKey);
        const cats = stateCategories(meta.model, d.openStates?.(ref.clientKey) ?? []);
        const f = view.fields ?? { fields: {}, starts: {}, size: null, ac: false };
        const tz = d.timeZone;
        const str = (v: unknown) => (typeof v === "string" ? v : "");
        const all = view.values.map((v) => {
          const type = str(v.fields["System.WorkItemType"]);
          const state = str(v.fields["System.State"]);
          const category = cats.get(type)?.get(state.toLowerCase()) ?? "Unknown";
          const parent = v.fields["System.Parent"];
          const sizeField = f.sizes?.[type] ?? null;
          const sz = sizeField ? v.fields[sizeField] : null;
          const who = v.fields["System.AssignedTo"];
          const rung = meta.model.ladder.findIndex((r) => r.includes(type));
          const ord = meta.orderField ? v.fields[meta.orderField] : null;
          return {
            id: v.id, rev: typeof v.fields["System.Rev"] === "number" ? (v.fields["System.Rev"] as number) : 0,
            title: str(v.fields["System.Title"]).trim() || "(No title)", type, state, stateCategory: category,
            level: typeOf(meta.model, type)?.level ?? null, rung: rung >= 0 ? rung : null,
            parentId: typeof parent === "number" && Number.isInteger(parent) ? parent : null,
            assignee: who ? { name: identityName(who) ?? identityEmail(who) ?? "Someone", email: identityEmail(who) } : null,
            start: f.starts[type] ? dateOnly(v.fields[f.starts[type]!], tz) : null,
            target: f.fields[type] ? dateOnly(v.fields[f.fields[type]!], tz) : null,
            size: typeof sz === "number" && Number.isFinite(sz) ? sz : null,
            url: workItemUrl(ctx.org, ctx.projectName, v.id), changedAt: str(v.fields["System.ChangedDate"]),
            order: typeof ord === "number" && Number.isFinite(ord) ? ord : null,
          };
        });
        const known = all.filter((i) => i.level !== null && cats.has(i.type));
        // AH-2: the scope. Out of it, an item shows only with "Show the whole project" (or as a parent, for context).
        const sc = await scopeFor(ref.clientKey, view, meta.model, target?.email ?? null);
        const inScope = (id: number) => !sc || sc.all || sc.ids.has(id);
        const open = known.filter((i) => !isClosed(i.stateCategory));
        const keep = new Set(open.filter((i) => o.whole || inScope(i.id)).map((i) => i.id));
        const byId = new Map(known.map((i) => [i.id, i]));
        for (const id of [...keep]) for (let p = byId.get(id)?.parentId ?? null, n = 0; p !== null && n < 10; p = byId.get(p)?.parentId ?? null, n++) if (byId.has(p)) keep.add(p);
        const items = known.filter((i) => keep.has(i.id)).map((i) => ({ ...i, inScope: inScope(i.id) }));
        const scope = { kind: sc?.kind ?? "whole", automatic: sc?.kind === "automatic", all: sc ? sc.all : true, inScope: open.filter((i) => inScope(i.id)).length, total: open.length, problem: sc?.problem ?? null, whole: !!o.whole } as const;
        const typesOf = new Set(meta.model.types.map((t) => t.name));
        const pick = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([t]) => typesOf.has(t)));
        const fetchedAt = view.okAt ? Temporal.Instant.from(view.okAt).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" }) : null;
        reportItems(ref.clientKey, items.map((i) => ({ id: i.id })) as never);
        return {
          clientKey: ref.clientKey, clientName: ref.clientName, status: view.failure ? view.failure.status : "ok", ...(view.failure ? { message: view.failure.message } : {}),
          fetchedAt, project: ctx.projectName, me: target?.email ?? null,
          startFields: pick(f.starts), targetFields: pick(f.fields), sizeFields: pick(f.sizes ?? {}), fieldNames: f.names ?? {},
          types: looksOf(meta.model), items, scope, orderField: meta.orderField,
        };
      }),
    );
  }

  /** PL-1: the state category of these items (any state) as the store has them; null when DevOps can't say now. */
  async function itemStates(clients: ClientRef[], ids: Readonly<Record<string, readonly number[]>>): Promise<{ clientKey: string; states: Record<number, string> | null }[]> {
    if (!d.central) return clients.map((c) => ({ clientKey: c.clientKey, states: null }));
    const targets = await viewerTargets(clients.map((c) => c.clientKey), false);
    return Promise.all(
      clients.map(async (ref) => {
        const want = [...new Set(ids[ref.clientKey] ?? [])].filter((id) => Number.isInteger(id) && id > 0).slice(0, BATCH_MAX);
        if (!want.length) return { clientKey: ref.clientKey, states: {} };
        const c = await centralCtx(ref, targets);
        if (!c) return { clientKey: ref.clientKey, states: null };
        try {
          const meta = { ...c.meta, categories: stateCategories(c.meta.model, d.openStates?.(ref.clientKey) ?? []) };
          const values = await storeReads(ref.clientKey, c.view.values, meta).byIds(want, batchFields(meta.orderField));
          const items = normalized(c.ctx, meta, values, { keepDone: true, tiers: false });
          return { clientKey: ref.clientKey, states: Object.fromEntries(items.map((i) => [i.id, i.stateCategory])) };
        } catch {
          return { clientKey: ref.clientKey, states: null };
        }
      }),
    );
  }

  /**
   * CV-5: items a conversation or promise is linked to, as the store has them now, in any state and any scope (the
   * link already exists): state, assignee (display name), last change. Null when DevOps can't say for this client now.
   */
  async function linkedItems(ref: ClientRef, ids: readonly number[]): Promise<WorkItem[] | null> {
    const want = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0).slice(0, BATCH_MAX);
    if (!want.length) return [];
    if (!d.central) return null;
    const c = await centralCtx(ref, await viewerTargets([ref.clientKey], false));
    if (!c) return null;
    try {
      const meta = { ...c.meta, categories: stateCategories(c.meta.model, d.openStates?.(ref.clientKey) ?? []) };
      const values = await storeReads(ref.clientKey, c.view.values, meta).byIds(want, [...batchFields(meta.orderField), ASSIGNED_FIELD]);
      return normalized(await withIdentities(c.ctx), meta, values, { keepDone: true, tiers: false, people: true });
    } catch {
      return null;
    }
  }

  /**
   * CV-5: Link to item's search: one client's open items in Cooptimize's scope (AH-2, my own always), from the central
   * store, by #id or title words, newest change first, at most `limit`. Null when the store can't say for this client now.
   */
  async function searchItems(ref: ClientRef, query: string, limit = 20): Promise<import("../../actions/types.ts").AheadItem[] | null> {
    const [r] = await aheadItems([ref]);
    if (!r || !r.project) return null;
    const q = query.trim().toLowerCase().replace(/^#/, "");
    const words = q.split(/\s+/).filter(Boolean);
    return r.items
      .filter((i) => i.inScope && !isClosed(i.stateCategory))
      .filter((i) => !q || String(i.id) === q || words.every((w) => i.title.toLowerCase().includes(w)))
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
      .slice(0, limit);
  }

  /**
   * PL-1: the items whose state changed since an instant, per the change log; `known` false while the store's change
   * log doesn't cover the whole span yet (the first load came after it, just after DV-1) or DevOps can't say.
   */
  /** BH-1: Backlog's Last change: what the change log says each item's last change was, in its 30 days. */
  async function lastChanges(clientKey: string): Promise<Record<number, import("../../plan/backlog.ts").LastChange> | null> {
    if (!d.central?.lastChanges) return null;
    const targets = await viewerTargets([clientKey], false);
    if (!targets.ok || precheck({ clientKey, clientName: clientKey }, targets.targets.find((t) => t.clientKey === clientKey), { pat: false })) return null;
    const since = now().subtract({ hours: 24 * 30 }).toString();
    return d.central.lastChanges(clientKey, since).catch(() => null);
  }

  async function stateChanges(clientKey: string, since: string): Promise<{ known: boolean; itemIds: number[] }> {
    if (!d.central?.stateChanges) return { known: false, itemIds: [] };
    const targets = await viewerTargets([clientKey], false);
    if (!targets.ok || precheck({ clientKey, clientName: clientKey }, targets.targets.find((t) => t.clientKey === clientKey), { pat: false })) return { known: false, itemIds: [] };
    return d.central.stateChanges(clientKey, since).catch(() => ({ known: false, itemIds: [] }));
  }

  async function centralLoad(clients: ClientRef[], opts: { refresh?: boolean; watch?: Readonly<Record<string, readonly number[]>>; features?: Readonly<Record<string, readonly number[]>> }): Promise<CentralRead[]> {
    const force = !!opts.refresh;
    const targets = await viewerTargets(clients.map((c) => c.clientKey), force);
    const ids = (r?: Readonly<Record<string, readonly number[]>>, k = "") => (r?.[k] ?? []).slice().sort((a, b) => a - b).join(",");
    const reads = await Promise.all(clients.map((ref) => centralWork(ref, targets, { force, watch: opts.watch?.[ref.clientKey] ?? [], features: opts.features?.[ref.clientKey] ?? [] })));
    clients.forEach((ref, i) => memory.set(ref.clientKey, { at: now().epochMilliseconds, result: reads[i]!.work, features: `${ids(opts.features, ref.clientKey)}|${ids(opts.watch, ref.clientKey)}` }));
    return reads;
  }

  async function centralPortfolio(clients: ClientRef[], opts: { refresh?: boolean }): Promise<ClientPortfolio[]> {
    const features = Object.fromEntries(clients.map((c) => [c.clientKey, (memory.get(c.clientKey)?.features ?? "").split("|")[0]!.split(",").filter(Boolean).map(Number)]));
    const reads = await centralLoad(clients, { ...opts, features });
    return Promise.all(
      reads.map(async ({ work: w, ctx, meta, view }): Promise<ClientPortfolio> => {
        const base = { clientKey: w.clientKey, clientName: w.clientName, status: w.status, ...(w.message ? { message: w.message.replace("Showing items from", "Showing features from") } : {}), ...(w.cause ? { cause: w.cause } : {}), fetchedAt: w.fetchedAt, fromCache: w.fromCache };
        const none = { items: [], targetFields: {}, startFields: {}, sizeField: null, acceptanceField: false };
        if (!ctx || !meta || !view) return { ...base, ...none };
        try {
          const keep = keepOf(await scopeFor(w.clientKey, view, meta.model, ctx.me));
          const p = await readPortfolio(ctx, meta, w.items, (m) => storeReads(w.clientKey, view.values, m, keep), async () => view.fields ?? { fields: {}, starts: {}, size: null, ac: false });
          reportItems(w.clientKey, [...p.items, ...p.items.flatMap((i) => i.children)]);
          const out: ClientPortfolio = { ...base, ...p };
          portfolioMemory.set(w.clientKey, { at: now().epochMilliseconds, result: out });
          return out;
        } catch (e) {
          const f = e instanceof DevOpsFailure ? e : new DevOpsFailure("error", `DevOps load failed for ${w.clientName}`);
          return { ...base, status: f.status, message: f.message, ...none };
        }
      }),
    );
  }

  /**
   * DV-1: a read on demand (Break down, a description, the process view) for a client this person can see, with the
   * poller's PAT (memory only) and this person's identity. Through the same limiter as the poller's reads.
   */
  async function centralTarget(clientKey: string): Promise<{ ref: ClientRef; target: DevOpsTarget } | string> {
    const mine = await viewerTargets([clientKey], false);
    if (!mine.ok) return `DevOps settings can't be read from Dataverse now (${mine.message})`;
    const v = mine.targets.find((x) => x.clientKey === clientKey);
    const ref = { clientKey, clientName: v?.clientName ?? clientKey };
    const pre = precheck(ref, v, { pat: false });
    if (pre) return pre.message;
    const t = await d.central!.target(clientKey).catch(() => null);
    if (!t?.pat) return `DevOps isn't readable for ${ref.clientName} now`;
    return { ref, target: { ...t, email: v!.email } };
  }

  // ---- DV-1: what the central poller uses (an app-level source: targets carry the company read PAT, no identity) ----
  const internal = {
    /** Why a client can't be polled, or null. */
    check: (target: DevOpsTarget | undefined, ref: ClientRef) => precheck(ref, target, { identity: false }),
    /** The process (a day) and the Plan the week fields (an hour) of the client's project. */
    async meta(target: DevOpsTarget, o: { refresh?: boolean } = {}): Promise<{ process: ProcessRaw; meta: Metadata; fields: FieldSet }> {
      const { ctx, project } = contextOf({ clientKey: target.clientKey, clientName: target.clientName }, target);
      const process = await loadProcess(ctx, project, o.refresh);
      const meta = metaOf(process, target.clientKey);
      const fields = await targetFieldsFor(ctx, project, [...meta.tiers.feature, ...meta.tiers.epic], [...meta.levels.story]);
      return { process, meta: { ...meta, categories: stateCategories(meta.model, d.openStates?.(target.clientKey) ?? []) }, fields };
    },
    /** AH-2: the project's area tree and teams (a day). */
    async areas(target: DevOpsTarget, o: { refresh?: boolean } = {}): Promise<ProjectAreas> {
      const { ctx, project } = contextOf({ clientKey: target.clientKey, clientName: target.clientName }, target);
      return loadAreas(ctx, project, o.refresh);
    },
    /**
     * AH-2: Admin › Clients' counts for a client's store: open items per area path and team, how many are Cooptimize's,
     * and how many the automatic scope takes. Null until the poller has read the client.
     */
    scopeCounts(view: CentralView, clientKey: string, isCooptimizer: (email: string) => boolean): ScopeCounts | null {
      if (!view.process || !view.loaded) return null;
      const meta = metaOf(view.process, clientKey);
      const cats = stateCategories(meta.model, d.openStates?.(clientKey) ?? []);
      const open = view.values.filter((v) => {
        const type = typeof v.fields["System.WorkItemType"] === "string" ? (v.fields["System.WorkItemType"] as string) : "";
        const state = typeof v.fields["System.State"] === "string" ? (v.fields["System.State"] as string).toLowerCase() : "";
        return typeOf(meta.model, type)?.level != null && cats.has(type) && !isClosed(cats.get(type)?.get(state) ?? "Unknown");
      });
      return scopeCounts(scopeItems(open, meta.model), { areas: view.areas ?? null, isCooptimizer });
    },
    /** A WIQL query in the client's project with time precision: the ids, and the server's "as of" time. */
    async ids(target: DevOpsTarget, query: string, top: number): Promise<{ ids: number[]; asOf: string | null }> {
      const { ctx, project } = contextOf({ clientKey: target.clientKey, clientName: target.clientName }, target);
      const r = await call<{ workItems?: { id?: unknown }[]; asOf?: unknown }>(ctx, "wiql_changed", `${encodeURIComponent(project)}/_apis/wit/wiql?timePrecision=true&$top=${top}`, { query });
      return { ids: (r.workItems ?? []).map((w) => w.id).filter((id): id is number => typeof id === "number" && Number.isInteger(id)), asOf: typeof r.asOf === "string" ? r.asOf : null };
    },
    /** The batch call in chunks of 200, as raw values. */
    async batch(target: DevOpsTarget, ids: readonly number[], fields: string[]): Promise<RawValue[]> {
      const { ctx, project } = contextOf({ clientKey: target.clientKey, clientName: target.clientName }, target);
      return (await httpReads(ctx, project, null as never).byIds(ids, fields)).filter((v): v is RawValue => typeof (v as RawValue)?.id === "number" && typeof (v as RawValue)?.fields === "object" && (v as RawValue).fields !== null);
    },
  };

  return { load, lookup, orgOf, last, portfolio, description, forget, featureSignals, exemplarPool, processModels, featureTrees, itemStates, stateChanges, lastChanges, aheadItems, linkedItems, searchItems, featureComments, activity, internal };
}

/** What screens use (the same interface whether it reads DevOps or the central store). */
type FullSource = ReturnType<typeof createDevOpsSource>;
/** PL-1's by-id reads are optional: a source without them (a stub, an older adapter) means "DevOps can't say". */
type PlanReads = "featureTrees" | "itemStates" | "stateChanges" | "lastChanges" | "aheadItems" | "linkedItems" | "searchItems" | "featureComments" | "activity";
export type DevOpsSource = Omit<FullSource, "internal" | PlanReads> & Partial<Pick<FullSource, PlanReads>>;
/** DV-1: what the central poller uses of an app-level source. */
export type DevOpsInternal = ReturnType<typeof createDevOpsSource>["internal"];
