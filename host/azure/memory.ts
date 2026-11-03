// The hosted app's settings-file and cache parts (no-demo-leak: these replaced the test fakes it was built with).
// - No settings file: per-person settings are rows in the plan store (A2), so there is nothing to seed from and nothing
//   to write here. load() is the plain starter (no clients), only for what sign-in reads before a person's rows exist.
// - Source snapshots and photos are caches for this revision: lost on a restart, after which the sources are read again.
//   They never stand in for data a source didn't give.
import { parseConfig } from "../../config/schema.ts";
import { starterToml } from "../../config/starter.ts";
import type { CachedPhoto, HostConfig, PhotoCache, Snapshot, SnapshotStore } from "../types.ts";

export function noSettingsFile(): HostConfig {
  const refuse = () => {
    throw new Error("The hosted app has no settings file: settings are each person's, in the plan store");
  };
  return {
    app: async () => null,
    load: async () => ({ path: "none (hosted)", parsed: parseConfig(starterToml("UTC")) }),
    raw: async () => null,
    write: async () => refuse(),
    saveSystemUserId: async () => refuse(),
  };
}

export function snapshotCache(): SnapshotStore {
  const data = new Map<string, unknown>();
  return {
    read: async <T,>(source: string, key: string) => (structuredClone(data.get(`${source}/${key}`)) as Snapshot<T> | undefined) ?? null,
    write: async (source, key, snap) => void data.set(`${source}/${key}`, structuredClone(snap)),
    clear: async (source) => {
      for (const k of [...data.keys()]) if (k.startsWith(`${source}/`)) data.delete(k);
    },
  };
}

export function photoCache(): PhotoCache {
  const data = new Map<string, CachedPhoto>();
  return { read: async (id) => data.get(id) ?? null, write: async (id, e) => void data.set(id, e), clear: async () => data.clear() };
}
