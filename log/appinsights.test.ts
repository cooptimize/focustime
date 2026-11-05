// A4, HK-1: telemetry to Application Insights carries only the closed fields, fixed names and operation ids. The
// redaction tests plant tokens, Authorization headers, PATs, chat text, raw bodies and a client's key everywhere a
// value could leak (records, operations, exception messages and stacks) and look for them in what was sent.
import { describe, expect, it } from "vitest";
import { appInsights, envelopeOf, parseConnectionString, span } from "./appinsights.ts";
import { clientRef, jobRunner, newOperation, noteCurrent, parseTraceparent, runInOperation, traceparentOf } from "./operation.ts";
import { ownFrames, redact } from "./redact.ts";
import { leaks, PLANTED } from "../test/planted.ts";

const CS = "InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://centralus-0.in.applicationinsights.azure.com/;LiveEndpoint=https://x/";

function capture() {
  const sent: unknown[][] = [];
  let answer = () => new Response("", { status: 200 });
  const fetch = (async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as unknown[]);
    return answer();
  }) as unknown as typeof globalThis.fetch;
  const lines: unknown[] = [];
  const t = appInsights({ connectionString: CS, next: (r) => lines.push(r), fetch, everyMs: 60_000, root: "/app" })!;
  return { t, sent, lines, answer: (f: () => Response) => void (answer = f), text: () => JSON.stringify(sent) };
}
type Env = { name: string; tags: Record<string, string>; data: { baseType: string; baseData: Record<string, unknown> } };

