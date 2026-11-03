// A4: the hosted app's telemetry to Application Insights, without an SDK: the logger's closed fields (source,
// operation, status, duration, count, kind) and finished requests (a fixed route name, status, duration) posted to the
// ingestion endpoint in batches. Never a path with ids, a query, a header, a body, a token or a person's id: there is no
// field for them. Nothing is sent when nothing happened (an idle server makes no calls), and a failed send is dropped,
// never retried in a loop.
import { randomUUID } from "node:crypto";
import type { LogRecord, Logger } from "./logger.ts";

export type Telemetry = { log: Logger; request: (r: { method: string; route: string; status: number; durationMs: number }) => void; flush: () => Promise<void>; stop: () => void };

const EXTERNAL = new Set(["dataverse", "outlook", "google", "devops", "azure"]);

/** "InstrumentationKey=…;IngestionEndpoint=https://…/" → the key and the track URL; null when it isn't one. */
export function parseConnectionString(s: string): { iKey: string; url: string } | null {
  const parts = Object.fromEntries(s.split(";").map((p) => p.split("=", 2) as [string, string]).filter((p) => p[0] && p[1]).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const iKey = parts.instrumentationkey;
  const endpoint = parts.ingestionendpoint ?? "https://dc.services.visualstudio.com/";
  if (!iKey || !/^[0-9a-f-]{36}$/i.test(iKey) || !/^https:\/\//.test(endpoint)) return null;
  return { iKey, url: `${endpoint.replace(/\/$/, "")}/v2.1/track` };
}

/** .NET TimeSpan text, as the ingestion API wants durations. */
export function span(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const d = Math.floor(t / 86_400_000);
  const h = Math.floor((t % 86_400_000) / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const sec = Math.floor((t % 60_000) / 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d}.${p(h)}:${p(m)}:${p(sec)}.${p(t % 1000, 3)}`;
}

const props = (r: LogRecord): Record<string, string> => {
  const out: Record<string, string> = { source: r.source, op: r.op };
  if (r.status !== undefined) out.status = String(r.status);
  if (r.count !== undefined) out.count = String(r.count);
  if (r.kind !== undefined) out.kind = r.kind;
  return out;
};

/** One record as an envelope: a call to a source with a status is a dependency, the rest a trace. */
export function envelopeOf(r: LogRecord, iKey: string, at: Date, role: string): object {
  const tags = { "ai.cloud.role": role };
  const time = at.toISOString();
  if (EXTERNAL.has(r.source) && r.status !== undefined && r.durationMs !== undefined) {
    const code = String(r.status);
    return {
      name: "Microsoft.ApplicationInsights.RemoteDependency",
      time,
      iKey,
      tags,
      data: { baseType: "RemoteDependencyData", baseData: { ver: 2, id: randomUUID(), name: `${r.source} ${r.op}`, type: "HTTP", target: r.source, resultCode: code, duration: span(r.durationMs), success: /^[23]/.test(code), properties: props(r) } },
    };
  }
  return { name: "Microsoft.ApplicationInsights.Message", time, iKey, tags, data: { baseType: "MessageData", baseData: { ver: 2, message: `${r.source} ${r.op}`, severityLevel: r.kind?.includes("fail") || r.kind?.includes("error") ? 2 : 1, properties: props(r) } } };
}

export function appInsights(o: { connectionString: string; next: Logger; role?: string; fetch?: typeof fetch; everyMs?: number; max?: number }): Telemetry | null {
  const cfg = parseConnectionString(o.connectionString);
  if (!cfg) return null;
  const f = o.fetch ?? fetch;
  const role = o.role ?? "focustime";
  const max = o.max ?? 200;
  let queue: object[] = [];
  const push = (e: object) => {
    if (queue.length < 2000) queue.push(e);
    if (queue.length >= max) void flush();
  };
  async function flush(): Promise<void> {
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    try {
      const r = await f(cfg!.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch) });
      if (!r.ok) o.next({ source: "server", op: "telemetry", status: r.status, count: batch.length, kind: "dropped" });
    } catch {
      o.next({ source: "server", op: "telemetry", count: batch.length, kind: "dropped" });
    }
  }
  const timer = setInterval(() => void flush(), o.everyMs ?? 5_000);
  timer.unref();
  return {
    log: (r) => {
      o.next(r);
      if (r.op === "telemetry") return;
      push(envelopeOf(r, cfg.iKey, new Date(), role));
    },
    request: (r) => {
      const code = String(r.status);
      push({
        name: "Microsoft.ApplicationInsights.Request",
        time: new Date(Date.now() - r.durationMs).toISOString(),
        iKey: cfg.iKey,
        tags: { "ai.cloud.role": role, "ai.operation.name": `${r.method} ${r.route}` },
        data: { baseType: "RequestData", baseData: { ver: 2, id: randomUUID(), name: `${r.method} ${r.route}`, duration: span(r.durationMs), responseCode: code, success: r.status < 400 || r.status === 401, properties: {} } },
      });
    },
    flush,
    stop: () => clearInterval(timer),
  };
}
