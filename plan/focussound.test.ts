import { describe, expect, it } from "vitest";
import { mediaStep, playlistLink, playlistTarget, soundStep, type TimerLike } from "./focussound.ts";

const focus = (o: Partial<NonNullable<TimerLike>> = {}): TimerLike => ({ kind: "focus", running: true, ended: false, startedAt: "a", ...o });
const brk: TimerLike = { kind: "break", running: true, ended: false, startedAt: "b" };

describe("the focus sound follows the timer", () => {
  it("plays the chosen sound only while focus runs: start, pause, resume, end, stop, break, restart", () => {
    expect(soundStep(null, focus(), "brown", "silence")).toEqual({ play: "brown", chime: false });
    expect(soundStep(focus(), focus({ running: false }), "brown", "silence").play).toBeNull(); // paused
    expect(soundStep(focus({ running: false }), focus(), "brown", "silence").play).toBe("brown"); // resumed
    expect(soundStep(focus(), focus({ running: false, ended: true }), "brown", "silence")).toEqual({ play: null, chime: false }); // time's up
    expect(soundStep(focus(), null, "brown", "silence").play).toBeNull(); // stopped or done
    expect(soundStep(focus(), brk, "brown", "silence")).toEqual({ play: null, chime: false });
    expect(soundStep(brk, focus({ startedAt: "c" }), "pink", "silence").play).toBe("pink"); // the next focus
    expect(soundStep(null, focus(), "none", "silence").play).toBeNull();
  });
  it("chimes softly into a break or at the end of focus when on_break is chime, never on a stop", () => {
    expect(soundStep(focus(), brk, "rain", "chime").chime).toBe(true);
    expect(soundStep(focus(), focus({ running: false, ended: true }), "rain", "chime").chime).toBe(true);
    expect(soundStep(focus(), null, "rain", "chime").chime).toBe(false);
    expect(soundStep(focus(), focus({ running: false }), "rain", "chime").chime).toBe(false);
    expect(soundStep(focus({ ended: true, running: false }), focus({ ended: true, running: false }), "rain", "chime").chime).toBe(false);
  });
});

describe("media pause and resume (playerctl)", () => {
  it("pauses when focus ends, stops or turns into a break, and resumes only what it paused", () => {
    expect(mediaStep(focus(), null, false, true)).toEqual({ command: "pause", pausedByUs: true });
    expect(mediaStep(focus(), brk, false, true)).toEqual({ command: "pause", pausedByUs: true });
    expect(mediaStep(focus(), focus({ running: false, ended: true }), false, true).command).toBe("pause");
    expect(mediaStep(brk, focus({ startedAt: "c" }), true, true)).toEqual({ command: "play", pausedByUs: false });
    expect(mediaStep(null, focus(), false, true)).toEqual({ command: null, pausedByUs: false }); // nothing was paused by Coopilot
    expect(mediaStep(focus({ running: false, ended: true }), focus({ startedAt: "a" }), true, true).command).toBe("play"); // +15 after time's up
  });
  it("leaves media alone on a timer pause or resume, and does nothing when turned off", () => {
    expect(mediaStep(focus(), focus({ running: false }), false, true).command).toBeNull();
    expect(mediaStep(focus({ running: false }), focus(), true, true)).toEqual({ command: null, pausedByUs: true });
    expect(mediaStep(focus(), null, false, false)).toEqual({ command: null, pausedByUs: false });
  });
});

describe("playlist links", () => {
  it("accepts Spotify and YouTube links only, normalized, with the Spotify app URI", () => {
    expect(playlistLink("https://open.spotify.com/playlist/37i9dQZF1DX8Uebhn9wzrS?si=abc")).toEqual({ service: "spotify", web: "https://open.spotify.com/playlist/37i9dQZF1DX8Uebhn9wzrS", uri: "spotify:playlist:37i9dQZF1DX8Uebhn9wzrS" });
    expect(playlistLink("https://open.spotify.com/intl-de/album/abc123")?.uri).toBe("spotify:album:abc123");
    expect(playlistLink("spotify:playlist:abc123")?.web).toBe("https://open.spotify.com/playlist/abc123");
    expect(playlistLink("https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG")).toEqual({ service: "youtube", web: "https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG", uri: null });
    expect(playlistLink("https://music.youtube.com/watch?v=jfKfPfyJRdk&list=RD1&feature=x")?.web).toBe("https://music.youtube.com/watch?v=jfKfPfyJRdk&list=RD1");
    expect(playlistLink("https://youtu.be/jfKfPfyJRdk")?.service).toBe("youtube");
  });
  it("rejects everything else", () => {
    for (const bad of [
      "http://open.spotify.com/playlist/abc", // not https
      "https://open.spotify.com.evil.example/playlist/abc",
      "https://user:pw@open.spotify.com/playlist/abc",
      "https://open.spotify.com:8443/playlist/abc",
      "https://open.spotify.com/user/abc",
      "https://open.spotify.com/playlist/abc/extra",
      "https://www.youtube.com/watch?v=a b",
      "https://www.youtube.com/channel/x",
      "https://example.com/playlist?list=abc",
      "spotify:playlist:abc;rm -rf",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "--help",
      "",
    ])
      expect(playlistLink(bad), bad).toBeNull();
  });
  it("opens Spotify in its app when installed, else the web link", () => {
    const sp = playlistLink("https://open.spotify.com/playlist/abc")!;
    expect(playlistTarget(sp, true)).toBe("spotify:playlist:abc");
    expect(playlistTarget(sp, false)).toBe("https://open.spotify.com/playlist/abc");
    expect(playlistTarget(playlistLink("https://youtu.be/abc")!, true)).toBe("https://youtu.be/abc");
  });
});
