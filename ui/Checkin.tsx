// Day's Midday check-in (U2; its own file since WD-2): the day's blocks as check-in cards (ended blocks dim, done
// to-dos a count, each unfinished to-do with its Move to…), then walk-on work once at the foot. QT-2: nothing says
// a to-do doesn't fit or that a block is over; the afternoon's free time is said once, in the header, as a fact.
// Day opens it from its moment card; Done marks the day checked in.
import { DueBadge } from "./FollowUps.tsx";
import { useContext, useState, type CSSProperties } from "react";
import type { WeekLoadData } from "../actions/types.ts";
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
import { SelectField } from "./SelectField.tsx";
import { Icon } from "./icons.tsx";

const live = (p: Pick) => p.status === "planned" || p.status === "done";

/**
 * QT-2: the free time left, once, as a fact: "1h 45m free this afternoon" (after meetings and personal events, from
 * the blocks that haven't ended), "this evening" or "the rest of today" when an evening is still ahead. Never what's
 * planned against it.
 */
export function checkLeft(check: readonly CheckSlot[]): string {
  const open = check.filter((c) => !c.ended);
  if (!open.length) return "No free time left today";
  const left = open.reduce((n, c) => n + c.leftMinutes, 0);
  const when = open.every((c) => c.half === "PM") ? "this afternoon" : open.every((c) => c.half === "EVE") ? "this evening" : "the rest of today";
  return left > 0 ? `${formatDuration(left)} free ${when}` : `No free time ${when}`;
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

/** One block in the check-in: what's left, each unfinished to-do with one Move to… (QT-2: never whether it fits). */
export function CheckinBlock(b: BlockProps) {
  const { slot, data, nameOf, ended } = b;
  const view = useContext(PlanCtx);
  const client = slot.focus[0]?.clientKey ?? null;
  const done = b.picks.filter((p) => p.status === "done");
  const title = client ? nameOf(client) : slot.open ? "Open" : halfName(slot.half);
  const followUp = (p: Pick) => (p.followUpId !== null ? data.followUps.find((f) => f.id === p.followUpId) ?? null : null);
  const c = b.check;
  const left = c.picks.filter((x) => x.pick.status === "planned");
  const head = ended ? `${halfName(slot.half)} · ended` : halfName(slot.half);
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
        {left.map(({ pick: p, focusedMinutes }) => {
          // QT-2: every unfinished to-do has its move, never only the ones that "don't fit".
          const move = suggestedMove(p, { owedToday: owed(p), later: b.later, carryTo: b.carryTo });
          return (
            <PickRow
              key={p.id}
              pick={p}
              toggle={view.toggle}
              link
              density="today"
              canTick={b.tickable}
              timeEditable={!ended}
              badge={
                <>
                  {followUp(p) && <DueBadge l={followUp(p)!} />}
                  {focusedMinutes > 0 && <span className="pr-note">{formatDuration(focusedMinutes)} focused</span>}
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
      {ended && left.length > 0 && <p className="tb-line">{left.length} unfinished. Move {left.length === 1 ? "it" : "them"}, or leave {left.length === 1 ? "it" : "them"} for Close out.</p>}
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
          <button type="button" className="link-btn" onClick={onAsks} title="Urgent requests still open after their urgency (now: 2 hours; this week: Friday)">
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
          <Icon name="add" /> Add walk-on work
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
      {/* The app's own pickers (no browser select). */}
      {blocks.length > 1 && <SelectField label="Block" value={half} options={blocks.map((sl) => ({ key: sl.half, label: halfName(sl.half) }))} onChange={(k) => setHalf(k as Half)} />}
      <SelectField label="DevOps item" value={choice} options={[{ key: "", label: "Typed intention" }, ...items.map((i) => ({ key: String(i.id), label: `#${i.id} ${i.title}` }))]} onChange={setChoice} />
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

