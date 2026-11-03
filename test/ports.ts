// Free ports for tests that start a server (S1, D454). The OS hands out a free port (listen on 0), but a server that
// needs its port before it starts (the public URL is built from it) has to close that probe and listen again, and
// another test can take the port in between (E2's two demo servers on one port). onFreePort retries on a new port when
// that happens, so parallel runs never collide. Every e2e and app test starts its servers through here.
import { createServer } from "node:net";

/** A port the OS says is free right now. */
export const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (a && typeof a === "object" ? ok(a.port) : fail(new Error("no port"))));
    });
  });

/** True for "port already taken": the error code, or the server's own message for it. */
export const portTaken = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === "EADDRINUSE" || /EADDRINUSE|already running on port|address already in use/i.test(err?.message ?? String(e));
};

/** Starts something on a free port, trying a new port (up to `tries` times) when another test took it first. */
export async function onFreePort<T>(start: (port: number) => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    const port = await freePort();
    try {
      return await start(port);
    } catch (e) {
      if (i >= tries || !portTaken(e)) throw e;
    }
  }
}
