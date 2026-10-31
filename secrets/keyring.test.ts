import { describe, expect, it } from "vitest";
import { getSecret, SecretError, type RunResult } from "./keyring.ts";

const SECRET = "FAKE-SECRET-7f3a9c1e";

function runner(result: RunResult | Error) {
  const seen: string[][] = [];
  const run = async (args: string[]) => {
    seen.push(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { run, seen };
}

describe("keyring", () => {
  it("looks up service coopilot by account and returns the secret without a trailing newline", async () => {
    const r = runner({ code: 0, stdout: `${SECRET}\n`, stderr: "" });
    expect(await getSecret("dataverse-client-secret", r.run)).toBe(SECRET);
    expect(r.seen).toEqual([["lookup", "service", "coopilot", "account", "dataverse-client-secret"]]);
  });

  it("only allows known accounts", async () => {
    const r = runner({ code: 0, stdout: SECRET, stderr: "" });
    await expect(getSecret("something-else" as never, r.run)).rejects.toThrow();
    expect(r.seen).toEqual([]);
  });

  it.each<[string, RunResult | Error, string]>([
    ["no entry", { code: 1, stdout: "", stderr: "" }, "not_found"],
    ["secret-tool missing", Object.assign(new Error("spawn secret-tool ENOENT"), { code: "ENOENT" }), "unavailable"],
    ["no Secret Service", { code: 1, stdout: "", stderr: "secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY" }, "unavailable"],
    ["locked and prompt dismissed", { code: 1, stdout: "", stderr: "secret-tool: Cannot create an item in a locked collection" }, "locked"],
  ])("%s → %s, with no secret material in the error", async (_label, result, kind) => {
    const err = await getSecret("dataverse-client-secret", runner(result).run).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecretError);
    expect((err as SecretError).kind).toBe(kind);
    expect(String(err)).not.toContain(SECRET);
  });
});
