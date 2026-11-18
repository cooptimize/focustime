// VM-4: how the page holds the VM chip's status between answers. The server keeps the last state it read while Azure
// fails; the page keeps its own too, for the two cases the server can't cover: the server has none (it restarted, so
// its first answer is "Checking…") and the request for the status itself fails (FocusTime didn't answer). Never a
// flash of Unknown; Start and Stop stay as the last good answer offered them (each reads Azure afresh before it acts).
import type { VmStatus } from "../actions/account-types.ts";
import { CHECK_AGAIN_MS, CHECK_LATER_MS, PROBLEM_AFTER_MS, READ_PROBLEM } from "../plan/vm.ts";

/** The status to show after an answer: the answer, or, when it couldn't read and has no state, the page's last one. */
export function mergeStatus(prev: VmStatus | null, next: VmStatus): VmStatus {
  if (!next.checking || next.chip !== null || !prev?.vm || !next.vm || prev.vm.id !== next.vm.id || prev.chip === null) return next;
  return {
    ...next,
    chip: prev.chip, label: prev.label, text: prev.text, power: prev.power, transition: prev.transition, schedule: prev.schedule, ...(prev.noShutdown !== undefined ? { noShutdown: prev.noShutdown } : {}),
    canStart: prev.canStart, canStop: prev.canStop, readAt: prev.readAt ?? null, prompt: false,
  };
}

/** The status to show when the request itself failed: the last one, checking, and after 2 minutes the reason. */
export function unreachable(prev: VmStatus | null, nowMs: number): VmStatus | null {
  if (!prev?.vm) return prev;
  const since = prev.checking?.since ?? new Date(nowMs).toISOString();
  const long = nowMs - Date.parse(since) >= PROBLEM_AFTER_MS;
  return { ...prev, checking: { since }, problem: long ? { kind: "app", ...READ_PROBLEM.app } : (prev.problem ?? null), prompt: false, refreshMs: long ? CHECK_LATER_MS : CHECK_AGAIN_MS };
}

/**
 * The server's times on the page's clock: the server and the browser can disagree (a skewed clock, the demo's own), so
 * "Read 1 minute ago" and the 2 minutes are measured from when the server answered, not from the server's clock.
 */
export function onPageClock(s: VmStatus, pageNowMs: number): VmStatus {
  if (!s.answeredAt) return s;
  const shift = pageNowMs - Date.parse(s.answeredAt);
  if (!Number.isFinite(shift)) return s;
  const move = (iso: string) => new Date(Date.parse(iso) + shift).toISOString();
  return { ...s, ...(s.readAt ? { readAt: move(s.readAt) } : {}), ...(s.checking ? { checking: { since: move(s.checking.since) } } : {}) };
}
