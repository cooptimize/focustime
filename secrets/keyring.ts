// Keyring access through Secret Service, via the system `secret-tool`.
// The only module that touches secrets. The secret arrives on stdout and is never put in argv,
// logged, cached or included in an error.
import { execFile } from "node:child_process";

export const KEYRING_SERVICE = "coopilot";
/** App secrets set up by Tanner outside Coopilot: read-only here. */
export type AppSecretAccount = "dataverse-client-secret" | "google-client-secret";
/** Refresh tokens Coopilot writes after sign-in and clears on disconnect. */
export type RefreshTokenAccount = "outlook-refresh-token" | "google-refresh-token";
export type SecretAccount = AppSecretAccount | RefreshTokenAccount;
const ACCOUNTS: readonly SecretAccount[] = ["dataverse-client-secret", "google-client-secret", "outlook-refresh-token", "google-refresh-token"];
const WRITABLE: readonly RefreshTokenAccount[] = ["outlook-refresh-token", "google-refresh-token"];

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
export type Runner = (args: string[], stdin?: string) => Promise<RunResult>;

const runSecretTool: Runner = (args, stdin) =>
  new Promise((resolve, reject) => {
    const child = execFile("secret-tool", args, { timeout: 30_000, maxBuffer: 64 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return reject(error);
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout, stderr });
    });
    // Secrets go in through stdin only, never argv.
    if (stdin !== undefined) child.stdin?.end(stdin);
    else child.stdin?.end();
  });

function failure(r: RunResult): SecretError {
  const err = r.stderr.toLowerCase();
  if (err.includes("locked") || err.includes("dismissed") || err.includes("prompt")) return new SecretError("locked");
  return new SecretError("unavailable");
}

export async function setSecret(account: RefreshTokenAccount, value: string, run: Runner = runSecretTool): Promise<void> {
  if (!WRITABLE.includes(account)) throw new Error("This keyring account is read-only for Coopilot");
  let r: RunResult;
  try {
    r = await run(["store", `--label=Coopilot ${account}`, "service", KEYRING_SERVICE, "account", account], value);
  } catch {
    throw new SecretError("unavailable");
  }
  if (r.code !== 0) throw failure(r);
}

/**
 * Stores an app client secret entered in Settings (step 6b): only the two app secret accounts, through stdin, never
 * argv. Replaces the entry when it exists (Settings asks to confirm first). The value is never returned or logged.
 */
export async function setAppSecret(account: AppSecretAccount, value: string, run: Runner = runSecretTool): Promise<void> {
  if (account !== "dataverse-client-secret" && account !== "google-client-secret") throw new Error("Not an app secret account");
  if (!value || value.length > 1024 || /[\r\n]/.test(value)) throw new Error("A secret is one line of 1 to 1024 characters");
  let r: RunResult;
  try {
    r = await run(["store", `--label=Coopilot ${account}`, "service", KEYRING_SERVICE, "account", account], value);
  } catch {
    throw new SecretError("unavailable");
  }
  if (r.code !== 0) throw failure(r);
}

/** Whether an account has an entry, without keeping its value: "set", "missing", or why the keyring can't say. */
export async function secretState(account: SecretAccount, run: Runner = runSecretTool): Promise<"set" | "missing" | "locked" | "unavailable"> {
  try {
    await getSecret(account, run);
    return "set";
  } catch (e) {
    if (e instanceof SecretError) return e.kind === "not_found" ? "missing" : e.kind;
    return "unavailable";
  }
}

export async function deleteSecret(account: RefreshTokenAccount, run: Runner = runSecretTool): Promise<void> {
  if (!WRITABLE.includes(account)) throw new Error("This keyring account is read-only for Coopilot");
  let r: RunResult;
  try {
    r = await run(["clear", "service", KEYRING_SERVICE, "account", account]);
  } catch {
    throw new SecretError("unavailable");
  }
  if (r.code !== 0 && r.stderr.trim() !== "") throw failure(r);
}

export async function getSecret(account: SecretAccount, run: Runner = runSecretTool): Promise<string> {
  if (!ACCOUNTS.includes(account)) throw new Error("Unknown keyring account");
  let r: RunResult;
  try {
    r = await run(["lookup", "service", KEYRING_SERVICE, "account", account]);
  } catch {
    throw new SecretError("unavailable");
  }
  if (r.code === 0 && r.stdout.length > 0) return r.stdout.replace(/\r?\n$/, "");
  if (r.stderr.trim() !== "") throw failure(r);
  throw new SecretError("not_found");
}
