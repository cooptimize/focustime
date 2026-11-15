// ED-2: rename and move in Backlog (the Grid's rows and the Gantt's), through the change set. A title is edited in
// place in its cell (Enter stages, Esc cancels, Tab stages and moves on); Move… is ED-1's picker as one of the Grid's
// popovers (the client's open items one level up, the parent now marked, No parent). Both only stage: nothing is
// written until Save. The rules are ED-1's and the server checks them again; a refusal is said here, where it was tried.
import { useEffect, useMemo, useRef, useState } from "react";
import { moveItemFrom, moveTargets, parentIdIn } from "../../plan/ahead-edit.ts";
import { cleanTitle, TITLE_MAX } from "../../plan/quick-create.ts";
import { CellPopover, FilterList, type ListOption } from "../CellPopover.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import { useAhead } from "./Ahead.tsx";
import type { LoadClient, Row } from "./model.ts";

/** Why a row's title or parent can't be changed by me here (null: it can). */
export const noEdit = (r: Row, readOnly: boolean, note: string): string | null => (readOnly ? "Backlog is read only on a phone" : r.editable ? null : note);

/** What a staged rename or move says on its row: "Renamed, not saved" and "Moved, not saved", with what DevOps has. */
export function Unsaved({ r, parentTitle }: { r: Row; /** DevOps's parent, for the tooltip. */ parentTitle: (id: number) => string }) {
  const t = r.pending.title;
  const p = r.pending.parent;
  if (!t && !p) return null;
  const was = r.saved?.parentId ?? parentIdIn(p?.baseValue);
  return (
    <>
      {t && (
        <span className="ah-unsaved" data-unsaved="title" title={`Not in DevOps until you save. DevOps has: ${typeof t.baseValue === "string" ? t.baseValue : (r.saved?.title ?? "")}`}>
          Renamed, not saved
        </span>
      )}
      {p && (
        <span className="ah-unsaved" data-unsaved="parent" title={`Not in DevOps until you save. In DevOps it is ${was === null ? "under no parent" : `under #${was} ${parentTitle(was)}`}. Its place in the backlog order doesn't change`}>
          Moved, not saved
        </span>
      )}
    </>
  );
}

/** The words a screen reader hears for a row's staged rename and move. */
export function unsavedWords(r: Row): string {
  const t = r.pending.title;
  const p = r.pending.parent;
  return `${t ? `. Renamed, not saved yet. DevOps has ${typeof t.baseValue === "string" ? t.baseValue : "another title"}` : ""}${p ? ". Moved, not saved yet" : ""}`;
}

/**
 * The title, edited in place. Enter stages it, Esc cancels, Tab stages and moves on (Shift+Tab back); a click
 * elsewhere cancels, as the other cells' editors do. ED-1's title rule is checked as it is typed and again on the
 * server. `done(step)`: closed; 1 or -1 after Tab.
 */
export function RenameBox({ r, done, say }: { r: Row; done: (step: 0 | 1 | -1) => void; say?: (text: string) => void }) {
  const a = useAhead();
  const [text, setText] = useState(r.item.title);
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  useEffect(() => {
    // The caret at the end, nothing selected: most renames fix a word, not the whole title (review 1).
    const el = box.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // A refusal from the server: the box is enabled again by then, so focus goes back to it (review 2).
  useEffect(() => {
    if (why && !busy) box.current?.focus();
  }, [why, busy]);
  const save = async (step: 0 | 1 | -1) => {
    const t = cleanTitle(text);
    if ("problem" in t) return setWhy(t.problem);
    closing.current = true;
    if (t.title === r.item.title) return done(step);
    setBusy(true);
    const no = await a.tryStage(r, "title", t.title);
    setBusy(false);
    if (no) {
      closing.current = false;
      return setWhy(no);
    }
    say?.(`Title of #${r.item.id} staged: ${t.title}. Not saved until you save.`);
    done(step);
  };
  return (
    <span className="ah-rename">
      <input
        ref={box}
        className="ah-rename-box"
        aria-label={`Title of #${r.item.id}`}
        aria-invalid={why ? true : undefined}
        aria-describedby={why ? `ah-rename-why-${r.item.id}` : undefined}
        value={text}
        maxLength={TITLE_MAX + 50}
        disabled={busy}
        autoComplete="off"
        spellCheck
        onChange={(e) => (setText(e.target.value), setWhy(null))}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.preventDefault(), void save(0));
          else if (e.key === "Escape") (e.preventDefault(), (closing.current = true), done(0));
          else if (e.key === "Tab") (e.preventDefault(), void save(e.shiftKey ? -1 : 1));
        }}
        onBlur={() => {
          if (closing.current || busy) return;
          // A click elsewhere cancels, as the other cells' editors do; typed words that go with it are said (review 1).
          if (text.replace(/\s+/g, " ").trim() !== r.item.title) say?.(`Title of #${r.item.id} not changed. Enter keeps an edit; a click elsewhere cancels it.`);
          done(0);
        }}
      />
      {why && (
        <span id={`ah-rename-why-${r.item.id}`} className="ah-rename-why" role="alert">
          {why}
        </span>
      )}
    </span>
  );
}

