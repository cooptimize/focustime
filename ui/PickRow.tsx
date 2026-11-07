// One pick, one row (step 15, D269): checkbox, title, size chip, time, ⋯. The same row on week cards, Today and Plan
// the day. Every other action (move, drop, timebox, open, Ask to collaborate) is in ⋯ and on right-click.
// U2: density "today" is the same row on Today's Now, Check-in and Close out: no size chip, the title a link to
// DevOps with its #id as the cue, "+ time" and ⋯ on hover only (always on the next pick), a badge and actions on the right.
// U4: density "plan" is Plan the day's row: a drag handle, no checkbox (ticking is Today's job; a done pick shows a ✓
// and is struck), the title, a due badge, the size chip always (planning is where sizes live), + time and ⋯ on hover.
import { ResolvedMark, TypeIcon } from "./TypeIcon.tsx";
import { useContext, type DragEvent, type HTMLAttributes, type ReactNode } from "react";
import type { Pick } from "../plan/types.ts";
import { SizeChip } from "./plan/Estimate.tsx";
import { focusLabel } from "../plan/focus.ts";
import { pickMenu } from "./menu.ts";
import { MenuCtx, useMenu } from "./Menus.tsx";
import { ITEM_ATTRS } from "./keys.ts";
import { PickTime } from "./PickTime.tsx";
import { pickTime } from "../plan/picktime.ts";
import { useTimeboxes } from "./Timeboxes.tsx";
import { useFocused } from "./planview.ts";
import { WorkLink } from "./WorkLink.tsx";
import { PlanRow } from "./plan/PlanRow.tsx";
import { useTodoSheet } from "./TodoSheet.tsx";
import { DevOpsWork } from "./work.ts";
import { isResolved } from "../plan/process.ts";

export const PICK_DRAG = "application/x-focustime-pick";

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
  /** U2: "today" for Today's Now, Check-in and Close out. U3: "week" for Week's cards (size, + time and ⋯ on hover). */
  density?: "default" | "today" | "week" | "plan";
  /** U2: the next pick: highlighted, its controls always shown. */
  next?: boolean;
  /** U2: on the right before the hover controls (a due badge, "45m focused", the fit word). */
  badge?: ReactNode;
  /** U2: always-visible buttons on the right (Start focus, the timer, one suggested move). */
  actions?: ReactNode;
  /** PV-1: the item's type icon before the title (Week's cards and the Week panel). */
  typeIcon?: boolean;
  /** PV-1: Week's drag and drop (drag to another block, long-press on touch) instead of `draggable`. */
  dragProps?: HTMLAttributes<HTMLLIElement> | undefined;
};

