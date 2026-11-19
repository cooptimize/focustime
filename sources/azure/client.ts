// Azure Resource Manager for my VM (step 15.4), delegated (user_impersonation): the signed-in person's own Azure
// permissions decide what works. fix/vm-schedule (D475): every request passes a fixed allowlist (ALLOWED) before a
// token is asked for or anything is sent. Reads: Resource Graph (VMs by owner tag), the VM, its instance view, its
// auto-shutdown schedule and a start's or stop's progress. The two writes: start the VM, and (VM-2) deallocate it (a
// stop that ends compute billing). Never power off without deallocating, restart, delete or resize, and never any
// write to an auto-shutdown schedule (PUT, PATCH, DELETE, execute, retarget); the schedule is the person's own.
// The two writes take no query parameter but api-version (no hibernate, no forceDeallocate).
// Only https://management.azure.com is called. Errors carry a kind, the HTTP status and Azure's error code, never
// bodies, tokens or Azure's messages (they can name principals and scopes).
import type { BodyWord, CauseWord, ChallengeWord, Logger } from "../../log/logger.ts";
import { powerFrom, type PowerState } from "../../plan/vm.ts";

export const ARM = "https://management.azure.com";
/** api-versions, checked against Microsoft Learn on Nov 2, 2026 (deallocate: Nov 11, 2026, VM-2). */
export const API = {
  /** Microsoft.Compute virtualMachines: GET, instanceView, start, deallocate. */
  compute: "2026-04-01",
  /** Microsoft.ResourceGraph resources (POST query). */
  resourceGraph: "2024-04-01",
  /** Microsoft.DevTestLab global schedules (a VM's auto-shutdown): GET only. */
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
  /** VM-6: Azure's error code as one plain word (AuthorizationFailed), "" when it gave none. Never its message. */
  readonly code: string;
  constructor(kind: AzureErrorKind, status: number, message: string, permission: string | null = null, code = "") {
    super(message);
    this.name = "AzureError";
    this.kind = kind;
    this.status = status;
    this.permission = permission;
    this.code = code;
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
} as const;
export type AzureCall = keyof typeof PERMISSION;

const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SEG = "[^/]+";
const VM_PATH = `/subscriptions/${GUID}/resourceGroups/${SEG}/providers/Microsoft\\.Compute/virtualMachines/${SEG}`;
const rule = (call: AzureCall, method: "GET" | "POST", path: string) => ({ call, method, path: new RegExp(`^${path}$`, "i") });

/**
 * The only Azure calls FocusTime makes (D475). Anything else, any other method or path, throws before a token is
 * asked for or a request is sent. There is deliberately no rule for Microsoft.DevTestLab/schedules other than GET.
 */
export const ALLOWED = [
  rule("find", "POST", "/providers/Microsoft\\.ResourceGraph/resources"),
  rule("read", "GET", VM_PATH),
  rule("instanceView", "GET", `${VM_PATH}/instanceView`),
  rule("start", "POST", `${VM_PATH}/start`),
  // VM-2: the stop that ends compute billing. Never powerOff (it keeps billing), restart, delete or resize.
  rule("deallocate", "POST", `${VM_PATH}/deallocate`),
  rule("operation", "GET", `/subscriptions/${GUID}/providers/Microsoft\\.Compute/locations/${SEG}/operations/${SEG}`),
  rule("scheduleRead", "GET", `/subscriptions/${GUID}/resourceGroups/${SEG}/providers/Microsoft\\.DevTestLab/schedules/shutdown-computevm-${SEG}`),
] as const;

/** The writes: their only query parameter is api-version (VM-2: no hibernate or forceDeallocate rides along). */
const WRITES: ReadonlySet<AzureCall> = new Set<AzureCall>(["start", "deallocate"]);

/** Which allowed call a request is, or null: refused. Azure Resource Manager only; no encoded slashes or dot segments. */
export function allowedCall(method: string, url: string): AzureCall | null {
  // Control characters (tabs, newlines) are dropped by URL parsing, so "%2\tF" would become "%2F": refused first.
  if (!url.startsWith(`${ARM}/`) || /[\u0000-\u001f\u007f]/.test(url)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== ARM || u.username || u.password || u.hash) return null;
  const raw = url.slice(ARM.length).split("?")[0]!;
  if (/%2f|%5c|\\|\/\.\.?(\/|$)/i.test(raw)) return null;
  if (/%2f|%5c|\\/i.test(u.pathname)) return null;
  const call = ALLOWED.find((r) => r.method === method && r.path.test(u.pathname))?.call ?? null;
  if (call && WRITES.has(call) && [...u.searchParams.keys()].some((k) => k !== "api-version")) return null;
  return call;
}

/** VM-4: Azure's error code as a log kind: one plain code word (AuthorizationFailed), else "other"; none: "none". */
export const azureCodeWord = (code: string): string => (!code ? "none" : /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(code) ? code : "other");

/** VM-6: Azure's codes for a token it won't take (expired, for another tenant or resource): the sign-in, not a no. */
const TOKEN_CODES = /^(InvalidAuthenticationToken\w*|ExpiredAuthenticationToken|AuthenticationFailed\w*)$/;
/**
 * VM-6: whether a Bearer challenge (WWW-Authenticate) names the token: `invalid_token` (expired, revoked, the wrong one)
 * or `insufficient_claims` (Azure wants a fresh sign-in, a claims challenge). Only that one word is read; nothing of the
 * header is kept or logged. `insufficient_scope` and anything else is a no, not a sign-in.
 */
export const challengeNamesToken = (header: string | null): boolean => !!header && /^\s*Bearer\b/i.test(header) && /\berror\s*=\s*"?(invalid_token|insufficient_claims)"?/i.test(header);

/**
 * VM-7: a refused answer's challenge as one closed word: the error word of a Bearer WWW-Authenticate (invalid_token,
 * insufficient_claims, insufficient_scope), any other word or scheme "other", no header or no error word "none".
 * Nothing else of the header is read.
 */
export function challengeWord(header: string | null): ChallengeWord {
  if (!header || !header.trim()) return "none";
  if (!/^\s*Bearer\b/i.test(header)) return "other";
  const m = /\berror\s*=\s*"?([^",\s]*)/i.exec(header);
  if (!m) return "none";
  const w = m[1]!.toLowerCase();
  return w === "invalid_token" || w === "insufficient_claims" || w === "insufficient_scope" ? w : "other";
}
/** VM-7: x-ms-failure-cause as one closed word: gateway or service, any other value "other", no header "none". */
export function causeWord(header: string | null): CauseWord {
  if (header === null || !header.trim()) return "none";
  const w = header.trim().toLowerCase();
  return w === "gateway" || w === "service" ? w : "other";
}
/** VM-7: a refused answer's body as its shape only, with Azure's code when it has one (for the kind and the error). */
export function bodyShape(text: string): { body: BodyWord; code: string } {
  if (!text.trim()) return { body: "empty", code: "" };
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { body: "not_json", code: "" };
  }
  const code = (j as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" && code ? { body: "json_with_code", code } : { body: "json_no_code", code: "" };
}

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

  /** Every request: the allowlist decides, before the token or the network. */
  async function send(method: string, url: string, body?: unknown): Promise<Response> {
    const call = allowedCall(method, url);
    if (!call) {
      d.log({ source: "azure", op: "refused", kind: "refused" });
      throw new AzureError("refused", 0, url.startsWith(`${ARM}/`) ? "FocusTime doesn't make that Azure call. It only reads your VM and its auto-shutdown, starts it and stops it" : "FocusTime only calls Azure Resource Manager");
    }
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
    if (res.ok) {
      d.log({ source: "azure", op: call, status: res.status, durationMs: performance.now() - started });
      return res;
    }
    // Only Azure's error code is read (AuthorizationFailed, ResourceNotFound, ...); its message is never kept.
    const shape = bodyShape(await res.text().catch(() => ""));
    const code = shape.code;
    const challenge = res.headers.get("www-authenticate");
    // VM-4: the code goes in the log as the failure's kind (a word Azure defines, never its message), so a refusal
    // like Nov 17's 403s says which kind of no it was. Anything that isn't one plain code word is "other".
    // VM-7: and three closed words, so the next stretch of refusals can be explained from the logs: the challenge's
    // error word, x-ms-failure-cause and the body's shape. Never a header's value beyond them, nor any of the body.
    d.log({ source: "azure", op: call, status: res.status, durationMs: performance.now() - started, kind: azureCodeWord(code), challenge: challengeWord(challenge), cause: causeWord(res.headers.get("x-ms-failure-cause")), body: shape.body });
    throw failure(call, res.status, code, challengeNamesToken(challenge));
  }

  function failure(call: AzureCall, status: number, raw: string, tokenChallenge = false): AzureError {
    const code = raw && azureCodeWord(raw) !== "other" ? raw : "";
    // VM-6: Azure asking for the sign-in again is the sign-in, whether it says so with a 401, a challenge naming the
    // token or a token code on a 403 (before, a 403 was always read as "you don't have permission").
    if (status === 401 || (status === 403 && (tokenChallenge || TOKEN_CODES.test(code)))) return new AzureError("not_signed_in", status, "Azure didn't accept the sign-in. Sign in again", null, code);
    if (status === 403) return new AzureError("forbidden", status, `Azure says you don't have permission: ${PERMISSION[call]}`, PERMISSION[call], code);
    if (status === 404 || /NotFound$/.test(code)) {
      const what = call.startsWith("schedule") ? "No auto-shutdown schedule found for this VM" : code === "SubscriptionNotFound" ? "Subscription not found, or you can't see it" : "VM not found. It may have been deleted or moved";
      return new AzureError("not_found", status, what, null, code);
    }
    if (status === 429) return new AzureError("throttled", status, "Azure is busy (throttled). Try again in a minute", null, code);
    if (status === 409) return new AzureError("failed", status, `Azure refused that right now${code ? ` (${code})` : ""}. Another operation may be running`, null, code);
    return new AzureError("failed", status, `Azure error (HTTP ${status}${code ? `, ${code}` : ""})`, null, code);
  }

  /** VMs I can see, across every subscription I can see, whose tag matches. Pages through $skipToken. */
  async function findVms(tag: string, value: string): Promise<VmCandidate[]> {
    const query = ownerQuery(tag, value);
    const out: VmCandidate[] = [];
    let skipToken: string | null = null;
    for (let page = 0; page < 5; page++) {
      const body: Record<string, unknown> = { query, options: { resultFormat: "objectArray", ...(skipToken ? { $skipToken: skipToken } : {}) } };
      const res = await send("POST", `${ARM}/providers/Microsoft.ResourceGraph/resources?api-version=${API.resourceGraph}`, body);
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
    const res = await send("GET", `${ARM}${vmPath(r)}?api-version=${API.compute}`);
    const j = (await res.json().catch(() => ({}))) as { id?: unknown; name?: unknown; location?: unknown };
    return { id: typeof j.id === "string" ? j.id : r.id, name: typeof j.name === "string" ? j.name : r.name, location: typeof j.location === "string" ? j.location : "" };
  }

  async function powerState(r: VmRef): Promise<PowerState> {
    const res = await send("GET", `${ARM}${vmPath(r)}/instanceView?api-version=${API.compute}`);
    const j = (await res.json().catch(() => ({}))) as { statuses?: unknown };
    return powerFrom(j.statuses);
  }

  /** Start or (VM-2) deallocate, the two writes. Null poll: Azure finished at once (200). */
  async function power(r: VmRef, op: "start" | "deallocate"): Promise<Poll | null> {
    const res = await send("POST", `${ARM}${vmPath(r)}/${op}?api-version=${API.compute}`);
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
    const res = await send("GET", p.url);
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
      const res = await send("GET", `${ARM}${schedulePath(r)}?api-version=${API.schedules}`);
      return (await res.json()) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof AzureError && e.kind === "not_found") return null;
      throw e;
    }
  }

  return {
    findVms, getVm, power: powerState, operation, getSchedule,
    start: (r: VmRef) => power(r, "start"),
    /** VM-2: stop it so it stops billing (deallocate). Only ever from a person's Confirm on their own VM. */
    deallocate: (r: VmRef) => power(r, "deallocate"),
    /** Any request, through the same allowlist (tests; nothing in FocusTime calls this). */
    request: (method: string, url: string, body?: unknown) => send(method, url, body),
  };
}
export type AzureClient = ReturnType<typeof createAzureClient>;
