// Focused time on picks (step 6d, Q39): what the focus log holds, plus the running stretch of a live session.
// Pure; the UI passes the clock in.
import { formatDuration } from "../week/format.ts";
import type { Pick, Size } from "./types.ts";

/** Seconds focused on a pick: logged, plus now minus runningSince when a session on it is running. */
export function liveFocused(pickId: number, logged: Readonly<Record<number, number>>, timer: { pickId: number | null; runningSince: string | null } | null, nowMs: number): number {
  const base = logged[pickId] ?? 0;
  if (!timer || timer.pickId !== pickId || !timer.runningSince) return base;
  return base + Math.max(0, Math.floor((nowMs - Temporal.Instant.from(timer.runningSince).epochMilliseconds) / 1000));
}

/** "45m of M"; null under a minute, so untouched picks show just their size. */
export function focusLabel(seconds: number, size: Size): string | null {
  const minutes = Math.floor(seconds / 60);
  return minutes < 1 ? null : `${formatDuration(minutes)} of ${size}`;
}

/** A day's focused minutes (every pick, dropped too: the time was spent) and planned minutes (picks not dropped). */
export function dayFocus(picks: readonly Pick[], focused: (id: number) => number, sizes: Readonly<Record<Size, number>>): { focusedMinutes: number; plannedMinutes: number };
export function dayFocus(picks: readonly Pick[], focused: Readonly<Record<number, number>>, sizes: Readonly<Record<Size, number>>): { focusedMinutes: number; plannedMinutes: number };
export function dayFocus(picks: readonly Pick[], focused: Readonly<Record<number, number>> | ((id: number) => number), sizes: Readonly<Record<Size, number>>) {
  const of = typeof focused === "function" ? focused : (id: number) => focused[id] ?? 0;
  const seconds = picks.reduce((n, p) => n + of(p.id), 0);
  return { focusedMinutes: Math.floor(seconds / 60), plannedMinutes: picks.filter((p) => p.status !== "dropped").reduce((n, p) => n + sizes[p.size ?? "M"], 0) };
}
