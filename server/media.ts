// Media control for focus (step 10 slice 5). Read-only detection of playerctl (MPRIS) and the Spotify app by looking
// for the programs on PATH (nothing is run to detect, nothing is installed). Commands are argument arrays started
// without a shell. Only the players Coopilot paused are resumed.
import { execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { MediaControl } from "../actions/timer-actions.ts";
import { mediaStep, type TimerLike } from "../plan/focussound.ts";

/** Whether a program is on PATH and executable. */
export function onPath(name: string, path = process.env.PATH ?? ""): boolean {
  return path.split(delimiter).filter(Boolean).some((dir) => {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const PLAYER = /^[A-Za-z0-9_.-]{1,100}$/;

/** playerctl command lines, as argument arrays (no shell). Player names are checked; anything else throws. */
export const playerctl = {
  /** Every player's instance name and status, one per line ("spotify\tPlaying"). */
  list: (): string[] => ["playerctl", "--all-players", "--format", "{{playerInstance}}\t{{status}}", "status"],
  pause: (players: string[]): string[] => ["playerctl", "--player", names(players), "pause"],
  play: (players: string[]): string[] => ["playerctl", "--player", names(players), "play"],
};
function names(players: string[]): string {
  if (!players.length || players.some((p) => !PLAYER.test(p))) throw new Error("bad player name");
  return players.join(",");
}

/** The players playing now, from playerctl.list's output. */
export function playingPlayers(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(([name, status]) => !!name && PLAYER.test(name) && status?.trim() === "Playing")
    .map(([name]) => name!);
}

/** xdg-open with one already validated link (https:// or spotify:), so it can't be read as an option. */
export function openArgs(target: string): string[] {
  if (!/^(https:\/\/|spotify:)/.test(target)) throw new Error("not a playlist link");
  return ["xdg-open", target];
}

type Run = (argv: string[]) => Promise<string>;
const run: Run = (argv) =>
  new Promise((resolve, reject) => {
    execFile(argv[0]!, argv.slice(1), { timeout: 4000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
const detach = (argv: string[]) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(argv[0]!, argv.slice(1), { stdio: "ignore", detached: true });
    p.once("error", reject);
    p.once("spawn", () => {
      p.unref();
      resolve();
    });
  });

/** The live media control. `has` and `exec` are swappable for tests. */
export function mediaControl(deps: { has?: (name: string) => boolean; exec?: Run; open?: (argv: string[]) => Promise<void> } = {}): MediaControl {
  const has = deps.has ?? ((n: string) => onPath(n));
  const exec = deps.exec ?? run;
  const open = deps.open ?? detach;
  let paused: string[] = [];
  return {
    status: async () => ({ playerctl: has("playerctl"), spotify: has("spotify") || has("spotify-launcher") }),
    transition: async (prev: TimerLike, next: TimerLike, enabled: boolean) => {
      if (!enabled || !has("playerctl")) {
        paused = [];
        return null;
      }
      const step = mediaStep(prev, next, paused.length > 0, true);
      try {
        if (step.command === "pause") {
          const playing = playingPlayers(await exec(playerctl.list()).catch(() => ""));
          if (playing.length) await exec(playerctl.pause(playing));
          paused = playing;
        } else if (step.command === "play") {
          const was = paused;
          paused = [];
          await exec(playerctl.play(was));
        }
      } catch {
        // A player that went away is fine; nothing to report.
      }
      return step.command;
    },
    open: (target: string) => open(openArgs(target)),
  };
}
