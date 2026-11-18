// SA-2: what the section files share: the saved mark of an autosaved field, the Undo message's name (the registry's
// label), the time zones, and a field key's registry id.
import type { AutoSave } from "../autosave.tsx";
import { labelOf } from "../parts.tsx";

/** The saved mark for one autosaved field (Row's `mark`). */
export const markOf = <V,>(a: AutoSave<V>, k: keyof V) => ({ s: a.status(k), retry: () => a.commit(k) });

/** The Undo message's name for a field: its registry label, from a field key → setting id map. */
export const labelBy = <V,>(ids: Partial<Record<keyof V & string, string>>) => (k: keyof V) => {
  const id = ids[k as keyof V & string];
  return id ? labelOf(id) : "Setting";
};

/** Zones the browser knows, for the time zone field (A1: each person sets their own). */
export const ZONES: readonly string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

export const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;

/** A long help line split for "More about this", word for word: its first sentence, and the rest (or nothing). */
export const firstLine = (t: string) => {
  const i = t.indexOf(". ");
  return i < 0 ? t : t.slice(0, i + 1);
};
export const rest = (t: string) => {
  const i = t.indexOf(". ");
  return i < 0 ? undefined : t.slice(i + 2);
};
