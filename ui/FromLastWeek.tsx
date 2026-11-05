// NV-1: "From last week" on Week's Board: the unfinished picks from earlier days (carry-over), which Plan the day
// used to offer only on the carry-over day ("Unfinished work from earlier days shows on Mon…"). One row each, with
// the day it was planned for; drag it onto a block, Move to…, or Plan <day> to bring it in from the focused day.
// Read with planday.carry, which opens no day. Hidden when there is nothing or the week shown isn't this week.
import { useEffect, useState, type CSSProperties } from "react";
import type { Pick } from "../plan/types.ts";
import type { IsoDate } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor, shortDate } from "./labels.ts";
import { MenuRow } from "./Menus.tsx";
import { pickMenu } from "./menu.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { MoveTo, pickDragged, useDragSource } from "./WeekStories.tsx";

type Carry = { target: IsoDate | null; picks: Pick[] };

export function FromLastWeek({ version, colors, nameOf, onPlanDay }: { version: unknown; colors: Record<string, string>; nameOf: (k: string) => string; onPlanDay: (d: IsoDate) => void }) {
  const [carry, setCarry] = useState<Carry | null>(null);
  useEffect(() => {
    let live = true;
    call<Carry>("planday.carry", {}).then((c) => live && setCarry(c), () => live && setCarry(null));
    return () => void (live = false);
  }, [version]);
  if (!carry || !carry.picks.length) return null;
  const day = carry.target ? Temporal.PlainDate.from(carry.target).toLocaleString("en-US", { weekday: "short" }) : null;
  return (
    <section className="from-last-week" aria-label="From last week">
      <header className="flw-head">
        <h2 className="section-label">From last week</h2>
        <span className="muted">
          {carry.picks.length} unfinished · drag onto a block or use Move to…
        </span>
        {carry.target && day && (
          <button type="button" className="link-btn" onClick={() => onPlanDay(carry.target!)}>
            Plan {day}
          </button>
        )}
      </header>
      <ul className="flw-list">
        {carry.picks.map((p) => (
          <CarryRow key={p.id} pick={p} color={clientColor(p.clientKey, colors)} client={nameOf(p.clientKey)} />
        ))}
      </ul>
    </section>
  );
}

function CarryRow({ pick, color, client }: { pick: Pick; color: string; client: string }) {
  const drag = useDragSource(pickDragged(pick));
  return (
    <li className="flw-row" style={{ "--c": color } as CSSProperties} {...drag}>
      <MenuRow build={(env) => pickMenu(env, pick)} label={`More for ${pick.title}`} item={{ clientKey: pick.clientKey, url: pick.itemUrl }} className="flw-row-inner">
        <span className="swatch" aria-hidden="true" />
        {pick.itemType && <TypeIcon clientKey={pick.clientKey} type={pick.itemType} decorative />}
        <span className="pr-title">{pick.title}</span>
        <span className="pr-note">
          {client} · from {shortDate(pick.date)}
        </span>
        <MoveTo pick={pick} />
      </MenuRow>
    </li>
  );
}
