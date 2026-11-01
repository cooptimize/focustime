// Read-only Azure DevOps source: open work items assigned to me, per client.
// Each client is fetched, fails and is cached on its own. PATs arrive from Dataverse for one fetch,
// wrapped in Pat, and are used only to build the Authorization header right at the request. They are
// never logged, cached, returned or put in a message. Only the normalized items are cached.
import { createHash } from "node:crypto";
import { readSnapshot, writeSnapshot } from "../../cache/snapshots.ts";
import type { Logger } from "../../log/logger.ts";
import type { ClientPortfolio, ClientWork, ClientWorkStatus, FailureCause, PortfolioItem, WorkItem } from "../../week/types.ts";
import { formatFetchedAt } from "../when.ts";
import { withOpenStates, allowPortfolio, backlogLevels, batchFields, buildAllChildrenWiql, buildChildrenWiql, buildWiql, categoriesFrom, detectOrderField, detectTargetField, DONE_CATEGORIES, htmlToText, normalizeWorkItems, portfolioTiers, type BacklogLevels, type FieldInfo, type NormalizeContext, type StateCategories } from "./normalize.ts";
import type { Pat } from "./pat.ts";
import type { DevOpsTarget, TargetsResult } from "./types.ts";

export const API_VERSION = "7.1";
const BATCH_MAX = 200; // documented maximum ids per workitemsbatch call
const WIQL_TOP = 1000;
const CHILD_DEPTH = 2; // epic → feature → story
const MAX_PARENTS = 200; // keeps the IN (...) list far under the 32K WIQL limit
const MAX_ANCESTOR_DEPTH = 4; // feature → epic → any custom levels above, Q49

