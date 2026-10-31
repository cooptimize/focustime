// Morning ignition: today's column becomes a short planning panel. Each half-day shows its real capacity,
// picks come from that client's DevOps items in board order (story level only) or a typed intention, and one
// key commits. Everything here is local: the actions only write Coopilot's plan store.
import { useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { blockClient, capacityMinutes, fitOf, isPickable, pickableChildren, plannedMinutes, type Fit } from "../plan/rules.ts";
import { SIZES, type DraftStory, type IgnitionState, type Pick, type Size } from "../plan/types.ts";
import type { Day, Half, Slot, WorkItem } from "../week/types.ts";
import { formatMinutes } from "./ignition.ts";
import { clientColor, longDate, shortDate, slotRange, startClock } from "./labels.ts";
import { DevOpsWork, typeTag, workStatusLabel } from "./work.ts";

export type IgnitionAct = (action: string, input: Record<string, unknown>) => Promise<boolean>;

type Props = {
  day: Day;
  state: IgnitionState;
  /** Friday of the same week, when it is not this day (for "move to Friday"). */
  friday: string | null;
  now: string;
  tz: string;
  colors: Record<string, string>;
  /** Clients that can be picked from in an Open half-day (this week's DevOps clients, Cooptimize included). */
  clients: { clientKey: string; clientName: string }[];
  error: string | null;
  act: IgnitionAct;
  onCommit: () => void;
  onClose: () => void;
};

const inPlay = (p: Pick) => p.status === "planned" || p.status === "done";

export function Ignition({ day, state, friday, now, tz, colors, clients, error, act, onCommit, onClose }: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const picked = new Set(state.picks.filter(inPlay).map((p) => (p.itemId !== null ? `i${p.clientKey}:${p.itemId}` : p.draftId !== null ? `d${p.draftId}` : "")));
  const committed = state.plan.committedAt;

  const onKey = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (typing) (e.target as HTMLElement).blur();
      else onClose();
      return;
    }
    if (!typing && (e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onCommit();
    }
  };

  return (
    <section ref={ref} className="ignition" tabIndex={-1} aria-label={`Plan ${longDate(day.date)}`} onKeyDown={onKey}>
      <header className="ign-head">
        <div>
          <h2>Plan {longDate(day.date)}</h2>
          <p className="muted">
            {committed ? `Committed at ${startClock(committed.replace(/\[.*\]$/, ""), tz)}. Changes are saved as you go; commit again when done.` : "About two minutes: pick story-level work for each block, then commit."}
          </p>
        </div>
        <div className="ign-actions">
          <button type="button" className="commit" onClick={onCommit}>
            <kbd>c</kbd> {committed ? "Commit again" : "Commit"}
          </button>
          <button type="button" onClick={onClose} aria-label="Close planning">
            Esc
          </button>
        </div>
      </header>
      {error && (
        <p className="ign-error" role="alert">
          {error}
        </p>
      )}

      {state.carryOver.length > 0 && <CarryOver picks={state.carryOver} date={day.date} act={act} />}

      <div className="ign-blocks">
        {(["AM", "PM"] as const).map((half) => (
          <Block
            key={half}
            slot={half === "AM" ? day.am : day.pm}
            overflow={day.kind === "overflow"}
            picks={state.picks.filter((p) => p.half === half && p.date === day.date && inPlay(p))}
            drafts={state.drafts}
            picked={picked}
            other={half === "AM" ? "PM" : "AM"}
            friday={friday}
            now={now}
            tz={tz}
            colors={colors}
            clients={clients}
            act={act}
          />
        ))}
      </div>
    </section>
  );
}

function CarryOver({ picks, date, act }: { picks: Pick[]; date: string; act: IgnitionAct }) {
  return (
    <section className="ign-carry" aria-label="Unfinished from earlier days">
      <h3>Carry over · unfinished from earlier</h3>
      <ul>
        {picks.map((p) => (
          <li key={p.id}>
            <span className="carry-when">{shortDate(p.date)} {p.half}</span>
            <span className="carry-client">{p.clientKey}</span>
            <span className="pick-title">{p.title}</span>
            <span className="size-tag">{p.size}</span>
            <span className="row-actions">
              <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date, half: "AM" })}>
                To AM
              </button>
              <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date, half: "PM" })}>
                To PM
              </button>
              <button type="button" className="mini quiet" onClick={() => act("pick.remove", { id: p.id })}>
                Drop
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type BlockProps = {
  slot: Slot;
  overflow: boolean;
  picks: Pick[];
  drafts: DraftStory[];
  picked: Set<string>;
  other: Half;
  friday: string | null;
  now: string;
  tz: string;
  colors: Record<string, string>;
  clients: { clientKey: string; clientName: string }[];
  act: IgnitionAct;
};

