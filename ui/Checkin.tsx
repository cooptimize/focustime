// Day's Midday check-in (U2; its own file since WD-2, unchanged in what it does): the day's blocks as check-in cards
// (ended blocks dim, done to-dos a count, each to-do that won't fit with one suggested move, one amber line per
// block), then walk-on work once at the foot. Day opens it from its moment card; Done marks the day checked in.
import { DueBadge } from "./FollowUps.tsx";
import { useContext, useState, type CSSProperties } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { aboutHours } from "../plan/fit.ts";
import { PickRow } from "./PickRow.tsx";
import type { Pick } from "../plan/types.ts";
import type { Half, IsoDate, Slot } from "../week/types.ts";
import { clientColor, halfName } from "./labels.ts";
import { PlanCtx } from "./planview.ts";
import { type CheckSlot } from "../plan/checkin.ts";
import { suggestedMove } from "../plan/checkinmove.ts";
import { blockClient, isPickable } from "../plan/rules.ts";
import { formatDuration } from "../week/format.ts";
import { DevOpsWork } from "./work.ts";
import { dayName } from "./PickReview.tsx";

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
const live = (p: Pick) => p.status === "planned" || p.status === "done";

/** "about 4 hours left today", from the blocks that haven't ended. */
export function checkLeft(check: readonly CheckSlot[]): string {
  const left = check.reduce((n, c) => n + (c.ended ? 0 : c.leftMinutes), 0);
  return left > 0 ? `${aboutHours(left)} left today` : "no time left today";
}

type BlockProps = {
  slot: Slot;
  data: WeekLoadData;
  check: CheckSlot;
  picks: Pick[];
  tickable: boolean;
  ended: boolean;
  later: { half: Half; clientKey: string | null }[];
  carryTo: IsoDate | null;
  nameOf: (k: string) => string;
  act: (a: string, i: Record<string, unknown>) => Promise<boolean>;
  makeUp: (p: Pick, i: { when: "tonight" | "friday" | "day"; date?: IsoDate; half?: Half }) => Promise<boolean>;
};

/** One block in the check-in: what's left, whether each to-do still fits, and one suggested move. */
export function CheckinBlock(b: BlockProps) {
  const { slot, data, nameOf, ended } = b;
  const view = useContext(PlanCtx);
  const client = slot.focus[0]?.clientKey ?? null;
  const done = b.picks.filter((p) => p.status === "done");
  const title = client ? nameOf(client) : slot.open ? "Open" : halfName(slot.half);
  const followUp = (p: Pick) => (p.followUpId !== null ? data.followUps.find((f) => f.id === p.followUpId) ?? null : null);
  const c = b.check;
  const left = c.picks.filter((x) => x.pick.status === "planned");
  const head = ended ? `${halfName(slot.half)} · ended` : c.leftMinutes > 0 ? `${halfName(slot.half)} · ${aboutHours(c.leftMinutes)} left after meetings` : `${halfName(slot.half)} · no time left`;
  const owed = (p: Pick) => {
    const f = followUp(p);
    return !!f && f.due !== null && f.due <= data.planDay.date;
  };
  return (
    <article className={`today-block${ended ? " ended" : ""} ci`} style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties} aria-label={title}>
      <header>
        <h2>{title}</h2>
        <span className="tb-when">{head}</span>
        <span className="tb-count">{done.length} done</span>
      </header>
      <ul className="today-picks">
        {left.map(({ pick: p, fits, focusedMinutes }) => {
          const move = !fits || ended ? suggestedMove(p, { owedToday: owed(p), later: b.later, carryTo: b.carryTo }) : null;
          return (
            <PickRow
              key={p.id}
              pick={p}
              toggle={view.toggle}
              link
              density="today"
              canTick={b.tickable}
              timeEditable={!ended}
              className={!fits && !ended ? "nofit" : ""}
              badge={
                <>
                  {followUp(p) && <DueBadge l={followUp(p)!} />}
                  {focusedMinutes > 0 && <span className="pr-note">{formatDuration(focusedMinutes)} focused</span>}
                  {!ended && <span className={`pr-fit${fits ? "" : " watch"}`}>{p.size} · {fits ? "fits" : "doesn't fit"}</span>}
                </>
              }
              actions={move ? (
                <button type="button" className="mini ci-move" onClick={() => void (move.kind === "move" ? b.act("pick.move", { id: p.id, date: move.date, half: move.half }) : b.makeUp(p, { when: "tonight" }))} title={move.kind === "move" ? `Move to ${dayName(move.date)}, ${halfName(move.half).toLowerCase()}` : "Make it up tonight (borrowed time)"}>
                  {move.label}
                </button>
              ) : undefined}
            />
          );
        })}
      </ul>
      {!left.length && <p className="tb-empty">{done.length ? "All done here." : "Nothing planned here."}</p>}
      {ended && left.length > 0 && <p className="tb-line watch">{left.length} not done. Move {left.length === 1 ? "it" : "them"}, or leave {left.length === 1 ? "it" : "them"} for Close out.</p>}
      {!ended && c.overBy > 0 && <p className="tb-line watch">{c.overBy < 45 ? "A little over" : `${cap(aboutHours(c.overBy))} over`}. Move one?</p>}
    </article>
  );
}