describe("Application Insights (A4, HK-1)", () => {
  it("reads the connection string, and refuses one that isn't", () => {
    expect(parseConnectionString(CS)).toEqual({ iKey: "00000000-0000-4000-8000-000000000001", url: "https://centralus-0.in.applicationinsights.azure.com/v2.1/track" });
    expect(parseConnectionString("nonsense")).toBeNull();
    expect(span(1234)).toBe("0.00:00:01.234");
    expect(span(90_061_001)).toBe("1.01:01:01.001");
  });

  it("a source call with a status is a dependency, the rest a trace; only the closed fields", () => {
    const d = envelopeOf({ source: "outlook", op: "events", status: 200, durationMs: 12, count: 3 }, "k", new Date(0), "focustime") as Env;
    expect(d.data.baseType).toBe("RemoteDependencyData");
    expect(d.data.baseData.properties).toEqual({ source: "outlook", op: "events", status: "200", count: "3" });
    const t = envelopeOf({ source: "plan", op: "scheduler", kind: "idle" }, "k", new Date(0), "focustime") as Env;
    expect(t.data.baseType).toBe("MessageData");
  });

  it("sends in batches, nothing when idle, and drops a failed batch without retrying; Status counts it", async () => {
    const c = capture();
    await c.t.flush();
    expect(c.sent).toHaveLength(0);
    c.t.request({ method: "POST", route: "/api/action", status: 200, durationMs: 5 });
    c.t.log({ source: "plan", op: "scheduler", kind: "idle" });
    await c.t.flush();
    expect(c.sent).toHaveLength(1);
    expect(c.text()).toContain("POST /api/action");
    c.answer(() => new Response("", { status: 500 }));
    c.t.log({ source: "plan", op: "x" });
    await c.t.flush();
    await c.t.flush();
    expect(c.sent).toHaveLength(2);
    expect(c.lines.at(-1)).toMatchObject({ op: "telemetry", kind: "dropped" });
    expect(c.t.status()).toMatchObject({ sent: 2, dropped: 1, refused: 0, lastProblem: { status: 500, items: 1 } });
    c.t.stop();
  });

  it("a 206 counts the refused items as refused, not sent", async () => {
    const c = capture();
    c.answer(() => new Response(JSON.stringify({ itemsReceived: 3, itemsAccepted: 1, errors: [{ index: 0, statusCode: 400 }, { index: 2, statusCode: 400 }] }), { status: 206 }));
    for (const op of ["a", "b", "c"]) c.t.log({ source: "plan", op });
    await c.t.flush();
    expect(c.t.status()).toMatchObject({ sent: 1, refused: 2, dropped: 0, lastProblem: { status: 206, items: 2 } });
    expect(c.lines.at(-1)).toMatchObject({ op: "telemetry", kind: "partial", count: 2 });
    c.t.stop();
  });

  it("a request's traces, dependencies and exception share its operation id; the request names its action", async () => {
    const c = capture();
    const caller = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const op = newOperation("request", "POST", { traceparent: caller });
    await runInOperation(op, async () => {
      noteCurrent({ name: "POST /api/action week.load", client: "Adatum" });
      c.t.log({ source: "devops", op: "wiql", status: 200, durationMs: 40 });
      c.t.log({ source: "server", op: "action", status: 200 });
      c.t.exception(new Error("boom"), "action");
    });
    c.t.request({ method: "POST", route: "/api/action", status: 200, durationMs: 50, op });
    await c.t.flush();
    const items = c.sent[0] as Env[];
    expect(items.map((i) => i.data.baseType)).toEqual(["RemoteDependencyData", "MessageData", "ExceptionData", "RequestData"]);
    expect(new Set(items.map((i) => i.tags["ai.operation.id"]))).toEqual(new Set(["0af7651916cd43dd8448eb211c80319c"]));
    const req = items[3]!;
    expect(req.data.baseData).toMatchObject({ id: op.spanId, name: "POST /api/action week.load", responseCode: "200", success: true });
    expect(req.tags["ai.operation.parentId"]).toBe("b7ad6b7169203331");
    for (const i of items.slice(0, 3)) expect(i.tags["ai.operation.parentId"]).toBe(op.spanId);
    expect((req.data.baseData.properties as Record<string, string>).client).toBe(clientRef("Adatum"));
    expect(c.text()).not.toContain("Adatum");
    c.t.stop();
  });

  it("a job run is its own operation with outcome, counts and flags; a throw is failed and an exception", async () => {
    const c = capture();
    const run = jobRunner({ done: c.t.job, onError: (e) => c.t.exception(e, "job") });
    await run("devops_check", { client: "Adatum" }, async (job) => {
      c.t.log({ source: "devops", op: "workitemsbatch", status: 200, durationMs: 9 });
      job.set({ name: "devops_reconcile", counts: { changed: 3, calls: 2 }, flags: { slowed: "no", note: "free text is dropped" } });
    });
    await expect(run("requests_poll", {}, async () => Promise.reject(new TypeError("x")))).rejects.toThrow(TypeError);
    await c.t.flush();
    const items = c.sent[0] as Env[];
    const jobs = items.filter((i) => i.data.baseType === "RequestData");
    expect(jobs.map((j) => [j.data.baseData.name, j.data.baseData.responseCode, j.data.baseData.success])).toEqual([["devops_reconcile", "ok", true], ["requests_poll", "failed", false]]);
    expect(jobs[0]!.data.baseData.measurements).toEqual({ changed: 3, calls: 2 });
    expect(jobs[0]!.data.baseData.properties).toEqual({ kind: "job", slowed: "no", client: clientRef("Adatum"), outcome: "ok" });
    // The dependency sits under its job; the second job is a different operation.
    expect(items[0]!.tags["ai.operation.id"]).toBe(jobs[0]!.tags["ai.operation.id"]);
    expect(jobs[1]!.tags["ai.operation.id"]).not.toBe(jobs[0]!.tags["ai.operation.id"]);
    const ex = items.find((i) => i.data.baseType === "ExceptionData")!;
    expect(ex.tags["ai.operation.id"]).toBe(jobs[1]!.tags["ai.operation.id"]);
    expect((ex.data.baseData.exceptions as { typeName: string }[])[0]!.typeName).toBe("TypeError");
    c.t.stop();
  });

  it("redaction: no planted token, header, PAT, chat text, body, address or client key reaches Application Insights", async () => {
    const c = capture();
    const run = jobRunner({ done: c.t.job, onError: (e) => c.t.exception(e, "job") });
    const message = `Graph said "${PLANTED.chat}" for ${PLANTED.email} in ${PLANTED.chatId}; Authorization: Bearer ${PLANTED.jwt}; pat=${PLANTED.pat}; client_secret=${PLANTED.secret}; body ${PLANTED.body} at https://dev.azure.com/contoso/_apis/wit/workitems?ids=1&token=${PLANTED.secret} for ${PLANTED.client}`;
    const op = newOperation("request", "POST");
    await runInOperation(op, async () => {
      noteCurrent({ name: "POST /api/action note.set", client: PLANTED.client });
      // A record that names its client by key, and a kind made of short words.
      c.t.log({ source: "devops", op: "items", count: 4, client: PLANTED.client });
      c.t.exception(new Error(message), "action");
      c.t.exception(message, "action");
    });
    c.t.request({ method: "POST", route: "/api/action", status: 500, durationMs: 3, op });
    await run("devops_check", { client: PLANTED.client }, async (job) => {
      job.set({ flags: { error: PLANTED.pat, [PLANTED.chat]: "yes" } });
      throw new Error(message);
    }).catch(() => undefined);
    await c.t.flush();
    const sent = c.text();
    expect(leaks(sent)).toEqual([]);
    // What a reader still gets: the type, the shape of the message, the ref.
    expect(sent).toContain("https://dev.azure.com/[path]");
    expect(sent).toContain("Authorization: [redacted]");
    expect(sent).toContain(clientRef(PLANTED.client));
    c.t.stop();
  });

  it("redact() and the stack: own frames only, no arguments; a message keeps its words", () => {
    expect(redact("DevOps answered 503 for item 4411")).toBe("DevOps answered 503 for item 4411");
    expect(redact(`token=${PLANTED.pat} and x-api-key: ${PLANTED.secret}`)).toBe("token=[redacted] and x-api-key: [redacted]");
    expect(redact("word ".repeat(100))).toHaveLength(200);
    const stack = ["Error: boom", "    at run (/app/actions/devops-poll.ts:380:11)", "    at async Promise.all (index 0)", "    at Object.fetch (/app/node_modules/mssql/lib/x.js:1:1)", "    at node:internal/process/task_queues:105:5", "    at file:///app/server/main.ts:12:3"].join("\n");
    expect(ownFrames(stack, "/app")).toEqual([
      { level: 0, method: "run", fileName: "actions/devops-poll.ts", line: 380, assembly: "focustime" },
      { level: 1, method: "<anonymous>", fileName: "server/main.ts", line: 12, assembly: "focustime" },
    ]);
  });

  it("traceparent: a valid one is taken, anything else starts a new trace", () => {
    expect(parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")).toEqual({ traceId: "0af7651916cd43dd8448eb211c80319c", parentId: "b7ad6b7169203331" });
    for (const bad of ["", "00-00000000000000000000000000000000-b7ad6b7169203331-01", "ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", `00-${PLANTED.jwt}-01`]) expect(parseTraceparent(bad)).toBeNull();
    const op = newOperation("job", "x");
    expect(parseTraceparent(traceparentOf(op))).toEqual({ traceId: op.traceId, parentId: op.spanId });
    expect(clientRef("Adatum")).toMatch(/^c-[0-9a-f]{10}$/);
    expect(clientRef("Adatum")).toBe(clientRef("Adatum"));
  });
});
