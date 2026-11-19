import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { ALLOWED, allowedCall, API, ARM, AzureError, bodyShape, causeWord, challengeWord, createAzureClient, ownerQuery, parseVmId, sameVm } from "./client.ts";

const SUB = "00000000-0000-4000-8000-0000000000aa";
const ID = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-pat-01`;
const TOKEN = "FAKE-ARM-TOKEN-77";
type Call = { method: string; url: string; auth: string | null; body: unknown };

function fake(routes: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const logs: LogRecord[] = [];
  const tokens = { n: 0 };
  const fetchFn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    const c: Call = { method: init.method ?? "GET", url: String(input), auth: h.get("authorization"), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return routes(c);
  };
  const client = createAzureClient({ fetch: fetchFn as typeof fetch, token: async () => (tokens.n++, TOKEN), log: (r) => logs.push(r) });
  return { client, calls, logs, tokens };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ref = parseVmId(ID)!;
const OP = `${ARM}/subscriptions/${SUB}/providers/Microsoft.Compute/locations/eastus/operations/op-1?api-version=2026-04-01`;

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

describe("power: instance view, start, polling", () => {
  it("reads the power state from the instance view", async () => {
    const { client, calls } = fake(() => json(200, { statuses: [{ code: "ProvisioningState/succeeded" }, { code: "PowerState/running" }] }));
    expect(await client.power(ref)).toBe("running");
    expect(calls[0]!.url).toBe(`${ARM}${ID}/instanceView?api-version=${API.compute}`);
  });

  it("start POSTs with no body; 202 gives the poll URL", async () => {
    const op = `${ARM}/subscriptions/${SUB}/providers/Microsoft.Compute/locations/eastus/operations/abc?api-version=${API.compute}`;
    const { client, calls } = fake(() => new Response(null, { status: 202, headers: { "azure-asyncoperation": op, location: `${op}&monitor=true`, "retry-after": "10" } }));
    expect(await client.start(ref)).toEqual({ url: op, style: "async", retryAfterMs: 10_000 });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([["POST", `${ARM}${ID}/start?api-version=${API.compute}`, undefined]]);
  });

  it("falls back to Location, and never polls a URL outside Azure Resource Manager", async () => {
    const { client } = fake(() => new Response(null, { status: 202, headers: { location: OP } }));
    expect(await client.start(ref)).toEqual({ url: OP, style: "location", retryAfterMs: null });
    const evil = fake(() => new Response(null, { status: 202, headers: { "azure-asyncoperation": "https://evil.example/op" } }));
    expect(await evil.client.start(ref)).toBeNull();
    await expect(evil.client.operation({ url: "https://evil.example/op", style: "async", retryAfterMs: null })).rejects.toMatchObject({ kind: "refused" });
  });

  it("reads operation status: InProgress until Succeeded, Failed or Canceled", async () => {
    const seq = ["InProgress", "Succeeded"];
    const { client } = fake(() => json(200, { status: seq.shift() }));
    const p = { url: OP, style: "async" as const, retryAfterMs: null };
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
    const e = (await client.start(ref).catch((x: unknown) => x)) as AzureError;
    expect(e).toMatchObject({ kind: "forbidden", permission: "Microsoft.Compute/virtualMachines/start/action" });
    expect(e.message).toBe("Azure says you don't have permission: Microsoft.Compute/virtualMachines/start/action");
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

// VM-6, lead 3: Azure asking for the sign-in again must read as the sign-in, never as "Azure refused". A 401 always
// did; a 403 with a Bearer challenge naming the token (invalid_token, insufficient_claims) or one of Azure's token codes
// was read as refused. Production's 403s carried neither (docs/ux/vm6/what-happened.md): those stay refused.
describe("VM-6: a sign-in asked for again is a sign-in, not refused", () => {
  const challenge = (error: string) => new Response(null, { status: 403, headers: { "www-authenticate": `Bearer authorization_uri="https://login.microsoftonline.com/common/oauth2/authorize", error="${error}", error_description="secret principal 9999"` } });
  for (const error of ["invalid_token", "insufficient_claims"])
    it(`a 403 with a challenge naming the token (${error}) is not_signed_in`, async () => {
      const { client, logs } = fake(() => challenge(error));
      const e = (await client.power(ref).catch((x: unknown) => x)) as AzureError;
      expect(e).toMatchObject({ kind: "not_signed_in", status: 403 });
      // Nothing of the header is kept or logged; the log keeps its one code word.
      expect(JSON.stringify(logs) + e.message).not.toMatch(/principal|login\.microsoftonline/);
      expect(logs.at(-1)).toMatchObject({ op: "instanceView", status: 403, kind: "none" });
    });
  for (const code of ["InvalidAuthenticationToken", "InvalidAuthenticationTokenTenant", "ExpiredAuthenticationToken"])
    it(`a 403 with Azure's token code ${code} is not_signed_in`, async () => {
      await expect(fake(() => json(403, { error: { code, message: "x" } })).client.power(ref)).rejects.toMatchObject({ kind: "not_signed_in" });
    });
  it("production's 403 (no body, no code) and AuthorizationFailed stay refusals, each with Azure's code on the error", async () => {
    await expect(fake(() => new Response(null, { status: 403 })).client.power(ref)).rejects.toMatchObject({ kind: "forbidden", code: "" });
    await expect(fake(() => json(403, { error: { code: "AuthorizationFailed", message: "x" } })).client.power(ref)).rejects.toMatchObject({ kind: "forbidden", code: "AuthorizationFailed" });
    // A challenge that names no token (insufficient_scope) is a no, not a sign-in.
    await expect(fake(() => challenge("insufficient_scope")).client.power(ref)).rejects.toMatchObject({ kind: "forbidden" });
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
});