/** Check-in's foot, once: walk-on work for a block (CF-1: no musts line). */
export function CheckinFoot({ data, date, blocks, picks, act, onAsks }: { data: WeekLoadData; date: IsoDate; blocks: Slot[]; picks: Pick[]; act: (a: string, i: Record<string, unknown>) => Promise<boolean>; onAsks: () => void }) {
  return (
    <div className="ci-foot">
      {blocks.length > 0 && <WalkOn data={data} date={date} blocks={blocks} picks={picks} act={act} />}
      {(data.requests?.pastUrgency ?? 0) > 0 && (
        <p className="ci-asks">
          <button type="button" className="link-btn" onClick={onAsks} title="Requests still open after their urgency (now: 2 hours; this week: Friday)">
            Walked in, not resolved ({data.requests.pastUrgency})
          </button>
        </p>
      )}
    </div>
  );
}

/** Walk-on work: a DevOps item of the block's client, or a typed intention, added to a block that hasn't ended. */
function WalkOn({ data, date, blocks, picks, act }: { data: WeekLoadData; date: IsoDate; blocks: Slot[]; picks: readonly Pick[]; act: (a: string, i: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [half, setHalf] = useState<Half>(blocks[0]!.half);
  const [choice, setChoice] = useState("");
  const [intention, setIntention] = useState("");
  const slot = blocks.find((s) => s.half === half) ?? blocks[0]!;
  const client = blockClient(slot.focus[0]?.clientKey ?? null, picks.filter((p) => p.half === slot.half)).clientKey ?? data.planClients[0]?.clientKey ?? "";
  const work = useContext(DevOpsWork).get(client);
  const taken = new Set(picks.filter(live).map((p) => p.itemId));
  const items = work ? [...work.items, ...work.children].filter((i) => isPickable(i) && !taken.has(i.id)) : [];
  if (!open)
    return (
      <p className="ci-walkon">
        <span className="tw-label">Walked in</span>
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          + Add walk-on work
        </button>
      </p>
    );
  return (
    <form
      className="slip-form ci-walkon-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const input = choice ? { itemId: Number(choice) } : { intention };
        if (await act("pick.add", { date, half: slot.half, clientKey: client, ...input })) {
          setOpen(false);
          setChoice("");
          setIntention("");
        }
      }}
    >
      {blocks.length > 1 && (
        <select value={half} onChange={(e) => setHalf(e.target.value as Half)} aria-label="Block">
          {blocks.map((s) => (
            <option key={s.half} value={s.half}>
              {halfName(s.half)}
            </option>
          ))}
        </select>
      )}
      <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="DevOps item">
        <option value="">Typed intention</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            #{i.id} {i.title}
          </option>
        ))}
      </select>
      {!choice && <input required maxLength={200} value={intention} placeholder="What walked in" onChange={(e) => setIntention(e.target.value)} aria-label="Intention" />}
      <button type="submit" className="mini primary">
        Add
      </button>
      <button type="button" className="mini" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

