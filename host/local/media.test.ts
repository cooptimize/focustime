import { describe, expect, it } from "vitest";
import { mediaControl, onPath, openArgs, playerctl, playingPlayers } from "./media.ts";

const focus = { kind: "focus" as const, running: true, ended: false, startedAt: "a" };
const brk = { kind: "break" as const, running: true, ended: false, startedAt: "b" };

describe("playerctl commands", () => {
  it("are argument arrays with checked player names, never a shell line", () => {
    expect(playerctl.list()).toEqual(["playerctl", "--all-players", "--format", "{{playerInstance}}\t{{status}}", "status"]);
    expect(playerctl.pause(["spotify", "firefox.instance123"])).toEqual(["playerctl", "--player", "spotify,firefox.instance123", "pause"]);
    expect(playerctl.play(["spotify"])).toEqual(["playerctl", "--player", "spotify", "play"]);
    for (const bad of [["a;rm -rf ~"], ["$(id)"], ["a b"], [""], []]) expect(() => playerctl.pause(bad)).toThrow();
  });
  it("reads which players are playing", () => {
    expect(playingPlayers("spotify\tPlaying\nfirefox.instance1\tPaused\nchromium\tPlaying\nbad name\tPlaying\n")).toEqual(["spotify", "chromium"]);
    expect(playingPlayers("")).toEqual([]);
  });
  it("opens only a validated link with xdg-open", () => {
    expect(openArgs("https://open.spotify.com/playlist/abc")).toEqual(["xdg-open", "https://open.spotify.com/playlist/abc"]);
    expect(openArgs("spotify:playlist:abc")).toEqual(["xdg-open", "spotify:playlist:abc"]);
    expect(() => openArgs("--help")).toThrow();
    expect(() => openArgs("file:///etc/passwd")).toThrow();
  });
  it("finds programs on PATH without running them", () => {
    expect(onPath("sh", "/usr/bin:/bin")).toBe(true);
    expect(onPath("no-such-program-focustime", "/usr/bin:/bin")).toBe(false);
  });
});

describe("media control follows focus", () => {
  const setup = (has: boolean, playing = "spotify\tPlaying\nmpv\tPaused\n") => {
    const ran: string[][] = [];
    const m = mediaControl({ has: (n) => has && n === "playerctl", exec: async (argv) => (ran.push(argv), argv.at(-1) === "status" ? playing : ""), open: async (argv) => void ran.push(argv) });
    return { m, ran };
  };
  it("pauses only the players that were playing, and resumes just those when focus starts again", async () => {
    const { m, ran } = setup(true);
    expect(await m.transition(focus, brk, true)).toBe("pause");
    expect(ran).toEqual([playerctl.list(), ["playerctl", "--player", "spotify", "pause"]]);
    expect(await m.transition(brk, { ...focus, startedAt: "c" }, true)).toBe("play");
    expect(ran.at(-1)).toEqual(["playerctl", "--player", "spotify", "play"]);
    expect(await m.transition(null, focus, true)).toBeNull(); // nothing paused by FocusTime now
  });
  it("never resumes when nothing was playing", async () => {
    const { m, ran } = setup(true, "mpv\tPaused\n");
    await m.transition(focus, null, true);
    expect(await m.transition(null, focus, true)).toBeNull();
    expect(ran).toEqual([playerctl.list()]);
  });
  it("does nothing without playerctl or when turned off, and says what is there", async () => {
    const a = setup(false);
    expect(await a.m.transition(focus, null, true)).toBeNull();
    const b = setup(true);
    expect(await b.m.transition(focus, null, false)).toBeNull();
    expect(a.ran).toEqual([]);
    expect(b.ran).toEqual([]);
    expect(await a.m.status()).toEqual({ players: false, spotify: false });
    expect(await b.m.status()).toEqual({ players: true, spotify: false });
  });
});
