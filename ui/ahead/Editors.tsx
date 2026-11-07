// AH-5: Ahead's cell editors, each a small popover anchored to its cell (ui/CellPopover.tsx) with a clear title,
// Save and Cancel: dates on the app's calendar with the quick dates and AM or PM, State from the type's states in the
// process model, Assigned to from the client's own DevOps project (ahead.people) with a search, and Size as the
// process's number with a few common values. Save puts the change in my change set; nothing is written to DevOps
// until "Save N items to DevOps", as before.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeField, DayHalf } from "../../plan/ahead-edit.ts";
import type { AssignPerson } from "../../plan/ahead-people.ts";
import { categoryLabel } from "../../plan/process.ts";
import { call } from "../api.ts";
import { CellPopover, FilterList, Segmented, type ListOption } from "../CellPopover.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { Avatar, usePhotos } from "../Presence.tsx";
import { useAhead } from "./Ahead.tsx";
import type { Row } from "./model.ts";

/** What a cell edits: one field, or the narrow layout's Dates column (start and target together). */
export type EditKind = ChangeField | "dates";

const NAME: Record<EditKind, string> = { start: "Start date", target: "Target date", dates: "Dates", state: "State", assignee: "Assigned to", size: "Size" };
const itemSub = (r: Row) => `#${r.item.id} ${r.item.title}`;
const before = (a: string, b: string) => Temporal.PlainDate.compare(Temporal.PlainDate.from(a), Temporal.PlainDate.from(b)) < 0;
const HALVES = [{ value: "AM", label: "AM" }, { value: "PM", label: "PM" }] as const;

/** The editor for one cell. `done(step)`: closed; step 1 or -1 when Tab or Shift+Tab saved it (move on), else 0. */
export function CellEditor({ r, kind, anchor, done }: { r: Row; kind: EditKind; anchor: HTMLElement | null; done: (step: 0 | 1 | -1) => void }) {
  if (kind === "start" || kind === "target" || kind === "dates") return <DatesEditor r={r} kind={kind} anchor={anchor} done={done} />;
  if (kind === "state") return <StateEditor r={r} anchor={anchor} done={done} />;
  if (kind === "assignee") return <AssigneeEditor r={r} anchor={anchor} done={done} />;
  return <SizeEditor r={r} anchor={anchor} done={done} />;
}

/**
 * Start, Target, or both (the Dates column, Start | Target at the top). Target before Start is an inline warning and
 * Save stays off. The half-day (AM or PM) is kept as before: FocusTime's, DevOps stores the day.
 */
function DatesEditor({ r, kind, anchor, done }: { r: Row; kind: "start" | "target" | "dates"; anchor: HTMLElement | null; done: (step: 0 | 1 | -1) => void }) {
  const a = useAhead();
  const today = a.load.today;
  const fields: ("start" | "target")[] = kind === "dates" ? (["start", "target"] as const).filter((f) => r.has[f]) : [kind];
  const [tab, setTab] = useState<"start" | "target">(fields[0] ?? "start");
  const [val, setVal] = useState({ start: r.eff.start, target: r.eff.target });
  const [half, setHalf] = useState<{ start: DayHalf; target: DayHalf }>({ start: r.startHalf ?? "AM", target: r.targetHalf ?? "PM" });
  const [busy, setBusy] = useState(false);
  const warn = val.start && val.target && r.has.start && r.has.target && before(val.target, val.start) ? "The target is before the start. Change one of them to save." : null;
  const save = async (step: 0 | 1 | -1 = 0, override?: { f: "start" | "target"; v: string | null }) => {
    const next = override ? { ...val, [override.f]: override.v } : val;
    if (next.start && next.target && r.has.start && r.has.target && before(next.target, next.start)) {
      setVal(next);
      return;
    }
    setBusy(true);
    for (const f of fields) {
      const was = f === "start" ? r.startHalf : r.targetHalf;
      if (next[f] === r.eff[f] && (next[f] === null || half[f] === (was ?? half[f]))) continue;
      if (!(await a.stage(r, f, next[f], next[f] ? half[f] : null))) return setBusy(false);
    }
    done(step);
  };
  const f = kind === "dates" ? tab : kind;
  return (
    <CellPopover anchor={anchor} title={NAME[kind]} sub={itemSub(r)} onSave={() => void save()} onCancel={() => done(0)} onTab={(back) => void save(back ? -1 : 1)} warning={warn} saveDisabled={busy} className="ah-pop ah-pop-date">
      {kind === "dates" && fields.length > 1 && (
        <div className="ah-pop-row">
          <Segmented label="Which date" value={tab} onChange={setTab} options={[{ value: "start", label: `Start${val.start ? ` · ${short(val.start)}` : ""}` }, { value: "target", label: `Target${val.target ? ` · ${short(val.target)}` : ""}` }]} />
        </div>
      )}
      <DatePicker key={f} value={val[f]} onChange={(d) => setVal((v) => ({ ...v, [f]: d }))} today={today} label={f === "start" ? "Start date" : "Target date"} onEnter={(d) => void save(0, { f, v: d })}>
        {val[f] && (
          <div className="ah-pop-row ah-pop-half">
            <span className="muted">Half-day</span>
            <Segmented label="Half-day" value={half[f]} onChange={(h) => setHalf((x) => ({ ...x, [f]: h }))} options={HALVES} />
            <span className="muted ah-pop-note">Kept in FocusTime; DevOps keeps the day.</span>
          </div>
        )}
      </DatePicker>
    </CellPopover>
  );
}
const short = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });

