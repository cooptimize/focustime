// WK-5: the Thursday Week is judged on, built in the demo through the app's own actions (fictional data only). The
// before and after screenshots and the browser checks use the same script, so they match.
//   Thursday 9:30 AM. Mon to Wed are past: done, unfinished and moved to-dos (one block with more than six). Today's
//   morning has timeboxed to-dos with long titles across two features (the 9:00 one under the second feature) and an
//   untimed one; the afternoon has more. Friday's catch-up and Saturday each hold a to-do; Sunday a promise.
import type { Page } from "playwright-core";
import { call, emptyFrom } from "./sg1-helpers.ts";

export const WK5_TODAY = "2026-11-12";
/** Thursday 9:30 AM: Monday to Wednesday are past, the morning block is under way. */
export const WK5_CLOCK = "2026-11-12T09:30:00-05:00";
export const WK5_FRIDAY = "2026-11-13";
export const WK5_SATURDAY = "2026-11-14";
const MON = "2026-11-09";
const TUE = "2026-11-10";
const WED = "2026-11-11";

export const at = (date: string, t: string) => `${date}T${t}:00-05:00`;

type Pick = { id: number; status: string; half: string; clientKey: string; itemId: number | null; title: string };
type Slot = { focus: { clientKey: string }[] };
type WeekData = { plan?: Record<string, { picks: Pick[] }>; week: { days: { date: string; am: Slot; pm: Slot }[] } };

const load = async (page: Page) => (await call(page, "week.load", {})).data as unknown as WeekData;
const ready = async (page: Page) => {
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
};
const must = <T>(r: { ok: boolean; data: Record<string, unknown> }, what: string): T => {
  if (!r.ok) throw new Error(`WK-5 state: ${what}: ${JSON.stringify(r).slice(0, 300)}`);
  return r.data as T;
};

async function add(page: Page, date: string, half: "AM" | "PM", clientKey: string, what: { itemId?: number; title?: string; size?: string }): Promise<number> {
  const input = { date, half, clientKey, ...(what.itemId ? { itemId: what.itemId } : { intention: what.title }), ...(what.size ? { size: what.size } : {}) };
  return must<{ pick: { id: number } }>(await call(page, "pick.add", input), `add ${what.title ?? what.itemId}`).pick.id;
}
async function box(page: Page, pickId: number, date: string, a: string, b: string) {
  must(await call(page, "timebox.add", { pickId, date, start: at(date, a), end: at(date, b) }), `timebox ${pickId}`);
}

/** Today's to-dos, in the order the board adds them (the 9:00 one goes under the second feature). */
export const TODAY_AM = {
  intake: "Validate date of birth",
  reminders: "SMS reminder template",
  longA: "Create the intake export mapping for the billing team and the front desk",
  longB: "Draft the questions for the operations lead about the new referral rules",
};

/** Builds the state in this page's demo session, then reloads. */
export async function buildWk5(page: Page): Promise<void> {
  await emptyFrom(page, WK5_TODAY);
  const w = await load(page);
  const picks = (d: string) => w.plan?.[d]?.picks ?? [];
  const cl = (d: string, h: "am" | "pm") => w.week.days.find((x) => x.date === d)![h].focus[0]!.clientKey;
  const thuAm = cl(WK5_TODAY, "am");
  const thuPm = cl(WK5_TODAY, "pm");

  // Past days (a past day takes no new to-dos, so the demo's own): Monday's afternoon one is ticked done, Tuesday's
  // morning story moves on to today (a moved line on Tuesday), Wednesday keeps its done one. "More than six" is a unit
  // test (plan/pastrows.test.ts).
  const monPm = picks(MON).find((p) => p.half === "PM" && p.status === "planned");
  if (monPm) must(await call(page, "pick.mark_done", { id: monPm.id, done: true }), "mon done");
  const tueStory = picks(TUE).find((p) => p.half === "AM" && p.itemId !== null);
  if (tueStory) must(await call(page, "pick.move", { id: tueStory.id, date: WK5_TODAY, half: "AM" }), "move tue");
  void WED;

  // Today's morning: the moved story (intake feature) at 10:30, the reminders story at 9:00, a long untimed-feature one
  // at 11:30 and a long untimed one.
  const after = await load(page);
  const moved = (after.plan?.[WK5_TODAY]?.picks ?? []).find((p) => p.half === "AM" && p.itemId !== null && p.status === "planned");
  const intake = moved?.id ?? (await add(page, WK5_TODAY, "AM", thuAm, { itemId: 2212, size: "S" }));
  const reminders = await add(page, WK5_TODAY, "AM", thuAm, { itemId: 2221, size: "M" });
  const longA = await add(page, WK5_TODAY, "AM", thuAm, { title: TODAY_AM.longA, size: "S" });
  await add(page, WK5_TODAY, "AM", thuAm, { title: TODAY_AM.longB });
  await box(page, intake, WK5_TODAY, "10:30", "11:30");
  await box(page, reminders, WK5_TODAY, "09:00", "10:30");
  await box(page, longA, WK5_TODAY, "11:30", "12:30");

  // Today's afternoon: two timed, one untimed.
  const delay = await add(page, WK5_TODAY, "PM", thuPm, { itemId: 3312, size: "M" });
  const rates = await add(page, WK5_TODAY, "PM", thuPm, { title: "Draft the carrier rate questions for Casey before the Friday call", size: "S" });
  await add(page, WK5_TODAY, "PM", thuPm, { title: "Estimate the rate table import" });
  await box(page, delay, WK5_TODAY, "13:00", "14:00");
  await box(page, rates, WK5_TODAY, "14:00", "15:30");

  // Friday's catch-up and Saturday: one to-do each, moved there from today (the way a person puts work there).
  const fri = await add(page, WK5_TODAY, "PM", thuPm, { title: "Catch up on the carrier rate review notes", size: "M" });
  must(await call(page, "pick.move", { id: fri, date: WK5_FRIDAY, half: "AM" }), "move to friday");
  const sat = await add(page, WK5_TODAY, "PM", thuPm, { title: "Read the carrier contract draft", size: "S" });
  must(await call(page, "pick.move", { id: sat, date: WK5_SATURDAY, half: "AM" }), "move to saturday");

  await page.reload();
  await ready(page);
}
