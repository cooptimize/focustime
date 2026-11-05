// PL-1 (replaces NV-1's read-only list): "From last week" on Week's Board: last week's features as a proposal for this
// week (weekplan.proposal, nothing added until accepted: Accept all, or Keep, Watch, Drop row by row), the Watching
// rows with their check-ins, and NV-1's unfinished picks from earlier days folded into one line ("3 unfinished picks
// from earlier days") that opens the rows with drag and Move to…. Only on this week's Board; hidden when empty.
import { useEffect, useState, type CSSProperties } from "react";
import type { Pick } from "../plan/types.ts";
import type { IsoDate, Week } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor, shortDate } from "./labels.ts";
import { MenuRow } from "./Menus.tsx";
import { pickMenu } from "./menu.ts";
import { FoldLine } from "./plan/FoldLine.tsx";
import { TypeIcon } from "./TypeIcon.tsx";
import { checkinDays, ProposalSection, useProposal, WatchingList } from "./Watching.tsx";
import { MoveTo, pickDragged, useDragSource } from "./WeekStories.tsx";

type Carry = { target: IsoDate | null; picks: Pick[] };

export function FromLastWeek({ version, colors, nameOf, onPlanDay, weekStart, week, today, onChanged }: { version: unknown; colors: Record<string, string>; nameOf: (k: string) => string; onPlanDay: (d: IsoDate) => void; weekStart: IsoDate; week: Week; today: IsoDate; onChanged: () => void }) {
  const [carry, setCarry] = useState<Carry | null>(null);
  const [open, setOpen] = useState(false);
  const proposal = useProposal(weekStart, version, onChanged);
  useEffect(() => {
    let live = true;
    call<Carry>("planday.carry", {}).then((c) => live && setCarry(c), () => live && setCarry(null));
    return () => void (live = false);
  }, [version]);
  const picks = carry?.picks ?? [];
  const p = proposal.data;
  const rows = p ? p.clients.flatMap((c) => c.rows).length : 0;
  if (!rows && !picks.length && !p?.watching.length) return null;
  const day = carry?.target ? Temporal.PlainDate.from(carry.target).toLocaleString("en-US", { weekday: "short" }) : null;
  const unfinished = picks.length > 0 && (
    <div className="flw-picks">
      <FoldLine className="flw-fold" open={open} onToggle={() => setOpen((o) => !o)} label={`${picks.length} unfinished ${picks.length === 1 ? "pick" : "picks"} from earlier days`} title="Drag one onto a block, or use Move to…" />
      {open && (
        <>
          {carry?.target && day && (
            <button type="button" className="link-btn flw-plan" onClick={() => onPlanDay(carry.target!)}>
              Plan {day}
            </button>
          )}
          <ul className="flw-list">
            {picks.map((pk) => (
              <CarryRow key={pk.id} pick={pk} color={clientColor(pk.clientKey, colors)} client={nameOf(pk.clientKey)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
  return (
    <section className="from-last-week" aria-label="From last week">
      {p ? (
        <ProposalSection data={p} act={proposal.act} onRefresh={onChanged} colors={colors}>
          {proposal.error && <p className="error-line" role="alert">{proposal.error}</p>}
          <WatchingList watching={p.watching} act={proposal.act} colors={colors} nameOf={nameOf} days={checkinDays(week, today)} />
          {unfinished}
        </ProposalSection>
      ) : (
        unfinished
      )}
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
