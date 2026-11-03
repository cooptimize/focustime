// Structured logging with a closed set of fields: source, operation, status, duration, count, kind.
// There is deliberately no field for headers, bodies, tokens or free-form objects.
export type LogRecord = {
  source: "dataverse" | "outlook" | "google" | "devops" | "azure" | "server" | "config" | "plan" | "auth";
  op: string;
  status?: number | string;
  durationMs?: number;
  count?: number;
  kind?: string;
};

export type Logger = (r: LogRecord) => void;

export const stderrLogger: Logger = (r) => {
  const parts = [new Date().toISOString(), r.source, r.op];
  if (r.status !== undefined) parts.push(`status=${r.status}`);
  if (r.durationMs !== undefined) parts.push(`ms=${Math.round(r.durationMs)}`);
  if (r.count !== undefined) parts.push(`count=${r.count}`);
  if (r.kind !== undefined) parts.push(`kind=${r.kind}`);
  process.stderr.write(parts.join(" ") + "\n");
};
