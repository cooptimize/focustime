// The local host's sign-in redirect (A1): a one-shot listener on 127.0.0.1 (any free port) that takes the browser's
// return from the identity provider. Only a GET to / with our state and an allowed Host header is accepted; the page
// it answers with comes from the caller. Nothing here logs or keeps the code.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Loopback, LoopbackListener, LoopbackResult } from "../types.ts";

export function createLoopback(): Loopback {
  return {
    async listen(redirectHost): Promise<LoopbackListener> {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const port = (server.address() as AddressInfo).port;
      const allowedHosts = [`${redirectHost}:${port}`, `127.0.0.1:${port}`];
      return {
        redirectUri: `http://${redirectHost}:${port}/`,
        wait: (state, timeoutMs, page) =>
          new Promise<LoopbackResult>((resolve) => {
            const timer = setTimeout(() => resolve({ error: "timeout" }), timeoutMs);
            server.on("request", (req, res) => {
              const url = new URL(req.url ?? "/", "http://placeholder");
              if (!allowedHosts.includes(String(req.headers.host ?? "").toLowerCase())) {
                res.writeHead(403).end();
                return;
              }
              if (req.method !== "GET" || url.pathname !== "/" || url.searchParams.get("state") !== state) {
                res.writeHead(400, { "content-type": "text/plain" }).end("Unexpected request");
                return;
              }
              const code = url.searchParams.get("code");
              const error = url.searchParams.get("error");
              res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
              res.end(page(!!code));
              clearTimeout(timer);
              if (code) resolve({ code });
              else resolve({ error: error === "access_denied" ? "denied" : "failed" });
            });
          }),
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      };
    },
  };
}
