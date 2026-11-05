// HK-1: telemetry from a real request through the server. A signed-in POST to /api/action carries an Authorization
// header, a token in the query, a traceparent and chat text in its body, and the person's context throws an error full
// of secrets; a 500 does the same. What reaches Application Insights names the route and the action, links to the
// caller's trace, has the exception with its type, and none of the planted values.
import { afterEach, describe, expect, it } from "vitest";
import { appInsights } from "../log/appinsights.ts";
import { clientRef } from "../log/operation.ts";
import { leaks, PLANTED } from "../test/planted.ts";
import { startTestApp } from "./test-app.ts";

const CS = "InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://example.in.applicationinsights.azure.com/";
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
});
type Env = { tags: Record<string, string>; data: { baseType: string; baseData: Record<string, unknown> } };

describe("telemetry through the server (HK-1)", () => {
  it("names the action, links the trace, reports the exception, and leaks nothing planted", async () => {
    const sent: unknown[][] = [];
    const fetch = (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body)) as unknown[]), new Response("", { status: 200 }))) as unknown as typeof globalThis.fetch;
    const t = appInsights({ connectionString: CS, next: () => {}, fetch, everyMs: 60_000, root: process.cwd() })!;
    const secretError = `no context: "${PLANTED.chat}" Authorization: Bearer ${PLANTED.jwt} pat ${PLANTED.pat} for ${PLANTED.client} (${PLANTED.email})`;
    const app = await startTestApp({
      ctx: () => {
        throw new Error(secretError);
      },
      log: t.log,
      extra: { onRequest: t.request, onError: t.exception },
    });
    stops.push(app.close, async () => t.stop());
    const b = app.browser();
    await b.signIn("oid-ana");
    const caller = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const r = await b.post(`/api/action?token=${PLANTED.secret}`, { action: "note.set", input: { clientKey: PLANTED.client, date: "2026-11-02", note: PLANTED.chat, raw: PLANTED.body } }, { authorization: `Bearer ${PLANTED.jwt}`, traceparent: caller, "x-devops-pat": PLANTED.pat });
    expect(r.status).toBe(400);
    // A path the server doesn't know with secrets in it: a fixed route name only.
    await b.send(`/api/${PLANTED.pat}/${encodeURIComponent(PLANTED.email)}?q=${encodeURIComponent(PLANTED.chat)}`);
    await t.flush();
    const items = sent.flat() as Env[];
    const req = items.find((i) => i.data.baseType === "RequestData" && String(i.data.baseData.name).includes("note.set"))!;
    expect(req.data.baseData).toMatchObject({ name: "POST /api/action note.set", responseCode: "400" });
    expect(req.tags["ai.operation.id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(req.tags["ai.operation.parentId"]).toBe("00f067aa0ba902b7");
    expect((req.data.baseData.properties as Record<string, string>).client).toBe(clientRef(PLANTED.client));
    const ex = items.find((i) => i.data.baseType === "ExceptionData")!;
    expect(ex.tags["ai.operation.id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    const [first] = ex.data.baseData.exceptions as { typeName: string; message: string; parsedStack?: { fileName: string }[] }[];
    expect(first!.typeName).toBe("Error");
    expect(first!.message).toContain("Authorization: [redacted]");
    expect(first!.parsedStack?.every((f) => !f.fileName.startsWith("/") && !f.fileName.includes("node_modules"))).toBe(true);
    expect(first!.parsedStack?.some((f) => f.fileName === "server/telemetry.test.ts")).toBe(true);
    const text = JSON.stringify(sent);
    expect(leaks(text)).toEqual([]);
    expect(text).not.toContain("oid-ana");
  });
});
