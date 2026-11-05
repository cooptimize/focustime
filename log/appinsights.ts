// A4, HK-1: the hosted app's telemetry to Application Insights, without an SDK (no dependency; the closed fields are
// the redaction boundary). What is sent:
// - requests: "<METHOD> <route>" (a fixed route name), "POST /api/action <action>" for a registered action, status,
//   duration, and the client's ref when the action names one;
// - jobs (the DevOps check, the Teams poll, conversations upkeep, people refresh): one request item each run, marked
//   kind=job, with its outcome, counts (measurements) and short flags;
// - the logger's closed fields: a call to a source with a status is a dependency, the rest a trace;
// - exceptions: a 500 or an error a job throws: type, a redacted message (log/redact.ts) and frames in FocusTime's
//   own code only.
// Every item carries its operation's W3C ids (log/operation.ts), so traces, dependencies and exceptions sit under the
// request or job that made them. Never a path with ids, a query, a header, a body, a token, a person's id, message
// text or a client's key or name: there is no field for them, and a client key becomes its one-way ref.
// Nothing is sent when nothing happened (an idle server makes no calls). A failed send is dropped, never retried in a
// loop; a 206 with refused items counts those as refused. Both show in Admin › Status (status()).
import { randomUUID } from "node:crypto";
import type { LogRecord, Logger } from "./logger.ts";
import { clientRef, currentOperation, type Operation } from "./operation.ts";
import { ownFrames, redact, typeNameOf } from "./redact.ts";

export type RequestRecord = { method: string; route: string; status: number; durationMs: number; op?: Operation | undefined };

export type TelemetryStatus = {
  sent: number;
  /** Items in batches that never arrived (network error or a non-2xx answer), or that didn't fit the queue. */
  dropped: number;
  /** Items the service refused inside an accepted batch (a 206). */
  refused: number;
  lastProblem: { at: string; status: number | null; items: number } | null;
};

export type Telemetry = {
  log: Logger;
  request: (r: RequestRecord) => void;
  job: (op: Operation, durationMs: number) => void;
  exception: (e: unknown, where: string) => void;
  status: () => TelemetryStatus;
  flush: () => Promise<void>;
  stop: () => void;
};

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
  if (r.client !== undefined) out.client = clientRef(r.client);
  return out;
};

/** The operation tags of an item made inside `op`: its trace, its parent (the request's or job's span) and name. */
function opTags(role: string, op: Operation | undefined): Record<string, string> {
  const tags: Record<string, string> = { "ai.cloud.role": role };
  if (!op) return tags;
  tags["ai.operation.id"] = op.traceId;
  tags["ai.operation.parentId"] = op.spanId;
  tags["ai.operation.name"] = op.name;
  return tags;
}

/** One record as an envelope: a call to a source with a status is a dependency, the rest a trace. */
export function envelopeOf(r: LogRecord, iKey: string, at: Date, role: string, op: Operation | undefined = currentOperation()): object {
  const tags = opTags(role, op);
  const time = at.toISOString();
  const properties = props(r);
  if (op?.client && !properties.client) properties.client = clientRef(op.client);
  if (EXTERNAL.has(r.source) && r.status !== undefined && r.durationMs !== undefined) {
    const code = String(r.status);
    return {
      name: "Microsoft.ApplicationInsights.RemoteDependency",
      time,
      iKey,
      tags,
      data: { baseType: "RemoteDependencyData", baseData: { ver: 2, id: randomUUID(), name: `${r.source} ${r.op}`, type: "HTTP", target: r.source, resultCode: code, duration: span(r.durationMs), success: /^[23]/.test(code), properties } },
    };
  }
  return { name: "Microsoft.ApplicationInsights.Message", time, iKey, tags, data: { baseType: "MessageData", baseData: { ver: 2, message: `${r.source} ${r.op}`, severityLevel: r.kind?.includes("fail") || r.kind?.includes("error") ? 2 : 1, properties } } };
}

/** A finished request or job run as a request item: its own span id, the trace, the caller's span as parent. */
export function operationEnvelope(op: Operation, o: { iKey: string; role: string; at: Date; durationMs: number; code: string; success: boolean; extra?: Record<string, string> }): object {
  const tags: Record<string, string> = { "ai.cloud.role": o.role, "ai.operation.id": op.traceId, "ai.operation.name": op.name };
  if (op.parentId) tags["ai.operation.parentId"] = op.parentId;
  const properties: Record<string, string> = { kind: op.kind, ...op.flags, ...o.extra };
  if (op.client) properties.client = clientRef(op.client);
  if (op.outcome) properties.outcome = op.outcome;
  return {
    name: "Microsoft.ApplicationInsights.Request",
    time: new Date(o.at.getTime() - o.durationMs).toISOString(),
    iKey: o.iKey,
    tags,
    data: { baseType: "RequestData", baseData: { ver: 2, id: op.spanId, name: op.name, duration: span(o.durationMs), responseCode: o.code, success: o.success, properties, ...(Object.keys(op.counts).length ? { measurements: { ...op.counts } } : {}) } },
  };
}

