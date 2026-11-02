// Azure Resource Manager for my VM (step 15.4), delegated (user_impersonation): the signed-in person's own Azure
// permissions decide what works. Reads: Resource Graph (VMs by owner tag), the VM, its instance view and its
// auto-shutdown schedule. Writes: start, deallocate, and that schedule (a full PUT; PATCH only changes tags).
// Only https://management.azure.com is called. Errors carry a kind, the HTTP status and Azure's error code, never
// bodies, tokens or Azure's messages (they can name principals and scopes).
import type { Logger } from "../../log/logger.ts";
import { powerFrom, type PowerState } from "../../plan/vm.ts";

export const ARM = "https://management.azure.com";
/** api-versions, checked against Microsoft Learn on Nov 2, 2026. */
export const API = {
  /** Microsoft.Compute virtualMachines: GET, instanceView, start, deallocate. */
  compute: "2026-04-01",
  /** Microsoft.ResourceGraph resources (POST query). */
  resourceGraph: "2024-04-01",
  /** Microsoft.DevTestLab global schedules (a VM's auto-shutdown). */
  schedules: "2018-09-15",
} as const;

export type VmRef = { id: string; subscriptionId: string; resourceGroup: string; name: string };
const VM_ID = /^\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resourceGroups\/([-\w.()]{1,90})\/providers\/Microsoft\.Compute\/virtualMachines\/([-\w.]{1,64})$/i;

