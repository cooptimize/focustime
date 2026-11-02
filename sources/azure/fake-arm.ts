// A fake Azure Resource Manager (step 15.4) behind a fetch function: Resource Graph by tag, VMs with power states and
// timed transitions, async operations, and auto-shutdown schedules. Used by tests and by demo mode (no Azure calls).
// Fictional IDs only.
import { ARM } from "./client.ts";

export type FakeVm = { id: string; name: string; resourceGroup: string; subscriptionId: string; location: string; tags: Record<string, string>; power: string };
export type FakeArmOptions = {
  now: () => number;
  /** How long a start or deallocate takes. */
  transitionMs?: number;
  /** Calls Azure refuses with 403 AuthorizationFailed: "start", "deallocate", "read", "scheduleRead", "scheduleWrite". */
  forbid?: Set<string>;
  /** Operations that end Failed. */
  failOps?: Set<"start" | "deallocate">;
  /** Every call fails as a network error while true. */
  offline?: { on: boolean };
  /** Schedule PUTs are accepted but not applied (a read-back mismatch). */
  ignorePut?: boolean;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const denied = () => json(403, { error: { code: "AuthorizationFailed", message: "The client 'fake' with object id 'fake' does not have authorization" } });
const notFound = () => json(404, { error: { code: "ResourceNotFound", message: "not found" } });

export function fakeArm(o: FakeArmOptions) {
  const vms = new Map<string, FakeVm>();
  const schedules = new Map<string, Record<string, unknown>>();
  const ops = new Map<string, { vm: string; op: "start" | "deallocate"; doneAt: number; fail: boolean }>();
  const calls: { method: string; path: string; body: unknown }[] = [];
  let seq = 0;

  function settle() {
    for (const op of ops.values()) {
      const vm = vms.get(op.vm);
      if (!vm || o.now() < op.doneAt) continue;
      if (vm.power === "starting" || vm.power === "deallocating") vm.power = op.fail ? (op.op === "start" ? "deallocated" : "running") : op.op === "start" ? "running" : "deallocated";
    }
  }

  function addVm(v: FakeVm, schedule?: { time: string; status?: "Enabled" | "Disabled"; timeZoneId?: string }) {
    vms.set(v.id.toLowerCase(), { ...v });
    if (schedule) {
      schedules.set(v.id.toLowerCase(), {
        id: `/subscriptions/${v.subscriptionId}/resourcegroups/${v.resourceGroup}/providers/microsoft.devtestlab/schedules/shutdown-computevm-${v.name}`,
        name: `shutdown-computevm-${v.name}`, type: "microsoft.devtestlab/schedules", location: v.location,
        properties: { status: schedule.status ?? "Enabled", taskType: "ComputeVmShutdownTask", dailyRecurrence: { time: schedule.time }, timeZoneId: schedule.timeZoneId ?? "Eastern Standard Time", notificationSettings: { status: "Disabled", timeInMinutes: 30, notificationLocale: "en" }, targetResourceId: v.id, provisioningState: "Succeeded", uniqueIdentifier: "00000000-0000-4000-8000-00000000f00d" },
      });
    }
  }

  const fetchFn = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    if (url.origin !== ARM) throw new Error(`unexpected host ${url.origin}`);
    if (o.offline?.on) throw new TypeError("fetch failed");
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const path = url.pathname;
    calls.push({ method, path, body });
    settle();
    if (method === "POST" && path === "/providers/Microsoft.ResourceGraph/resources") {
      const q = String((body as { query?: unknown }).query ?? "");
      const m = /tags\["((?:[^"\\]|\\.)*)"\]\) =~ "((?:[^"\\]|\\.)*)"/.exec(q);
      const un = (s: string) => s.replace(/\\(.)/g, "$1");
      const tag = m ? un(m[1]!) : "";
      const value = m ? un(m[2]!).toLowerCase() : "";
      const data = [...vms.values()].filter((v) => (v.tags[tag] ?? "").toLowerCase() === value).map((v) => ({ id: v.id, name: v.name, resourceGroup: v.resourceGroup, subscriptionId: v.subscriptionId, location: v.location, power: `PowerState/${v.power}` }));
      return json(200, { totalRecords: data.length, count: data.length, data, facets: [], resultTruncated: "false" });
    }
    const opMatch = /\/operations\/([\w-]+)$/.exec(path);
    if (method === "GET" && opMatch) {
      const op = ops.get(opMatch[1]!);
      if (!op) return notFound();
      if (o.now() < op.doneAt) return json(200, { status: "InProgress" }, { "retry-after": "5" });
      return json(200, op.fail ? { status: "Failed", error: { code: "OSProvisioningTimedOut", message: "x" } } : { status: "Succeeded" });
    }
    const vmMatch = /^(\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/virtualMachines\/[^/]+)(\/(instanceView|start|deallocate))?$/i.exec(path);
    if (vmMatch) {
      const vm = vms.get(decodeURIComponent(vmMatch[1]!).toLowerCase());
      const sub = vmMatch[3];
      if (!vm) return notFound();
      if (!sub && method === "GET") return o.forbid?.has("read") ? denied() : json(200, { id: vm.id, name: vm.name, location: vm.location, tags: vm.tags });
      if (sub === "instanceView" && method === "GET") return o.forbid?.has("instanceView") ? denied() : json(200, { statuses: [{ code: "ProvisioningState/succeeded" }, { code: `PowerState/${vm.power}`, displayStatus: `VM ${vm.power}` }] });
      if ((sub === "start" || sub === "deallocate") && method === "POST") {
        if (o.forbid?.has(sub)) return denied();
        const id = `op-${++seq}`;
        ops.set(id, { vm: vm.id.toLowerCase(), op: sub, doneAt: o.now() + (o.transitionMs ?? 60_000), fail: !!o.failOps?.has(sub) });
        vm.power = sub === "start" ? "starting" : "deallocating";
        const opUrl = `${ARM}/subscriptions/${vm.subscriptionId}/providers/Microsoft.Compute/locations/${vm.location}/operations/${id}?api-version=2026-04-01`;
        return new Response(null, { status: 202, headers: { "azure-asyncoperation": opUrl, location: `${opUrl}&monitor=true`, "retry-after": "10" } });
      }
    }
    const sMatch = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.DevTestLab\/schedules\/shutdown-computevm-([^/]+)$/i.exec(path);
    if (sMatch) {
      const vm = [...vms.values()].find((v) => v.subscriptionId === sMatch[1] && v.resourceGroup.toLowerCase() === decodeURIComponent(sMatch[2]!).toLowerCase() && v.name.toLowerCase() === decodeURIComponent(sMatch[3]!).toLowerCase());
      const key = vm?.id.toLowerCase() ?? "";
      if (method === "GET") {
        if (o.forbid?.has("scheduleRead")) return denied();
        const s = schedules.get(key);
        return s ? json(200, s) : notFound();
      }
      if (method === "PUT") {
        if (o.forbid?.has("scheduleWrite")) return denied();
        const prev = schedules.get(key);
        if (!prev) return notFound();
        const b = body as { properties: Record<string, unknown> };
        if (!o.ignorePut) schedules.set(key, { ...prev, properties: { ...(prev.properties as object), ...b.properties, provisioningState: "Succeeded" } });
        return json(200, schedules.get(key));
      }
    }
    return notFound();
  };

  const schedule = (vmId: string) => {
    const p = schedules.get(vmId.toLowerCase())?.properties as { dailyRecurrence: { time: string }; status: string } | undefined;
    return p ? { time: p.dailyRecurrence.time, status: p.status } : null;
  };
  return { fetch: fetchFn as typeof fetch, vms, schedules, calls, addVm, schedule, setPower: (id: string, p: string) => void (vms.get(id.toLowerCase())!.power = p) };
}
