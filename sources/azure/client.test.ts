import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { API, ARM, AzureError, createAzureClient, ownerQuery, parseVmId, sameVm, scheduleBody } from "./client.ts";

const SUB = "00000000-0000-4000-8000-0000000000aa";
const ID = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-pat-01`;
const TOKEN = "FAKE-ARM-TOKEN-77";
type Call = { method: string; url: string; auth: string | null; body: unknown };

function fake(routes: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const logs: LogRecord[] = [];
  const fetchFn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    const c: Call = { method: init.method ?? "GET", url: String(input), auth: h.get("authorization"), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return routes(c);
  };
  const client = createAzureClient({ fetch: fetchFn as typeof fetch, token: async () => TOKEN, log: (r) => logs.push(r) });
  return { client, calls, logs };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ref = parseVmId(ID)!;

describe("VM resource IDs", () => {
  it("parses one VM ID and nothing else", () => {
    expect(ref).toEqual({ id: ID, subscriptionId: SUB, resourceGroup: "rg-dev", name: "vm-pat-01" });
    expect(parseVmId(`${ID}/`)).toBeNull();
    expect(parseVmId(`${ID}/extensions/x`)).toBeNull();
    expect(parseVmId(ID.replace("virtualMachines", "disks"))).toBeNull();
    expect(parseVmId(`/subscriptions/not-a-guid/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/v`)).toBeNull();
    expect(parseVmId(`${ID}?x=1`)).toBeNull();
    expect(sameVm(ID, ID.toUpperCase())).toBe(true);
  });
});

describe("Resource Graph: VMs by owner tag", () => {
  it("queries every subscription I can see, with the tag escaped, and pages", async () => {
    let page = 0;
    const { client, calls } = fake(() =>
      json(200, page++ === 0
        ? { data: [{ id: ID, name: "vm-pat-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", power: "PowerState/deallocated" }], $skipToken: "next" }
        : { data: [{ id: "/bad", name: "x" }] }),
    );
    const vms = await client.findVms("Owner", 'Pat "Example"');
    expect(vms).toEqual([{ id: ID, name: "vm-pat-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", power: "deallocated" }]);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${ARM}/providers/Microsoft.ResourceGraph/resources?api-version=${API.resourceGraph}`);
    expect(calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
    const b = calls[0]!.body as { query: string; subscriptions?: unknown; options: Record<string, unknown> };
    expect(b.subscriptions).toBeUndefined();
    expect(b.query).toContain(`tostring(tags["Owner"]) =~ "Pat \\"Example\\""`);
    expect(b.query).toContain("type =~ 'microsoft.compute/virtualmachines'");
    expect((calls[1]!.body as { options: Record<string, unknown> }).options.$skipToken).toBe("next");
  });

  it("refuses odd tag names and empty values", () => {
    expect(() => ownerQuery("Own'er", "x")).toThrow(AzureError);
    expect(() => ownerQuery("Owner", " ")).toThrow(AzureError);
  });
});

describe("power: instance view, start, deallocate, polling", () => {
  it("reads the power state from the instance view", async () => {
    const { client, calls } = fake(() => json(200, { statuses: [{ code: "ProvisioningState/succeeded" }, { code: "PowerState/running" }] }));
    expect(await client.power(ref)).toBe("running");
    expect(calls[0]!.url).toBe(`${ARM}${ID}/instanceView?api-version=${API.compute}`);
  });

  it("start and deallocate POST with no body, never force or hibernate; 202 gives the poll URL", async () => {
    const op = `${ARM}/subscriptions/${SUB}/providers/Microsoft.Compute/locations/eastus/operations/abc?api-version=${API.compute}`;
    const { client, calls } = fake(() => new Response(null, { status: 202, headers: { "azure-asyncoperation": op, location: `${op}&monitor=true`, "retry-after": "10" } }));
    expect(await client.powerOp(ref, "start")).toEqual({ url: op, style: "async", retryAfterMs: 10_000 });
    expect(await client.powerOp(ref, "deallocate")).toMatchObject({ style: "async" });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", `${ARM}${ID}/start?api-version=${API.compute}`, undefined],
      ["POST", `${ARM}${ID}/deallocate?api-version=${API.compute}`, undefined],
    ]);
  });

  it("falls back to Location, and never polls a URL outside Azure Resource Manager", async () => {
    const { client } = fake(() => new Response(null, { status: 202, headers: { location: `${ARM}/op/1` } }));
    expect(await client.powerOp(ref, "start")).toEqual({ url: `${ARM}/op/1`, style: "location", retryAfterMs: null });
    const evil = fake(() => new Response(null, { status: 202, headers: { "azure-asyncoperation": "https://evil.example/op" } }));
    expect(await evil.client.powerOp(ref, "start")).toBeNull();
    await expect(evil.client.operation({ url: "https://evil.example/op", style: "async", retryAfterMs: null })).rejects.toMatchObject({ kind: "refused" });
  });

  it("reads operation status: InProgress until Succeeded, Failed or Canceled", async () => {
    const seq = ["InProgress", "Succeeded"];
    const { client } = fake(() => json(200, { status: seq.shift() }));
    const p = { url: `${ARM}/op/1`, style: "async" as const, retryAfterMs: null };
    expect((await client.operation(p)).status).toBe("InProgress");
    expect((await client.operation(p)).status).toBe("Succeeded");
    const loc = fake(() => new Response(null, { status: 202 }));
    expect((await loc.client.operation({ ...p, style: "location" })).status).toBe("InProgress");
  });
});

