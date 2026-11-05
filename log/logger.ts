// Structured logging with a closed set of fields: source, operation, status, duration, count, kind, and (HK-1) the
// client a record is about. There is deliberately no field for headers, bodies, tokens or free-form objects.
import { clientRef } from "./operation.ts";

export type LogRecord = {
  source: "dataverse" | "outlook" | "google" | "devops" | "azure" | "server" | "config" | "plan" | "auth" | "database" | "ai";
  op: string;
  status?: number | string;
  durationMs?: number;
  count?: number;
  kind?: string;
  /** HK-1: a client key. Printed and sent only as its one-way ref (log/operation.ts clientRef), never as is. */
  client?: string;
};

export type Logger = (r: LogRecord) => void;

export const stderrLogger: Logger = (r) => {
  const parts = [new Date().toISOString(), r.source, r.op];
  if (r.status !== undefined) parts.push(`status=${r.status}`);
  if (r.durationMs !== undefined) parts.push(`ms=${Math.round(r.durationMs)}`);
  if (r.count !== undefined) parts.push(`count=${r.count}`);
  if (r.kind !== undefined) parts.push(`kind=${r.kind}`);
  if (r.client !== undefined) parts.push(`client=${clientRef(r.client)}`);
  process.stderr.write(parts.join(" ") + "\n");
};
