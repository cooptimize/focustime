// BH-1, BL-1: the bulk bar over the Grid's selected rows (was the Backlog mode's). Push the target date by 2 or 4 weeks
// or to a chosen date, set one where there's none, assign to me: each goes into the change set (nothing is written
// until Save to DevOps, with its preview, confirm, read back and undo); items I can't change are skipped with the
// reason. Plan it puts the selected stories on next week's Plan (a plan-store write), with Undo.
//
// ED-2 adds four, each a small popover from its button, each only staging and saying "Staged N, skipped M" with the
// reasons: Assign to… (the client's own DevOps people, the Grid's picker), State… (the states every ticked row's type
// takes; where types differ, the rest are listed with the rows they fit), Size… and Move to… (ED-1's picker; only
// when the ticked rows are one level in one client, and it says so otherwise).
import { useEffect, useMemo, useRef, useState } from "react";
import type { WeekPlanState } from "../../actions/types.ts";
import type { StagedChange } from "../../plan/ahead-edit.ts";
import { bulkMoveBlock, bulkSummary, commonStates, nextMonday, type BulkOp } from "../../plan/backlog.ts";
import { categoryLabel } from "../../plan/process.ts";
import { CellPopover, FilterList, Segmented, type ListOption } from "../CellPopover.tsx";
import { Avatar, usePhotos } from "../Presence.tsx";
import { sizeChoices, usePeople } from "./Editors.tsx";
import { MovePicker } from "./GridEdits.tsx";
import { call } from "../api.ts";
import { DateField } from "../DatePicker.tsx";
import { useAhead } from "./Ahead.tsx";
import type { Row } from "./model.ts";
import { Icon } from "../icons.tsx";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

type Skip = { clientKey: string; itemId: number; reason: string };
type Result = { text: string; skipped: Skip[] };
type Toast = { id: number; text: string; undo: (() => Promise<void>) | null };