/** An error as an exception item: its type, a redacted message, frames under `root` only. */
export function exceptionEnvelope(e: unknown, o: { iKey: string; role: string; at: Date; where: string; root: string; known?: Iterable<string>; op?: Operation | undefined }): object {
  const op = o.op;
  const message = redact(e instanceof Error ? e.message : typeof e === "string" ? e : "", o.known);
  const frames = ownFrames(e instanceof Error ? e.stack : undefined, o.root);
  const properties: Record<string, string> = { where: /^[a-z0-9_.-]{1,40}$/i.test(o.where) ? o.where : "unknown" };
  if (op?.client) properties.client = clientRef(op.client);
  return {
    name: "Microsoft.ApplicationInsights.Exception",
    time: o.at.toISOString(),
    iKey: o.iKey,
    tags: opTags(o.role, op),
    data: { baseType: "ExceptionData", baseData: { ver: 2, severityLevel: 3, exceptions: [{ id: 1, outerId: 0, typeName: typeNameOf(e), message: message || typeNameOf(e), hasFullStack: frames.length > 0, ...(frames.length ? { parsedStack: frames } : {}) }], properties } },
  };
}

/** The ingestion service's answer: items refused inside a batch it took (206), by index; 0 when it took them all. */
async function refusedOf(r: Response): Promise<number> {
  if (r.status !== 206) return 0;
  try {
    const b = (await r.json()) as { itemsReceived?: number; itemsAccepted?: number; errors?: unknown[] };
    if (Array.isArray(b.errors)) return b.errors.length;
    return Math.max(0, (b.itemsReceived ?? 0) - (b.itemsAccepted ?? 0));
  } catch {
    return 0;
  }
}

export function appInsights(o: {
  connectionString: string;
  next: Logger;
  role?: string;
  fetch?: typeof fetch;
  everyMs?: number;
  max?: number;
  /** Where FocusTime's own code is (exception frames below it are kept, the rest dropped). */
  root?: string;
  now?: () => Date;
}): Telemetry | null {
  const cfg = parseConnectionString(o.connectionString);
  if (!cfg) return null;
  const f = o.fetch ?? fetch;
  const role = o.role ?? "focustime";
  const max = o.max ?? 200;
  const root = o.root ?? process.cwd();
  const now = o.now ?? (() => new Date());
  /** Client keys seen in records and operations: taken out of exception messages. */
  const known = new Set<string>();
  const learn = (k: string | null | undefined) => {
    if (k && known.size < 500) known.add(k);
  };
  const st: TelemetryStatus = { sent: 0, dropped: 0, refused: 0, lastProblem: null };
  let queue: object[] = [];
  const push = (e: object) => {
    if (queue.length < 2000) queue.push(e);
    else st.dropped++;
    if (queue.length >= max) void flush();
  };
  async function flush(): Promise<void> {
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    try {
      const r = await f(cfg!.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch) });
      if (!r.ok) {
        st.dropped += batch.length;
        st.lastProblem = { at: now().toISOString(), status: r.status, items: batch.length };
        o.next({ source: "server", op: "telemetry", status: r.status, count: batch.length, kind: "dropped" });
        return;
      }
      const refused = await refusedOf(r);
      st.sent += batch.length - refused;
      if (refused) {
        st.refused += refused;
        st.lastProblem = { at: now().toISOString(), status: r.status, items: refused };
        o.next({ source: "server", op: "telemetry", status: r.status, count: refused, kind: "partial" });
      }
    } catch {
      st.dropped += batch.length;
      st.lastProblem = { at: now().toISOString(), status: null, items: batch.length };
      o.next({ source: "server", op: "telemetry", count: batch.length, kind: "dropped" });
    }
  }
  const timer = setInterval(() => void flush(), o.everyMs ?? 5_000);
  timer.unref();
  return {
    log: (r) => {
      o.next(r);
      if (r.op === "telemetry") return;
      learn(r.client);
      const op = currentOperation();
      learn(op?.client);
      push(envelopeOf(r, cfg.iKey, now(), role, op));
    },
    request: (r) => {
      const op = r.op;
      if (!op) {
        push({
          name: "Microsoft.ApplicationInsights.Request",
          time: new Date(now().getTime() - r.durationMs).toISOString(),
          iKey: cfg.iKey,
          tags: { "ai.cloud.role": role, "ai.operation.name": `${r.method} ${r.route}` },
          data: { baseType: "RequestData", baseData: { ver: 2, id: randomUUID(), name: `${r.method} ${r.route}`, duration: span(r.durationMs), responseCode: String(r.status), success: r.status < 400 || r.status === 401, properties: {} } },
        });
        return;
      }
      learn(op.client);
      push(operationEnvelope(op, { iKey: cfg.iKey, role, at: now(), durationMs: r.durationMs, code: String(r.status), success: r.status < 400 || r.status === 401, extra: { route: r.route } }));
    },
    job: (op, durationMs) => {
      learn(op.client);
      const outcome = op.outcome ?? "ok";
      push(operationEnvelope(op, { iKey: cfg.iKey, role, at: now(), durationMs, code: outcome, success: outcome !== "failed" }));
    },
    exception: (e, where) => {
      o.next({ source: "server", op: "exception", kind: where });
      const op = currentOperation();
      learn(op?.client);
      push(exceptionEnvelope(e, { iKey: cfg.iKey, role, at: now(), where, root, known, op }));
    },
    status: () => ({ ...st, lastProblem: st.lastProblem && { ...st.lastProblem } }),
    flush,
    stop: () => clearInterval(timer),
  };
}
