// The local host's windows and programs (A1): the app window (Chromium --app), focustime-open under the developer
// service, the launch link file the launcher reads, and links in the default browser (xdg-open). Every program is
// started from an argument array without a shell.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostLaunch, HostLinks } from "../types.ts";
import { takeOpenRequest } from "./open-request.ts";

/** Starts a program from an argument array (no shell), detached, with no output kept. */
export function launchDetached(argv: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const [cmd, ...args] = argv;
    if (!cmd) return fail(new Error("empty command"));
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", shell: false });
    child.once("error", () => fail(new Error("could not start")));
    child.once("spawn", () => {
      child.unref();
      ok();
    });
  });
}

/** Opens one https link in the default browser (xdg-open). The link is checked so it can't be read as an option. */
export const localLinks = (launch: (argv: string[]) => Promise<void> = launchDetached): HostLinks => ({
  open: async (url) => {
    if (!/^https:\/\//.test(url)) throw new Error("not a web link");
    await launch(["xdg-open", url]);
    return "opened";
  },
});

export type LaunchOptions = {
  runtimeDir: string;
  port: number;
  token: string;
  /** No windows at all (the browser tests). */
  headless: boolean;
  /** The server may open a window (not --no-open). */
  open: boolean;
  /** --no-reopen (the browser tests). */
  noReopen: boolean;
  /** Under the developer service (systemd sets INVOCATION_ID). */
  service: boolean;
};

export function localLaunch(o: LaunchOptions): HostLaunch {
  const launchFile = join(o.runtimeDir, "launch.json");
  return {
    detached: launchDetached,
    /**
     * "Reopen FocusTime" from a window whose launch token is old. Under the service, focustime-open replaces a window
     * opened for an earlier server run; with npm start, a new app window opens with the launch link.
     */
    reopen: async () => {
      if (o.headless || o.noReopen) return false;
      const script = join(homedir(), ".local", "bin", "focustime-open");
      const argv = o.service && existsSync(script) ? [script] : o.open ? ["chromium", `--app=http://127.0.0.1:${o.port}/?token=${o.token}`] : null;
      if (!argv) return false;
      return launchDetached(argv).then(() => true, () => false);
    },
    openWindow: (url) => {
      if (o.headless || !o.open) return;
      spawn("chromium", [`--app=${url}`], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    },
    takeOpenRequest: () => takeOpenRequest(o.runtimeDir),
    // The launch URL holds the per-launch token, so it goes to a private file, not the terminal.
    publish: async (url) => {
      await mkdir(o.runtimeDir, { recursive: true, mode: 0o700 });
      await writeFile(launchFile, JSON.stringify({ url, pid: process.pid }), { mode: 0o600 });
      return launchFile;
    },
    unpublish: () => rm(launchFile, { force: true }),
  };
}
