// Read-only Azure DevOps source: open work items assigned to me, per client.
// Each client is fetched, fails and is cached on its own. PATs arrive from Dataverse for one fetch,
// wrapped in Pat, and are used only to build the Authorization header right at the request. They are
// never logged, cached, returned or put in a message. Only the normalized items are cached.
import { createHash } from "node:crypto";
import { readSnapshot, writeSnapshot } from "../../cache/snapshots.ts";
import type { Logger } from "../../log/logger.ts";
import type { ClientWork, ClientWorkStatus, WorkItem } from "../../week/types.ts";
import { formatFetchedAt } from "../when.ts";
import { batchFields, buildWiql, categoriesFrom, detectOrderField, normalizeWorkItems, type StateCategories } from "./normalize.ts";
import type { Pat } from "./pat.ts";
import type { DevOpsTarget, TargetsResult } from "./types.ts";

export const API_VERSION = "7.1";
const BATCH_MAX = 200; // documented maximum ids per workitemsbatch call
const WIQL_TOP = 1000;

export type DevOpsDeps = {
  fetch: typeof fetch;
  log: Logger;
  cacheDir: string;
  timeZone: string;
  /** Dataverse → DevOps: settings and PATs for these clients, read live. */
  targets: (clientKeys: string[]) => Promise<TargetsResult>;
  now?: () => Temporal.Instant;
  timeoutMs?: number;
  /** A normal load (e.g. changing weeks) reuses results this fresh. */
  memoryTtlMs?: number;
  /** A forced refresh refetches a client at most this often. */
  minRefreshMs?: number;
  /** Work item types, states and the order field change rarely. */
  metadataTtlMs?: number;
};

export type ClientRef = { clientKey: string; clientName: string };

/** A safe, plain failure. Never carries bodies, headers or PATs. */
class DevOpsFailure extends Error {
  readonly status: ClientWorkStatus;
  constructor(status: ClientWorkStatus, message: string) {
    super(message);
    this.status = status;
  }
}

type Metadata = { orderField: string | null; categories: StateCategories };

const ORG = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;

export function cacheKey(clientKey: string): string {
  const slug = clientKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
  return `${slug}-${createHash("sha256").update(clientKey).digest("hex").slice(0, 8)}`;
}

export function createDevOpsSource(d: DevOpsDeps) {
  const now = d.now ?? (() => Temporal.Now.instant());
  const timeoutMs = d.timeoutMs ?? 15_000;
  const ttl = d.memoryTtlMs ?? 5 * 60_000;
  const minRefresh = d.minRefreshMs ?? 60_000;
  const metaTtl = d.metadataTtlMs ?? 60 * 60_000;
  const memory = new Map<string, { at: number; result: ClientWork }>();
  const metadata = new Map<string, { at: number; meta: Metadata }>();
  const log = (op: string, extra: { status?: number; durationMs?: number; count?: number; kind?: string } = {}) => d.log({ source: "devops", op, ...extra });

  type Ctx = { client: string; org: string; base: string; projectName: string; pat: Pat };

  /** One request. Errors are mapped to plain messages; response bodies of failures are never read. */
  async function call<T>(c: Ctx, op: string, path: string, body?: unknown): Promise<T> {
    const url = `${c.base}/${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`;
    const started = performance.now();
    let res: Response;
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
      log(op, { kind: notFound ? "host_not_found" : "network" });
      throw new DevOpsFailure("unreachable", `DevOps organization ${c.org} unreachable`);
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
    const meta = { orderField: detectOrderField(pc), categories: categoriesFrom(withStates) };
    metadata.set(key, { at: t, meta });
    return meta;
  }

  async function fetchClient(ref: ClientRef, target: DevOpsTarget): Promise<WorkItem[]> {
    const org = target.org!;
    const ctx: Ctx = { client: ref.clientName, org, base: `https://dev.azure.com/${encodeURIComponent(org)}`, projectName: target.projectName ?? target.project!, pat: target.pat! };
    const project = target.project!;
    const meta = await loadMetadata(ctx, project);
    const p = encodeURIComponent(project);
    const wiql = await call<{ workItems?: { id?: unknown }[] }>(ctx, "wiql", `${p}/_apis/wit/wiql?$top=${WIQL_TOP}`, { query: buildWiql(target.email!, meta.categories, meta.orderField) });
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
    const { items, skipped } = normalizeWorkItems(values, { org, projectName: ctx.projectName, orderField: meta.orderField, categories: meta.categories });
    if (skipped) log("normalize", { kind: "skipped", count: skipped });
    log("items", { count: items.length });
    return items;
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
    const snap = useCache ? await readSnapshot<WorkItem>(d.cacheDir, "devops", cacheKey(ref.clientKey)) : null;
    const message = snap ? `${f.message}. Showing items from ${formatFetchedAt(snap.fetchedAt, d.timeZone, now())}` : useCache ? `${f.message}. No cached items yet` : f.message;
    return { clientKey: ref.clientKey, clientName: ref.clientName, status: f.status, message, fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: snap?.items ?? [] };
  }

  async function loadOne(ref: ClientRef, targets: TargetsResult): Promise<ClientWork> {
    try {
      if (!targets.ok) throw new DevOpsFailure("unreachable", `DevOps settings unavailable (${targets.message})`);
      const target = targets.targets.find((t) => t.clientKey === ref.clientKey);
      const pre = precheck(ref, target);
      if (pre) throw pre;
      const items = await fetchClient(ref, target!);
      const fetchedAt = now().toZonedDateTimeISO(d.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
      await writeSnapshot(d.cacheDir, "devops", cacheKey(ref.clientKey), { fetchedAt, items }).catch(() => log("cache_write", { kind: "failed" }));
      return { clientKey: ref.clientKey, clientName: ref.clientName, status: "ok", fetchedAt, fromCache: false, items };
    } catch (e) {
      if (!(e instanceof DevOpsFailure)) log("load", { kind: "unexpected" });
      return fromCache(ref, e instanceof DevOpsFailure ? e : new DevOpsFailure("error", `DevOps load failed for ${ref.clientName}`));
    }
  }

  /** One result per client, in the order given. A client never sees another client's items. */
  async function load(clients: ClientRef[], opts: { refresh?: boolean } = {}): Promise<ClientWork[]> {
    const t = now().epochMilliseconds;
    const fresh = (ref: ClientRef) => {
      const hit = memory.get(ref.clientKey);
      if (!hit) return null;
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
      const results = await Promise.all(need.map((ref) => loadOne(ref, targets)));
      need.forEach((ref, i) => memory.set(ref.clientKey, { at: t, result: results[i]! }));
    }
    return clients.map((c) => memory.get(c.clientKey)!.result);
  }

  return { load };
}

export type DevOpsSource = ReturnType<typeof createDevOpsSource>;
