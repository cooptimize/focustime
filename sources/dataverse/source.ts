// Read-only Dataverse source: Focus Time patterns for me, for one week.
// Token in memory only. Never throws to callers: every failure becomes a SourceResult with a plain message.
import { readSnapshot, writeSnapshot } from "../../cache/snapshots.ts";
import type { DataverseConfig } from "../../config/schema.ts";
import type { Logger } from "../../log/logger.ts";
import { SecretError } from "../../secrets/keyring.ts";
import { formatTime } from "../../week/format.ts";
import { PTO_DETAIL_COLUMNS, PTO_DETAIL_FILTER_COLUMNS, PTO_TRACKER_COLUMNS, PTO_TRACKER_FILTER_COLUMNS, ptoEntries, type PtoDetailRow, type PtoEntry, type PtoTrackerRow } from "../../week/pto.ts";
import type { FailureCause, FocusPattern, SourceResult } from "../../week/types.ts";
import { Pat } from "../devops/pat.ts";
import type { DevOpsTarget, TargetsResult } from "../devops/types.ts";
import { clientKeyOf, normalizeFocusTimes, type AccountRow, type FocusTimeRow } from "./normalize.ts";

export type DataverseSourceDeps = {
  config: DataverseConfig;
  timeZone: string;
  getSecret: () => Promise<string>;
  fetch: typeof fetch;
  cacheDir: string;
  log: Logger;
  now?: () => Temporal.Instant;
  memoryTtlMs?: number;
  timeoutMs?: number;
};

type Status = SourceResult<unknown>["status"];

/** A failure with a plain message that is safe to show and log. Never carries bodies, tokens or secrets. */
class SourceFailure extends Error {
  readonly status: Status;
  readonly fixAction: SourceResult<unknown>["fixAction"] | undefined;
  /** Dataverse said a table (404) or a column (400, 0x80060888) doesn't exist (D108). */
  schema: "table" | "column" | undefined;
  /** Shared root cause (keyring, network), so the status bar names it once. */
  rootCause: FailureCause | undefined;
  constructor(status: Status, message: string, fixAction?: SourceResult<unknown>["fixAction"], schema?: "table" | "column", cause?: FailureCause) {
    super(message);
    this.status = status;
    this.fixAction = fixAction;
    this.schema = schema;
    this.rootCause = cause;
  }
}

/** The tables and columns one query reads, so a missing one can be named (D108). */
type SchemaUse = {
  /** Plain name for messages: "PTO", "Focus block". */
  label: string;
  table: string;
  /** Primary key: always there while the table is. */
  key: string;
  /** A filter limiting probes to my own rows, and the column it uses (probed first). */
  scope: string;
  scopeColumn: string;
  /** Every other column selected or filtered on. */
  columns: readonly string[];
};

const API = "/api/data/v9.2/";

/** Focus Time columns read (selected; the filter uses some of them too). */
const FOCUS_COLUMNS = [
  "coop_focustimeid", "_coop_account_value", "_coop_systemuser_value", "_coop_accountworker_value",
  "coop_startdate", "coop_enddate", "coop_mondaydaypart", "coop_tuesdaydaypart",
  "coop_wednesdaydaypart", "coop_thursdaydaypart", "statecode",
] as const;
const KEYRING_HINT = "keyring entry focustime / dataverse-client-secret";

