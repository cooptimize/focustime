// Read-only Azure DevOps source: open work items assigned to me, per client.
// Each client is fetched, fails and is cached on its own. PATs arrive from Dataverse for one fetch,
// wrapped in Pat, and are used only to build the Authorization header right at the request. They are
// never logged, cached, returned or put in a message. Only the normalized items are cached.
import { createHash } from "node:crypto";
import type { SnapshotStore } from "../../host/types.ts";
import type { Logger } from "../../log/logger.ts";
import type { ClientPortfolio, ClientWork, ClientWorkStatus, FailureCause, PortfolioItem, WorkItem } from "../../week/types.ts";
import { formatFetchedAt } from "../when.ts";
import { batchFields, buildAllChildrenWiql, buildChildrenWiql, buildWiql, detectOrderField, detectSizeField, detectTargetField, START_DATE_FIELD, ACCEPTANCE_FIELD, htmlToText, normalizeWorkItems, type BacklogLevels, type FieldInfo, type NormalizeContext, type StateCategories } from "./normalize.ts";
import { buildProcessModel, isClosed, isOpen, looksOf, type TypeLook, planningLevels, stateCategories, typeOf, type ProcessModel, type ProcessOverrides, type RawProcess } from "../../plan/process.ts";
import type { Pat } from "./pat.ts";
import type { DevOpsTarget, TargetsResult } from "./types.ts";
import type { ExemplarCandidate, FeatureSignals } from "../../plan/stories.ts";
import { CHILD_FIELDS, childrenWiql, COMMENTS_API, COMMENTS_TOP, EPIC_FIELDS, FEATURE_FIELDS, parseChild, parseComments, parseEpic, parseFeature, POOL_FEATURE_FIELDS, POOL_FEATURES, poolCandidates, poolStoriesWiql, poolStoryFields, poolWiql } from "./signals.ts";

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
};

export type ClientRef = { clientKey: string; clientName: string };

/** A safe, plain failure. Never carries bodies, headers or PATs. */
class DevOpsFailure extends Error {
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
type ProcessRaw = { raw: RawProcess; orderField: string | null };
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

  type Ctx = { client: string; /** The client key (process overrides are per client). */ clientKey: string; org: string; base: string; projectName: string; pat: Pat; /** My identity here (not secret), for changedByMe. */ me: string | null };

