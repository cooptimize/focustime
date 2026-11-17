// PH-1: the Desktop version's switch: saved and reloaded when storage works, in place (and not remembered) when not.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DESKTOP_KEY, desktopViewport, setDesktopVersion, type DesktopPage } from "./desktop-version.ts";

const fake = (works: boolean) => {
  const log: string[] = [];
  const page: DesktopPage = { save: (on) => (log.push(`save ${on}`), works), reload: () => log.push("reload"), viewport: (c) => log.push(`viewport ${c}`), mark: (on) => log.push(`mark ${on}`) };
  return { page, log };
};

describe("PH-1: the Desktop version", () => {
  it("with storage: saved, then the page reloads so prefs.js lays it out before the first paint", () => {
    const { page, log } = fake(true);
    expect(setDesktopVersion(true, page)).toBe("reload");
    expect(log).toEqual(["save true", "reload"]);
  });
  it("with storage refused: switched in place, not remembered, and back the same way", () => {
    const { page, log } = fake(false);
    expect(setDesktopVersion(true, page, { width: 390 })).toBe("in_place");
    expect(setDesktopVersion(false, page, { width: 390 })).toBe("in_place");
    expect(log).toEqual(["save true", "viewport width=1280, initial-scale=0.3047, viewport-fit=cover", "mark true", "save false", "viewport width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content", "mark false"]);
  });
  it("prefs.js reads the same key before the first paint, and index.html's viewport is the phone's", () => {
    const prefs = readFileSync(new URL("../public/prefs.js", import.meta.url), "utf8");
    expect(prefs).toContain(`localStorage.getItem("${DESKTOP_KEY}") === "1"`);
    expect(prefs).toContain('"width=1280, initial-scale=" + fit + ", viewport-fit=cover"');
    // The same starting zoom as the in-place switch: (390 / 1280) to 4 places.
    expect(desktopViewport(390)).toBe("width=1280, initial-scale=0.3047, viewport-fit=cover");
    expect(desktopViewport(1400)).toBe("width=1280, initial-scale=1, viewport-fit=cover");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain('content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"');
  });
});
