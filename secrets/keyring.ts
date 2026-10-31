// Keyring access through Secret Service, via the system `secret-tool`.
// The only module that touches secrets. The secret arrives on stdout and is never put in argv,
// logged, cached or included in an error.
import { execFile } from "node:child_process";

export const KEYRING_SERVICE = "coopilot";
export type SecretAccount = "dataverse-client-secret";
const ACCOUNTS: readonly SecretAccount[] = ["dataverse-client-secret"];

export type SecretErrorKind = "not_found" | "unavailable" | "locked";

export class SecretError extends Error {
  readonly kind: SecretErrorKind;
  constructor(kind: SecretErrorKind) {
    super(`Secret storage: ${kind}`);
    this.name = "SecretError";
    this.kind = kind;
  }
}

export type RunResult = { code: number; stdout: string; stderr: string };
export type Runner = (args: string[]) => Promise<RunResult>;

const runSecretTool: Runner = (args) =>
  new Promise((resolve, reject) => {
    execFile("secret-tool", args, { timeout: 30_000, maxBuffer: 64 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return reject(error);
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });

export async function getSecret(account: SecretAccount, run: Runner = runSecretTool): Promise<string> {
  if (!ACCOUNTS.includes(account)) throw new Error("Unknown keyring account");
  let r: RunResult;
  try {
    r = await run(["lookup", "service", KEYRING_SERVICE, "account", account]);
  } catch {
    throw new SecretError("unavailable");
  }
  if (r.code === 0 && r.stdout.length > 0) return r.stdout.replace(/\r?\n$/, "");
  const err = r.stderr.toLowerCase();
  if (err.includes("locked") || err.includes("dismissed") || err.includes("prompt")) throw new SecretError("locked");
  if (err.trim() !== "") throw new SecretError("unavailable");
  throw new SecretError("not_found");
}