export function PickRow({ pick, toggle, link = false, canTick = true, timeEditable = true, hint = false, highlight = false, extra, readOnly = false, draggable = false, tabIndex, className = "", density = "default", next = false, badge, actions, typeIcon = false, dragProps }: Props) {
  const today = density === "today";
  const week = density === "week";
  const planD = density === "plan";
  const tbs = useTimeboxes();
  const timed = (week || planD) && !!tbs && tbs.settings.enabled && pickTime(pick.id, tbs.timeboxes).state !== "untimed";
  const menu = useMenu((env) => pickMenu(env, pick));
  // MB-1: on the phone ⋯ opens the to-do's sheet (the same as Today's); elsewhere the menu, as before.
  const sheet = useTodoSheet();
  const more = sheet ? (
    <button type="button" className="more-btn ph-more" aria-label={`More for ${pick.title}`} aria-haspopup="dialog" onClick={(e) => (e.stopPropagation(), sheet(pick))} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      ⋯
    </button>
  ) : (
    menu.button(`More for ${pick.title}`)
  );
  const { env } = useContext(MenuCtx);
  const focused = focusLabel(useFocused()(pick.id), pick.size);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const onDrag = (e: DragEvent) => {
    e.dataTransfer.setData(PICK_DRAG, String(pick.id));
    e.dataTransfer.effectAllowed = "move";
  };
  // E2: S, M, L or a muted "Size?"; a click opens S, M, L, Clear. "M · 2h" on Plan the day's roomy row.
  // WT-1: an item DevOps has resolved shows a small Resolved marker (no hours left, not closed).
  const workAll = useContext(DevOpsWork).get(pick.clientKey);
  const seen = pick.itemId !== null && workAll ? [...workAll.items, ...workAll.children, ...(workAll.watched ?? [])].find((i) => i.id === pick.itemId) : undefined;
  const resolved = seen && isResolved(seen.stateCategory) ? seen : null;
  const sizeChip = (
    <SizeChip size={pick.size} title={pick.title} wide={planD} tabIndex={tabIndex} note={focused ? `${focused} focused` : null}
      {...(readOnly || pick.status !== "planned" || !env ? {} : { onSet: (size) => void env.runPlan("pick.set_size", { id: pick.id, size }) })} />
  );
  // MB-1: on the phone (the sheet is there only on the phone) every to-do row puts its title on its own line (two at
  // most) and its chips (time, size, + time, ⋯) on a smaller second line, so a chip never squeezes the title.
  if (sheet) {
    const titleNode = link && pick.itemUrl ? <WorkLink clientKey={pick.clientKey} url={pick.itemUrl}>{pick.title}</WorkLink> : pick.title;
    const line2 = (
      <span className="pr-line2">
        {extra}
        {resolved && <ResolvedMark state={resolved.state} />}
        {badge}
        {actions}
        <PickTime pick={pick} editable={timeEditable && !readOnly} hint={hint} />
        {sizeChip}
        {more}
      </span>
    );
    if (planD)
      return (
        <PlanRow data-pick={pick.id} className={`pick-row ${pick.status}${highlight ? " trim" : ""} dens-plan ph-row ${className}`} onContextMenu={menu.onContextMenu} {...ITEM_ATTRS(pick.clientKey, pick.itemUrl)}
          handle={pick.status === "done" ? "✓" : "⋮⋮"} titleText={pick.title}
          icon={pick.itemType ? <TypeIcon clientKey={pick.clientKey} type={pick.itemType} /> : undefined}
          title={titleNode}>
          {line2}
        </PlanRow>
      );
    return (
      <li data-pick={pick.id} className={`pick-row ${pick.status}${highlight ? " trim" : ""}${today ? " dens-today" : ""}${week ? " dens-week" : ""}${next ? " next" : ""} ph-row ${className}`} onContextMenu={menu.onContextMenu} {...(dragProps ?? {})} {...ITEM_ATTRS(pick.clientKey, pick.itemUrl)}>
        <input type="checkbox" tabIndex={tabIndex} checked={pick.status === "done"} disabled={!canTick || pick.status === "dropped"} onChange={(e) => toggle(pick.id, e.target.checked)} onClick={stop} onDoubleClick={stop} aria-label={`Done: ${pick.title}`} />
        {typeIcon && pick.itemType && <TypeIcon clientKey={pick.clientKey} type={pick.itemType} />}
        <span className="pr-title" title={pick.title}>
          {titleNode}
        </span>
        {line2}
      </li>
    );
  }
  if (planD)
    // U6: Plan the day's row is the shared planning row (ui/plan/PlanRow.tsx).
    return (
      <PlanRow data-pick={pick.id} className={`pick-row ${pick.status}${highlight ? " trim" : ""} dens-plan ${className}`} onContextMenu={menu.onContextMenu} draggable={draggable} onDragStart={draggable ? onDrag : undefined} {...ITEM_ATTRS(pick.clientKey, pick.itemUrl)}
        handle={pick.status === "done" ? "✓" : "⋮⋮"} titleText={pick.title}
        icon={pick.itemType ? <TypeIcon clientKey={pick.clientKey} type={pick.itemType} /> : undefined}
        title={link && pick.itemUrl ? <WorkLink clientKey={pick.clientKey} url={pick.itemUrl}>{pick.title}</WorkLink> : pick.title}
        badges={<>{resolved && <ResolvedMark state={resolved.state} />}{extra}{badge}</>}
        right={<>{timed && <PickTime pick={pick} editable={timeEditable && !readOnly} hint={hint} />}{sizeChip}</>}
        hover={<>{!timed && <PickTime pick={pick} editable={timeEditable && !readOnly} hint={hint} />}{more}</>} />
    );
  return (
    <li data-pick={pick.id} className={`pick-row ${pick.status}${highlight ? " trim" : ""}${today ? " dens-today" : ""}${week ? " dens-week" : ""}${next ? " next" : ""} ${className}`} onContextMenu={menu.onContextMenu} {...(dragProps ?? { draggable, onDragStart: draggable ? onDrag : undefined })} {...ITEM_ATTRS(pick.clientKey, pick.itemUrl)}>
      <input type="checkbox" tabIndex={tabIndex} checked={pick.status === "done"} disabled={!canTick || pick.status === "dropped"} onChange={(e) => toggle(pick.id, e.target.checked)} onClick={stop} onDoubleClick={stop} aria-label={`Done: ${pick.title}`} />
      {typeIcon && pick.itemType && <TypeIcon clientKey={pick.clientKey} type={pick.itemType} />}
      <span className="pr-title" title={pick.title}>
        {link && pick.itemUrl ? (
          <WorkLink clientKey={pick.clientKey} url={pick.itemUrl} className={today ? "pr-link pr-cue" : undefined} title={today ? `${pick.title}\nOpen #${pick.itemId ?? ""} in DevOps` : undefined}>
            {today ? <span className="pr-text">{pick.title}</span> : pick.title}
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
            {more}
          </span>
        </>
      ) : week ? (
        <>
          {badge}
          {timed && <PickTime pick={pick} editable={timeEditable && !readOnly} />}
          <span className="pr-hover">
            {sizeChip}
            {!timed && <PickTime pick={pick} editable={timeEditable && !readOnly} />}
            {more}
          </span>
        </>
      ) : (
        <>
          {sizeChip}
          <PickTime pick={pick} editable={timeEditable && !readOnly} hint={hint} />
          {more}
        </>
      )}
    </li>
  );
}
