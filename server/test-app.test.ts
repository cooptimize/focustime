import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { startTestApp } from "./test-app.ts";

// HK-3: the live e2e tests hung in teardown: a page's timer call (notices, presence, the quiet refresh) was still being
// answered when the test closed the server, and server.close() waits for every connection with a request on it (Node
// closes only idle ones). Closing ends them too.
describe("the test app's close (HK-3)", () => {
  it("returns at once while a request is still being answered on a keep-alive connection", async () => {
    let started!: () => void;
    const answering = new Promise<void>((r) => (started = r));
    // A call that never answers, like a refresh waiting on a source.
    const app = await startTestApp({ ctx: () => (started(), new Promise<ActionContext>(() => {})) });
    const b = app.browser();
    const s = await b.signIn("user-a");
    const sock = connect(app.port, "127.0.0.1");
    sock.on("error", () => {});
    await new Promise((r) => sock.on("connect", r));
    const body = JSON.stringify({ action: "week.load", input: {} });
    sock.write(
      [
        "POST /api/action HTTP/1.1",
        `host: localhost:${app.port}`,
        `origin: ${app.publicUrl}`,
        "connection: keep-alive",
        "content-type: application/json",
        `cookie: ${[...b.jar].map(([k, v]) => `${k}=${v}`).join("; ")}`,
        `x-csrf: ${s.csrf}`,
        `content-length: ${Buffer.byteLength(body)}`,
        "",
        body,
      ].join("\r\n"),
    );
    await answering;
    const t0 = performance.now();
    const closed = await Promise.race([app.close().then(() => "closed"), new Promise((r) => setTimeout(() => r("hung"), 3000))]);
    sock.destroy();
    expect(closed).toBe("closed");
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