/** ahead.stage_bulk's most items a call. */
export const BULK_MAX = 200;
/** A list in parts of at most n, in order. */
export const inParts = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function BulkBar({ chosen, titleOf, select, onChanged }: { chosen: Row[]; titleOf: (clientKey: string, itemId: number) => string; /** The rows left selected (the ones skipped), or none. */ select: (keys: string[]) => void; onChanged: () => void }) {
  const a = useAhead();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [dateFor, setDateFor] = useState<"move" | "set_missing" | null>(null);
  const [date, setDate] = useState("");
  // ED-2: which of the four pickers is open, anchored to its button; and why one can't open (said in the bar).
  const [pop, setPop] = useState<{ kind: "assign" | "state" | "size" | "parent"; at: HTMLElement } | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  // The line about what was staged goes once the change set shrinks (saved, removed or discarded): it would no
  // longer be true (review 1).
  const pendingN = a.load.changes.length;
  const lastN = useRef(pendingN);
  useEffect(() => {
    if (pendingN < lastN.current) setResult(null);
    lastN.current = pendingN;
  }, [pendingN]);
  const oneClient = new Set(chosen.map((r) => r.clientKey)).size === 1;
  const moveBlock = bulkMoveBlock(chosen.map((r) => ({ clientKey: r.clientKey, rung: r.item.rung })));
  const assignBlock = oneClient ? null : "Assign to… needs rows from one client: each client has its own people";
  /** A button that opens its picker, or says why it can't for these rows (it stays reachable, so the reason can be heard). */
  const opener = (kind: "assign" | "state" | "size" | "parent", label: string, blocked: string | null) => (
    <button
      type="button"
      className={`mini${blocked ? " bl-off" : ""}`}
      disabled={busy}
      aria-disabled={blocked ? true : undefined}
      aria-haspopup="dialog"
      aria-expanded={pop?.kind === kind}
      title={blocked ?? undefined}
      onClick={(e) => {
        if (blocked) return void (setWhy(blocked), setPop(null));
        setWhy(null);
        setResult(null);
        setPop(pop?.kind === kind ? null : { kind, at: e.currentTarget });
      }}
    >
      {label}
    </button>
  );
  const closePop = () => {
    const at = pop?.at;
    setPop(null);
    at?.focus();
  };

  const bulk = async (op: BulkOp) => {
    setBusy(true);
    try {
      // The server takes 200 items a call: a larger selection goes in parts, one result.
      type Part = { changes: StagedChange[]; staged: { clientKey: string; itemId: number }[]; skipped: Skip[] };
      const items = chosen.map((x) => ({ clientKey: x.clientKey, itemId: x.item.id }));
      const r: Part = { changes: [], staged: [], skipped: [] };
      for (const part of inParts(items, BULK_MAX)) {
        const p = await call<Part>("ahead.stage_bulk", { items: part, op });
        r.changes = p.changes;
        r.staged.push(...p.staged);
        r.skipped.push(...p.skipped);
      }
      a.setChanges(r.changes);
      setResult({ text: bulkSummary(op, r.staged.length, r.skipped.length), skipped: r.skipped });
      // ED-2's four keep the rows ticked, so an owner and then a size go on the same rows (review 1); the older
      // actions leave only the skipped rows ticked, as before.
      if (!(op.kind === "assign" || op.kind === "state" || op.kind === "size" || op.kind === "parent")) select(r.skipped.map((s) => `${s.clientKey}:${s.itemId}`));
      setDateFor(null);
      setWhy(null);
      return null;
    } catch (e) {
      a.error(errText(e));
      return errText(e);
    } finally {
      setBusy(false);
    }
  };

  // Plan it: next week's Plan; Undo takes off only what this added.
  const planIt = async () => {
    const weekStart = nextMonday(a.load.today);
    const stories = chosen.filter((r) => r.tier === "story");
    const skipped: Skip[] = chosen.filter((r) => r.tier !== "story").map((r) => ({ clientKey: r.clientKey, itemId: r.item.id, reason: "Plan it adds stories" }));
    if (!stories.length) return;
    setBusy(true);
    try {
      const st = await call<WeekPlanState>("weekplan.load", { weekStart });
      const on = new Set(st.plan.features.map((f) => `${f.clientKey}:${f.itemId}`));
      const added: number[] = [];
      for (const r of stories) {
        if (on.has(r.key)) {
          skipped.push({ clientKey: r.clientKey, itemId: r.item.id, reason: "Already on next week's Plan" });
          continue;
        }
        try {
          const res = await call<{ item: { id: number } }>("weekplan.add", { weekStart, clientKey: r.clientKey, itemId: r.item.id });
          added.push(res.item.id);
        } catch (e) {
          skipped.push({ clientKey: r.clientKey, itemId: r.item.id, reason: errText(e) });
        }
      }
      setResult({ text: `${plural(added.length, "story", "stories")} on next week's Plan (week of ${monthDay(weekStart)})`, skipped });
      select(skipped.map((s) => `${s.clientKey}:${s.itemId}`));
      if (added.length) {
        setToast({
          id: Date.now(),
          text: `${plural(added.length, "story", "stories")} on next week's Plan`,
          undo: async () => {
            for (const id of added) await call("weekplan.remove", { id });
            onChanged();
          },
        });
        onChanged();
      }
    } catch (e) {
      a.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const stories = chosen.some((r) => r.tier === "story");
  return (
    <>
      {!a.readOnly && chosen.length > 0 && (
        <div className="bl-bulk" role="toolbar" aria-label="Selected items">
          <strong>{chosen.length} selected</strong>
          <span className="bl-bulk-group" role="group" aria-label="Push target date">
            <span className="muted">Push target date</span>
            <button type="button" className="mini" disabled={busy} onClick={() => void bulk({ kind: "push", weeks: 2 })}>
              2 weeks
            </button>
            <button type="button" className="mini" disabled={busy} onClick={() => void bulk({ kind: "push", weeks: 4 })}>
              4 weeks
            </button>
            <button type="button" className="mini" disabled={busy} aria-pressed={dateFor === "move"} onClick={() => setDateFor(dateFor === "move" ? null : "move")}>
              To a date…
            </button>
          </span>
          <button type="button" className="mini" disabled={busy} aria-pressed={dateFor === "set_missing"} onClick={() => setDateFor(dateFor === "set_missing" ? null : "set_missing")}>
            Set a target date…
          </button>
          <button type="button" className="mini" disabled={busy} onClick={() => void bulk({ kind: "assign_me" })}>
            Assign to me
          </button>
          <span className="bl-bulk-group" role="group" aria-label="Change the selected items">
            {opener("assign", "Assign to…", assignBlock)}
            {opener("state", "State…", null)}
            {opener("size", "Size…", null)}
            {opener("parent", "Move to…", moveBlock)}
          </span>
          <button type="button" className="mini" disabled={busy || !stories} title={stories ? "Adds the selected stories to next week's Plan" : "Plan it adds stories: select some stories"} onClick={() => void planIt()}>
            Plan it
          </button>
          <button type="button" className="mini quiet" disabled={busy} onClick={() => (select([]), setDateFor(null), setPop(null), setWhy(null))} title="Clear the selection (Esc)">
            Clear
          </button>
          {dateFor && (
            <span className="bl-bulk-date">
              <span className="bl-bulk-label">
                {dateFor === "move" ? "New target date" : "Target date, only where there's none"}
                <DateField label={dateFor === "move" ? "New target date" : "Target date, only where there's none"} value={date || null} today={a.load.today} clearable={false} placeholder="Choose a date" onChange={(d) => setDate(d ?? "")} />
              </span>
              <button type="button" className="mini primary" disabled={busy || !date} onClick={() => void bulk({ kind: dateFor, date })}>
                Apply
              </button>
            </span>
          )}
          {pop?.kind === "assign" && <BulkAssign rows={chosen} anchor={pop.at} onPick={(p) => bulk({ kind: "assign", email: p?.email ?? null, name: p?.name ?? "Nobody" })} done={closePop} />}
          {pop?.kind === "state" && <BulkState rows={chosen} anchor={pop.at} onPick={(state) => bulk({ kind: "state", state })} done={closePop} />}
          {pop?.kind === "size" && <BulkSize rows={chosen} anchor={pop.at} onPick={(value) => bulk({ kind: "size", value })} done={closePop} />}
          {pop?.kind === "parent" && <MovePicker rows={chosen} anchor={pop.at} onPick={(p) => bulk({ kind: "parent", parentId: p?.id ?? null, title: p?.title ?? "" })} done={closePop} />}
        </div>
      )}
      {why && chosen.length > 0 && (
        <p className="bl-result bl-why" role="status">
          {why}
        </p>
      )}
      {result && (
        <div className="bl-result" role="status">
          <span>{result.text}</span>
          {result.skipped.length > 0 && (
            <details>
              <summary>Why {plural(result.skipped.length, "item was", "items were")} skipped</summary>
              <ul>
                {result.skipped.map((s) => (
                  <li key={`${s.clientKey}:${s.itemId}`}>
                    #{s.itemId} {titleOf(s.clientKey, s.itemId)}: <span className="muted">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button type="button" className="mini quiet" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      )}
      {toast && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="mini" onClick={() => void toast.undo!().then(() => setToast({ id: Date.now(), text: "Undone", undo: null }), (e: unknown) => setToast({ id: Date.now(), text: errText(e), undo: null }))}>
              Undo
            </button>
          )}
          <button type="button" className="mini quiet icon-btn small" aria-label="Dismiss" onClick={() => setToast(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}

type Picked<T> = (v: T) => Promise<string | null>;

/** ED-2: Assign to… for the ticked rows of one client: its own DevOps people (never another client's), me first, Unassigned. */
function BulkAssign({ rows, anchor, onPick, done }: { rows: Row[]; anchor: HTMLElement; onPick: Picked<{ email: string; name: string } | null>; done: () => void }) {
  const { data, error } = usePeople(rows[0]!.clientKey);
  const people = useMemo(() => data?.people ?? [], [data]);
  const photos = usePhotos({ emails: people.filter((p) => !p.external).map((p) => p.email).slice(0, 60) });
  const [chosen, setChosen] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const options: ListOption[] = useMemo(() => {
    const row = (p: (typeof people)[number]): ListOption => ({ key: p.email, label: p.me ? `${p.name} (me)` : p.name, search: `${p.name} ${p.domain}${p.me ? " me" : ""}`, title: p.external ? `${p.name}, outside Cooptimize (${p.domain})` : `${p.name} (${p.domain})`, lead: <Avatar name={p.name} photo={p.external ? null : photos.photoFor(p.email)} size={22} />, sub: p.domain, ...(p.external ? { hint: <span className="ah-ext">Outside Cooptimize</span> } : {}) });
    return [...people.filter((p) => p.me).map(row), { key: "", label: "Unassigned", search: "unassigned nobody none", lead: <span className="ah-pop-nobody" aria-hidden="true">–</span> }, ...people.filter((p) => !p.me).map(row)];
  }, [people, photos]);
  const save = async (key: string | null) => {
    if (key === null) return;
    const p = people.find((x) => x.email === key);
    const no = await onPick(key === "" ? null : p ? { email: p.email, name: p.name } : null);
    if (no) return setWhy(no);
    done();
  };
  return (
    <CellPopover anchor={anchor} title="Assign to" sub={`${rows.length} selected`} onSave={() => void save(chosen)} onCancel={done} saveLabel="Assign" saveDisabled={chosen === null} warning={why} className="ah-pop ah-pop-list ah-pop-people">
      {!data && !error ? <p className="muted fl-note">Reading who can be assigned…</p> : <FilterList label={`Assign ${rows.length} items to`} options={options} current={chosen} onPick={(k) => (setChosen(k), void save(k))} placeholder="Search people" empty="Nobody on this project matches" note={error ?? data?.problem ?? "Rows already assigned to that person are skipped. Nothing is written until you save."} />}
    </CellPopover>
  );
}

/**
 * ED-2: State… for the ticked rows. Only a state every row's type takes can be picked; where the types differ, the
 * other states are listed under it with the rows they fit, so it's plain why they aren't offered. All from each
 * client's process, never a fixed list.
 */
function BulkState({ rows, anchor, onPick, done }: { rows: Row[]; anchor: HTMLElement; onPick: Picked<string>; done: () => void }) {
  const a = useAhead();
  const statesOf = (r: Row) => a.load.clients.find((c) => c.clientKey === r.clientKey)?.states?.[r.item.type] ?? [];
  const { common, partial } = useMemo(() => commonStates(rows.map((r) => ({ type: r.item.type, states: statesOf(r).map((s) => s.name) }))), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const look = (name: string) => rows.flatMap(statesOf).find((s) => s.name.toLowerCase() === name.toLowerCase());
  const [chosen, setChosen] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const dot = (name: string) => {
    const s = look(name);
    return <span className={`ah-state-dot cat-${(s?.category ?? "").toLowerCase()}`} style={s?.color ? { background: `#${s.color}`, boxShadow: "none" } : undefined} aria-hidden="true" />;
  };
  const options: ListOption[] = common.map((name) => ({ key: name, label: name, lead: dot(name), hint: categoryLabel(look(name)?.category ?? "") ?? undefined }));
  const save = async (name: string | null) => {
    if (!name) return;
    const no = await onPick(name);
    if (no) return setWhy(no);
    done();
  };
  const types = [...new Set(rows.map((r) => r.item.type))];
  return (
    <CellPopover anchor={anchor} title="State" sub={`${rows.length} selected`} onSave={() => void save(chosen)} onCancel={done} saveLabel="Set state" saveDisabled={!chosen} warning={why} className="ah-pop ah-pop-list ah-pop-bulk-state">
      <FilterList
        label={`State for ${rows.length} items`}
        options={options}
        current={chosen}
        onPick={(k) => (setChosen(k), void save(k))}
        placeholder="Filter states"
        empty={common.length ? "No state matches" : "These rows' types share no state"}
        note={
          partial.length ? (
            <span className="bl-state-partial">
              <span>The selection has {types.length} types ({types.join(", ")}). Only states every row's type takes can be set at once. Not for every row:</span>
              <span role="list" aria-label="States that fit only some of the selected rows">
                {partial.map((p) => (
                  <span role="listitem" key={p.state} className="bl-state-fit">
                    {dot(p.state)}
                    <strong>{p.state}</strong> fits {p.fits} of {rows.length}: {p.types.join(", ")}
                  </span>
                ))}
              </span>
              <span>Select only those rows to set one of these.</span>
            </span>
          ) : (
            "Rows already in that state are skipped. Nothing is written until you save."
          )
        }
      />
    </CellPopover>
  );
}

/** ED-2: Size… for the ticked rows: the process's number, typed or a common value; rows whose type has no size are skipped. */
function BulkSize({ rows, anchor, onPick, done }: { rows: Row[]; anchor: HTMLElement; onPick: Picked<number | null>; done: () => void }) {
  const labels = [...new Set(rows.filter((r) => r.has.size).map((r) => r.sizeLabel ?? "Size"))];
  const label = labels.length === 1 ? labels[0]! : "Size";
  const none = rows.filter((r) => !r.has.size).length;
  const [text, setText] = useState("");
  const [why, setWhy] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const n = text.trim() === "" ? null : Number(text.trim());
  const bad = n !== null && (!Number.isFinite(n) || n < 0 || n > 10_000);
  const choices = sizeChoices(labels[0] ?? null);
  const save = async (v: number | null) => {
    const no = await onPick(v);
    if (no) return setWhy(no);
    done();
  };
  return (
    <CellPopover anchor={anchor} title={label} sub={`${rows.length} selected`} onSave={() => !bad && n !== null && void save(n)} onCancel={done} saveLabel="Set size" saveDisabled={bad || n === null} warning={bad ? "A size is a number from 0 to 10000." : why} className="ah-pop ah-pop-size">
      <div className="ah-pop-row">
        <input ref={box} data-autofocus className="ah-pop-num" inputMode="decimal" aria-label={`${label} for ${rows.length} items`} value={text} placeholder="A number" autoComplete="off" onChange={(e) => setText(e.target.value)} />
        <Segmented label={`Common ${label} values`} value={n !== null && choices.includes(n) ? String(n) : null} onChange={(v) => setText(v)} options={choices.map((x) => ({ value: String(x), label: String(x) }))} />
        <button type="button" className="mini quiet" onClick={() => void save(null)} title="Remove the size from the selected rows">
          Clear size
        </button>
      </div>
      <p className="muted ah-pop-note">
        {none === rows.length ? "None of these rows' types has a size in its process, so all would be skipped." : none ? `${none} of ${rows.length} have no size in their process and are skipped.` : `Stored in DevOps as ${label}.`} Nothing is written until you save.
      </p>
    </CellPopover>
  );
}
