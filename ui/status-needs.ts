// WD-1, RF-1: the Status tab's count and dot in the top bar, read at start. Its own file (PF-1) so the top bar
// doesn't bring the Status screen (ui/Status.tsx, loaded when the tab is first opened) into the first download.
import { useEffect, useState } from "react";
import type { StatusLoad } from "../plan/status-types.ts";
import type { DotSchedule } from "../plan/status-dot.ts";
import { call } from "./api.ts";

export type StatusNeeds = { needs: number; dot: DotSchedule | null; sendsAt: string | null; zone: string | null; /** The server's clock minus the browser's. */ skewMs: number };

/**
 * WD-1, RF-1: SR-3's Needs your update (features I worked on this week with no update of mine) and the dot's schedule.
 * Read once, then again when `version` changes; null until read or when Status can't load.
 */
export function useStatusNeeds(version: unknown): StatusNeeds | null {
  const [n, setN] = useState<StatusNeeds | null>(null);
  // RF-1: read again a minute after the report goes out, so the next week's list and dot replace this one's.
  const [after, setAfter] = useState(0);
  const sendsAt = n?.sendsAt ?? null;
  const skew = n?.skewMs ?? 0;
  // RF-1 review: the list changes as I work, so read it again every 30 minutes while the window is shown, and when it
  // comes back into view after 10 minutes or more (status.load reads DevOps, so not as often as the Inbox's count).
  useEffect(() => {
    let last = Date.now();
    const again = () => {
      if (document.hidden || Date.now() - last < 10 * 60_000) return;
      last = Date.now();
      setAfter((k) => k + 1);
    };
    const id = window.setInterval(() => !document.hidden && (last = Date.now(), setAfter((k) => k + 1)), 30 * 60_000);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, []);
  useEffect(() => {
    if (!sendsAt) return;
    const wait = Date.parse(sendsAt) - (Date.now() + skew) + 60_000;
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const t = window.setTimeout(() => setAfter((k) => k + 1), wait);
    return () => window.clearTimeout(t);
  }, [sendsAt, skew]);
  useEffect(() => {
    let live = true;
    call<StatusLoad>("status.load", {}).then(
      (d) => live && setN({ needs: d.clients.reduce((k, c) => k + c.features.filter((f) => f.needsYou).length, 0), dot: d.dot ?? null, sendsAt: d.sendsAt ?? null, zone: d.zone ?? null, skewMs: d.serverNow ? Date.parse(d.serverNow) - Date.now() : 0 }),
      () => live && setN(null),
    );
    return () => {
      live = false;
    };
  }, [version, after]);
  return n;
}