describe("the allowlist (D475, VM-2): reads, start and deallocate, nothing else, refused before anything is sent", () => {
  const SCHED = `${ARM}/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.DevTestLab/schedules/shutdown-computevm-vm-pat-01`;
  const v = `?api-version=${API.schedules}`;
  const c = `?api-version=${API.compute}`;

  it("allows exactly: Resource Graph query, read the VM, its instance view, its schedule, start, deallocate, and their progress", () => {
    expect(ALLOWED.map((r) => `${r.method} ${r.call}`)).toEqual(["POST find", "GET read", "GET instanceView", "POST start", "POST deallocate", "GET operation", "GET scheduleRead"]);
    expect(allowedCall("POST", `${ARM}${ID}/deallocate${c}`)).toBe("deallocate");
    expect(allowedCall("POST", `${ARM}/providers/Microsoft.ResourceGraph/resources?api-version=${API.resourceGraph}`)).toBe("find");
    expect(allowedCall("GET", `${ARM}${ID}${c}`)).toBe("read");
    expect(allowedCall("GET", `${ARM}${ID}/instanceView${c}`)).toBe("instanceView");
    expect(allowedCall("GET", `${SCHED}${v}`)).toBe("scheduleRead");
    expect(allowedCall("POST", `${ARM}${ID}/start${c}`)).toBe("start");
    expect(allowedCall("GET", OP)).toBe("operation");
  });

  it("refuses every write to an auto-shutdown schedule: PUT, PATCH, DELETE and its POST actions", () => {
    for (const m of ["PUT", "PATCH", "DELETE", "POST"]) expect(allowedCall(m, `${SCHED}${v}`)).toBeNull();
    for (const action of ["execute", "retarget"]) for (const m of ["POST", "GET", "PUT"]) expect(allowedCall(m, `${SCHED}/${action}${v}`)).toBeNull();
    // Lab schedules, other schedule names, the schedules list, and the VM's own schedule child are refused too.
    expect(allowedCall("PUT", `${ARM}/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.DevTestLab/labs/lab/schedules/LabVmsShutdown${v}`)).toBeNull();
    expect(allowedCall("GET", `${ARM}/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.DevTestLab/schedules/other${v}`)).toBeNull();
    expect(allowedCall("GET", `${ARM}/subscriptions/${SUB}/providers/Microsoft.DevTestLab/schedules${v}`)).toBeNull();
  });

  it("refuses every other VM write and any other path or host", () => {
    // VM-2: power off without deallocating (it keeps billing), restart, delete and resize stay refused.
    for (const op of ["powerOff", "restart", "redeploy", "reimage", "runCommand", "generalize", "performMaintenance", "simulateEviction", "convertToManagedDisks", "vmSizes", "reapply", "installPatches", "capture"]) expect(allowedCall("POST", `${ARM}${ID}/${op}${c}`)).toBeNull();
    for (const op of ["powerOff", "restart", "deallocate", "start"]) for (const m of ["GET", "PUT", "PATCH", "DELETE"]) expect(allowedCall(m, `${ARM}${ID}/${op}${c}`)).toBeNull();
    for (const m of ["PUT", "PATCH", "DELETE"]) expect(allowedCall(m, `${ARM}${ID}${c}`)).toBeNull();
    expect(allowedCall("GET", `${ARM}${ID}/extensions/x${c}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}${ID}/../${ID.split("/").pop()}/start${c}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}${ID}%2Fstart${c}`)).toBeNull();
    expect(allowedCall("GET", `https://evil.example${ID}${c}`)).toBeNull();
    expect(allowedCall("GET", `${ARM}.evil.example${ID}${c}`)).toBeNull();
  });

  it("VM-2: deallocate only on a VM path, with no query parameter but api-version, and only on management.azure.com", () => {
    expect(allowedCall("POST", `${ARM}${ID}/deallocate${c}`)).toBe("deallocate");
    // Not on anything but a VM: a resource group, a subscription, a scale set, a schedule, a lab VM.
    expect(allowedCall("POST", `${ARM}/subscriptions/${SUB}/resourceGroups/rg-dev/deallocate${c}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}/subscriptions/${SUB}/deallocate${c}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachineScaleSets/ss/deallocate${c}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachineScaleSets/ss/virtualmachines/0/deallocate${c}`)).toBeNull();
    expect(allowedCall("POST", `${SCHED}/deallocate${v}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.DevTestLab/labs/lab/virtualmachines/vm/stop${v}`)).toBeNull();
    // No extra segment, no encoded slash or dot segment, no hibernate or forceDeallocate riding along, no other host.
    expect(allowedCall("POST", `${ARM}${ID}/deallocate/x${c}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}${ID}%2Fdeallocate${c}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}${ID}/x/../deallocate${c}`)).toBeNull();
    expect(allowedCall("POST", `${ARM}${ID}/deallocate${c}&hibernate=true`)).toBeNull();
    expect(allowedCall("POST", `${ARM}${ID}/deallocate${c}&forceDeallocate=true`)).toBeNull();
    expect(allowedCall("POST", `${ARM}${ID}/start${c}&x=1`)).toBeNull();
    expect(allowedCall("POST", `https://management.azure.com.evil.example${ID}/deallocate${c}`)).toBeNull();
    expect(allowedCall("POST", `http://management.azure.com${ID}/deallocate${c}`)).toBeNull();
    expect(allowedCall("POST", `https://user:pw@management.azure.com${ID}/deallocate${c}`)).toBeNull();
  });

  it("VM-2: every write to an auto-shutdown schedule stays refused, in any case and encoding", () => {
    const variants = [SCHED, SCHED.replace("DevTestLab", "devtestlab"), SCHED.replace("schedules", "SCHEDULES"), SCHED.replace("shutdown-computevm-", "Shutdown-ComputeVm-"), SCHED.replace("/schedules/", "/schedules%2F"), SCHED.replace("/schedules/", "/schedules%2\tF"), SCHED.replace("/schedules/", "/schedules%\n2f"), `${SCHED}/`, `${SCHED}/.`];
    for (const u of variants) for (const m of ["PUT", "PATCH", "DELETE", "POST", "MERGE"]) expect(allowedCall(m, `${u}${v}`)).toBeNull();
    for (const action of ["execute", "retarget", "deallocate", "start", "stop", "enable", "disable"]) for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(allowedCall(m, `${SCHED}/${action}${v}`)).toBeNull();
    // From the review: a tab or newline inside the VM path (dropped by URL parsing) never turns a read into another call.
    for (const u of [`${ARM}${ID}/deallo\tcate${c}`, `${ARM}${ID}%2\tF..%2\tFschedules${c}`]) for (const m of ["GET", "POST"]) expect(allowedCall(m, u)).toBeNull();
    // Reads of it are the only call on a schedule.
    expect(allowedCall("GET", `${SCHED}${v}`)).toBe("scheduleRead");
  });

  it("a refused call never asks for a token or sends anything", async () => {
    const { client, calls, tokens } = fake(() => json(200, {}));
    for (const m of ["PUT", "PATCH", "DELETE"]) await expect(client.request(m, `${SCHED}${v}`, { properties: { status: "Disabled" } })).rejects.toMatchObject({ kind: "refused" });
    await expect(client.request("POST", `${SCHED}/execute${v}`)).rejects.toMatchObject({ kind: "refused" });
    await expect(client.request("POST", `${ARM}${ID}/powerOff${c}`)).rejects.toMatchObject({ kind: "refused" });
    await expect(client.request("POST", `${ARM}${ID}/restart${c}`)).rejects.toMatchObject({ kind: "refused" });
    await expect(client.request("DELETE", `${ARM}${ID}${c}`)).rejects.toMatchObject({ kind: "refused" });
    await expect(client.request("PATCH", `${ARM}${ID}${c}`, { properties: { hardwareProfile: { vmSize: "Standard_B1s" } } })).rejects.toMatchObject({ kind: "refused" });
    await expect(client.request("POST", `${ARM}${ID}/deallocate${c}&hibernate=true`)).rejects.toMatchObject({ kind: "refused" });
    expect(calls).toEqual([]);
    expect(tokens.n).toBe(0);
    // The reads, start and (VM-2) deallocate still go out.
    await client.request("GET", `${SCHED}${v}`);
    await client.request("POST", `${ARM}${ID}/start${c}`);
    await client.request("POST", `${ARM}${ID}/deallocate${c}`);
    expect(calls.map((x) => x.method)).toEqual(["GET", "POST", "POST"]);
  });

  it("the client has no method that writes a schedule; its only writes are start and deallocate", () => {
    const { client } = fake(() => json(200, {}));
    expect(Object.keys(client).sort()).toEqual(["deallocate", "findVms", "getSchedule", "getVm", "operation", "power", "request", "start"]);
  });

  it("VM-2: deallocate POSTs with no body to the VM's deallocate; 202 gives the poll URL", async () => {
    const { client, calls } = fake(() => new Response(null, { status: 202, headers: { location: OP, "retry-after": "10" } }));
    const p = await client.deallocate(parseVmId(ID)!);
    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0]!.url).toBe(`${ARM}${ID}/deallocate${c}`);
    expect(p).toEqual({ url: OP, style: "location", retryAfterMs: 10_000 });
  });
});

