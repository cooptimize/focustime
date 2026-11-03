// S1 (D452): which build is running. Baked into the image at build time (Docker build args from the workflow, kept as
// FOCUSTIME_BUILD_SHA, FOCUSTIME_BUILD_PR and FOCUSTIME_BUILD_TIME), with the env label (local, dev, prod, demo) from
// runtime config (FOCUSTIME_ENV, set by the Bicep). A local run has no baked values: "local", the tree's short sha,
// PR "none". Only these four facts: no secrets, hostnames or user data. Served at /version and in ⋯ › About.

export const ENVS = ["local", "dev", "prod", "demo"] as const;
export type BuildEnv = (typeof ENVS)[number];
export type BuildInfo = { env: BuildEnv; pr: string; sha: string; builtAt: string | null };

/**
 * The PR number from a merge commit's message: GitHub's "(#12)" (squash) or "Merge pull request #12 from …" (merge
 * commit). Null when there is none (a direct push).
 */
export function prFromMessage(message: string): string | null {
  const first = message.split("\n")[0] ?? "";
  const merge = /^Merge pull request #(\d+)\b/.exec(first);
  if (merge) return merge[1]!;
  const squash = /\(#(\d+)\)\s*$/.exec(first);
  return squash ? squash[1]! : null;
}

const SHA = /^[0-9a-f]{7,40}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/;

/** The running build from its environment; `localSha` (the developer loop only) reads the source tree's commit. */
export function buildInfo(env: Record<string, string | undefined>, localSha: () => string | null = () => null): BuildInfo {
  const label = env.FOCUSTIME_ENV?.trim().toLowerCase();
  const baked = env.FOCUSTIME_BUILD_SHA?.trim().toLowerCase();
  const sha = baked && SHA.test(baked) ? baked.slice(0, 7) : (localSha()?.trim().toLowerCase() ?? "");
  const pr = env.FOCUSTIME_BUILD_PR?.trim();
  const at = env.FOCUSTIME_BUILD_TIME?.trim();
  return {
    env: (ENVS as readonly string[]).includes(label ?? "") ? (label as BuildEnv) : "local",
    pr: pr && /^\d+$/.test(pr) ? pr : "none",
    sha: SHA.test(sha) ? sha.slice(0, 7) : "unknown",
    builtAt: at && ISO.test(at) ? at : null,
  };
}
