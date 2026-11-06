// PL-1: "From last week" on Week's Board: last week's features as a proposal for this week (weekplan.proposal,
// nothing added until accepted: Accept all, or Keep, Watch, Drop row by row) and the Watching rows with their check-ins.
// UI-B: unfinished picks of this week moved to suggested cards (ui/Carry.tsx); only picks from earlier weeks stay here,
// as "N unfinished picks from last week", grouped by client and feature, with drag and Move to….
import { useContext, useState } from "react";
import type { IsoDate, Week } from "../week/types.ts";
import { CarryCtx, Grouped, ListRow } from "./Carry.tsx";
import { FoldLine } from "./plan/FoldLine.tsx";
import { checkinDays, ProposalSection, useProposal, WatchingList } from "./Watching.tsx";

export function FromLastWeek({ version, colors, nameOf, weekStart, week, today, onChanged }: { version: unknown; colors: Record<string, string>; nameOf: (k: string) => string; weekStart: IsoDate; week: Week; today: IsoDate; onChanged: () => void }) {
  const carry = useContext(CarryCtx);
  const [open, setOpen] = useState(false);
  const proposal = useProposal(weekStart, version, onChanged);
  const picks = carry?.plan.earlierWeeks ?? [];
  const p = proposal.data;
  const rows = p ? p.clients.flatMap((c) => c.rows).length : 0;
  if (!rows && !picks.length && !p?.watching.length) return null;
  const unfinished = picks.length > 0 && (
    <div className="flw-picks">
      <FoldLine className="flw-fold" open={open} onToggle={() => setOpen((o) => !o)} label={`${picks.length} unfinished ${picks.length === 1 ? "to-do" : "to-dos"} from last week`} title="Drag one onto a block, or use Move to…" />
      {open && <Grouped picks={picks} colors={colors} nameOf={nameOf} row={(pk) => <ListRow pick={pk} />} />}
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
