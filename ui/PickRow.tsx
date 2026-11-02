// One pick, one row (step 15, D269): checkbox, title, size chip, time, ⋯. The same row on week cards, Today and Plan
// the day. Every other action (move, drop, timebox, open, Needs help from…) is in ⋯ and on right-click.
// U2: density "today" is the same row on Today's Now, Check-in and Close out: no size chip, the title a link to
// DevOps with its #id as the cue, "+ time" and ⋯ on hover only (always on the next pick), a badge and actions on the right.
import { useContext, type DragEvent, type ReactNode } from "react";
import { SIZES, type Pick, type Size } from "../plan/types.ts";
import { focusLabel } from "../plan/focus.ts";
import { pickMenu } from "./menu.ts";
import { MenuCtx, useMenu } from "./Menus.tsx";
import { ITEM_ATTRS } from "./keys.ts";
import { PickTime } from "./PickTime.tsx";
import { useFocused } from "./planview.ts";
import { WorkLink } from "./WorkLink.tsx";

/** The next size when the chip is clicked: S, M, L, then S again. */
export const nextSize = (s: Size): Size => SIZES[(SIZES.indexOf(s) + 1) % SIZES.length]!;

export const PICK_DRAG = "application/x-coopilot-pick";

type Props = {
  pick: Pick;
  toggle: (id: number, done: boolean) => void;
  /** Title as a link to the work item (Today, Plan the day); plain text on cards so a click selects the card. */
  link?: boolean;
  /** Ticking needs a committed day on Today (a draft plan shows "draft"). */
  canTick?: boolean;
  timeEditable?: boolean;
  hint?: boolean;
  /** Marked by "trim": a pick to shrink or move so the block fits. */
  highlight?: boolean;
  /** Something after the title (Today: Start focus; Plan the day: "· from Tue"). */
  extra?: ReactNode;
  /** A past day: the size chip doesn't change. */
  readOnly?: boolean;
  draggable?: boolean;
  tabIndex?: number;
  className?: string;
  /** U2: "today" for Today's Now, Check-in and Close out. */
  density?: "default" | "today";
  /** U2: the next pick: highlighted, its controls always shown. */
  next?: boolean;
  /** U2: on the right before the hover controls (a due badge, "45m focused", the fit word). */
  badge?: ReactNode;
  /** U2: always-visible buttons on the right (Start focus, the timer, one suggested move). */
  actions?: ReactNode;
};

export function PickRow({ pick, toggle, link = false, canTick = true, timeEditable = true, hint = false, highlight = false, extra, readOnly = false, draggable = false, tabIndex, className = "", density = "default", next = false, badge, actions }: Props) {
  const today = density === "today";
  const menu = useMenu((env) => pickMenu(env, pick));
  const { env } = useContext(MenuCtx);
  const focused = focusLabel(useFocused()(pick.id), pick.size);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const onDrag = (e: DragEvent) => {
    e.dataTransfer.setData(PICK_DRAG, String(pick.id));
    e.dataTransfer.effectAllowed = "move";
  };
  const sizeChip =
    readOnly || pick.status !== "planned" || !env ? (
      <span className="size-chip static" title={focused ? `${focused} focused` : `Size ${pick.size}`}>{pick.size}</span>
    ) : (
      <button type="button" className="size-chip" tabIndex={tabIndex} title={`Size ${pick.size}. Click for ${nextSize(pick.size)}`} aria-label={`Size ${pick.size}, change to ${nextSize(pick.size)}`} onClick={(e) => (stop(e), void env.runPlan("pick.set_size", { id: pick.id, size: nextSize(pick.size) }))} onDoubleClick={stop}>
        {pick.size}
      </button>
    );
  return (
    <li data-pick={pick.id} className={`pick-row ${pick.status}${highlight ? " trim" : ""}${today ? " dens-today" : ""}${next ? " next" : ""} ${className}`} onContextMenu={menu.onContextMenu} draggable={draggable} onDragStart={draggable ? onDrag : undefined} {...ITEM_ATTRS(pick.clientKey, pick.itemUrl)}>
      <input type="checkbox" tabIndex={tabIndex} checked={pick.status === "done"} disabled={!canTick || pick.status === "dropped"} onChange={(e) => toggle(pick.id, e.target.checked)} onClick={stop} onDoubleClick={stop} aria-label={`Done: ${pick.title}`} />
      <span className="pr-title" title={pick.title}>
        {link && pick.itemUrl ? (
          <WorkLink clientKey={pick.clientKey} url={pick.itemUrl} className={today ? "pr-link" : undefined} title={today ? `Open #${pick.itemId ?? ""} in DevOps` : undefined}>
            {pick.title}
            {today && pick.itemId !== null && <span className="pr-id">#{pick.itemId}</span>}
          </WorkLink>
        ) : (
          pick.title
        )}
      </span>
      {extra}
      {today ? (
        <>
          {badge}
          {actions}
          <span className="pr-hover">
            <PickTime pick={pick} editable={timeEditable && !readOnly} hint={hint} />
            {menu.button(`More for ${pick.title}`)}
          </span>
        </>
      ) : (
        <>
          {sizeChip}
          <PickTime pick={pick} editable={timeEditable && !readOnly} hint={hint} />
          {menu.button(`More for ${pick.title}`)}
        </>
      )}
    </li>
  );
}