// VM-7: a refused answer's line says its challenge, its failure cause and its body's shape, each one closed word, so
// the next stretch of refusals (VM-6's 403 with no code) can be explained from the logs. Nothing else of it is logged.
describe("VM-7: a refused answer's three closed words", () => {
  const no = (status: number, body: string | null, headers: Record<string, string> = {}) => () => new Response(body, { status, headers });
  const lineOf = async (answer: () => Response) => {
    const { client, logs } = fake(answer);
    await client.power(ref).catch(() => undefined);
    return logs.at(-1)!;
  };

  it("each challenge word from a Bearer WWW-Authenticate's error word; any other word or scheme is other; none without", () => {
    const bearer = (e: string) => `Bearer authorization_uri="https://login.example/x", error="${e}", error_description="made up"`;
    expect(challengeWord(bearer("invalid_token"))).toBe("invalid_token");
    expect(challengeWord(bearer("insufficient_claims"))).toBe("insufficient_claims");
    expect(challengeWord(bearer("insufficient_scope"))).toBe("insufficient_scope");
    expect(challengeWord('Bearer error=INVALID_TOKEN')).toBe("invalid_token");
    expect(challengeWord(bearer("something_new"))).toBe("other");
    expect(challengeWord('Basic realm="x", error="invalid_token"')).toBe("other");
    expect(challengeWord(null)).toBe("none");
    expect(challengeWord("")).toBe("none");
    expect(challengeWord('Bearer authorization_uri="https://login.example/x"')).toBe("none");
  });

  it("each cause word from x-ms-failure-cause; any other value is other; none without", () => {
    expect(causeWord("gateway")).toBe("gateway");
    expect(causeWord(" Service ")).toBe("service");
    expect(causeWord("network")).toBe("other");
    expect(causeWord(null)).toBe("none");
    expect(causeWord("")).toBe("none");
  });

  it("each body shape: JSON with Azure's code, JSON without one, not JSON, empty", () => {
    expect(bodyShape('{"error":{"code":"AuthorizationFailed","message":"x"}}')).toEqual({ body: "json_with_code", code: "AuthorizationFailed" });
    expect(bodyShape('{"error":{"message":"x"}}').body).toBe("json_no_code");
    expect(bodyShape('{"error":{"code":""}}').body).toBe("json_no_code");
    expect(bodyShape("[1,2]").body).toBe("json_no_code");
    expect(bodyShape("null").body).toBe("json_no_code");
    expect(bodyShape("<html>Forbidden</html>").body).toBe("not_json");
    expect(bodyShape("").body).toBe("empty");
    expect(bodyShape("  \n").body).toBe("empty");
  });

  it("a refused answer's line carries all three, from a made-up answer", async () => {
    expect(await lineOf(no(403, null))).toMatchObject({ op: "instanceView", status: 403, kind: "none", challenge: "none", cause: "none", body: "empty" });
    expect(await lineOf(no(403, '{"error":{"code":"AuthorizationFailed"}}', { "x-ms-failure-cause": "service" }))).toMatchObject({ kind: "AuthorizationFailed", challenge: "none", cause: "service", body: "json_with_code" });
    expect(await lineOf(no(401, "", { "www-authenticate": 'Bearer error="invalid_token"', "x-ms-failure-cause": "gateway" }))).toMatchObject({ status: 401, challenge: "invalid_token", cause: "gateway", body: "empty" });
    expect(await lineOf(no(403, "<html>no</html>", { "www-authenticate": 'Bearer error="insufficient_scope"', "x-ms-failure-cause": "elsewhere" }))).toMatchObject({ challenge: "insufficient_scope", cause: "other", body: "not_json" });
    expect(await lineOf(no(500, '{"error":{}}'))).toMatchObject({ status: 500, body: "json_no_code" });
  });

  it("a made-up token, id and address in a header or the body reach the line in no field", async () => {
    const TOK = "eyJmYWtlLXRva2Vu.made-up.sig";
    const OID = "00000000-0000-4000-8000-00000000beef";
    const ADDR = "203.0.113.7";
    const headers = {
      "www-authenticate": `Bearer authorization_uri="https://login.example/${OID}", error="${TOK}", error_description="principal ${OID} from ${ADDR}"`,
      "x-ms-failure-cause": `${ADDR} ${OID}`,
      "x-ms-request-id": OID,
      "x-ms-correlation-request-id": OID,
    };
    const body = JSON.stringify({ error: { code: `Bad ${TOK}`, message: `The client ${OID} at ${ADDR} with token ${TOK}`, target: OID } });
    const line = await lineOf(no(403, body, headers));
    expect(Object.keys(line).sort()).toEqual(["body", "cause", "challenge", "durationMs", "kind", "op", "source", "status"]);
    for (const [k, v] of Object.entries(line)) for (const bad of [TOK, OID, ADDR, "made-up", "principal", "login.example"]) expect(String(v), k).not.toContain(bad);
    expect(line).toMatchObject({ kind: "other", challenge: "other", cause: "other", body: "json_with_code" });
  });

  it("a yes logs none of the three", async () => {
    const { client, logs } = fake(() => json(200, { statuses: [{ code: "PowerState/running" }] }, { "x-ms-failure-cause": "service", "www-authenticate": 'Bearer error="invalid_token"' }));
    await client.power(ref);
    const line = logs.at(-1)!;
    expect(line).toMatchObject({ op: "instanceView", status: 200 });
    for (const k of ["challenge", "cause", "body", "kind"]) expect(line, k).not.toHaveProperty(k);
  });

  it("what each failure returns to the page is what it was on main", async () => {
    const errOf = async (answer: () => Response) => {
      const e = (await fake(answer).client.start(ref).catch((x: unknown) => x)) as AzureError;
      return { kind: e.kind, status: e.status, message: e.message, permission: e.permission ?? null, code: e.code ?? "" };
    };
    expect(await errOf(no(401, null))).toEqual({ kind: "not_signed_in", status: 401, message: "Azure didn't accept the sign-in. Sign in again", permission: null, code: "" });
    expect(await errOf(no(403, null))).toEqual({ kind: "forbidden", status: 403, message: "Azure says you don't have permission: Microsoft.Compute/virtualMachines/start/action", permission: "Microsoft.Compute/virtualMachines/start/action", code: "" });
    expect(await errOf(no(403, "<html>no</html>", { "x-ms-failure-cause": "gateway" }))).toMatchObject({ kind: "forbidden", code: "" });
    expect(await errOf(no(403, null, { "www-authenticate": 'Bearer error="insufficient_claims"' }))).toMatchObject({ kind: "not_signed_in", status: 403 });
    expect(await errOf(no(403, null, { "www-authenticate": 'Bearer error="insufficient_scope"' }))).toMatchObject({ kind: "forbidden" });
    expect(await errOf(no(403, '{"error":{"code":"ExpiredAuthenticationToken"}}'))).toMatchObject({ kind: "not_signed_in", code: "ExpiredAuthenticationToken" });
    expect(await errOf(no(404, '{"error":{"code":"ResourceNotFound"}}'))).toMatchObject({ kind: "not_found", message: "VM not found. It may have been deleted or moved" });
    expect(await errOf(no(429, ""))).toMatchObject({ kind: "throttled", message: "Azure is busy (throttled). Try again in a minute" });
    expect(await errOf(no(409, '{"error":{"code":"OperationNotAllowed"}}'))).toMatchObject({ kind: "failed", message: "Azure refused that right now (OperationNotAllowed). Another operation may be running" });
    expect(await errOf(no(500, "oops"))).toMatchObject({ kind: "failed", message: "Azure error (HTTP 500)" });
    expect(await errOf(no(502, '{"error":{"code":"BadGateway"}}', { "x-ms-failure-cause": "gateway" }))).toMatchObject({ kind: "failed", message: "Azure error (HTTP 502, BadGateway)" });
  });
});
