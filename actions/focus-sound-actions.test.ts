// Step 10 slice 5: playlists open through media control, media follows the timer, [focus] parses and saves.
import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, legacyHours, parseConfig, type AppConfig } from "../config/schema.ts";
import { settingsEdit } from "../config/settings.ts";
import { DEFAULT_FOCUS, type FocusSettings } from "../plan/focussound.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { timerAction, type MediaControl } from "./timer-actions.ts";

const NY = "America/New_York";
const BASE = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"');
function setup(focus: Partial<FocusSettings> = {}, spotify = false) {
  const clock = Temporal.Instant.from("2026-11-02T09:00:00-05:00");
  const plan = createPlanStore({ path: ":memory:", now: () => clock.toZonedDateTimeISO(NY) });
  const cfg = { plan: { ...DEFAULT_PLAN, pickablePortfolioTypes: [] }, focus: { ...DEFAULT_FOCUS, ...focus }, week: { hours: legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: NY }) } } as unknown as AppConfig;
  const opened: string[] = [];
  const moves: [string | null, string | null, boolean][] = [];
  const media: MediaControl = {
    status: async () => ({ players: true, spotify }),
    transition: async (prev, next, enabled) => (moves.push([prev ? `${prev.kind}${prev.running ? "" : " paused"}${prev.ended ? " ended" : ""}` : null, next ? `${next.kind}${next.running ? "" : " paused"}${next.ended ? " ended" : ""}` : null, enabled]), null),
    open: async (t) => void opened.push(t),
  };
  const run = (action: Parameters<typeof timerAction>[1], input?: unknown) => timerAction({ plan, config: async () => cfg, now: () => clock.toString(), media }, action, input);
  return { plan, run, opened, moves };
}
const lists = [{ name: "Deep work", url: "https://open.spotify.com/playlist/abc123" }, { name: "Lofi", url: "https://www.youtube.com/playlist?list=PLabc" }];

describe("focus playlists and media (step 10)", () => {
  it("timer.start opens a saved playlist after the timer starts: the Spotify app when installed, else the web link", async () => {
    const a = setup({ playlists: lists }, true);
    expect(await a.run("timer.start", { playlist: "Deep work" })).toMatchObject({ ok: true, data: { playlist: "Deep work", timer: { kind: "focus" } } });
    expect(a.opened).toEqual(["spotify:playlist:abc123"]);
    const b = setup({ playlists: lists }, false);
    await b.run("timer.start", { playlist: "Deep work" });
    await b.run("timer.start", { playlist: "Lofi" });
    expect(b.opened).toEqual(["https://open.spotify.com/playlist/abc123", "https://www.youtube.com/playlist?list=PLabc"]);
  });
  it("refuses unknown playlists and playlists on a break, and opens nothing for a bad pick", async () => {
    const t = setup({ playlists: lists });
    expect(await t.run("timer.start", { playlist: "Nope" })).toMatchObject({ ok: false, status: 422 });
    expect(await t.run("timer.start", { kind: "break", playlist: "Lofi" })).toMatchObject({ ok: false, status: 400 });
    expect(await t.run("timer.start", { pickId: 999, playlist: "Lofi" })).toMatchObject({ ok: false, status: 404 });
    expect(await t.run("playlist.open", { name: "https://evil.example" })).toMatchObject({ ok: false, status: 422 });
    expect(t.opened).toEqual([]);
    expect(await t.run("playlist.open", { name: "Lofi" })).toMatchObject({ ok: true, data: { opened: "Lofi", app: "browser" } });
  });
  it("tells media control about every timer change, with the pause_media setting", async () => {
    const t = setup({ pauseMedia: true });
    await t.run("timer.start", {});
    await t.run("timer.pause");
    await t.run("timer.resume");
    await t.run("timer.start", { kind: "break" });
    await t.run("timer.stop");
    expect(t.moves).toEqual([
      [null, "focus", true],
      ["focus", "focus paused", true],
      ["focus paused", "focus", true],
      ["focus", "break", true],
      ["break", null, true],
    ]);
  });
});

describe("[focus] config", () => {
  it("defaults when absent, parses every key, and rejects bad values per field", () => {
    const base = parseConfig(BASE);
    expect(base.ok && base.config.focus).toEqual(DEFAULT_FOCUS);
    const ok = parseConfig(`${BASE}\n[focus]\nsound = "rain"\nvolume = 55\nfade_seconds = 8\non_break = "chime"\npause_media = true\nteams_status = false\nplain_focus_status = "none"\nplaylists = [{ name = "Deep work", url = "https://open.spotify.com/playlist/abc123" }]\n`);
    expect(ok.ok && ok.config.focus).toEqual({ sound: "rain", volume: 55, fadeSeconds: 8, onBreak: "chime", pauseMedia: true, playlists: [lists[0]], teamsStatus: false, plainFocusStatus: "none" });
    const bad = parseConfig(`${BASE}\n[focus]\nsound = "techno"\nvolume = 101\non_break = "bell"\nteams_status = "yes"\nplain_focus_status = "dnd"\nplaylists = [{ name = "X", url = "https://example.com/x" }, { name = "", url = "https://youtu.be/abc" }]\nextra = 1\n`, { strict: true });
    expect(bad.ok ? [] : bad.errors.map((e) => e.field).sort()).toEqual(["focus.extra", "focus.on_break", "focus.plain_focus_status", "focus.playlists[0].url", "focus.playlists[1].name", "focus.sound", "focus.teams_status", "focus.volume"]);
  });
  it("Settings > Focus writes the table and keeps the rest of the file", () => {
    const edit = settingsEdit("focus", { sound: "brown", volume: 30, fadeSeconds: 4, onBreak: "silence", pauseMedia: false, playlists: [lists[1]], teamsStatus: true, plainFocusStatus: "none" });
    const out = edit(BASE);
    const parsed = parseConfig(out);
    expect(parsed.ok && parsed.config.focus).toEqual({ sound: "brown", volume: 30, fadeSeconds: 4, onBreak: "silence", pauseMedia: false, playlists: [lists[1]], teamsStatus: true, plainFocusStatus: "none" });
    expect(out.startsWith(BASE.slice(0, 200))).toBe(true);
    expect(() => settingsEdit("focus", { sound: "brown", shell: "rm" })).toThrow(/Unknown field/);
  });
});
