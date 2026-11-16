// CI-3: a step's screenshots on their own branch, never on main. Takes a folder of images and a step name, makes or
// updates the branch shots/<step> so that it holds exactly those images (the folder's layout kept), pushes it, and
// prints the lines to paste into the pull request body: each image by its raw address pinned to the new commit, so the
// pictures stay the same whatever is pushed to the branch later.
//
// It never touches the working tree, the index, HEAD or any other branch: the commit is built from git's objects with
// a throwaway index file (hash-object, update-index, write-tree, commit-tree), then pushed by its id. Updating the
// branch adds a commit on top of its tip (no force push), whose tree is only the images given now.
//
// Usage: node scripts/shots-branch.ts <folder> <step> [--remote origin] [--repo owner/name] [--no-push]
//   <step>       the step's code in lower case (ci3, nm2); the branch is shots/<step>
//   --remote     the remote to push to and read the branch from (origin)
//   --repo       owner/name for the raw addresses (read from the remote's URL by default)
//   --no-push    make the commit and print the lines, push nothing
// Demo data only: the repo is public, and nothing here can tell a real screen from a demo one.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { IMAGE_OR_VIDEO } from "./guards.ts";

export type ShotsResult = { branch: string; commit: string; files: string[]; lines: string[]; pushed: boolean };

const STEP = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** Every file under `dir`, as paths relative to it with forward slashes. */
function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, root) : [relative(root, p).split(sep).join("/")];
  });
}

/** owner/name from a GitHub remote URL (https or ssh), else null. */
export function repoFromUrl(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function shotsBranch(opts: { folder: string; step: string; cwd?: string; remote?: string; repo?: string; push?: boolean }): ShotsResult {
  const cwd = opts.cwd ?? process.cwd();
  const remote = opts.remote ?? "origin";
  const push = opts.push ?? true;
  if (!STEP.test(opts.step) || opts.step === "archive") throw new Error(`step must be a step's code in lower case, like ci3 (not "archive"): ${opts.step}`);
  const folder = resolve(cwd, opts.folder);
  const files = walk(folder).sort();
  if (!files.length) throw new Error(`no files in ${opts.folder}`);
  const notImages = files.filter((f) => !IMAGE_OR_VIDEO.test(f));
  if (notImages.length) throw new Error(`only images and videos go on a shots branch; not: ${notImages.join(", ")}`);
  const branch = `shots/${opts.step}`;
  const git = (args: string[], env: NodeJS.ProcessEnv = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();

  const remoteUrl = git(["remote", "get-url", remote]);
  const repo = opts.repo ?? repoFromUrl(remoteUrl);
  if (!repo) throw new Error(`can't tell owner/name from ${remote}'s URL; pass --repo owner/name`);

  // The branch's tip on the remote, if it exists, becomes the parent (fetched into FETCH_HEAD only, no local branch).
  const tip = git(["ls-remote", "--heads", remote, `refs/heads/${branch}`]).split(/\s+/)[0] || null;
  if (tip) git(["fetch", "-q", "--no-tags", remote, `refs/heads/${branch}`]);

  const tmp = mkdtempSync(join(tmpdir(), "shots-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(tmp, "index") };
    git(["read-tree", "--empty"], env);
    for (const f of files) {
      const blob = git(["hash-object", "-w", "--", join(folder, f)]);
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${f}`], env);
    }
    const tree = git(["write-tree"], env);
    const message = `${branch}: ${files.length} image${files.length === 1 ? "" : "s"} for ${opts.step.toUpperCase()}'s pull request (scripts/shots-branch.ts)`;
    const commit = git(["commit-tree", tree, ...(tip ? ["-p", tip] : []), "-m", message]);
    if (push) git(["push", "-q", remote, `${commit}:refs/heads/${branch}`]);
    const lines = files.map((f) => `![${f}](https://raw.githubusercontent.com/${repo}/${commit}/${f.split("/").map(encodeURIComponent).join("/")})`);
    return { branch, commit, files, lines, pushed: push };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const noPush = args.includes("--no-push");
  if (noPush) args.splice(args.indexOf("--no-push"), 1);
  const remote = flag("--remote");
  const repo = flag("--repo");
  const [folder, step] = args;
  if (!folder || !step) {
    console.error("usage: node scripts/shots-branch.ts <folder> <step> [--remote origin] [--repo owner/name] [--no-push]");
    process.exit(2);
  }
  try {
    const r = shotsBranch({ folder, step, ...(remote ? { remote } : {}), ...(repo ? { repo } : {}), push: !noPush });
    console.error(`${r.pushed ? "pushed" : "made (not pushed)"} ${r.branch} at ${r.commit}: ${r.files.length} file(s). Paste into the pull request body:\n`);
    console.log(r.lines.join("\n"));
  } catch (e) {
    console.error(`shots-branch: ${(e as Error).message}`);
    process.exit(1);
  }
}