/** A VM resource ID, or null. Strict: one VM, no trailing parts, nothing to add to a URL. */
export function parseVmId(id: unknown): VmRef | null {
  if (typeof id !== "string") return null;
  const t = id.trim();
  const m = VM_ID.exec(t);
  if (!m || m[2]!.endsWith(".")) return null;
  return { id: t, subscriptionId: m[1]!.toLowerCase(), resourceGroup: m[2]!, name: m[3]! };
}
/** Resource IDs compare without case (Azure treats them that way). */
export const sameVm = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const TAG_NAME = /^[^<>%&\\?/'"]{1,128}$/;
/** KQL string literal: double quotes, backslash and quote escaped. */
const kql = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** The Resource Graph query for VMs whose tag `tag` equals `value` (any case). */
export function ownerQuery(tag: string, value: string): string {
  if (!TAG_NAME.test(tag)) throw new AzureError("failed", 0, "Not a valid tag name");
  if (!value.trim() || value.length > 256 || /[\r\n]/.test(value)) throw new AzureError("failed", 0, "Not a valid tag value");
  return [
    "Resources",
    "| where type =~ 'microsoft.compute/virtualmachines'",
    `| where tostring(tags[${kql(tag)}]) =~ ${kql(value.trim())}`,
    "| project id, name, resourceGroup, subscriptionId, location, power = tostring(properties.extended.instanceView.powerState.code)",
    "| order by name asc",
    "| limit 50",
  ].join("\n");
}

export type AzureErrorKind = "not_signed_in" | "consent" | "forbidden" | "not_found" | "throttled" | "network" | "timeout" | "failed" | "refused";
export class AzureError extends Error {
  readonly kind: AzureErrorKind;
  readonly status: number;
  /** The Azure permission this call needs, when Azure refused it. */
  readonly permission: string | null;
  constructor(kind: AzureErrorKind, status: number, message: string, permission: string | null = null) {
    super(message);
    this.name = "AzureError";
    this.kind = kind;
    this.status = status;
    this.permission = permission;
  }
}

/** What each call needs in Azure RBAC (Virtual Machine Contributor covers the Compute ones). */
export const PERMISSION = {
  find: "Microsoft.Compute/virtualMachines/read (Reader on the subscription or resource group)",
  read: "Microsoft.Compute/virtualMachines/read",
  instanceView: "Microsoft.Compute/virtualMachines/instanceView/read",
  start: "Microsoft.Compute/virtualMachines/start/action",
  deallocate: "Microsoft.Compute/virtualMachines/deallocate/action",
  operation: "Microsoft.Compute/locations/operations/read",
  scheduleRead: "Microsoft.DevTestLab/schedules/read",
  scheduleWrite: "Microsoft.DevTestLab/schedules/write",
} as const;
export type AzureCall = keyof typeof PERMISSION;

export type VmCandidate = { id: string; name: string; resourceGroup: string; subscriptionId: string; location: string; power: PowerState };
export type VmInfo = { id: string; name: string; location: string };
/** Where to poll a start or stop: Azure-AsyncOperation (status in the body) or Location (202 until done). */
export type Poll = { url: string; style: "async" | "location"; retryAfterMs: number | null };
export type OpStatus = "InProgress" | "Succeeded" | "Failed" | "Canceled";

export type AzureDeps = { fetch: typeof fetch; token: () => Promise<string>; log: Logger; timeoutMs?: number };

const vmPath = (r: VmRef) => `/subscriptions/${r.subscriptionId}/resourceGroups/${encodeURIComponent(r.resourceGroup)}/providers/Microsoft.Compute/virtualMachines/${encodeURIComponent(r.name)}`;
/** A VM's auto-shutdown schedule: a resource-group schedule named shutdown-computevm-<vm>. */
export const schedulePath = (r: VmRef) => `/subscriptions/${r.subscriptionId}/resourceGroups/${encodeURIComponent(r.resourceGroup)}/providers/Microsoft.DevTestLab/schedules/shutdown-computevm-${encodeURIComponent(r.name)}`;
const retryAfter = (h: string | null) => (h && /^\d{1,4}$/.test(h) ? Number(h) * 1000 : null);

export function createAzureClient(d: AzureDeps) {
  const timeoutMs = d.timeoutMs ?? 20_000;

  async function send(call: AzureCall, method: "GET" | "POST" | "PUT", url: string, body?: unknown): Promise<Response> {
    if (!url.startsWith(`${ARM}/`)) throw new AzureError("refused", 0, "Coopilot only calls Azure Resource Manager");
    const token = await d.token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, {
        method,
        headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      d.log({ source: "azure", op: call, kind: "network" });
      throw new AzureError("network", 0, "Azure unreachable");
    }
    d.log({ source: "azure", op: call, status: res.status, durationMs: performance.now() - started });
    if (res.ok) return res;
    // Only Azure's error code is read (AuthorizationFailed, ResourceNotFound, ...); its message is never kept.
    const code = await res.json().then((j: { error?: { code?: unknown } }) => (typeof j?.error?.code === "string" ? j.error.code : ""), () => "");
    throw failure(call, res.status, code);
  }

  function failure(call: AzureCall, status: number, code: string): AzureError {
    if (status === 401) return new AzureError("not_signed_in", status, "Azure didn't accept the sign-in. Sign in again");
    if (status === 403) return new AzureError("forbidden", status, `Azure says you don't have permission: ${PERMISSION[call]}`, PERMISSION[call]);
    if (status === 404 || /NotFound$/.test(code)) {
      const what = call.startsWith("schedule") ? "No auto-shutdown schedule found for this VM" : code === "SubscriptionNotFound" ? "Subscription not found, or you can't see it" : "VM not found. It may have been deleted or moved";
      return new AzureError("not_found", status, what);
    }
    if (status === 429) return new AzureError("throttled", status, "Azure is busy (throttled). Try again in a minute");
    if (status === 409) return new AzureError("failed", status, `Azure refused that right now${code ? ` (${code})` : ""}. Another operation may be running`);
    return new AzureError("failed", status, `Azure error (HTTP ${status}${code ? `, ${code}` : ""})`);
  }

  /** VMs I can see, across every subscription I can see, whose tag matches. Pages through $skipToken. */
  async function findVms(tag: string, value: string): Promise<VmCandidate[]> {
    const query = ownerQuery(tag, value);
    const out: VmCandidate[] = [];
    let skipToken: string | null = null;
    for (let page = 0; page < 5; page++) {
      const body: Record<string, unknown> = { query, options: { resultFormat: "objectArray", ...(skipToken ? { $skipToken: skipToken } : {}) } };
      const res = await send("find", "POST", `${ARM}/providers/Microsoft.ResourceGraph/resources?api-version=${API.resourceGraph}`, body);
      const j = (await res.json().catch(() => ({}))) as { data?: unknown; $skipToken?: unknown };
      for (const row of Array.isArray(j.data) ? j.data : []) {
        const r = row as Record<string, unknown>;
        const ref = parseVmId(r.id);
        if (!ref) continue;
        out.push({ id: ref.id, name: String(r.name ?? ref.name), resourceGroup: String(r.resourceGroup ?? ref.resourceGroup), subscriptionId: ref.subscriptionId, location: String(r.location ?? ""), power: powerFrom([{ code: r.power }]) });
      }
      skipToken = typeof j.$skipToken === "string" && j.$skipToken ? j.$skipToken : null;
      if (!skipToken) break;
    }
    return out;
  }

  async function getVm(r: VmRef): Promise<VmInfo> {
    const res = await send("read", "GET", `${ARM}${vmPath(r)}?api-version=${API.compute}`);
    const j = (await res.json().catch(() => ({}))) as { id?: unknown; name?: unknown; location?: unknown };
    return { id: typeof j.id === "string" ? j.id : r.id, name: typeof j.name === "string" ? j.name : r.name, location: typeof j.location === "string" ? j.location : "" };
  }

  async function power(r: VmRef): Promise<PowerState> {
    const res = await send("instanceView", "GET", `${ARM}${vmPath(r)}/instanceView?api-version=${API.compute}`);
    const j = (await res.json().catch(() => ({}))) as { statuses?: unknown };
    return powerFrom(j.statuses);
  }

  /** Start or deallocate (never force, never hibernate). Null poll: Azure finished at once (200). */
  async function powerOp(r: VmRef, op: "start" | "deallocate"): Promise<Poll | null> {
    const res = await send(op, "POST", `${ARM}${vmPath(r)}/${op}?api-version=${API.compute}`);
    await res.body?.cancel();
    if (res.status !== 202 && res.status !== 201) return null;
    const asyncUrl = res.headers.get("azure-asyncoperation");
    const loc = res.headers.get("location");
    const ra = retryAfter(res.headers.get("retry-after"));
    if (asyncUrl?.startsWith(`${ARM}/`)) return { url: asyncUrl, style: "async", retryAfterMs: ra };
    if (loc?.startsWith(`${ARM}/`)) return { url: loc, style: "location", retryAfterMs: ra };
    return null;
  }

  /** One look at a running operation. */
  async function operation(p: Poll): Promise<{ status: OpStatus; retryAfterMs: number | null }> {
    const res = await send("operation", "GET", p.url);
    const ra = retryAfter(res.headers.get("retry-after"));
    if (p.style === "location") {
      await res.body?.cancel();
      return { status: res.status === 202 ? "InProgress" : "Succeeded", retryAfterMs: ra };
    }
    const j = (await res.json().catch(() => ({}))) as { status?: unknown };
    const s = j.status;
    const status: OpStatus = s === "Succeeded" || s === "Failed" || s === "Canceled" ? s : "InProgress";
    return { status, retryAfterMs: ra };
  }

  /** The VM's auto-shutdown schedule as Azure returns it, or null when there is none. */
  async function getSchedule(r: VmRef): Promise<Record<string, unknown> | null> {
    try {
      const res = await send("scheduleRead", "GET", `${ARM}${schedulePath(r)}?api-version=${API.schedules}`);
      return (await res.json()) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof AzureError && e.kind === "not_found") return null;
      throw e;
    }
  }

  /** Replaces the schedule (Global Schedules CreateOrUpdate). The body is the one read, with time or status changed. */
  async function putSchedule(r: VmRef, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await send("scheduleWrite", "PUT", `${ARM}${schedulePath(r)}?api-version=${API.schedules}`, body);
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  return { findVms, getVm, power, powerOp, operation, getSchedule, putSchedule };
}
export type AzureClient = ReturnType<typeof createAzureClient>;

/** The schedule body to PUT: the one read back, with only the daily time and status changed (and read-only parts dropped). */
export function scheduleBody(current: Record<string, unknown>, change: { time: string; status: "Enabled" | "Disabled" }): Record<string, unknown> {
  const props = { ...((current.properties as Record<string, unknown> | undefined) ?? {}) };
  delete props.provisioningState;
  delete props.createdDate;
  delete props.uniqueIdentifier;
  props.status = change.status;
  props.dailyRecurrence = { ...((props.dailyRecurrence as Record<string, unknown> | undefined) ?? {}), time: change.time };
  const out: Record<string, unknown> = { location: current.location, properties: props };
  if (current.tags) out.tags = current.tags;
  return out;
}