  /** One request. Errors are mapped to plain messages; response bodies of failures are never read. */
  async function call<T>(c: Ctx, op: string, path: string, body?: unknown): Promise<T> {
    // DS-1: a path may name its own api-version (the comments API is a preview version).
    const url = path.includes("api-version=") ? `${c.base}/${path}` : `${c.base}/${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`;
    const started = performance.now();
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
    // Azure DevOps answers a bad PAT with 401, or with a 203 or a redirect to a sign-in page.
    if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect")
      throw new DevOpsFailure("auth_failed", `DevOps PAT expired or invalid for ${c.client}`);
    if (res.status === 403 || res.status === 404) throw new DevOpsFailure("no_access", `No access to DevOps project ${c.projectName} for ${c.client}`);
    if (!res.ok) throw new DevOpsFailure("error", `DevOps error (HTTP ${res.status}) for ${c.client}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) throw new DevOpsFailure("auth_failed", `DevOps PAT expired or invalid for ${c.client}`);
    return (await res.json()) as T;
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

  /** WIQL for ids, then the batch call in chunks of 200, normalized. */
const ASSIGNED_FIELD = "System.AssignedTo";
  /** `people` (PV-1): also the assignee (display name, and the email only to match a Cooptimizer), for children. */
  async function fetchItems(ctx: Ctx, project: string, meta: Metadata, query: string, people = false): Promise<WorkItem[]> {
    const p = encodeURIComponent(project);
    const wiql = await call<{ workItems?: { id?: unknown }[] }>(ctx, "wiql", `${p}/_apis/wit/wiql?$top=${WIQL_TOP}`, { query });
    const ids = (wiql.workItems ?? []).map((w) => w.id).filter((id): id is number => typeof id === "number" && Number.isInteger(id));
    const values: unknown[] = [];
    for (let i = 0; i < ids.length; i += BATCH_MAX) {
      const page = await call<{ value?: unknown[] }>(ctx, "workitemsbatch", `${p}/_apis/wit/workitemsbatch`, {
        ids: ids.slice(i, i + BATCH_MAX),
        fields: people ? [...batchFields(meta.orderField), ASSIGNED_FIELD] : batchFields(meta.orderField),
        errorPolicy: "omit",
      });
      values.push(...(page.value ?? []));
    }
    const { items, skipped } = normalizeWorkItems(values, { org: ctx.org, projectName: ctx.projectName, orderField: meta.orderField, categories: meta.categories, levels: meta.levels, tiers: meta.tiers, me: ctx.me, ...(people ? { people: true } : {}) });
    if (skipped) log("normalize", { kind: "skipped", count: skipped });
    return items;
  }

  /** Items read by id (step 7): those an open follow-up is about that aren't among my open items, completed ones too. */
  async function fetchWatched(ctx: Ctx, project: string, meta: Metadata, ids: number[]): Promise<WorkItem[]> {
    if (!ids.length) return [];
    const page = await call<{ value?: unknown[] }>(ctx, "workitemsbatch", `${encodeURIComponent(project)}/_apis/wit/workitemsbatch`, { ids: ids.slice(0, BATCH_MAX), fields: batchFields(meta.orderField), errorPolicy: "omit" });
    return normalizeWorkItems(page.value ?? [], { org: ctx.org, projectName: ctx.projectName, orderField: meta.orderField, categories: meta.categories, levels: meta.levels, tiers: meta.tiers, keepDone: true, me: ctx.me }).items.filter((i) => ids.includes(i.id));
  }

  function contextOf(ref: ClientRef, target: DevOpsTarget): { ctx: Ctx; project: string } {
    const org = target.org!;
    return { ctx: { client: ref.clientName, clientKey: ref.clientKey, org, base: `https://dev.azure.com/${encodeURIComponent(org)}`, projectName: target.projectName ?? target.project!, pat: target.pat!, me: target.email }, project: target.project! };
  }

  /** The batch call for given ids and fields, in chunks of 200, normalized with the given context. */
  async function readByIds(ctx: Ctx, project: string, ids: readonly number[], fields: string[], n: Omit<NormalizeContext, "org" | "projectName">): Promise<WorkItem[]> {
    const values: unknown[] = [];
    for (let i = 0; i < ids.length; i += BATCH_MAX) {
      const page = await call<{ value?: unknown[] }>(ctx, "workitemsbatch", `${encodeURIComponent(project)}/_apis/wit/workitemsbatch`, { ids: ids.slice(i, i + BATCH_MAX), fields, errorPolicy: "omit" });
      values.push(...(page.value ?? []));
    }
    return normalizeWorkItems(values, { org: ctx.org, projectName: ctx.projectName, ...n }).items;
  }

  /** Q47: without a story level the backlog levels can't tell stories from features, so the client fails instead of guessing. */
  function needStoryLevel(meta: Metadata, ctx: Ctx, project: string) {
    if (meta.levels.story.size === 0)
      throw new DevOpsFailure("error", `The process for ${ctx.projectName || project} (${ctx.client}) has no story level in its backlog levels, so FocusTime can't tell stories from features there. Nothing is guessed; check the project's backlog configuration`);
  }

  async function fetchClient(ref: ClientRef, target: DevOpsTarget, watch: readonly number[] = [], features: readonly number[] = []): Promise<{ items: WorkItem[]; children: WorkItem[]; watched: WorkItem[]; committed: WorkItem[]; parents: WorkItem[]; model: ProcessModel }> {
    const { ctx, project } = contextOf(ref, target);
    const raw = await loadMetadata(ctx, project);
    needStoryLevel(raw, ctx, project);
    const meta = { ...raw, categories: stateCategories(raw.model, d.openStates?.(ref.clientKey) ?? []) };
    // WT-1 safety net: a bug assigned to me is always at child level, even when the team has bugs off.
    // PV-1: mine by the query (the assignee is me), so the Week panel can tell them from teammates' children.
    const items = (await fetchItems(ctx, project, meta, buildWiql(target.email!, meta.categories, meta.orderField))).map((i) => ({ ...(i.level === "other" && typeOf(meta.model, i.type)?.bug ? { ...i, level: "story" as const } : i), assignedToMe: true }));
    log("items", { count: items.length });
    // Features committed to a week (step 8) that aren't mine: read by id (open ones), so their stories can be offered.
    const mineIds = new Set(items.map((i) => i.id));
    const wanted = features.filter((id) => Number.isInteger(id) && id > 0 && !mineIds.has(id)).slice(0, BATCH_MAX);
    const committed = wanted.length ? (await readByIds(ctx, project, wanted, batchFields(meta.orderField), { orderField: meta.orderField, categories: meta.categories, levels: meta.levels, me: ctx.me })).filter((i) => wanted.includes(i.id)) : [];
    // Epics and features can't be picked: read their open children (any assignee), up to two levels down, read-only.
    const children: WorkItem[] = [];
    const seen = new Set([...items.map((i) => i.id), ...committed.map((i) => i.id)]);
    let parents = [...items.filter((i) => i.level === "portfolio").map((i) => i.id), ...committed.map((i) => i.id)];
    for (let depth = 0; depth < CHILD_DEPTH && parents.length; depth++) {
      const found = (await fetchItems(ctx, project, meta, buildChildrenWiql(parents.slice(0, MAX_PARENTS), meta.categories, meta.orderField), true)).filter((c) => !seen.has(c.id));
      for (const c of found) seen.add(c.id);
      children.push(...found);
      parents = found.filter((c) => c.level === "portfolio").map((c) => c.id);
    }
    if (children.length) log("children", { count: children.length });
    const missing = watch.filter((id) => Number.isInteger(id) && id > 0 && !seen.has(id));
    const watched = await fetchWatched(ctx, project, meta, missing);
    if (watched.length) log("watched", { count: watched.length });
    // PV-1 (D565): the parents of my stories that no read above has (a feature that's neither mine nor committed), by
    // id, so the Week panel can group every story under its feature.
    const known = new Set([...seen, ...watched.map((w) => w.id)]);
    const up = [...new Set([...items, ...children].filter((i) => i.assignedToMe && i.level === "story" && i.parentId !== null && !known.has(i.parentId)).map((i) => i.parentId!))].slice(0, BATCH_MAX);
    const parentItems = up.length ? (await readByIds(ctx, project, up, batchFields(meta.orderField), { orderField: meta.orderField, categories: meta.categories, levels: meta.levels, me: ctx.me })).filter((i) => up.includes(i.id)) : [];
    if (parentItems.length) log("parents", { count: parentItems.length });
    return { items, children, watched, committed, parents: parentItems, model: meta.model };
  }

  // ---- Plan the week (step 8): features and epics, read-only ----
  const portfolioMemory = new Map<string, { at: number; result: ClientPortfolio }>();
  const targetFieldMemory = new Map<string, { at: number; fields: Record<string, string>; starts: Record<string, string>; size: string | null; ac: boolean }>();

  /**
   * The target date field per portfolio type (and, D461, per story type, for the dates in Plan the week) for a project, and (step 16) the size field on stories, cached like the
   * metadata. None found: no target dates, no sizes.
   */
  async function targetFieldsFor(c: Ctx, project: string, types: readonly string[], storyTypes: readonly string[] = []): Promise<{ fields: Record<string, string>; starts: Record<string, string>; size: string | null; ac: boolean }> {
    const key = `${c.org.toLowerCase()}/${project.toLowerCase()}`;
    const hit = targetFieldMemory.get(key);
    const t = now().epochMilliseconds;
    if (hit && t - hit.at < metaTtl) return { fields: hit.fields, starts: hit.starts, size: hit.size, ac: hit.ac };
    const p = encodeURIComponent(project);
    const out: Record<string, string> = {};
    const starts: Record<string, string> = {};
    let size: string | null = null;
    let ac = false;
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
      }
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
    targetFieldMemory.set(key, { at: t, fields: out, starts, size, ac });
    return { fields: out, starts, size, ac };
  }

