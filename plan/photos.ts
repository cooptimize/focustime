// Profile photos (step 16.4): when a cached photo is fresh, stale (shown, read again in the background) or missing
// (read now), and the generated avatars demo mode uses instead of Graph. Pure: no I/O.

export const PHOTO_TTL_DAYS = 7;
/** Most people one request asks photos for (people on screen). */
export const MAX_PHOTO_PEOPLE = 60;

export type PhotoAge = "fresh" | "stale" | "missing";
/** Fresh for 7 days after it was read; stale after that (still shown while it's read again). */
export function photoAge(entry: { fetchedAt: string } | null, now: string): PhotoAge {
  if (!entry) return "missing";
  const age = Temporal.Instant.from(entry.fetchedAt).until(Temporal.Instant.from(now)).total("hours");
  return age >= 0 && age < PHOTO_TTL_DAYS * 24 ? "fresh" : "stale";
}

/** A data URL for an image's bytes. */
export function dataUrl(type: string, bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s.toLowerCase()) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return h >>> 0;
};

/**
 * Demo mode's avatar for a fictional person: a soft background and a symmetric 5 by 5 pattern from their name, as an
 * SVG data URL. No photo of anyone, no network.
 */
export function demoAvatar(name: string): string {
  const h = hash(name);
  const hue = h % 360;
  const bg = `hsl(${hue} 45% 82%)`;
  const fg = `hsl(${(hue + 180) % 360} 40% 36%)`;
  let cells = "";
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++)
      if ((h >>> ((y * 3 + x) % 31)) & 1) {
        cells += `<rect x="${10 + x * 15}" y="${10 + y * 15}" width="15" height="15"/>`;
        if (x < 2) cells += `<rect x="${10 + (4 - x) * 15}" y="${10 + y * 15}" width="15" height="15"/>`;
      }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${bg}"/><g fill="${fg}">${cells}</g></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
