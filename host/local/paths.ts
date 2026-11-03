// The local host's folders (XDG): config, plan data, cache and the per-session runtime folder.
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { HostPaths } from "../types.ts";

export function localPaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): HostPaths {
  const data = join(env.XDG_DATA_HOME || join(home, ".local", "share"), "focustime");
  return {
    config: join(env.XDG_CONFIG_HOME || join(home, ".config"), "focustime", "config.toml"),
    data,
    cache: join(env.XDG_CACHE_HOME || join(home, ".cache"), "focustime"),
    runtime: join(env.XDG_RUNTIME_DIR || tmpdir(), "focustime"),
    // XDG data, not cache: it is the person's own data.
    planDb: join(data, "plan.db"),
  };
}