  async function fetchPortfolio(ref: ClientRef, target: DevOpsTarget, mine: readonly WorkItem[]): Promise<{ items: PortfolioItem[]; targetFields: Record<string, string>; startFields: Record<string, string>; sizeField: string | null; acceptanceField: boolean }> {
    const { ctx, project } = contextOf(ref, target);
    const raw = await loadMetadata(ctx, project);
    needStoryLevel(raw, ctx, project);
    const categories = stateCategories(raw.model, d.openStates?.(ref.clientKey) ?? []);
    const portfolioTypes = new Set([...raw.tiers.feature, ...raw.tiers.epic]);
    // Assigned to me, or the parent of a story-level item assigned to me (raw backlog levels, not the pickable list).
    const assigned = new Set(mine.filter((i) => portfolioTypes.has(i.type)).map((i) => i.id));
    const parents = new Set(mine.filter((i) => raw.levels.story.has(i.type) && i.parentId !== null).map((i) => i.parentId!));
    const ids = [...new Set([...assigned, ...parents])].slice(0, MAX_PARENTS);
    if (!ids.length) return { items: [], targetFields: {}, startFields: {}, sizeField: null, acceptanceField: false };
    const { fields: targetFields, starts: startFields, size: sizeField, ac: acceptanceField } = await targetFieldsFor(ctx, project, [...portfolioTypes], [...raw.levels.story]);
    const fields = [...batchFields(raw.orderField), "System.AssignedTo", "System.AreaPath", "System.IterationPath", ...new Set([...Object.values(targetFields), ...Object.values(startFields)]), ...(sizeField ? [sizeField] : [])];
    const n = { orderField: raw.orderField, categories, levels: raw.levels, keepDone: true, me: ctx.me, people: true, targetFields, startFields, timeZone: d.timeZone, sizeField, paths: true };
    const found = (await readByIds(ctx, project, ids, fields, n)).filter((i) => portfolioTypes.has(i.type) && !isClosed(i.stateCategory));
    // Q49: follow parent links up to the top portfolio level, so the epics above my features are read too.
    const above = new Set<number>();
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
      const have = new Set(found.map((i) => i.id));
      const up = [...new Set(found.map((i) => i.parentId).filter((id): id is number => id !== null && !have.has(id)))].slice(0, MAX_PARENTS);
      if (!up.length) break;
      const got = (await readByIds(ctx, project, up, fields, n)).filter((i) => portfolioTypes.has(i.type) && !isClosed(i.stateCategory) && !have.has(i.id));
      if (!got.length) break;
      for (const i of got) above.add(i.id);
      found.push(...got);
    }
    found.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
    const kids: WorkItem[] = [];
    if (found.length) {
      const p = encodeURIComponent(project);
      const wiql = await call<{ workItems?: { id?: unknown }[] }>(ctx, "wiql", `${p}/_apis/wit/wiql?$top=${WIQL_TOP}`, { query: buildAllChildrenWiql(found.map((i) => i.id), raw.orderField) });
      const kidIds = (wiql.workItems ?? []).map((w) => w.id).filter((id): id is number => typeof id === "number" && Number.isInteger(id));
      kids.push(...(await readByIds(ctx, project, kidIds, fields, n)));
    }
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
    const targets = await d.targets([clientKey]).catch(() => null);
    const target = targets?.ok ? targets.targets.find((x) => x.clientKey === clientKey) : undefined;
    const ref = { clientKey, clientName: target?.clientName ?? clientKey };
    if (!target || precheck(ref, target)) return null;
    const { ctx, project } = contextOf(ref, target);
    const page = await call<{ value?: { id?: unknown; fields?: Record<string, unknown> }[] }>(ctx, "workitemsbatch", `${encodeURIComponent(project)}/_apis/wit/workitemsbatch`, { ids: [id], fields: ["System.Id", "System.Description"], errorPolicy: "omit" });
    const html = page.value?.find((v) => v.id === id)?.fields?.["System.Description"];
    return typeof html === "string" ? htmlToText(html) : "";
  }

  /** DS-1: the client's target and context for a read on demand (Draft stories), or a plain reason. */
  async function onDemand(clientKey: string): Promise<{ ctx: Ctx; project: string; meta: Metadata } | string> {
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
      if (!meta.tiers.feature.has(feature.type)) return { ok: false, message: `#${id} is a ${feature.type}: Draft stories works on features` };
      // WT-1: the child types this feature's type takes, the most common in this project's history first.
      const ft = typeOf(meta.model, feature.type);
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

  /** Check the target is usable. Identity is never guessed. */
  function precheck(ref: ClientRef, target: DevOpsTarget | undefined): DevOpsFailure | null {
    if (!target) return new DevOpsFailure("not_set_up", `No Account Worker for ${ref.clientName} in Dataverse`);
    if (target.problem) return new DevOpsFailure("error", target.problem);
    if (!target.email) return new DevOpsFailure("identity_missing", `DevOps identity missing for ${ref.clientName}`);
    const missing = [!target.org && "organization", !target.project && "project", !target.pat && "PAT"].filter(Boolean);
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
  }

  return { load, lookup, orgOf, last, portfolio, description, forget, featureSignals, exemplarPool, processModels };
}

export type DevOpsSource = ReturnType<typeof createDevOpsSource>;
