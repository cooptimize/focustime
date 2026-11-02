// Profile photo cache (step 16.4): ~/.cache/coopilot/photos, one small image per person plus when it was read (or
// that there is none), kept 7 days and refreshed in the background. File names are a hash of the Entra object ID, so
// the folder names no one. Never in the plan store; cleared on sign-out. Nothing here logs.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type CachedPhoto = { fetchedAt: string; photo: { type: string; bytes: Uint8Array } | null };
export type PhotoCache = {
  read(id: string): Promise<CachedPhoto | null>;
  write(id: string, entry: CachedPhoto): Promise<void>;
  clear(): Promise<void>;
};

const TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function createPhotoCache(root: string): PhotoCache {
  const dir = join(root, "photos");
  const key = (id: string) => createHash("sha256").update(`coopilot-photo:${id.toLowerCase()}`).digest("hex").slice(0, 40);
  const put = async (path: string, data: string | Uint8Array) => {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, path);
  };
  return {
    async read(id) {
      try {
        const k = key(id);
        const meta = JSON.parse(await readFile(join(dir, `${k}.json`), "utf8")) as { fetchedAt?: unknown; type?: unknown };
        if (typeof meta.fetchedAt !== "string") return null;
        if (meta.type === null) return { fetchedAt: meta.fetchedAt, photo: null };
        if (typeof meta.type !== "string" || !TYPES.has(meta.type)) return null;
        const bytes = new Uint8Array(await readFile(join(dir, `${k}.img`)));
        return bytes.length ? { fetchedAt: meta.fetchedAt, photo: { type: meta.type, bytes } } : null;
      } catch {
        return null;
      }
    },
    async write(id, entry) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const k = key(id);
      if (entry.photo) await put(join(dir, `${k}.img`), entry.photo.bytes);
      else await rm(join(dir, `${k}.img`), { force: true });
      await put(join(dir, `${k}.json`), JSON.stringify({ fetchedAt: entry.fetchedAt, type: entry.photo?.type ?? null }));
    },
    async clear() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
