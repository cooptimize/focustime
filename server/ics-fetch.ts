// CAL-1: the one way FocusTime fetches a calendar link. https only, no redirects followed here (sources/ics/fetch.ts
// checks each hop), a 15 second timeout and a 5 MB cap. The SSRF guard is in the socket's own DNS lookup: every
// address a name resolves to is checked (sources/ics/link.ts blockedAddress) at connect time, so a name can't pass a
// check and then resolve somewhere private (DNS rebinding). Nothing here logs the link, a header or the body.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { IcsFetchError, type IcsGet } from "../sources/ics/fetch.ts";
import { blockedAddress, blockedHostName } from "../sources/ics/link.ts";

type Resolve = (host: string, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
const systemResolve: Resolve = (host, cb) => dnsLookup(host, { all: true, verbatim: true }, cb);

/** A lookup that refuses a name when any of its addresses is private, loopback, link-local or otherwise blocked. */
export function guardedLookup(resolve: Resolve = systemResolve): LookupFunction {
  return ((host: string, options: { all?: boolean } | number, cb: (...a: unknown[]) => void) => {
    const all = typeof options === "object" && !!options?.all;
    resolve(host, (err, addresses) => {
      if (err) return cb(err);
      if (!addresses.length || addresses.some((a) => blockedAddress(a.address))) {
        const e = Object.assign(new Error("blocked address"), { code: "EFOCUSTIMEBLOCKED" });
        return cb(e);
      }
      if (all) return cb(null, addresses);
      cb(null, addresses[0]!.address, addresses[0]!.family);
    });
  }) as LookupFunction;
}

/** Tests hand in a stand-in for https.request (no network); the app uses the real one. */
export function createIcsGet(o: { resolve?: Resolve; request?: typeof request } = {}): IcsGet {
  const lookup = guardedLookup(o.resolve);
  const send = o.request ?? request;
  return (url, headers, limits) =>
    new Promise((resolvePromise, reject) => {
      if (url.protocol !== "https:" || blockedHostName(url.hostname)) return reject(new IcsFetchError("blocked_address"));
      let settled = false;
      const done = (f: () => void) => {
        if (settled) return;
        settled = true;
        f();
      };
      const req = send(url, { method: "GET", headers, lookup, timeout: limits.timeoutMs, agent: false }, (res) => {
        const status = res.statusCode ?? 0;
        const h = (k: string) => {
          const v = res.headers[k];
          return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
        };
        const meta = { status, location: h("location"), etag: h("etag"), lastModified: h("last-modified"), contentType: h("content-type") };
        if (status < 200 || status >= 300) {
          res.resume();
          return done(() => resolvePromise({ ...meta, body: null }));
        }
        const declared = Number(h("content-length") ?? "0");
        if (declared > limits.maxBytes) {
          res.destroy();
          return done(() => reject(new IcsFetchError("too_large")));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > limits.maxBytes) {
            res.destroy();
            req.destroy();
            done(() => reject(new IcsFetchError("too_large")));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => done(() => resolvePromise({ ...meta, body: Buffer.concat(chunks).toString("utf8") })));
        res.on("error", () => done(() => reject(new IcsFetchError("network"))));
      });
      // The whole request, not only idle time, is capped.
      const timer = setTimeout(() => {
        req.destroy();
        done(() => reject(new IcsFetchError("timeout")));
      }, limits.timeoutMs);
      req.on("timeout", () => {
        req.destroy();
        done(() => reject(new IcsFetchError("timeout")));
      });
      req.on("error", (e: NodeJS.ErrnoException) => done(() => reject(new IcsFetchError(e.code === "EFOCUSTIMEBLOCKED" ? "blocked_address" : "network"))));
      req.on("close", () => clearTimeout(timer));
      req.end();
    });
}
