// RB-1: the pure rules of reading a client's code: which paths a request may name, how a folder's entries are ordered,
// which files are shown as text, and the limits. No I/O; the reader (sources/devops/git.ts) and the actions
// (actions/code-actions.ts) both use these, and the UI reads the limits from here.

/** A file is shown as text up to this size. */
export const TEXT_MAX_BYTES = 1024 * 1024;
/** Find a file loads at most this many names, and says when the list was cut. */
export const FIND_MAX = 20_000;
/** A folder lists at most this many entries (folders first), and says when it was cut. */
export const FOLDER_MAX = 5_000;
/** Folder lists and file text may sit in the server's memory this long. */
export const CODE_MEMORY_MS = 5 * 60_000;
/** A path longer than this is refused (DevOps allows longer, but nothing a person clicks is). */
export const PATH_MAX = 1_024;

/** What happened, for the view log (C1). Opening and closing folders isn't logged. */
export const CODE_EVENTS = ["repo_opened", "file_opened", "find_used"] as const;
export type CodeEvent = (typeof CODE_EVENTS)[number];
export const CODE_EVENT_TEXT: Record<CodeEvent, string> = { repo_opened: "Repo opened", file_opened: "File opened", find_used: "Find used" };

/** B2: the per-client Rule "Who can read this client's code". */
export const CODE_ACCESS = ["company", "team"] as const;
export type CodeAccess = (typeof CODE_ACCESS)[number];
export const CODE_ACCESS_TEXT: Record<CodeAccess, string> = { company: "Whole company", team: "Client's team only" };

/** A repo id is a GUID (Azure DevOps names every repository by one). */
export const REPO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A path inside a repo as a request may name it: "/" or "/a/b.sql". It never leaves the repo (no "." or ".." part,
 * no backslash, no empty part), carries no control character, and is at most PATH_MAX long. Returns the path without
 * a trailing slash ("/" for the root), or null when it isn't one. It only ever travels as a query value.
 */
export function cleanPath(p: unknown): string | null {
  if (typeof p !== "string" || p.length === 0 || p.length > PATH_MAX || !p.startsWith("/")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return null;
  if (p === "/") return "/";
  const parts = (p.endsWith("/") ? p.slice(0, -1) : p).slice(1).split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return null;
  return `/${parts.join("/")}`;
}

/** The parts of a path, for breadcrumbs: "/a/b/c.sql" → ["a", "b", "c.sql"]. */
export const pathParts = (p: string): string[] => (p === "/" ? [] : p.slice(1).split("/"));
/** The folder a path is in ("/" for a file at the root). */
export const parentOf = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};
export const nameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** "refs/heads/main" → "main". Null for no branch. */
export const branchName = (ref: string | null | undefined): string | null => {
  if (!ref) return null;
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) || null : ref;
};

export type CodeEntry = { name: string; path: string; folder: boolean };
/** D3: folders first, then files, A to Z (case-insensitive, then exact, so the order is stable). */
export function sortEntries<E extends CodeEntry>(list: readonly E[]): E[] {
  return [...list].sort((a, b) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}

/** The first line of a Git LFS pointer file (git-lfs spec v1). Such a file is shown as it is, never resolved. */
const LFS_FIRST = "version https://git-lfs.github.com/spec/v1";
export const isLfsPointer = (text: string): boolean => text.length < 1024 && text.startsWith(LFS_FIRST);

/** File names that are images by their extension (shown as "an image", never drawn). */
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "tif", "tiff", "heic", "avif"]);
export const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

export type FileKind = "text" | "lfs" | "binary" | "image" | "too_large";
/** What the panel gets (shared with the UI): a repo in a client's list, and a file with its text or why there is none. */
export type CodeRepoView = { id: string; name: string; defaultBranch: string | null; state: "ok" | "empty" | "disabled" };
export type CodeFileView = { path: string; size: number | null; sizeText: string; kind: FileKind; text: string | null; devopsUrl: string | null };

/**
 * D4: what a file is shown as, from its name, DevOps's own content flags and its first bytes. Text up to
 * TEXT_MAX_BYTES; a binary file, an image or a larger file isn't shown. SVG is text (its source is shown, never drawn).
 * `bytes` is what was read (at most TEXT_MAX_BYTES + 1); `size` the whole size when DevOps said it.
 */
export function fileKind(i: { name: string; size: number | null; bytes: Uint8Array | null; isBinary?: boolean; isImage?: boolean }): FileKind {
  if (i.size !== null && i.size > TEXT_MAX_BYTES) return "too_large";
  const ext = extOf(i.name);
  if (ext !== "svg" && (i.isImage || IMAGE_EXT.has(ext))) return "image";
  if (!i.bytes) return "too_large";
  if (i.bytes.length > TEXT_MAX_BYTES) return "too_large";
  // A NUL in the first 8000 bytes (git's own test), or bytes that aren't UTF-8, make it binary.
  const head = i.bytes.subarray(0, 8000);
  if (head.includes(0)) return "binary";
  // DevOps's isBinary flag alone is not trusted: the bytes decide (a clean UTF-8 file is text).
  const text = decodeText(i.bytes);
  if (text === null) return "binary";
  return isLfsPointer(text) ? "lfs" : "text";
}

/** UTF-8 text without a byte order mark, or null when the bytes aren't UTF-8. */
export function decodeText(bytes: Uint8Array): string | null {
  try {
    const t = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return t;
  } catch {
    return null;
  }
}

/** "2.4 MB", "830 KB", "512 bytes": a file's size in plain words. */
export function sizeWords(n: number | null): string {
  if (n === null) return "size unknown";
  if (n < 1024) return `${n} byte${n === 1 ? "" : "s"}`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