/** The type's states from the process model (never a fixed list), each with its color dot; the current one checked. */
function StateEditor({ r, anchor, done }: { r: Row; anchor: HTMLElement | null; done: (step: 0 | 1 | -1) => void }) {
  const a = useAhead();
  const c = a.load.clients.find((x) => x.clientKey === r.clientKey);
  const states = c?.states?.[r.item.type] ?? [];
  const [chosen, setChosen] = useState(r.eff.state);
  const options: ListOption[] = states.map((s) => ({
    key: s.name,
    label: s.name,
    lead: <span className={`ah-state-dot cat-${s.category.toLowerCase()}`} style={s.color ? { background: `#${s.color}`, boxShadow: "none" } : undefined} aria-hidden="true" />,
    hint: categoryLabel(s.category) ?? undefined,
  }));
  const save = async (name: string, step: 0 | 1 | -1 = 0) => {
    if (name.toLowerCase() !== r.eff.state.toLowerCase() && !(await a.stage(r, "state", name))) return;
    done(step);
  };
  return (
    <CellPopover anchor={anchor} title="State" sub={itemSub(r)} onSave={() => void save(chosen)} onCancel={() => done(0)} onTab={(back) => void save(chosen, back ? -1 : 1)} className="ah-pop ah-pop-list">
      <FilterList label={`${r.item.type} states`} options={options} current={chosen} onPick={(k) => (setChosen(k), void save(k))} placeholder="Filter states" empty="No state matches" note={`${r.item.type}'s states in ${c?.project ?? c?.clientName ?? "this project"}'s process.`} />
    </CellPopover>
  );
}

/** ahead.people, read once per client while Ahead is open. */
const peopleMemo = new Map<string, Promise<{ people: AssignPerson[]; problem: string | null }>>();
export const forgetAheadPeople = () => peopleMemo.clear();
function usePeople(clientKey: string) {
  const [d, setD] = useState<{ people: AssignPerson[]; problem: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const p = peopleMemo.get(clientKey) ?? call<{ people: AssignPerson[]; problem: string | null }>("ahead.people", { clientKey });
    peopleMemo.set(clientKey, p);
    p.then((x) => live && setD(x), (e: unknown) => (peopleMemo.delete(clientKey), live && setErr(e instanceof Error ? e.message : "Couldn't read who can be assigned")));
    return () => void (live = false);
  }, [clientKey]);
  return { data: d, error: err };
}

/**
 * A dropdown with a search: the people on this client's DevOps project (never another client's), me first, then people
 * already assigned here, then everyone by name; each with their photo or initials, name and email domain, and a mark
 * for people outside Cooptimize; Unassigned too.
 */