/** The parents a row may move under, as ED-1's picker lists them: this client's open items one level up, in backlog order. */
export function moveChoices(c: LoadClient, r: Row) {
  const project = c.project ?? c.clientName;
  const order = (i: { order?: number | null; id: number }) => (typeof i.order === "number" ? i.order : Number.POSITIVE_INFINITY);
  const byId = new Map(c.items.map((i) => [i.id, i] as const));
  return moveTargets(c.items.map(moveItemFrom), moveItemFrom({ ...r.item, stateCategory: r.item.stateCategory }), project)
    .map((t) => byId.get(t.id)!)
    .sort((x, y) => order(x) - order(y) || x.id - y.id);
}

/**
 * Move…: search this client's open items one level up, the parent now marked, and No parent. Picking one stages the
 * move (`onPick` answers why it couldn't, and the popover says it). For several rows (the bulk bar) `rows` are all one
 * level in one client, so one list fits them all.
 */
export function MovePicker({ rows, anchor, onPick, done }: { rows: Row[]; anchor: HTMLElement | null; onPick: (parent: { id: number; title: string } | null) => Promise<string | null>; done: (step: 0 | 1 | -1) => void }) {
  const a = useAhead();
  const r = rows[0]!;
  const c = a.load.clients.find((x) => x.clientKey === r.clientKey)!;
  const choices = useMemo(() => moveChoices(c, r), [c, r]);
  const now = rows.length === 1 ? r.item.parentId : null;
  const one = rows.length === 1;
  const [chosen, setChosen] = useState<string>(one ? (now === null ? "none" : String(now)) : "");
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const types = [...new Set(choices.map((x) => x.type))];
  const options: ListOption[] = [
    { key: "none", label: "No parent", search: "no parent none", lead: <span className="ah-pop-nobody" aria-hidden="true">–</span>, ...(one && now === null ? { hint: "now" } : {}) },
    ...choices.map((p) => ({
      key: String(p.id),
      label: p.title,
      search: `${p.title} ${p.id}`,
      sub: `#${p.id} · ${p.state}`,
      lead: <TypeIcon clientKey={c.clientKey} type={p.type} className="ah-type-icon" />,
      ...(one && p.id === now ? { hint: "now" } : {}),
    })),
  ];
  const save = async (key: string, step: 0 | 1 | -1 = 0) => {
    if (!key) return;
    if (one && key === (now === null ? "none" : String(now))) return done(step);
    const p = key === "none" ? null : choices.find((x) => String(x.id) === key);
    if (p === undefined) return;
    setBusy(true);
    const no = await onPick(p ? { id: p.id, title: p.title } : null);
    setBusy(false);
    if (no) return setWhy(no);
    done(step);
  };
  const what = types.length ? types.join(" or ").toLowerCase() : "parent";
  return (
    <CellPopover
      anchor={anchor}
      title={one ? "Move under" : `Move ${rows.length} items under`}
      {...(one ? { sub: `#${r.item.id} ${r.item.title}` } : {})}
      onSave={() => void save(chosen)}
      onCancel={() => done(0)}
      saveLabel="Move"
      saveDisabled={busy || !chosen}
      warning={why}
      className="ah-pop ah-pop-list ah-pop-move"
    >
      <FilterList
        label={one ? `Move #${r.item.id} under` : `Move ${rows.length} items under`}
        options={options}
        current={chosen || null}
        onPick={(k) => (setChosen(k), setWhy(null), void save(k))}
        placeholder={`Find a ${what}`}
        empty="Nothing open one level up matches"
        note={`Only ${c.clientName}'s own open items one level up${types.length ? ` (${types.join(", ")})` : ""}. Only the parent link changes: area, iteration and the backlog order stay as they are. Nothing is written until you save.`}
      />
    </CellPopover>
  );
}