function fitLabel(f: Fit): string {
  switch (f.kind) {
    case "empty": return "nothing picked";
    case "fits": return `fits · ${formatMinutes(f.spare)} spare`;
    case "tight": return f.spare ? `tight · ${formatMinutes(f.spare)} spare` : "tight · full";
    case "over": return `over by ${formatMinutes(f.by)}`;
  }
}

function Block({ slot, overflow, picks, drafts, picked, other, friday, now, tz, colors, clients, act }: BlockProps) {
  const focus = overflow ? null : slot.focus[0] ?? null;
  const bc = blockClient(focus?.clientKey ?? null, picks);
  const [chosen, setChosen] = useState<string | null>(null);
  const source = focus?.clientKey ?? chosen ?? bc.clientKey ?? clients[0]?.clientKey ?? null;
  const capacity = capacityMinutes(slot, now);
  const fit = fitOf(plannedMinutes(picks), capacity);
  const started = Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(slot.start)) > 0;
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? k ?? "";
  const style = { "--c": clientColor(bc.clientKey ?? undefined, colors) } as CSSProperties;

  return (
    <section className={`ign-block fit-${fit.kind} ${focus ? "focus" : "open"}`} style={style} aria-label={`${slot.half} block`}>
      <header className="ign-block-head">
        <div className="ign-title">
          <span className="half-tag">{slot.half}</span>
          <span className="muted">{slotRange(slot, tz)}</span>
          <span className="ign-client">
            <span className="swatch" />
            {focus ? focus.clientName : overflow ? "Overflow" : bc.clientKey ? `Open · ${name(bc.clientKey)}` : "Open"}
          </span>
        </div>
        <div className="ign-capacity">
          <span>
            <strong>{formatMinutes(capacity)}</strong> free{started ? " from now" : ""}
          </span>
          <span className={`fit ${fit.kind}`}>{fitLabel(fit)}</span>
        </div>
      </header>
      {bc.mixed && <p className="ign-flag">Mixed clients in one block: {bc.clients.map(name).join(", ")}</p>}
      {fit.kind === "over" && (
        <p className="ign-flag over">
          Over by {formatMinutes(fit.by)}. Drop a pick, make one smaller, or move one to {other}
          {friday ? " or to Friday" : ""}.
        </p>
      )}

      {picks.length > 0 && (
        <ol className="ign-picks">
          {picks.map((p) => (
            <li key={p.id} className={p.clientKey !== bc.clientKey ? "other-client" : ""}>
              <span className="wi-type">{p.kind === "intention" ? "Note" : typeTag(p.itemType ?? "")}</span>
              <span className="pick-title" title={p.title}>
                {p.title}
                {p.clientKey !== bc.clientKey && <span className="muted"> · {name(p.clientKey)}</span>}
                {p.carriedFromDate && <span className="muted"> · from {shortDate(p.carriedFromDate)}</span>}
              </span>
              <span className="sizes" role="group" aria-label="Size">
                {SIZES.map((s) => (
                  <button key={s} type="button" className="size" aria-pressed={p.size === s} onClick={() => p.size !== s && act("pick.set_size", { id: p.id, size: s })}>
                    {s}
                  </button>
                ))}
              </span>
              <span className="row-actions">
                <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date: p.date, half: other })} aria-label={`Move to ${other}`}>
                  To {other}
                </button>
                {friday && (
                  <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date: friday, half: "AM" })} aria-label="Move to Friday">
                    To Fri
                  </button>
                )}
                <button type="button" className="mini quiet" onClick={() => act("pick.remove", { id: p.id })} aria-label={`Drop ${p.title}`}>
                  Drop
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {!focus && clients.length > 0 && (
        <div className="client-chooser" role="group" aria-label="Pick from client">
          {clients.map((c) => (
            <button key={c.clientKey} type="button" className="chip-btn" aria-pressed={source === c.clientKey} style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties} onClick={() => setChosen(c.clientKey)}>
              <span className="swatch" />
              {c.clientName}
            </button>
          ))}
        </div>
      )}

      {source && <Candidates clientKey={source} half={slot.half} date={slot.date} drafts={drafts} picked={picked} act={act} />}
      {source && <Intention clientKey={source} clientName={name(source)} half={slot.half} date={slot.date} act={act} />}
    </section>
  );
}

const SHOWN = 6;

