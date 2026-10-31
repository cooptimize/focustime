// Read-only Dataverse source: Focus Time patterns for me, for one week.
// Token in memory only. Never throws to callers: every failure becomes a SourceResult with a plain message.
import { readSnapshot, writeSnapshot } from "../../cache/snapshots.ts";
import type { DataverseConfig } from "../../config/schema.ts";
import type { Logger } from "../../log/logger.ts";
import { SecretError } from "../../secrets/keyring.ts";
import { formatTime } from "../../week/format.ts";
import type { FocusPattern, SourceResult } from "../../week/types.ts";
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
  constructor(status: Status, message: string, fixAction?: SourceResult<unknown>["fixAction"]) {
    super(message);
    this.status = status;
    this.fixAction = fixAction;
  }
}

const API = "/api/data/v9.2/";
const KEYRING_HINT = "keyring entry coopilot / dataverse-client-secret";

export function createDataverseSource(deps: DataverseSourceDeps) {
  const { config, log } = deps;
  const now = deps.now ?? (() => Temporal.Now.instant());
  const ttl = deps.memoryTtlMs ?? 5 * 60_000;
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const apiBase = `${config.environmentUrl}${API}`;

  let token: { value: string; expiresAt: number } | null = null;
  const memory = new Map<string, { at: number; result: SourceResult<FocusPattern> }>();

  const unreachable = () => new SourceFailure("unreachable", "Dataverse unreachable");
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
        throw new SourceFailure("misconfigured", "No Dataverse client secret in the keyring (service coopilot, account dataverse-client-secret)", "open_settings");
      throw new SourceFailure("error", "Secret storage unavailable (Secret Service). Unlock the keyring and retry");
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
    if (status === 404 || code === "0x8006088a" || code === "0x80060888")
      return new SourceFailure("misconfigured", "Focus block table not found: check config", "open_settings");
    return new SourceFailure("error", `Dataverse error (HTTP ${status})`);
  }

  function focusTimesPath(weekStart: string, userId: string): string {
    const mon = Temporal.PlainDate.from(weekStart);
    const thu = mon.add({ days: 3 });
    const select = [
      "coop_focustimeid", "_coop_account_value", "_coop_systemuser_value", "_coop_accountworker_value",
      "coop_startdate", "coop_enddate", "coop_mondaydaypart", "coop_tuesdaydaypart",
      "coop_wednesdaydaypart", "coop_thursdaydaypart", "statecode",
    ].join(",");
    const filter =
      `statecode eq 0 and coop_startdate le ${thu} and (coop_enddate eq null or coop_enddate ge ${mon})` +
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

  async function fetchLive(weekStart: string): Promise<SourceResult<FocusPattern>> {
    const userId = config.mySystemUserId;
    if (!userId) throw new SourceFailure("misconfigured", "Your Dataverse user id is not resolved yet: check my_email in config", "open_settings");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new SourceFailure("misconfigured", "my_systemuserid is not a GUID", "open_settings");

    const rows = await getAll<FocusTimeRow>("focustimes", focusTimesPath(weekStart, userId));
    const accountIds = [...new Set(rows.flatMap((r) => [r.coop_AccountWorker?._coop_account_value, r._coop_account_value]).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))];
    const accounts = accountIds.length ? await getAll<AccountRow>("accounts", accountsPath(accountIds)) : [];
    const { patterns, skipped } = normalizeFocusTimes(rows, accounts, userId);
    if (skipped.length) log({ source: "dataverse", op: "normalize", kind: "skipped", count: skipped.length });

    const fetchedAt = now().toZonedDateTimeISO(deps.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
    await writeSnapshot(deps.cacheDir, "dataverse", weekStart, { fetchedAt, items: patterns }).catch(() =>
      log({ source: "dataverse", op: "cache_write", kind: "failed" }),
    );
    const result: SourceResult<FocusPattern> = { source: "dataverse", status: "ok", fetchedAt, fromCache: false, items: patterns };
    if (skipped.length) result.message = `${skipped.length} Focus Time ${skipped.length === 1 ? "row" : "rows"} skipped: ${[...new Set(skipped.map((s) => s.reason))].join(", ")}`;
    return result;
  }

  async function load(weekStart: string, opts: { refresh?: boolean } = {}): Promise<SourceResult<FocusPattern>> {
    const t = now().epochMilliseconds;
    const hit = memory.get(weekStart);
    if (hit && !opts.refresh && t - hit.at < ttl) return hit.result;

    let result: SourceResult<FocusPattern>;
    try {
      result = await fetchLive(weekStart);
    } catch (e) {
      const f = e instanceof SourceFailure ? e : new SourceFailure("error", "Dataverse load failed");
      if (!(e instanceof SourceFailure)) log({ source: "dataverse", op: "load", kind: "unexpected" });
      const snap = await readSnapshot<FocusPattern>(deps.cacheDir, "dataverse", weekStart);
      const message = snap
        ? f.status === "unreachable"
          ? `Offline, showing data from ${fmtAt(snap.fetchedAt)}`
          : `${f.message}. Showing data from ${fmtAt(snap.fetchedAt)}`
        : `${f.message}. No cached data yet`;
      result = { source: "dataverse", status: f.status, fetchedAt: snap?.fetchedAt ?? null, fromCache: !!snap, items: snap?.items ?? [], message };
      if (f.fixAction) result.fixAction = f.fixAction;
    }
    memory.set(weekStart, { at: t, result });
    return result;
  }

  /**
   * DevOps settings for the given clients, read live for one DevOps fetch. This is the only query that
   * selects coop_devopstoken. Nothing here is cached, memoized or logged beyond counts, and each PAT is
   * wrapped in Pat as soon as it is read. Only accounts I am an active Account Worker on are considered.
   */
  async function devopsTargets(clientKeys: string[]): Promise<TargetsResult> {
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
      const select = "accountid,name,coop_reportingnickname,coop_devopsorg,coop_devopsprojectid,coop_devopsprojectname,coop_devopstoken";
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
          // Name first: it is set on every account, while some stored project IDs are blank or stale (CSC's is wrong).
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
      return { ok: false, message: f?.status === "unreachable" ? "Dataverse unreachable" : f?.status === "auth_required" ? "Dataverse access denied" : "Dataverse read failed" };
    }
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

  return { load, resolveUserId, devopsTargets };
}

export type DataverseSource = ReturnType<typeof createDataverseSource>;