export type DevOpsDeps = {
  fetch: typeof fetch;
  log: Logger;
  cacheDir: string;
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
  /** Portfolio types that can still be picked (config [plan], Q20). Read at each fetch. */
  pickableTypes?: () => readonly string[];
  /** A client's "treat as open" states (config [clients], step 6b). Read at each fetch. */
  openStates?: (clientKey: string) => readonly string[];
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

type Metadata = { orderField: string | null; categories: StateCategories; levels: BacklogLevels; /** Plan the week (step 8): portfolio tiers from the backlog levels. */ tiers: { feature: Set<string>; epic: Set<string> } };

/** What the cache file holds for Plan the week per client: normalized portfolio items only (no descriptions). */
type PortfolioSnapshot = { fetchedAt: string; items: PortfolioItem[]; targetFields: Record<string, string> };

/** What the cache file holds per client: normalized items only. */
type WorkSnapshot = { fetchedAt: string; items: WorkItem[]; children?: WorkItem[] };

/** Items cached before step 5 have no level; treat them as story level so nothing becomes unpickable by accident. */
const withLevel = (i: WorkItem): WorkItem => (i.level ? i : { ...i, level: "story" });

const ORG = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;

export function cacheKey(clientKey: string): string {
  const slug = clientKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
  return `${slug}-${createHash("sha256").update(clientKey).digest("hex").slice(0, 8)}`;
}

export function createDevOpsSource(d: DevOpsDeps) {
  const now = d.now ?? (() => Temporal.Now.instant());
  const timeoutMs = d.timeoutMs ?? 15_000;
  const retryDelayMs = d.retryDelayMs ?? 500;
  const ttl = d.memoryTtlMs ?? 5 * 60_000;
  const minRefresh = d.minRefreshMs ?? 60_000;
  const metaTtl = d.metadataTtlMs ?? 60 * 60_000;
  const memory = new Map<string, { at: number; result: ClientWork; /** The committed features it was read with, sorted ids. */ features: string }>();
  const metadata = new Map<string, { at: number; meta: Metadata }>();
  /** Each client's DevOps organization name (not secret), from its last Dataverse settings. */
  const orgs = new Map<string, string>();
  const log = (op: string, extra: { status?: number; durationMs?: number; count?: number; kind?: string } = {}) => d.log({ source: "devops", op, ...extra });

  type Ctx = { client: string; org: string; base: string; projectName: string; pat: Pat; /** My identity here (not secret), for changedByMe. */ me: string | null };

  /** One request. Errors are mapped to plain messages; response bodies of failures are never read. */
  async function call<T>(c: Ctx, op: string, path: string, body?: unknown): Promise<T> {
    const url = `${c.base}/${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`;
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

  async function loadMetadata(c: Ctx, project: string): Promise<Metadata> {
    const key = `${c.org.toLowerCase()}/${project.toLowerCase()}`;
    const hit = metadata.get(key);
    const t = now().epochMilliseconds;
    if (hit && t - hit.at < metaTtl) return hit.meta;
    const p = encodeURIComponent(project);
    const [pc, types] = await Promise.all([
      call<unknown>(c, "processconfiguration", `${p}/_apis/work/processconfiguration`),
      call<{ value?: { name?: unknown; states?: unknown }[] }>(c, "workitemtypes", `${p}/_apis/wit/workitemtypes`),
    ]);
    const list = (types.value ?? []).filter((x): x is { name: string; states?: unknown } => typeof x.name === "string");
    // Some responses list states with each type; otherwise ask the per-type states endpoint.
    const withStates = await Promise.all(
      list.map(async (x) => {
        if (Array.isArray(x.states) && x.states.length) return { name: x.name, states: x.states as { name?: unknown; category?: unknown }[] };
        const s = await call<{ value?: { name?: unknown; category?: unknown }[] }>(c, "states", `${p}/_apis/wit/workitemtypes/${encodeURIComponent(x.name)}/states`);
        return { name: x.name, states: s.value ?? [] };
      }),
    );
    const meta = { orderField: detectOrderField(pc), categories: categoriesFrom(withStates), levels: backlogLevels(pc), tiers: portfolioTiers(pc) };
    metadata.set(key, { at: t, meta });
    return meta;
  }

  /** WIQL for ids, then the batch call in chunks of 200, normalized. */
  async function fetchItems(ctx: Ctx, project: string, meta: Metadata, query: string): Promise<WorkItem[]> {
    const p = encodeURIComponent(project);
    const wiql = await call<{ workItems?: { id?: unknown }[] }>(ctx, "wiql", `${p}/_apis/wit/wiql?$top=${WIQL_TOP}`, { query });
    const ids = (wiql.workItems ?? []).map((w) => w.id).filter((id): id is number => typeof id === "number" && Number.isInteger(id));
    const values: unknown[] = [];
    for (let i = 0; i < ids.length; i += BATCH_MAX) {
      const page = await call<{ value?: unknown[] }>(ctx, "workitemsbatch", `${p}/_apis/wit/workitemsbatch`, {
        ids: ids.slice(i, i + BATCH_MAX),
        fields: batchFields(meta.orderField),
        errorPolicy: "omit",
      });
      values.push(...(page.value ?? []));
    }
    const { items, skipped } = normalizeWorkItems(values, { org: ctx.org, projectName: ctx.projectName, orderField: meta.orderField, categories: meta.categories, levels: meta.levels, tiers: meta.tiers, me: ctx.me });
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
    return { ctx: { client: ref.clientName, org, base: `https://dev.azure.com/${encodeURIComponent(org)}`, projectName: target.projectName ?? target.project!, pat: target.pat!, me: target.email }, project: target.project! };
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
      throw new DevOpsFailure("error", `The process for ${ctx.projectName || project} (${ctx.client}) has no story level in its backlog levels, so Coopilot can't tell stories from features there. Nothing is guessed; check the project's backlog configuration`);
  }

  async function fetchClient(ref: ClientRef, target: DevOpsTarget, watch: readonly number[] = [], features: readonly number[] = []): Promise<{ items: WorkItem[]; children: WorkItem[]; watched: WorkItem[]; committed: WorkItem[] }> {
    const { ctx, project } = contextOf(ref, target);
    const raw = await loadMetadata(ctx, project);
    needStoryLevel(raw, ctx, project);
    const meta = { ...raw, categories: withOpenStates(raw.categories, d.openStates?.(ref.clientKey) ?? []), levels: allowPortfolio(raw.levels, d.pickableTypes?.() ?? []) };
    const items = await fetchItems(ctx, project, meta, buildWiql(target.email!, meta.categories, meta.orderField));
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
      const found = (await fetchItems(ctx, project, meta, buildChildrenWiql(parents.slice(0, MAX_PARENTS), meta.categories, meta.orderField))).filter((c) => !seen.has(c.id));
      for (const c of found) seen.add(c.id);
      children.push(...found);
      parents = found.filter((c) => c.level === "portfolio").map((c) => c.id);
    }
    if (children.length) log("children", { count: children.length });
    const missing = watch.filter((id) => Number.isInteger(id) && id > 0 && !seen.has(id));
    const watched = await fetchWatched(ctx, project, meta, missing);
    if (watched.length) log("watched", { count: watched.length });
    return { items, children, watched, committed };
  }

  // ---- Plan the week (step 8): features and epics, read-only ----
  const portfolioMemory = new Map<string, { at: number; result: ClientPortfolio }>();
  const targetFieldMemory = new Map<string, { at: number; fields: Record<string, string> }>();

  /** The target date field per portfolio type for a project (cached like the metadata). None found: no target dates. */
  async function targetFieldsFor(c: Ctx, project: string, types: readonly string[]): Promise<Record<string, string>> {
    const key = `${c.org.toLowerCase()}/${project.toLowerCase()}`;
    const hit = targetFieldMemory.get(key);
    const t = now().epochMilliseconds;
    if (hit && t - hit.at < metaTtl) return hit.fields;
    const p = encodeURIComponent(project);
    const out: Record<string, string> = {};
    try {
      const all = await call<{ value?: FieldInfo[] }>(c, "fields", `${p}/_apis/wit/fields`);
      for (const type of types) {
        const tf = await call<{ value?: { referenceName?: unknown }[] }>(c, "typefields", `${p}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields`);
        const has = new Set((tf.value ?? []).map((f) => f.referenceName).filter((r): r is string => typeof r === "string"));
        const found = detectTargetField(all.value ?? [], has);
        if (found) out[type] = found;
      }
    } catch (e) {
      // A refused field list only means no target dates; a bad PAT fails the reads that follow anyway.
      if (e instanceof DevOpsFailure && e.status === "auth_failed") throw e;
      log("target_fields", { kind: "unavailable" });
      return {};
    }
    targetFieldMemory.set(key, { at: t, fields: out });
    return out;
  }

  async function fetchPortfolio(ref: ClientRef, target: DevOpsTarget, mine: readonly WorkItem[]): Promise<{ items: PortfolioItem[]; targetFields: Record<string, string> }> {
    const { ctx, project } = contextOf(ref, target);
    const raw = await loadMetadata(ctx, project);
    needStoryLevel(raw, ctx, project);
    const categories = withOpenStates(raw.categories, d.openStates?.(ref.clientKey) ?? []);
    const portfolioTypes = new Set([...raw.tiers.feature, ...raw.tiers.epic]);
    // Assigned to me, or the parent of a story-level item assigned to me (raw backlog levels, not the pickable list).
    const assigned = new Set(mine.filter((i) => portfolioTypes.has(i.type)).map((i) => i.id));
    const parents = new Set(mine.filter((i) => raw.levels.story.has(i.type) && i.parentId !== null).map((i) => i.parentId!));
    const ids = [...new Set([...assigned, ...parents])].slice(0, MAX_PARENTS);
    if (!ids.length) return { items: [], targetFields: {} };
    const targetFields = await targetFieldsFor(ctx, project, [...portfolioTypes]);
    const fields = [...batchFields(raw.orderField), "System.AssignedTo", ...new Set(Object.values(targetFields))];
    const n = { orderField: raw.orderField, categories, levels: raw.levels, keepDone: true, me: ctx.me, people: true, targetFields, timeZone: d.timeZone };
    const found = (await readByIds(ctx, project, ids, fields, n)).filter((i) => portfolioTypes.has(i.type) && !DONE_CATEGORIES.has(i.stateCategory));
    // Q49: follow parent links up to the top portfolio level, so the epics above my features are read too.
    const above = new Set<number>();
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
      const have = new Set(found.map((i) => i.id));
      const up = [...new Set(found.map((i) => i.parentId).filter((id): id is number => id !== null && !have.has(id)))].slice(0, MAX_PARENTS);
      if (!up.length) break;
      const got = (await readByIds(ctx, project, up, fields, n)).filter((i) => portfolioTypes.has(i.type) && !DONE_CATEGORIES.has(i.stateCategory) && !have.has(i.id));
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
      assignedTo: i.assignedTo ?? null,
      mine: !!i.assignedToMe,
      why: [...(assigned.has(i.id) ? ["assigned" as const] : []), ...(parents.has(i.id) ? ["parent" as const] : []), ...(above.has(i.id) && !assigned.has(i.id) && !parents.has(i.id) ? ["above" as const] : [])],
      children: kids.filter((k) => k.parentId === i.id).map((k) => ({ id: k.id, title: k.title, type: k.type, state: k.state, stateCategory: k.stateCategory, open: !DONE_CATEGORIES.has(k.stateCategory), level: k.level, order: k.order, url: k.url, assignedTo: k.assignedTo ?? null, mine: !!k.assignedToMe })),
    }));
    return { items, targetFields };
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
            const snap = (await readSnapshot<PortfolioItem>(d.cacheDir, "devops", key)) as PortfolioSnapshot | null;
            const msg = snap ? `${message}. Showing features from ${formatFetchedAt(snap.fetchedAt, d.timeZone, now())}` : message;
            return { clientKey: ref.clientKey, clientName: ref.clientName, status, message: msg, ...(cause ? { cause } : {}), fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: snap?.items ?? [], targetFields: snap?.targetFields ?? {} };
          };
          if (w.status !== "ok" || w.fromCache) return fallback(w.status, w.message ?? `DevOps unavailable for ${ref.clientName}`, w.cause);
          try {
            const target = targets.ok ? targets.targets.find((x) => x.clientKey === ref.clientKey) : undefined;
            const pre = precheck(ref, target);
            if (pre) throw pre;
            const { items, targetFields } = await fetchPortfolio(ref, target!, w.items);
            const fetchedAt = now().toZonedDateTimeISO(d.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
            await writeSnapshot(d.cacheDir, "devops", key, { fetchedAt, items, targetFields } as unknown as WorkSnapshot).catch(() => log("cache_write", { kind: "failed" }));
            return { clientKey: ref.clientKey, clientName: ref.clientName, status: "ok", fetchedAt, fromCache: false, items, targetFields };
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
    const snap = useCache ? ((await readSnapshot<WorkItem>(d.cacheDir, "devops", cacheKey(ref.clientKey))) as WorkSnapshot | null) : null;
    const message = snap ? `${f.message}. Showing items from ${formatFetchedAt(snap.fetchedAt, d.timeZone, now())}` : useCache ? `${f.message}. No cached items yet` : f.message;
    return { clientKey: ref.clientKey, clientName: ref.clientName, status: f.status, message, ...(f.rootCause ? { cause: f.rootCause } : {}), fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: (snap?.items ?? []).map(withLevel), children: Array.isArray(snap?.children) ? snap.children.map(withLevel) : [] };
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
      const { items, children, watched, committed } = await fetchClient(ref, target!, watch, features);
      const fetchedAt = now().toZonedDateTimeISO(d.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
      const snap: WorkSnapshot = { fetchedAt, items, children };
      await writeSnapshot(d.cacheDir, "devops", cacheKey(ref.clientKey), snap).catch(() => log("cache_write", { kind: "failed" }));
      return { clientKey: ref.clientKey, clientName: ref.clientName, status: "ok", fetchedAt, fromCache: false, items, children, watched, committed };
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

  return { load, lookup, orgOf, last, portfolio, description, forget };
}

export type DevOpsSource = ReturnType<typeof createDevOpsSource>;