function Candidates({ clientKey, half, date, drafts, picked, act }: { clientKey: string; half: Half; date: string; drafts: DraftStory[]; picked: Set<string>; act: IgnitionAct }) {
  const work = useContext(DevOpsWork).get(clientKey);
  const [all, setAll] = useState(false);
  if (!work) return <p className="muted ign-note">No DevOps items for {clientKey} this week. Type an intention instead.</p>;
  const free = (i: WorkItem) => !picked.has(`i${clientKey}:${i.id}`);
  // Board order: my story-level items, and my epics and features (which open into their children).
  const rows = work.items.filter((i) => (isPickable(i) && free(i)) || i.level === "portfolio");
  const shown = all ? rows : rows.slice(0, SHOWN);
  const add = (input: Record<string, unknown>) => act("pick.add", { date, half, clientKey, ...input });
  return (
    <div className="candidates">
      <h4>
        {work.clientName} in board order
        {work.status !== "ok" && <span className="muted"> · {workStatusLabel(work)}</span>}
      </h4>
      {rows.length === 0 && <p className="muted ign-note">Nothing left to pick for {work.clientName}. Type an intention instead.</p>}
      <ul>
        {shown.map((i) =>
          i.level === "portfolio" ? (
            <Portfolio key={i.id} item={i} clientKey={clientKey} kids={pickableChildren(i.id, work.children).filter(free)} drafts={drafts.filter((d) => d.clientKey === clientKey && d.parentItemId === i.id && !picked.has(`d${d.id}`))} add={add} act={act} />
          ) : (
            <li key={i.id}>
              <button type="button" className="cand" onClick={() => add({ itemId: i.id })} title={`${i.type} ${i.id}: ${i.title} (${i.state})`}>
                <span className="plus" aria-hidden="true">+</span>
                <span className="wi-type">{typeTag(i.type)}</span>
                <span className="wi-title">{i.title}</span>
              </button>
            </li>
          ),
        )}
      </ul>
      {rows.length > SHOWN && (
        <button type="button" className="mini quiet" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function Portfolio({ item, clientKey, kids: children, drafts, add, act }: { item: WorkItem; clientKey: string; kids: WorkItem[]; drafts: DraftStory[]; add: (i: Record<string, unknown>) => Promise<boolean>; act: IgnitionAct }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<Size>("M");
  const needs = children.length === 0 && drafts.length === 0;
  return (
    <li className="portfolio">
      <button type="button" className="cand parent" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`${item.type} ${item.id}: ${item.title}`}>
        <span className="plus" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="wi-type">{typeTag(item.type)}</span>
        <span className="wi-title">{item.title}</span>
        <span className={needs ? "needs" : "muted kids"}>{needs ? "Needs breakdown" : `${children.length + drafts.length} to pick`}</span>
      </button>
      {open && (
        <ul className="kids-list">
          {children.map((c) => (
            <li key={c.id}>
              <button type="button" className="cand" onClick={() => add({ itemId: c.id })} title={`${c.type} ${c.id}: ${c.title} (${c.state})`}>
                <span className="plus" aria-hidden="true">+</span>
                <span className="wi-type">{typeTag(c.type)}</span>
                <span className="wi-title">{c.title}</span>
              </button>
            </li>
          ))}
          {drafts.map((d) => (
            <li key={`d${d.id}`}>
              <button type="button" className="cand" onClick={() => add({ draftId: d.id, size: d.size })}>
                <span className="plus" aria-hidden="true">+</span>
                <span className="wi-type">Draft</span>
                <span className="wi-title">{d.title}</span>
              </button>
            </li>
          ))}
          <li>
            <form
              className="draft-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!title.trim()) return;
                if (await act("draft.add_story", { clientKey, parentItemId: item.id, title, size })) setTitle("");
              }}
            >
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Draft story (local only)" aria-label={`Draft story under ${item.title}`} maxLength={200} />
              <span className="sizes" role="group" aria-label="Draft size">
                {SIZES.map((s) => (
                  <button key={s} type="button" className="size" aria-pressed={size === s} onClick={() => setSize(s)}>
                    {s}
                  </button>
                ))}
              </span>
              <button type="submit" className="mini">Add draft</button>
            </form>
          </li>
        </ul>
      )}
    </li>
  );
}

function Intention({ clientKey, clientName, half, date, act }: { clientKey: string; clientName: string; half: Half; date: string; act: IgnitionAct }) {
  const [text, setText] = useState("");
  return (
    <form
      className="intention"
      onSubmit={async (e) => {
        e.preventDefault();
        if (text.trim() && (await act("pick.add", { date, half, clientKey, intention: text }))) setText("");
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Or type an intention for ${clientName}, Enter to add`} aria-label={`Intention for ${half}`} maxLength={200} />
    </form>
  );
}
