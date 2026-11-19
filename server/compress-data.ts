// PF-2 (C): data answers compressed, only for a short named list of large reads, and never anything that carries a
// token, a session, a sign-in step, a key or another secret. The decision is made in one place, where the server
// writes a JSON answer (server/app.ts's `json`), from the action the request named: a route or action that is not on
// the list below is never compressed, so a new one is safe by default.
//
// Each answer is compressed for that answer only and not kept: no cache of compressed data exists here, and a copy of
// a client's code (Code's reads) is zeroed once it has been written (the Code rules: nothing of a client's code kept).
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { pickEncoding, type Encoding } from "./static-files.ts";

/**
 * The large reads, by action. The week, Backlog, Status, the Inbox's lists, and Code's listings and files. The Guide's
 * and the technical docs' text come with the app's files (compressed there), not from the server.
 */
export const COMPRESSED_READS: ReadonlySet<string> = new Set([
  // The week (Today and Week read it; the week's plan for Week › Plan).
  "week.load",
  "weekplan.load",
  // Backlog (Ahead's grid, Gantt and gaps) and its roadmap.
  "ahead.load",
  "roadmap.load",
  // Status.
  "status.load",
  // The Inbox's lists.
  "inbox.list",
  "conversations.list",
  "my_promises.list",
  "followups.list",
  // Code's listings and files (a client's code: compressed for the one answer, never kept).
  "code.clients",
  "code.repos",
  "code.folder",
  "code.find",
  "code.kinds",
  "code.search",
  "code.inside",
  "code.inner",
  "code.branches",
  "code.file",
]);

/**
 * Kinds of answer that are never compressed, whatever their size, even if someone adds them to the list: anything with
 * a token, a session, a sign-in or sign-out step, a key or another secret in its body (a compressed secret beside text
 * an attacker chooses is what BREACH-style attacks read). Each has a test that fails if it is put on the list.
 */
export const NEVER_COMPRESSED: readonly { kind: string; example: string; test: (action: string) => boolean }[] = [
  { kind: "sign-in and sign-out (auth.*: sign-in addresses with their state, the account, connect steps)", example: "auth.sign_in", test: (a) => a.startsWith("auth.") },
  { kind: "push (the server's public key and this device's subscription)", example: "push.status", test: (a) => a.startsWith("push.") },
  { kind: "DevOps write PATs (set, clear, the write status)", example: "devops.set_write_pat", test: (a) => /^devops\.(set_write_pat|clear_write_pat|write_status)$/.test(a) },
  { kind: "calendar links (a private calendar address is a secret)", example: "calendar_link.list", test: (a) => a.startsWith("calendar_link.") },
  { kind: "settings (where each secret's state is shown and set)", example: "settings.load", test: (a) => a.startsWith("settings.") },
];

/** True when this action's answer may be compressed: on the list and of no never-compressed kind. */
export function onCompressedList(action: unknown): action is string {
  return typeof action === "string" && COMPRESSED_READS.has(action) && !NEVER_COMPRESSED.some((k) => k.test(action));
}

/** Under this a data answer is sent as it is. */
export const MIN_DATA_BYTES = 1024;
/** Brotli 4: about 11 ms for a 1 MB answer on the dev machine, within 7% of Brotli 5's size; gzip 6 for the rest. */
const BROTLI_QUALITY = 4;
const GZIP_LEVEL = 6;
const br = promisify(brotliCompress);
const gz = promisify(gzip);

/** PF-2 tests: how many data answers were compressed (none kept). */
export const dataWork = { compressed: 0, lastMs: 0 };

/**
 * A JSON answer's body and encoding. `read` is the action named by an /api/action call, else absent; anything with
 * cookies to set is never compressed (a session or sign-in step). Throws nothing: on any failure the plain body.
 */
export async function dataBody(req: IncomingMessage, json: string, o: { read?: unknown; cookies: boolean }): Promise<{ body: Buffer; encoding: Encoding | null; varies: boolean }> {
  const plain = Buffer.from(json);
  if (o.cookies || !onCompressedList(o.read)) return { body: plain, encoding: null, varies: false };
  const accept = req.headers["accept-encoding"];
  const enc = plain.length >= MIN_DATA_BYTES ? pickEncoding(Array.isArray(accept) ? accept.join(",") : accept, { br: true, gzip: true }) : null;
  if (!enc) return { body: plain, encoding: null, varies: true };
  const started = performance.now();
  try {
    const body = enc === "br" ? await br(plain, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT, [constants.BROTLI_PARAM_SIZE_HINT]: plain.length } }) : await gz(plain, { level: GZIP_LEVEL });
    dataWork.compressed++;
    dataWork.lastMs = performance.now() - started;
    // A client's code: the plain copy goes now; the compressed one once written (writeJson zeroes it).
    if (o.read.startsWith("code.")) plain.fill(0);
    return { body, encoding: enc, varies: true };
  } catch {
    return { body: plain, encoding: null, varies: true };
  }
}

/**
 * Every JSON answer the server gives is written here (server/app.ts's `json`). Compressed only when `read` names an
 * action on the list and no cookie is set (never a session or sign-in step); every route that doesn't pass `read` goes
 * plain. Always with its length. What is sent of a client's code is zeroed once written (or the connection closes).
 */
export async function writeJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, cookies: string[] = [], read?: unknown): Promise<void> {
  const out = await dataBody(req, JSON.stringify(body), { read, cookies: cookies.length > 0 });
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "content-length": out.body.length,
    ...(out.varies ? { vary: "Accept-Encoding" } : {}),
    ...(out.encoding ? { "content-encoding": out.encoding } : {}),
    ...(cookies.length ? { "set-cookie": cookies } : {}),
  });
  // A client's code, compressed or not: the bytes sent are zeroed once written, or when the connection closes first.
  const code = typeof read === "string" && read.startsWith("code.");
  if (code) res.once("close", () => void out.body.fill(0));
  res.end(out.body, code ? () => void out.body.fill(0) : undefined);
}
