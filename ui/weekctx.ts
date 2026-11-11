// WD-1: the contexts Week's grid gives its block cards (ui/BlockCard.tsx), in one place so the card can live in its
// own file and Day can use it in WD-2.
import { createContext } from "react";
import type { CoworkChatView } from "../plan/cowork.ts";
import type { RailItem } from "../plan/inbox-items.ts";
import type { RailSpan } from "../plan/rail-promises.ts";
import type { Half, IsoDate } from "../week/types.ts";
import type { Layout } from "./viewport.ts";
import type { Tier } from "./weekfit.ts";

export type Selection = { dayIndex: number; half: Half };
/** U3: where the detail panel opens: the features list, one follow-up or one pick. */
export type PanelFocus = { kind: "features" } | { kind: "followup"; id: number } | { kind: "pick"; id: number };

/** WK-1: the Board's tier (weekfit.ts), null outside the medium layout (the wide timeline, the one-day view). */
export const TierCtx = createContext<Tier | null>(null);
/** WK-2: the Timeline switch; off, cards draw no rail, strip or hour timeline and sum up their meetings in one line. */
export const TimelineCtx = createContext(true);

/** UI-9: `late` is each card's late promises (by rail key), its chip's count when the card draws no rail; `onLate` opens several. */
export type RulerCtxValue = { layout: Layout; promises: readonly RailItem[]; onPromise?: ((key: string) => void) | undefined; onLate?: ((clientKey: string | null) => void) | undefined; today: string; now: string; home: RailSpan | null; late: ReadonlyMap<string, RailItem[]> };
export const RulerCtx = createContext<RulerCtxValue>({ layout: "wide", promises: [], today: "", now: "", home: null, late: new Map() });
/** CW-1: the live co-working calls each of today's cards shows (by rail key): a client's on its first card not ended. */
export const LiveOnCard = createContext<ReadonlyMap<string, CoworkChatView[]>>(new Map());

/**
 * WD-1: the block panel's state, for the cards: the selected block while it is open (null: closed), and opening it
 * on a block ("+ Add" on a card).
 */
export type AddPanelApi = { at: { date: IsoDate; half: Half } | null; open: (date: IsoDate, half: Half) => void };
export const AddPanelCtx = createContext<AddPanelApi>({ at: null, open: () => {} });

/**
 * WD-2: Day today's next to-do (the first planned one in the first block that hasn't ended, or the one being timed):
 * its row on the card is highlighted and carries Start focus or the running timer. Null everywhere else.
 */
export type NextTodo = { id: number | null; actions: (p: import("../plan/types.ts").Pick) => import("react").ReactNode };
export const NextTodoCtx = createContext<NextTodo | null>(null);
