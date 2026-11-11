// How to notice a new day while the window stays open for days (step 16.2: nothing opens by itself any more).

/** True when the local date has moved past the day the loaded data calls today (midnight while running). */
export function dayRolledOver(now: Temporal.ZonedDateTime, loadedToday: string): boolean {
  return Temporal.PlainDate.compare(now.toPlainDate(), Temporal.PlainDate.from(loadedToday)) > 0;
}

export const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
};