function AssigneeEditor({ r, anchor, done }: { r: Row; anchor: HTMLElement | null; done: (step: 0 | 1 | -1) => void }) {
  const a = useAhead();
  const { data, error } = usePeople(r.clientKey);
  const people = useMemo(() => data?.people ?? [], [data]);
  const photos = usePhotos({ emails: people.filter((p) => !p.external).map((p) => p.email).slice(0, 60) });
  const current = r.eff.assignee?.email.toLowerCase() ?? "";
  const [chosen, setChosen] = useState(current);
  const options: ListOption[] = useMemo(() => {
    const me = people.filter((p) => p.me);
    const rest = people.filter((p) => !p.me);
    const row = (p: AssignPerson): ListOption => ({
      key: p.email,
      label: p.me ? `${p.name} (me)` : p.name,
      search: `${p.name} ${p.domain}${p.me ? " me" : ""}`,
      title: p.external ? `${p.name}, outside Cooptimize (${p.domain})` : `${p.name} (${p.domain})`,
      lead: <Avatar name={p.name} photo={p.external ? null : photos.photoFor(p.email)} size={22} />,
      sub: p.domain,
      ...(p.external ? { hint: <span className="ah-ext">Outside Cooptimize</span> } : {}),
    });
    // A current assignee DevOps knows who isn't listed (an older name) stays choosable.
    const known = r.eff.assignee && !people.some((p) => p.email === current) ? [{ key: current, label: r.eff.assignee.name, lead: <Avatar name={r.eff.assignee.name} photo={null} size={22} /> }] : [];
    return [...me.map(row), { key: "", label: "Unassigned", search: "unassigned nobody none", lead: <span className="ah-pop-nobody" aria-hidden="true">–</span> }, ...known, ...rest.map(row)];
  }, [people, photos, r.eff.assignee, current]);
  const save = async (key: string, step: 0 | 1 | -1 = 0) => {
    if (key !== current) {
      const p = people.find((x) => x.email === key);
      const value = key === "" ? null : p ? { email: p.email, name: p.name } : r.eff.assignee;
      if (!(await a.stage(r, "assignee", value))) return;
    }
    done(step);
  };
  return (
    <CellPopover anchor={anchor} title="Assigned to" sub={itemSub(r)} onSave={() => void save(chosen)} onCancel={() => done(0)} onTab={(back) => void save(chosen, back ? -1 : 1)} className="ah-pop ah-pop-list ah-pop-people">
      {!data && !error ? (
        <p className="muted fl-note">Reading who can be assigned…</p>
      ) : (
        <FilterList label="Assigned to" options={options} current={chosen} onPick={(k) => (setChosen(k), void save(k))} placeholder="Search people" empty="Nobody on this project matches" note={error ?? data?.problem ?? undefined} />
      )}
    </CellPopover>
  );
}

/** A few common values for the process's size field: points by Fibonacci, hours by doubling. */
export function sizeChoices(label: string | null): number[] {
  return /effort|estimate|hour|work/i.test(label ?? "") ? [1, 2, 4, 8, 16, 24] : [1, 2, 3, 5, 8, 13];
}

/** The process's own number (Story Points, Effort, Size), typed or one of the common values; Clear leaves it empty. */
function SizeEditor({ r, anchor, done }: { r: Row; anchor: HTMLElement | null; done: (step: 0 | 1 | -1) => void }) {
  const a = useAhead();
  const [text, setText] = useState(r.eff.size === null ? "" : String(r.eff.size));
  const box = useRef<HTMLInputElement>(null);
  const n = text.trim() === "" ? null : Number(text.trim());
  const bad = n !== null && (!Number.isFinite(n) || n < 0 || n > 10_000);
  const save = async (v: number | null = n, step: 0 | 1 | -1 = 0) => {
    if (bad && v === n) return;
    if (v !== r.eff.size && !(await a.stage(r, "size", v))) return;
    done(step);
  };
  const label = r.sizeLabel ?? "Size";
  const choices = sizeChoices(r.sizeLabel);
  return (
    <CellPopover anchor={anchor} title={label} sub={itemSub(r)} onSave={() => void save()} onCancel={() => done(0)} onTab={(back) => void save(n, back ? -1 : 1)} warning={bad ? "A size is a number from 0 to 10000." : null} className="ah-pop ah-pop-size">
      <div className="ah-pop-row">
        <input ref={box} data-autofocus className="ah-pop-num" inputMode="decimal" aria-label={label} value={text} placeholder="None" autoComplete="off" onChange={(e) => setText(e.target.value)} />
        <Segmented label={`Common ${label} values`} value={n !== null && choices.includes(n) ? String(n) : null} onChange={(v) => setText(v)} options={choices.map((x) => ({ value: String(x), label: String(x) }))} />
        <button type="button" className="mini quiet" onClick={() => (setText(""), box.current?.focus())}>
          Clear
        </button>
      </div>
      <p className="muted ah-pop-note">{r.hint ? `${r.hint}. ` : ""}Stored in DevOps as {label}.</p>
    </CellPopover>
  );
}

/**
 * The same editors for places without a grid cell (Gantt's No dates list, Gaps): a popover anchored where it's
 * rendered. `done` closes it; a Start that's saved goes on to Target there, as before.
 */
export function Editor({ r, field, done }: { r: Row; field: ChangeField; done: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <span ref={setAnchor} className="ah-editor-anchor">
      {anchor && <CellEditor r={r} kind={field} anchor={anchor} done={() => done()} />}
    </span>
  );
}
