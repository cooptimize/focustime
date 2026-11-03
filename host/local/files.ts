// The local host's own files (A1): the plan store's private folder and file modes, plan exports, the demo flag.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HostFiles, HostPaths, StoreFiles } from "../types.ts";

export const localStoreFiles: StoreFiles = {
  prepare: (path) => void mkdirSync(dirname(path), { recursive: true, mode: 0o700 }),
  secure: (path) => chmodSync(path, 0o600),
};

/** Where a plan export goes: <data>/exports/plan-<stamp>.json. */
export const exportPath = (dataDir: string, stamp: string) => join(dataDir, "exports", `plan-${stamp.replace(/[^0-9TZ]/g, "")}.json`);

export function localFiles(paths: HostPaths): HostFiles {
  // Demo mode (D272): a flag file next to the plan store.
  const flag = join(dirname(paths.planDb), "demo-mode");
  return {
    store: localStoreFiles,
    exportPlan: async (json) => {
      const out = exportPath(dirname(paths.planDb), new Date().toISOString());
      await mkdir(dirname(out), { recursive: true, mode: 0o700 });
      await writeFile(out, json, { mode: 0o600 });
      await chmod(out, 0o600);
      return out;
    },
    demoFlag: {
      get: () => existsSync(flag),
      set: async (on) => {
        if (!on) return void (await rm(flag, { force: true }));
        await mkdir(dirname(flag), { recursive: true, mode: 0o700 });
        await writeFile(flag, "on\n", { mode: 0o600 });
      },
    },
  };
}
