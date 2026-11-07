// UI-5: the Guide's "Show me" tours, as data. A tour opens a real screen and walks through it one element at a time:
// it only highlights and explains, never clicks, types or writes (ui/guide/tour/Tour.tsx blocks the page under it).
// Each step points at a `data-tour` hook on the real screen (listed in docs/guide.md). Where the screen has nothing
// there yet (no From last week, no client with blocks), the step shows a small example drawing instead.
// This file is plain data so nav.ts, the link checker and the tests can read it without loading the Guide.
import type { Nav } from "../nav.ts";

/** The example drawings a step can show in place of an empty highlight (ui/guide/tour/Illustrations.tsx). */
export type IllustrationId = "pw-grid" | "pw-carry" | "pw-card" | "pw-add" | "pw-next";

export type TourStep = {
  /** The `data-tour` value on the real screen this step points at. */
  target: string;
  title: string;
  text: string;
  /** Shown when the target isn't on screen, or (`emptyWhen`) is there with nothing in it. Without it the step is skipped. */
  example?: IllustrationId;
  /** A selector inside the target: when it matches nothing, the target counts as empty. */
  emptyWhen?: string;
  /** On a phone: other words, or skip the step. */
  phone?: { text: string } | "skip";
};

export type Tour = {
  id: string;
  title: string;
  /** One line for the Show me button. */
  summary: string;
  /** Where the tour opens. */
  start: Nav;
  steps: TourStep[];
  /** The last card: one line, then what to try yourself. */
  end: { line: string; tryIt: string };
};

const PLAN_WEEK: Tour = {
  id: "plan-week",
  title: "Plan your week",
  summary: "Choose the features you'll touch next week, one client at a time.",
  start: { tab: "week", mode: "commit", week: null, focus: null },
  steps: [
    {
      target: "modes-week",
      title: "Week › Plan",
      text: "Plan is Week's second mode. It opens on next week. You plan features here; the to-dos come later, on the Board.",
    },
    {
      target: "pw-grid",
      title: "Your blocks for the week",
      text: "Each cell is a half-day block from Focus Time in Dataverse, in its client's color. PTO is hatched and Friday is catch-up. Click a cell to open its client.",
      example: "pw-grid",
      phone: { text: "Each cell is a half-day block from Focus Time in Dataverse, in its client's color. PTO is hatched and Friday is catch-up." },
    },
    {
      target: "pw-carry",
      title: "From last week",
      text: "Last week's features come first, each with one suggestion: carry it over, watch it, or it's finished. Nothing is added until you choose.",
      example: "pw-carry",
    },
    {
      target: "pw-open-card",
      title: "One client at a time",
      text: "Musts are what you'll definitely touch; nice to haves fit if there's room. The line at the top compares the hours you planned with the free time in that client's blocks. Over turns amber, never red.",
      example: "pw-card",
      // No musts yet: the example card, not an empty ring.
      emptyWhen: ".pw-features",
    },
    {
      target: "pw-addpane",
      title: "Add from DevOps",
      text: "The right side lists that client's DevOps work assigned to you. Add a feature as a must or a nice to have, or type a draft feature at the bottom.",
      example: "pw-add",
      phone: "skip",
    },
    {
      target: "pw-next",
      title: "Next client",
      text: "Next client moves on (J and K do too). When every client is planned, this button reads Confirm week.",
      example: "pw-next",
      phone: { text: "Next client moves on. Planning works best on a bigger screen: Copy link at the top opens this week on your computer." },
    },
    {
      target: "mode-done",
      title: "Confirm week",
      text: "Confirm week saves your lists and goes back to the Board. You can change and confirm again any time; the header says if it changed since.",
      phone: "skip",
    },
  ],
  end: { line: "That's planning. About 15 minutes on a Thursday or Friday.", tryIt: "Try it yourself: open Week › Plan with W, or close this and start from the first client." },
};

/** Every tour, in the Guide's order. UI-5's next build adds the other six from the approved list. */
export const TOURS: readonly Tour[] = [PLAN_WEEK];

export const tourById = (id: string): Tour | undefined => TOURS.find((t) => t.id === id);
