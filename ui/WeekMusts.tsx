// Musts per client for a week (step 11): progress from DevOps state, local done marks and done picks, against the
// current list (not the original). In this week, the on-track question: musts left against the client's blocks left.
// U2: Check-in shows this as one line ("Musts this week: 4 clients, Northwind tight · Review"); swapping musts is in
// Plan the week.
import type { WeekLoadData } from "../actions/types.ts";
import { borrowedForWeek, weekBudget } from "../plan/weekplan.ts";
import { freeLeft, onTrack, pickDoneFrom, weekList } from "../plan/weeklist.ts";
import type { IsoDate } from "../week/types.ts";


/** The week's list, progress and (when the loaded week is that week) the on-track question per client. */
export function weekMusts(data: WeekLoadData, weekStart: IsoDate, now: string | null) {
  const features = data.weekFeatures.filter((f) => f.weekStart === weekStart);
  const loaded = data.weekStart === weekStart;
  const list = weekList(features, data.devops, [], loaded ? pickDoneFrom(data.plan) : undefined);
  const fits = loaded ? weekBudget(data.week, features, { borrowedMinutes: borrowedForWeek(data.borrowed, weekStart) }) : [];
  const names = new Map([...(data.devops ?? []).map((c) => [c.clientKey, c.clientName] as const), ...fits.map((f) => [f.clientKey, f.clientName] as const), ...data.planClients.map((c) => [c.clientKey, c.clientName] as const)]);
  const rows = list.progress
    .filter((p) => p.musts > 0 || p.nice > 0)
    .map((p) => {
      const fit = fits.find((f) => f.clientKey === p.clientKey);
      return { ...p, name: names.get(p.clientKey) ?? p.clientKey, track: now && fit ? onTrack(p, freeLeft(fit.blocks, now)) : null };
    });
  return { items: list.items, rows };
}