export function createDataverseSource(deps: DataverseSourceDeps) {
  const { config, log } = deps;
  const now = deps.now ?? (() => Temporal.Now.instant());
  const ttl = deps.memoryTtlMs ?? 5 * 60_000;
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const apiBase = `${config.environmentUrl}${API}`;

  let token: { value: string; expiresAt: number } | null = null;
  const memory = new Map<string, { at: number; result: SourceResult<FocusPattern> }>();

  const unreachable = () => new SourceFailure("unreachable", "Dataverse unreachable", undefined, undefined, "network");
  const isNetworkError = (e: unknown) =>
    e instanceof TypeError || (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"));

  async function getToken(): Promise<string> {
    const t = now().epochMilliseconds;
    if (token && token.expiresAt - 5 * 60_000 > t) return token.value;

    let secret: string;
    try {
      secret = await deps.getSecret();
    } catch (e) {
      const kind = e instanceof SecretError ? e.kind : "unavailable";
      log({ source: "dataverse", op: "keyring", kind });
      if (kind === "not_found")
        throw new SourceFailure("misconfigured", "No Dataverse client secret in the keyring (service focustime, account dataverse-client-secret)", "open_settings");
      throw new SourceFailure("error", "Secret storage unavailable (Secret Service). Unlock the keyring and retry", undefined, undefined, "keyring");
    }

    const started = performance.now();
    let res: Response;
    try {
      res = await deps.fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: secret,
          scope: `${config.environmentUrl}/.default`,
        }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      log({ source: "dataverse", op: "token", kind: "network" });
      if (isNetworkError(e)) throw unreachable();
      throw new SourceFailure("error", "Dataverse sign-in failed");
    }
    log({ source: "dataverse", op: "token", status: res.status, durationMs: performance.now() - started });

    // Read only the fields we need; never forward error_description (it can echo request data).
    const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
    if (!res.ok || typeof body.access_token !== "string") {
      if (body.error === "invalid_client" || body.error === "unauthorized_client")
        throw new SourceFailure("auth_required", `Dataverse sign-in failed: the client secret was rejected. Update ${KEYRING_HINT}`, "open_settings");
      if (body.error === "invalid_scope" || body.error === "invalid_resource")
        throw new SourceFailure("misconfigured", "Dataverse sign-in failed: check environment_url in config", "open_settings");
      if (res.status === 400 || res.status === 401)
        throw new SourceFailure("misconfigured", "Dataverse sign-in failed: check tenant_id and client_id in config", "open_settings");
      throw new SourceFailure("error", `Dataverse sign-in failed (HTTP ${res.status})`);
    }
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3599;
    token = { value: body.access_token, expiresAt: t + expiresIn * 1000 };
    return token.value;
  }

  /** GET every page of a collection. Any page failing fails the whole call: no silent truncation. */
  async function getAll<T>(op: string, path: string): Promise<T[]> {
    const auth = await getToken();
    const items: T[] = [];
    let url: string | null = apiBase + path;
    let page = 0;
    while (url) {
      if (!url.startsWith(apiBase)) {
        log({ source: "dataverse", op, kind: "foreign_next_link" });
        throw new SourceFailure("error", "Dataverse returned a next-page link to another host, so it was not followed");
      }
      const started = performance.now();
      let res: Response;
      try {
        res = await deps.fetch(url, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${auth}`,
            "odata-maxversion": "4.0",
            "odata-version": "4.0",
            prefer: "odata.maxpagesize=500",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const notFound = (e as { cause?: { code?: unknown } })?.cause?.code === "ENOTFOUND";
        log({ source: "dataverse", op, kind: notFound ? "host_not_found" : "network" });
        if (page > 0) throw partial();
        // The token request already worked, so the network is up: an unknown host means a wrong URL.
        if (notFound) throw new SourceFailure("misconfigured", "Dataverse environment not found: check environment_url in config", "open_settings");
        if (isNetworkError(e)) throw unreachable();
        throw new SourceFailure("error", "Dataverse request failed");
      }
      if (!res.ok) {
        const code = await errorCode(res);
        log({ source: "dataverse", op, status: res.status, durationMs: performance.now() - started, kind: code ?? "http" });
        if (page > 0) throw partial();
        throw mapHttpError(res.status, code);
      }
      const body = (await res.json()) as { value?: T[]; "@odata.nextLink"?: string };
      const value = Array.isArray(body.value) ? body.value : [];
      items.push(...value);
      log({ source: "dataverse", op, status: res.status, durationMs: performance.now() - started, count: value.length });
      url = body["@odata.nextLink"] ?? null;
      page++;
    }
    return items;
  }

  function partial() {
    return new SourceFailure("error", "Dataverse returned only part of the results, so none were used");
  }

  async function errorCode(res: Response): Promise<string | null> {
    // Only the OData error code is read, never the message.
    const b = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    const c = b?.error?.code;
    return typeof c === "string" && /^0x[0-9a-f]{8}$/i.test(c) ? c.toLowerCase() : null;
  }

  function mapHttpError(status: number, code: string | null): SourceFailure {
    if (status === 401 || status === 403) return new SourceFailure("auth_required", "Dataverse access denied: check app user role", "open_settings");
    // Checked against the real environment: an unknown table is 404, an unknown column ($select or $filter) is
    // 400, both with 0x80060888 (D108).
    if (status === 404 || code === "0x8006088a") return new SourceFailure("misconfigured", "Focus block table not found: check config", "open_settings", "table");
    if (code === "0x80060888") return new SourceFailure("misconfigured", "A focus block column was not found: check config", "open_settings", "column");
    return new SourceFailure("error", `Dataverse error (HTTP ${status})`);
  }

  /**
   * Which table or column of a query is missing, found with small read-only probes limited to my own rows
   * (only the error code is read, never the message). The result is a plain, named message.
   */
  async function schemaMessage(use: SchemaUse, kind: "table" | "column"): Promise<string> {
    const probe = async (column: string, filter: string): Promise<"ok" | "table" | "column" | "other"> => {
      try {
        await getAll("schema_probe", `${use.table}?$select=${column}&$filter=${encodeURIComponent(filter)}&$top=1`);
        return "ok";
      } catch (e) {
        return e instanceof SourceFailure && e.schema ? e.schema : "other";
      }
    };
    const tableGone = `${use.label} table ${use.table} not found in Dataverse (renamed or removed?)`;
    const columnGone = (c: string) => `${use.label} column ${c} not found in ${use.table} (renamed or removed?)`;
    const first = await probe(use.key, use.scope);
    if (first === "table") return tableGone;
    if (first === "column") return columnGone(use.scopeColumn);
    if (first === "ok") {
      for (const c of use.columns) {
        const r = await probe(c, use.scope);
        if (r === "column") return columnGone(c);
        if (r !== "ok") break;
      }
    }
    return kind === "table" ? tableGone : `A ${use.label} column was not found in ${use.table} (renamed or removed?)`;
  }

  /** Rows must carry every selected column; a missing key means a schema change, never a silent blank (D108). */
  function checkColumns(use: SchemaUse, rows: readonly object[], selected: readonly string[]) {
    const row = rows[0];
    if (!row) return;
    const gone = selected.find((c) => !(c in row));
    if (gone) throw new SourceFailure("misconfigured", `${use.label} column ${gone} not found in ${use.table} (renamed or removed?)`, "open_settings", "column");
  }

  /** A week (Mon to Thu), or every row still running on or after `since` (step 6d, for following clients). */
  type FocusRange = { week: string } | { since: string };
  function focusTimesPath(range: FocusRange, userId: string): string {
    const select = FOCUS_COLUMNS.join(",");
    let dates: string;
    if ("week" in range) {
      const mon = Temporal.PlainDate.from(range.week);
      dates = `coop_startdate le ${mon.add({ days: 3 })} and (coop_enddate eq null or coop_enddate ge ${mon})`;
    } else dates = `(coop_enddate eq null or coop_enddate ge ${Temporal.PlainDate.from(range.since)})`;
    const filter =
      `statecode eq 0 and ${dates}` +
      ` and (_coop_systemuser_value eq ${userId} or coop_AccountWorker/_coop_user_value eq ${userId})`;
    const expand = "coop_AccountWorker($select=_coop_user_value,_coop_account_value)";
    return `coop_focustimes?$select=${select}&$filter=${encodeURIComponent(filter)}&$expand=${expand}`;
  }

  function accountsPath(ids: string[]): string {
    const filter = ids.map((id) => `accountid eq ${id}`).join(" or ");
    return `accounts?$select=accountid,name,coop_reportingnickname&$filter=${encodeURIComponent(filter)}`;
  }

  const fmtAt = (iso: string) => {
    const z = Temporal.Instant.from(iso).toZonedDateTimeISO(deps.timeZone);
    const today = now().toZonedDateTimeISO(deps.timeZone).toPlainDate();
    const time = formatTime(z);
    if (z.toPlainDate().equals(today)) return time;
    return `${z.toPlainDate().toLocaleString("en-US", { month: "short", day: "numeric" })} ${time}`;
  };

  async function fetchLive(range: FocusRange, snapshotKey: string): Promise<SourceResult<FocusPattern>> {
    const userId = config.mySystemUserId;
    if (!userId) throw new SourceFailure("misconfigured", "Your Dataverse user id is not resolved yet: check my_email in config", "open_settings");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new SourceFailure("misconfigured", "my_systemuserid is not a GUID", "open_settings");

    // A missing table or column is named (D108). The expanded Account Worker isn't probed; it falls to the general message.
    const named = async <T,>(use: SchemaUse, run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (e) {
        if (e instanceof SourceFailure && e.schema) throw new SourceFailure("misconfigured", `${await schemaMessage(use, e.schema)}: check config`, "open_settings", e.schema);
        throw e;
      }
    };
    const focusUse: SchemaUse = { label: "Focus block", table: "coop_focustimes", key: "coop_focustimeid", scope: `_coop_systemuser_value eq ${userId}`, scopeColumn: "_coop_systemuser_value", columns: FOCUS_COLUMNS.filter((c) => c !== "coop_focustimeid" && c !== "_coop_systemuser_value") };
    const rows = await named(focusUse, async () => {
      const r = await getAll<FocusTimeRow>("focustimes", focusTimesPath(range, userId));
      checkColumns(focusUse, r, FOCUS_COLUMNS);
      return r;
    });
    const accountIds = [...new Set(rows.flatMap((r) => [r.coop_AccountWorker?._coop_account_value, r._coop_account_value]).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))];
    const accountUse: SchemaUse = { label: "Client", table: "accounts", key: "accountid", scope: `accountid eq ${accountIds[0] ?? userId}`, scopeColumn: "accountid", columns: ["name", "coop_reportingnickname"] };
    const accounts = accountIds.length
      ? await named(accountUse, async () => {
          const r = await getAll<AccountRow>("accounts", accountsPath(accountIds));
          checkColumns(accountUse, r, ["accountid", "name", "coop_reportingnickname"]);
          return r;
        })
      : [];
    const { patterns, skipped } = normalizeFocusTimes(rows, accounts, userId);
    if (skipped.length) log({ source: "dataverse", op: "normalize", kind: "skipped", count: skipped.length });

    const fetchedAt = now().toZonedDateTimeISO(deps.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
    await writeSnapshot(deps.cacheDir, "dataverse", snapshotKey, { fetchedAt, items: patterns }).catch(() =>
      log({ source: "dataverse", op: "cache_write", kind: "failed" }),
    );
    const result: SourceResult<FocusPattern> = { source: "dataverse", status: "ok", fetchedAt, fromCache: false, items: patterns };
    if (skipped.length) result.message = `${skipped.length} Focus Time ${skipped.length === 1 ? "row" : "rows"} skipped: ${[...new Set(skipped.map((s) => s.reason))].join(", ")}`;
    return result;
  }

  const load = (weekStart: string, opts: { refresh?: boolean } = {}) => cachedPatterns({ week: weekStart }, weekStart, opts);
  /**
   * My Focus Time rows still running on or after `since` (today minus the grace days), whatever week is shown:
   * which clients to follow (step 6d). Same columns and filter on me as the week read; its own cache file.
   */
  const following = (since: string, opts: { refresh?: boolean } = {}) => cachedPatterns({ since }, `following-${since}`, opts, "following");

  async function cachedPatterns(range: FocusRange, key: string, opts: { refresh?: boolean }, snapshotKey = key): Promise<SourceResult<FocusPattern>> {
    const t = now().epochMilliseconds;
    const hit = memory.get(key);
    if (hit && !opts.refresh && t - hit.at < ttl) return hit.result;

    let result: SourceResult<FocusPattern>;
    try {
      result = await fetchLive(range, snapshotKey);
    } catch (e) {
      const f = e instanceof SourceFailure ? e : new SourceFailure("error", "Dataverse load failed");
      if (!(e instanceof SourceFailure)) log({ source: "dataverse", op: "load", kind: "unexpected" });
      const snap = await readSnapshot<FocusPattern>(deps.cacheDir, "dataverse", snapshotKey);
      const message = snap
        ? f.status === "unreachable"
          ? `Offline, showing data from ${fmtAt(snap.fetchedAt)}`
          : `${f.message}. Showing data from ${fmtAt(snap.fetchedAt)}`
        : `${f.message}. No cached data yet`;
      result = { source: "dataverse", status: f.status, fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: snap?.items ?? [], message };
      if (f.fixAction) result.fixAction = f.fixAction;
      if (f.rootCause) result.cause = f.rootCause;
    }
    memory.set(key, { at: t, result });
    return result;
  }

  /**
   * DevOps settings for the given clients, read live for one DevOps fetch. This is the only query that
   * selects coop_devopstoken. Nothing here is cached, memoized or logged beyond counts, and each PAT is
   * wrapped in Pat as soon as it is read. Only accounts I am an active Account Worker on are considered.
   * Step 14: `withPat: false` (the DevOps write path) never selects coop_devopstoken, so the company read PAT
   * can't reach a write at all; every target then has `pat: null`.
   */
  async function devopsTargets(clientKeys: string[], opts: { withPat?: boolean } = {}): Promise<TargetsResult> {
    const withPat = opts.withPat !== false;
    try {
      const userId = config.mySystemUserId;
      if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, message: "Your Dataverse user id is not resolved yet" };
      if (clientKeys.length === 0) return { ok: true, targets: [] };
      const workers = await getAll<{ _coop_account_value: string | null; coop_devopsemail: string | null }>(
        "accountworkers",
        `coop_accountworkers?$select=_coop_account_value,coop_devopsemail&$filter=${encodeURIComponent(`_coop_user_value eq ${userId} and statecode eq 0`)}`,
      );
      const emailByAccount = new Map<string, string | null>();
      for (const w of workers) {
        const id = w._coop_account_value?.toLowerCase();
        if (!id || !/^[0-9a-f-]{36}$/.test(id)) continue;
        const email = w.coop_devopsemail?.trim() || null;
        if (!emailByAccount.get(id)) emailByAccount.set(id, email);
      }
      if (emailByAccount.size === 0) return { ok: true, targets: [] };
      const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
      const idFilter = [...emailByAccount.keys()].map((id) => `accountid eq ${id}`).join(" or ");
      const keyFilter = clientKeys.flatMap((k) => [`coop_reportingnickname eq ${q(k)}`, `name eq ${q(k)}`]).join(" or ");
      const select = "accountid,name,coop_reportingnickname,coop_devopsorg,coop_devopsprojectid,coop_devopsprojectname" + (withPat ? ",coop_devopstoken" : "");
      const rows = await getAll<AccountRow & { coop_devopsorg: string | null; coop_devopsprojectid: string | null; coop_devopsprojectname: string | null; coop_devopstoken?: string | null }>(
        "devops_accounts",
        `accounts?$select=${select}&$filter=${encodeURIComponent(`(${idFilter}) and (${keyFilter})`)}`,
      );
      const targets: DevOpsTarget[] = [];
      for (const row of rows) {
        const token = row.coop_devopstoken?.trim() || null;
        delete row.coop_devopstoken;
        const key = clientKeyOf(row);
        if (!key || !clientKeys.includes(key)) continue;
        targets.push({
          accountId: row.accountid.toLowerCase(),
          clientKey: key,
          clientName: key,
          org: row.coop_devopsorg?.trim() || null,
          // Name first: it is set on every account, while some stored project IDs are blank or stale (one client's is wrong).
          project: row.coop_devopsprojectname?.trim() || row.coop_devopsprojectid?.trim() || null,
          projectName: row.coop_devopsprojectname?.trim() || null,
          email: emailByAccount.get(row.accountid.toLowerCase()) ?? null,
          pat: token ? new Pat(token) : null,
        });
      }
      // Two accounts with one client key would mix clients: refuse both rather than guess.
      for (const t of targets) {
        if (targets.filter((o) => o.clientKey === t.clientKey).length > 1) {
          t.pat = null;
          t.problem = `More than one account is named ${t.clientKey} in Dataverse`;
        }
      }
      return { ok: true, targets };
    } catch (e) {
      if (!(e instanceof SourceFailure)) log({ source: "dataverse", op: "devops_targets", kind: "unexpected" });
      const f = e instanceof SourceFailure ? e : null;
      return { ok: false, message: f?.rootCause === "keyring" ? "keyring locked" : f?.status === "unreachable" ? "Dataverse unreachable" : f?.status === "auth_required" ? "Dataverse access denied" : "Dataverse read failed", ...(f?.rootCause ? { cause: f.rootCause } : {}) };
    }
  }

  /**
   * Every client I'm an active Account Worker on (Q21), for Open half-days: key, name and whether DevOps is set up.
   * Never selects the PAT. Kept in memory for 5 minutes.
   */
  let myClientsMemo: { at: number; clients: MyClient[] } | null = null;
  async function myClients(): Promise<MyClient[] | null> {
    const t = Date.now();
    if (myClientsMemo && t - myClientsMemo.at < 5 * 60_000) return myClientsMemo.clients;
    try {
      const userId = config.mySystemUserId;
      if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
      const workers = await getAll<{ _coop_account_value: string | null; coop_devopsemail?: string | null }>(
        "accountworkers",
        `coop_accountworkers?$select=_coop_account_value,coop_devopsemail&$filter=${encodeURIComponent(`_coop_user_value eq ${userId} and statecode eq 0`)}`,
      );
      const ids = [...new Set(workers.map((w) => w._coop_account_value?.toLowerCase()).filter((id): id is string => !!id && /^[0-9a-f-]{36}$/.test(id)))];
      const emailOf = new Map<string, string>();
      for (const w of workers) {
        const id = w._coop_account_value?.toLowerCase();
        const e = w.coop_devopsemail?.trim();
        if (id && e && !emailOf.has(id)) emailOf.set(id, e);
      }
      if (ids.length === 0) return (myClientsMemo = { at: t, clients: [] }).clients;
      const rows = await getAll<AccountRow & { coop_devopsorg: string | null }>(
        "my_accounts",
        `accounts?$select=accountid,name,coop_reportingnickname,coop_devopsorg&$filter=${encodeURIComponent(ids.map((id) => `accountid eq ${id}`).join(" or "))}`,
      );
      const clients: MyClient[] = [];
      for (const row of rows) {
        const key = clientKeyOf(row);
        if (key && !clients.some((c) => c.clientKey === key)) clients.push({ clientKey: key, clientName: key, devops: !!row.coop_devopsorg?.trim(), devopsEmail: emailOf.get(row.accountid.toLowerCase()) ?? null });
      }
      clients.sort((a, b) => a.clientName.localeCompare(b.clientName));
      return (myClientsMemo = { at: t, clients }).clients;
    } catch (e) {
      if (!(e instanceof SourceFailure)) log({ source: "dataverse", op: "my_clients", kind: "unexpected" });
      return null;
    }
  }

  /**
   * My PTO between two dates (step 6): Time Off Tracker rows for me (coop_employee = my systemuserid) that overlap
   * them, and every detail row of those trackers. Only the dates are read, never hours (D105); never
   * coop_outofofficemessage, and the accrual table (coop_timeofffact) is never read. Normalized to PTO entries
   * for weekdays in the range, cached per range as the last good result, and never thrown: failures fall back
   * to it. A missing table or column is named in the message (D108).
   */
  const ptoMemory = new Map<string, { at: number; result: SourceResult<PtoEntry> }>();
  async function pto(from: string, to: string, opts: { refresh?: boolean } = {}): Promise<SourceResult<PtoEntry>> {
    const t = now().epochMilliseconds;
    const key = `${from}-to-${to}`; // a valid snapshot key (letters, digits, dashes)
    const hit = ptoMemory.get(key);
    if (hit && !opts.refresh && t - hit.at < ttl) return hit.result;
    let result: SourceResult<PtoEntry>;
    const userId = config.mySystemUserId ?? "";
    const trackerUse: SchemaUse = {
      label: "PTO",
      table: "coop_timeofftrackers",
      key: "coop_timeofftrackerid",
      scope: `_coop_employee_value eq ${userId}`,
      scopeColumn: "_coop_employee_value",
      columns: [...PTO_TRACKER_COLUMNS.filter((c) => c !== "coop_timeofftrackerid"), ...PTO_TRACKER_FILTER_COLUMNS.filter((c) => c !== "_coop_employee_value")],
    };
    let detailUse: SchemaUse | null = null;
    try {
      if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new SourceFailure("misconfigured", "Your Dataverse user id is not resolved yet", "open_settings");
      const start = Temporal.PlainDate.from(from);
      const end = Temporal.PlainDate.from(to);
      const filter = `_coop_employee_value eq ${userId} and statecode eq 0 and coop_timeoffstartdate le ${end} and (coop_enddate eq null or coop_enddate ge ${start})`;
      let trackers: PtoTrackerRow[];
      try {
        trackers = await getAll<PtoTrackerRow>("pto_trackers", `coop_timeofftrackers?$select=${PTO_TRACKER_COLUMNS.join(",")}&$filter=${encodeURIComponent(filter)}`);
        checkColumns(trackerUse, trackers, PTO_TRACKER_COLUMNS);
      } catch (e) {
        if (e instanceof SourceFailure && e.schema) throw new SourceFailure("misconfigured", await schemaMessage(trackerUse, e.schema), "open_settings", e.schema);
        throw e;
      }
      const ids = trackers.map((r) => r.coop_timeofftrackerid?.toLowerCase()).filter((id): id is string => !!id && /^[0-9a-f-]{36}$/.test(id));
      // All detail rows of these trackers, not only this range's: a tracker with details elsewhere must not be spread here.
      let details: PtoDetailRow[] = [];
      if (ids.length) {
        detailUse = {
          label: "PTO",
          table: "coop_timeofftrackerdetails",
          key: "coop_timeofftrackerdetailid",
          scope: `_coop_timeofftracker_value eq ${ids[0]}`,
          scopeColumn: "_coop_timeofftracker_value",
          columns: [...PTO_DETAIL_COLUMNS.filter((c) => c !== "_coop_timeofftracker_value"), ...PTO_DETAIL_FILTER_COLUMNS],
        };
        try {
          details = await getAll<PtoDetailRow>(
            "pto_details",
            `coop_timeofftrackerdetails?$select=${PTO_DETAIL_COLUMNS.join(",")}&$filter=${encodeURIComponent(`statecode eq 0 and (${ids.map((id) => `_coop_timeofftracker_value eq ${id}`).join(" or ")})`)}`,
          );
          checkColumns(detailUse, details, PTO_DETAIL_COLUMNS);
        } catch (e) {
          if (e instanceof SourceFailure && e.schema) throw new SourceFailure("misconfigured", await schemaMessage(detailUse, e.schema), "open_settings", e.schema);
          throw e;
        }
      }
      const { entries, skipped } = ptoEntries(trackers, details);
      const items = entries.filter((e) => e.date >= from && e.date <= to);
      if (skipped) log({ source: "dataverse", op: "pto_normalize", kind: "skipped", count: skipped });
      const fetchedAt = now().toZonedDateTimeISO(deps.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
      await writeSnapshot(deps.cacheDir, "pto", key, { fetchedAt, items }).catch(() => log({ source: "dataverse", op: "cache_write", kind: "failed" }));
      result = { source: "pto", status: "ok", fetchedAt, fromCache: false, items };
      if (skipped) result.message = `${skipped} PTO ${skipped === 1 ? "row" : "rows"} skipped (unreadable dates)`;
    } catch (e) {
      const f = e instanceof SourceFailure ? e : new SourceFailure("error", "PTO load failed");
      if (!(e instanceof SourceFailure)) log({ source: "dataverse", op: "pto", kind: "unexpected" });
      const plain = f.status === "auth_required" ? "PTO not readable: check the FocusTime role in Dataverse" : f.message;
      const snap = await readSnapshot<PtoEntry>(deps.cacheDir, "pto", key);
      const message = snap ? `${plain}. Showing PTO from ${fmtAt(snap.fetchedAt)}` : `${plain}. No cached PTO yet`;
      result = { source: "pto", status: f.status, fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: snap?.items ?? [], message };
      if (f.rootCause) result.cause = f.rootCause;
    }
    ptoMemory.set(key, { at: t, result });
    return result;
  }

  /** Find my systemuserid from my work email. Exactly one match or a plain error. */
  async function resolveUserId(email: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    try {
      const q = `internalemailaddress eq '${email.replace(/'/g, "''")}'`;
      const users = await getAll<{ systemuserid: string }>("systemusers", `systemusers?$select=systemuserid&$filter=${encodeURIComponent(q)}`);
      if (users.length === 1 && users[0]?.systemuserid) return { ok: true, id: users[0].systemuserid };
      return { ok: false, message: users.length === 0 ? "No Dataverse user has that work email: check my_email in config" : "More than one Dataverse user has that work email" };
    } catch (e) {
      return { ok: false, message: e instanceof SourceFailure ? e.message : "Could not look up your Dataverse user" };
    }
  }

  // ---------- the collaboration finder (step 13): teammates, who works on a client, team PTO ----------
  // Read-only, never cached on disk, kept in memory for 5 minutes. Teammates' PTO is read as dates only: the title
  // (coop_title) and the out-of-office message are never selected.
  const teamMemo = new Map<string, { at: number; value: unknown }>();
  async function memo<T>(key: string, run: () => Promise<T>): Promise<T> {
    const t = now().epochMilliseconds;
    const hit = teamMemo.get(key);
    if (hit && t - hit.at < ttl) return hit.value as T;
    const value = await run();
    teamMemo.set(key, { at: t, value });
    return value;
  }
  const guid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
  const fail = (e: unknown, op: string): TeamFailure => {
    if (!(e instanceof SourceFailure)) log({ source: "dataverse", op, kind: "unexpected" });
    const f = e instanceof SourceFailure ? e : null;
    return { ok: false, message: f?.rootCause === "keyring" ? "Keyring locked" : f?.status === "unreachable" ? "Dataverse unreachable" : f?.status === "auth_required" ? "Dataverse access denied: check the Dataverse reader role (users, Focus Time, Account Workers, PTO)" : f?.message ?? "Dataverse read failed" };
  };

  /**
   * Cooptimize staff: enabled, licensed users who aren't application users, with a work email. Step 16.3: with their
   * Entra object ID (aadId), which Teams presence is read by.
   */
  async function teammates(): Promise<{ ok: true; people: { id: string; name: string; email: string; aadId: string | null }[] } | TeamFailure> {
    try {
      return await memo("teammates", async () => {
        const filter = "isdisabled eq false and islicensed eq true and applicationid eq null and internalemailaddress ne null";
        const rows = await getAll<{ systemuserid?: unknown; fullname?: unknown; internalemailaddress?: unknown; azureactivedirectoryobjectid?: unknown }>("team_users", `systemusers?$select=systemuserid,fullname,internalemailaddress,azureactivedirectoryobjectid&$filter=${encodeURIComponent(filter)}`);
        const people = rows.filter((r) => guid(r.systemuserid) && typeof r.internalemailaddress === "string" && r.internalemailaddress.includes("@")).map((r) => ({ id: (r.systemuserid as string).toLowerCase(), name: typeof r.fullname === "string" && r.fullname.trim() ? r.fullname.trim() : (r.internalemailaddress as string), email: (r.internalemailaddress as string).trim().toLowerCase(), aadId: guid(r.azureactivedirectoryobjectid) ? (r.azureactivedirectoryobjectid as string).toLowerCase() : null }));
        return { ok: true as const, people };
      });
    } catch (e) {
      return fail(e, "team_users");
    }
  }

  /**
   * Who works on a client: every active Focus Time pattern on its account overlapping [from, to] (any person), and its
   * active Account Workers. The client is one of mine (I'm an active Account Worker on it), found by its key.
   */
  async function clientTeam(clientKey: string, from: string, to: string): Promise<{ ok: true; accountId: string | null; patterns: { userId: string; startDate: string; endDate: string | null; days: FocusPattern["days"] }[]; workers: string[] } | TeamFailure> {
    try {
      return await memo(`team:${clientKey}:${from}:${to}`, async () => {
        const userId = config.mySystemUserId;
        if (!guid(userId)) throw new SourceFailure("misconfigured", "Your Dataverse user id is not resolved yet");
        const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
        const accts = await getAll<AccountRow>("team_account", `accounts?$select=accountid,name,coop_reportingnickname&$filter=${encodeURIComponent(`coop_reportingnickname eq ${q(clientKey)} or name eq ${q(clientKey)}`)}`);
        const matches = accts.filter((a) => clientKeyOf(a) === clientKey && guid(a.accountid));
        if (matches.length !== 1) return { ok: true as const, accountId: null, patterns: [], workers: [] };
        const acct = matches[0]!.accountid.toLowerCase();
        const workers = await getAll<{ _coop_user_value?: unknown; coop_accountworkerid?: unknown }>("team_workers", `coop_accountworkers?$select=coop_accountworkerid,_coop_user_value&$filter=${encodeURIComponent(`_coop_account_value eq ${acct} and statecode eq 0`)}`);
        const workerIds = workers.map((w) => w._coop_user_value).filter(guid).map((x) => x.toLowerCase());
        const dates = `coop_startdate le ${Temporal.PlainDate.from(to)} and (coop_enddate eq null or coop_enddate ge ${Temporal.PlainDate.from(from)})`;
        const filter = `statecode eq 0 and ${dates} and (_coop_account_value eq ${acct} or coop_AccountWorker/_coop_account_value eq ${acct})`;
        const expand = "coop_AccountWorker($select=_coop_user_value,_coop_account_value)";
        const rows = await getAll<FocusTimeRow>("team_focustimes", `coop_focustimes?$select=${FOCUS_COLUMNS.join(",")}&$filter=${encodeURIComponent(filter)}&$expand=${expand}`);
        const patterns = rows.flatMap((r) => {
          const person = (r.coop_AccountWorker?._coop_user_value ?? r._coop_systemuser_value ?? "").toLowerCase();
          if (!guid(person) || !r.coop_startdate) return [];
          const days: FocusPattern["days"] = {};
          for (const [day, col] of [["Mon", "coop_mondaydaypart"], ["Tue", "coop_tuesdaydaypart"], ["Wed", "coop_wednesdaydaypart"], ["Thu", "coop_thursdaydaypart"]] as const) {
            const v = r[col];
            if (v === 1) days[day] = "AM";
            else if (v === 2) days[day] = "PM";
            else if (v === 3) days[day] = "AllDay";
          }
          return [{ userId: person, startDate: r.coop_startdate.slice(0, 10), endDate: r.coop_enddate ? r.coop_enddate.slice(0, 10) : null, days }];
        });
        log({ source: "dataverse", op: "team_client", count: patterns.length });
        return { ok: true as const, accountId: acct, patterns, workers: workerIds };
      });
    } catch (e) {
      return fail(e, "team_client");
    }
  }

  /** Everyone's PTO days in [from, to]: who and which date only. Never the title or message. */
  async function teamPto(from: string, to: string): Promise<{ ok: true; away: { userId: string; date: string }[] } | TeamFailure> {
    try {
      return await memo(`teampto:${from}:${to}`, async () => {
        const filter = `statecode eq 0 and coop_timeoffstartdate le ${Temporal.PlainDate.from(to)} and (coop_enddate eq null or coop_enddate ge ${Temporal.PlainDate.from(from)})`;
        const trackers = await getAll<{ coop_timeofftrackerid?: unknown; _coop_employee_value?: unknown; coop_timeoffstartdate: string | null; coop_enddate: string | null }>("team_pto", `coop_timeofftrackers?$select=coop_timeofftrackerid,_coop_employee_value,coop_timeoffstartdate,coop_enddate&$filter=${encodeURIComponent(filter)}`);
        const live = trackers.filter((t) => guid(t.coop_timeofftrackerid) && guid(t._coop_employee_value));
        const ids = live.map((t) => (t.coop_timeofftrackerid as string).toLowerCase());
        const details: PtoDetailRow[] = [];
        for (let i = 0; i < ids.length; i += 25) {
          const chunk = ids.slice(i, i + 25);
          details.push(...(await getAll<PtoDetailRow>("team_pto_details", `coop_timeofftrackerdetails?$select=${PTO_DETAIL_COLUMNS.join(",")}&$filter=${encodeURIComponent(`statecode eq 0 and (${chunk.map((id) => `_coop_timeofftracker_value eq ${id}`).join(" or ")})`)}`)));
        }
        // ptoEntries wants a title; a fixed word is passed and dropped: only who and when leave here.
        const { entries } = ptoEntries(live.map((t) => ({ coop_timeofftrackerid: (t.coop_timeofftrackerid as string).toLowerCase(), coop_timeoffstartdate: t.coop_timeoffstartdate, coop_enddate: t.coop_enddate, coop_title: "away" })), details);
        const owner = new Map(live.map((t) => [(t.coop_timeofftrackerid as string).toLowerCase(), (t._coop_employee_value as string).toLowerCase()]));
        const away = entries.filter((e) => e.date >= from && e.date <= to).map((e) => ({ userId: owner.get(e.trackerId)!, date: e.date }));
        log({ source: "dataverse", op: "team_pto", count: away.length });
        return { ok: true as const, away };
      });
    } catch (e) {
      return fail(e, "team_pto");
    }
  }

  return { load, following, resolveUserId, devopsTargets, myClients, pto, teammates, clientTeam, teamPto };
}

export type TeamFailure = { ok: false; message: string };

/** One of my clients. `devopsEmail` is my DevOps identity there (Account Worker), shown read-only in Settings. */
export type MyClient = { clientKey: string; clientName: string; devops: boolean; devopsEmail: string | null };

export type DataverseSource = ReturnType<typeof createDataverseSource>;
