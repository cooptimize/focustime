// Focus sounds (step 10 slice 5). Pure rules shared by the UI, the config and the server:
// - which generated sound should play for a timer state, and when a soft chime marks a break;
// - when media players are paused or resumed (only what FocusTime paused is resumed);
// - which playlist links are allowed (Spotify and YouTube only) and how each one opens.
// No audio, no processes, no network here.

export const SOUNDS = ["none", "brown", "pink", "rain", "alpha", "beta"] as const;
export type SoundKind = (typeof SOUNDS)[number];
export const SOUND_NAMES: Record<SoundKind, string> = { none: "No sound", brown: "Brown noise", pink: "Pink noise", rain: "Rain", alpha: "Binaural, alpha (10 Hz)", beta: "Binaural, beta (18 Hz)" };
/** Binaural presets need headphones: each ear gets its own tone. */
export const BINAURAL: Partial<Record<SoundKind, { carrier: number; beat: number }>> = { alpha: { carrier: 200, beat: 10 }, beta: { carrier: 220, beat: 18 } };

export type Playlist = { name: string; url: string };
export type FocusSettings = {
  sound: SoundKind;
  /** 0 to 100. */
  volume: number;
  /** Fade in and out, 0 to 30 seconds. */
  fadeSeconds: number;
  onBreak: "silence" | "chime";
  /** Pause media players when focus ends or a break starts, resume them when the next focus starts (the host's media control). */
  pauseMedia: boolean;
  playlists: Playlist[];
  /** Step 16.3: set my Teams status while focus runs (Busy, or Do not disturb for deep focus). */
  teamsStatus: boolean;
  /** Step 16.3: what plain (not deep) focus does to my Teams status: Busy, or leave it alone. */
  plainFocusStatus: "busy" | "none";
};
export const DEFAULT_FOCUS: FocusSettings = { sound: "none", volume: 40, fadeSeconds: 5, onBreak: "silence", pauseMedia: false, playlists: [], teamsStatus: true, plainFocusStatus: "busy" };
export const MAX_PLAYLISTS = 8;

/** The part of a timer the sound rules look at. */
export type TimerLike = { kind: "focus" | "break"; running: boolean; ended: boolean; startedAt?: string } | null;

const focusing = (t: TimerLike) => !!t && t.kind === "focus" && t.running && !t.ended;

/**
 * What should be playing now, and whether to chime. The chosen sound plays only while focus runs: paused, ended,
 * stopped and breaks are quiet. A chime marks the move from focus into a break or the end of focus, when on_break
 * is "chime".
 */
export function soundStep(prev: TimerLike, next: TimerLike, choice: SoundKind, onBreak: FocusSettings["onBreak"]): { play: SoundKind | null; chime: boolean } {
  const play = focusing(next) && choice !== "none" ? choice : null;
  const leftFocus = !!prev && prev.kind === "focus" && !prev.ended && ((!!next && next.kind === "break") || (!!next && next.kind === "focus" && next.ended));
  return { play, chime: onBreak === "chime" && leftFocus };
}

/**
 * Media control on a timer change. Pause when focus ends, stops or turns into a break; resume when a focus session
 * starts again, but only if FocusTime did the pausing (`pausedByUs`), so it never starts music nobody was playing.
 */
export function mediaStep(prev: TimerLike, next: TimerLike, pausedByUs: boolean, enabled: boolean): { command: "pause" | "play" | null; pausedByUs: boolean } {
  if (!enabled) return { command: null, pausedByUs: false };
  const was = !!prev && prev.kind === "focus" && !prev.ended;
  const ended = !next || next.kind === "break" || next.ended;
  if (was && ended) return { command: "pause", pausedByUs: true };
  const started = focusing(next) && !(prev && prev.kind === "focus" && !prev.ended && prev.startedAt === next?.startedAt);
  if (started && pausedByUs) return { command: "play", pausedByUs: false };
  return { command: null, pausedByUs };
}

export type PlaylistLink = { service: "spotify" | "youtube"; web: string; uri: string | null };

const SPOTIFY_KINDS = ["playlist", "album", "track", "show", "episode", "artist"];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A Spotify or YouTube link (https only, no credentials or ports), or null. Spotify links also get their app URI. */
export function playlistLink(input: string): PlaylistLink | null {
  const s = input.trim();
  if (s.length > 500) return null;
  const spUri = /^spotify:(playlist|album|track|show|episode|artist):([A-Za-z0-9]{1,64})$/.exec(s);
  if (spUri) return { service: "spotify", web: `https://open.spotify.com/${spUri[1]}/${spUri[2]}`, uri: s };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (host === "open.spotify.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0]?.startsWith("intl-")) parts.shift();
    const [kind, id] = parts;
    if (!kind || !id || !SPOTIFY_KINDS.includes(kind) || !/^[A-Za-z0-9]{1,64}$/.test(id) || parts.length !== 2) return null;
    return { service: "spotify", web: `https://open.spotify.com/${kind}/${id}`, uri: `spotify:${kind}:${id}` };
  }
  if (host === "youtube.com" || host === "www.youtube.com" || host === "music.youtube.com" || host === "m.youtube.com") {
    const list = u.searchParams.get("list");
    const v = u.searchParams.get("v");
    if (u.pathname === "/playlist" && list && ID.test(list)) return { service: "youtube", web: `https://${host}/playlist?list=${list}`, uri: null };
    if (u.pathname === "/watch" && v && ID.test(v)) return { service: "youtube", web: `https://${host}/watch?v=${v}${list && ID.test(list) ? `&list=${list}` : ""}`, uri: null };
    return null;
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1);
    return ID.test(id) ? { service: "youtube", web: `https://youtu.be/${id}`, uri: null } : null;
  }
  return null;
}

/** How a playlist opens: the Spotify app by its URI when installed, else the web link in the default browser. */
export function playlistTarget(link: PlaylistLink, spotifyApp: boolean): string {
  return link.service === "spotify" && spotifyApp && link.uri ? link.uri : link.web;
}
