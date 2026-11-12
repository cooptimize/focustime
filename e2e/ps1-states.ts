// PS-1: the three states the polish sweep is judged on, built in the demo through the app's own actions (fictional
// data only). The "before" and "after" screenshots and the browser checks use the same script, so they match.
//   empty    Tuesday and later have no to-dos: the board's suggestions show.
//   ordinary three or four to-dos a block today, some done, a promise due, an at-risk block (the demo's own).
//   heavy    eight or more to-dos in today's morning block, long titles, three due chips.
import type { Page } from "playwright-core";
import { call, emptyFrom } from "./sg1-helpers.ts";

export type PsState = "empty" | "ordinary" | "heavy";
export const PS_TODAY = "2026-11-03";
/** Tuesday 9:30 AM: Monday is past, the morning block is under way, Wednesday is the next working day. */
export const PS_CLOCK = "2026-11-03T09:30:00-05:00";

type Day = { picks: { id: number; status: string; half: string; clientKey: string }[] };
type Slot = { half: string; focus: { clientKey: string }[]; pto: boolean };
type WeekData = { plan?: Record<string, Day>; week: { days: { date: string; am: Slot; pm: Slot }[] } };

const load = async (page: Page) => (await call(page, "week.load", {})).data as unknown as WeekData;
const ready = async (page: Page) => {
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
};

const ORDINARY = ["Review the intake form copy", "Fix the date filter on orders", "Reply to the API question"];
const HEAVY = [
  "Rework the pricing rules import so that seasonal discounts apply before the regional surcharge is added",
  "Write the migration notes for the reporting database move, including the rollback steps and owners",
  "Pair on the failing nightly sync job",
  "Check the vendor's change to the shipping label format against our parser and the sample files",
  "Update the onboarding checklist",
  "Draft the questions for Thursday's planning call with the client's operations lead and finance",
  "Clean up the old feature flags",
  "Look at the slow search page on the admin portal with the new query plan and the index suggestions",
  "Sort the support inbox",
];

/** The client of a block on a date (the first focus block), or null. */
function clientOn(w: WeekData, date: string, half: "AM" | "PM"): string | null {
  const d = w.week.days.find((x) => x.date === date);
  const s = half === "AM" ? d?.am : d?.pm;
  return s && !s.pto ? (s.focus[0]?.clientKey ?? null) : null;
}

async function add(page: Page, date: string, half: "AM" | "PM", clientKey: string, titles: readonly string[], sizes: readonly (string | null)[]) {
  const ids: number[] = [];
  for (const [i, t] of titles.entries()) {
    const size = sizes[i % sizes.length];
    const r = await call(page, "pick.add", { date, half, clientKey, intention: t, ...(size ? { size } : {}) });
    const pick = (r.data as { pick?: { id: number } } | undefined)?.pick;
    if (pick) ids.push(pick.id);
  }
  return ids;
}

/** Builds a state in this page's demo session, then reloads. */
export async function buildState(page: Page, state: PsState): Promise<void> {
  // Every state starts from Tuesday on with nothing planned (Monday keeps its unfinished ones, so suggestions have some).
  await emptyFrom(page, PS_TODAY);
  if (state === "empty") return;
  const w = await load(page);
  const am = clientOn(w, PS_TODAY, "AM");
  const pm = clientOn(w, PS_TODAY, "PM");
  const wedAm = clientOn(w, "2026-11-04", "AM");
  const wedPm = clientOn(w, "2026-11-04", "PM");
  const done: number[] = [];
  if (state === "ordinary") {
    if (am) done.push(...(await add(page, PS_TODAY, "AM", am, ORDINARY, ["S", "M", null])).slice(0, 1));
    if (pm) done.push(...(await add(page, PS_TODAY, "PM", pm, [...ORDINARY.slice(0, 2), "Prepare the demo for Friday", "Write up the handover"], ["M", "S"])).slice(0, 1));
    if (wedAm) await add(page, "2026-11-04", "AM", wedAm, ORDINARY.slice(0, 2), ["M"]);
    await call(page, "followup.add", { what: "Send the revised estimate", who: "Jordan Lee", due: PS_TODAY, ...(am ? { clientKey: am } : {}) });
  } else {
    if (am) done.push(...(await add(page, PS_TODAY, "AM", am, HEAVY, ["S", "M", "XS", null, "L"])).slice(0, 3));
    if (pm) await add(page, PS_TODAY, "PM", pm, HEAVY.slice(0, 5), ["M", "S"]);
    if (wedAm) await add(page, "2026-11-04", "AM", wedAm, HEAVY.slice(2, 8), ["S"]);
    if (wedPm) await add(page, "2026-11-04", "PM", wedPm, HEAVY.slice(4, 9), ["M"]);
    const due = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;
    await call(page, "followup.add", { what: "Send the revised estimate for the second phase", who: "Jordan Lee", due: due(2), ...(am ? { clientKey: am } : {}) });
    await call(page, "followup.add", { what: "Share the test plan", who: "Priya Shah", due: due(3), ...(am ? { clientKey: am } : {}) });
    await call(page, "followup.add", { what: "Answer the question about the export", who: "Sam Ortiz", due: due(4), ...(am ? { clientKey: am } : {}) });
  }
  for (const id of done) await call(page, "pick.mark_done", { id, done: true });
  await page.reload();
  await ready(page);
}