describe("errors say what's wrong, never Azure's message", () => {
  const secret = "principal 9999 FAKE-ARM-TOKEN-77 scope /subscriptions/secret";
  it("403 names the missing permission", async () => {
    const { client, logs } = fake(() => json(403, { error: { code: "AuthorizationFailed", message: secret } }));
    const e = (await client.powerOp(ref, "deallocate").catch((x: unknown) => x)) as AzureError;
    expect(e).toMatchObject({ kind: "forbidden", permission: "Microsoft.Compute/virtualMachines/deallocate/action" });
    expect(e.message).toBe("Azure says you don't have permission: Microsoft.Compute/virtualMachines/deallocate/action");
    expect(JSON.stringify(logs) + e.message + e.stack).not.toContain("FAKE-ARM-TOKEN");
    expect(e.message).not.toContain("principal");
  });
  it("404 is VM not found; network and throttling are told apart", async () => {
    await expect(fake(() => json(404, { error: { code: "ResourceNotFound", message: secret } })).client.power(ref)).rejects.toMatchObject({ kind: "not_found", message: expect.stringMatching(/VM not found/) });
    await expect(fake(() => { throw new TypeError("fetch failed"); }).client.power(ref)).rejects.toMatchObject({ kind: "network" });
    await expect(fake(() => json(429, {})).client.power(ref)).rejects.toMatchObject({ kind: "throttled" });
    await expect(fake(() => json(401, {})).client.power(ref)).rejects.toMatchObject({ kind: "not_signed_in" });
  });
});

describe("auto-shutdown schedule", () => {
  const sched = { id: "x", name: "shutdown-computevm-vm-pat-01", location: "eastus", tags: { a: "b" }, properties: { status: "Enabled", taskType: "ComputeVmShutdownTask", dailyRecurrence: { time: "1900" }, timeZoneId: "Eastern Standard Time", notificationSettings: { status: "Disabled", timeInMinutes: 30 }, targetResourceId: ID, provisioningState: "Succeeded", uniqueIdentifier: "u" } };
  it("reads shutdown-computevm-<vm> in the VM's resource group; none is null", async () => {
    const { client, calls } = fake(() => json(200, sched));
    expect(await client.getSchedule(ref)).toEqual(sched);
    expect(calls[0]!.url).toBe(`${ARM}/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.DevTestLab/schedules/shutdown-computevm-vm-pat-01?api-version=${API.schedules}`);
    expect(await fake(() => json(404, { error: { code: "ResourceNotFound" } })).client.getSchedule(ref)).toBeNull();
  });
  it("PUTs the whole schedule as read, with only time and status changed", async () => {
    const body = scheduleBody(sched, { time: "2100", status: "Enabled" });
    expect(body).toEqual({ location: "eastus", tags: { a: "b" }, properties: { status: "Enabled", taskType: "ComputeVmShutdownTask", dailyRecurrence: { time: "2100" }, timeZoneId: "Eastern Standard Time", notificationSettings: { status: "Disabled", timeInMinutes: 30 }, targetResourceId: ID } });
    const { client, calls } = fake(() => json(200, sched));
    await client.putSchedule(ref, body);
    expect(calls[0]).toMatchObject({ method: "PUT", body });
  });
});
