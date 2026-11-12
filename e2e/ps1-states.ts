// PS-1: the three states the polish sweep is judged on, built in the demo through the app's own actions (fictional
// data only). The "before" and "after" screenshots and the browser checks use the same script, so they match.
//   empty    Tuesday and later have no to-dos: the board's suggestions show.
//   ordinary three or four to-dos a block today, some done, a promise due, an at-risk block (the demo's own).
//   heavy    eight or more to-dos in today's morning block, long titles, three due chips.
// PS-2: ordinary and heavy also put three DevOps stories with long titles (made through the demo's own create) on
// today's morning block, so its rows show "#id" cues and the panel lists them under its feature, and two long draft
// stories (one under the feature, one to place).
import type { Page } from "playwright-core";
import { call, emptyFrom } from "./sg1-helpers.ts";

export type PsState = "empty" | "ordinary" | "heavy";
export const PS_TODAY = "2026-11-03";
/** Tuesday 9:30 AM: Monday is past, the morning block is under way, Wednesday is the next working day. */
export const PS_CLOCK = "2026-11-03T09:30:00-05:00";

type Day = { picks: { id: number; status: string; half: string; clientKey: string }[] };
type Slot = { half: string; focus: { clientKey: string }[]; pto: boolean };
type WeekData = { plan?: Record<string, Day>; week: { days: { date: string; am: Slot; pm: Slot }[] }; devops?: { clientKey: string; items: { id: number; tier?: string; assignedToMe?: boolean }[] }[] };

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

export const LONG_ITEMS = [
  "Let the front desk upload a scanned insurance card from the intake tablet before the visit starts",
  "Check the date of birth against the insurer's record and flag a mismatch for the front desk to resolve",
  "Show the patient a summary of what they entered before they submit the intake form",
];

/** PS-2: three new stories under the client's first open feature of mine, made through the write framework; their ids. */
async function longItems(page: Page, w: WeekData, clientKey: string): Promise<number[]> {
  const work = (w.devops ?? []).find((c) => c.clientKey === clientKey);
  const feature = work?.items.find((i) => i.tier === "feature" && i.assignedToMe);
  if (!feature) return [];
  const ids: number[] = [];
  for (const title of LONG_ITEMS) {
    const pv = await call(page, "devops.preview", { clientKey, change: { kind: "new_item", title, type: "User Story", parentId: feature.id } });
    const previewId = (pv.data as { preview?: { previewId: string } } | undefined)?.preview?.previewId;
    if (!previewId) continue;
    const c = await call(page, "devops.confirm", { previewId });
    const id = (c.data as { entry?: { itemId: number | null } } | undefined)?.entry?.itemId;
    if (id) ids.push(id);
  }
  // Two long draft stories: one under the feature (listed with it in the panel), one with none (To place).
  await call(page, "draft.add_story", { clientKey, parentItemId: feature.id, title: "Draft: let the front desk see which intake forms are waiting for a signature this morning", size: "M" });
  await call(page, "draft.add_story", { clientKey, parentItemId: null, title: "Draft: ask the insurer which fields their eligibility check needs before we build the intake export", size: "S" });
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
  if (am) for (const [i, itemId] of (await longItems(page, w, am)).entries()) await call(page, "pick.add", { date: PS_TODAY, half: "AM", clientKey: am, itemId, size: ["M", "S", "L"][i] });
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
