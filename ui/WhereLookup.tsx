// RB-3: "Where is it?" with the client's real things offered as you type. The box stays the plain text box it was
// (ui/TextBox.tsx): everything typed is kept as typed, and a pick only writes words into it at the cursor. The names
// are read once, in the background, the first time the box is focused with a client chosen (code.kinds, logged as
// "Listed for Where is it?" by where it was used), and live only in this component's memory while the form is open:
// nothing goes to the browser's storage, the installed app's files or any store, and nothing goes to an AI. A report's
// pages and a model table's measures and columns are read from their one file when asked for (code.file, logged as a
// file opened). Who may read is Code's own rule, decided by the server; someone who can't gets the plain box and one
// quiet line saying why. All the words are in plan/where-lookup.ts (WHERE_TEXT).
//
// Keys, only while the list is open: Up and Down move, Enter or Tab picks the row chosen (with none chosen they do
// what they always did), Right opens a row's second level, Left goes back a level while browsing, Esc closes the list
// (the form stays). With the list closed every key is as before, except Down in an empty box, which opens the list by
// kind, and Alt+Down, which opens it anywhere. The box keeps focus throughout; the list is announced as the box's suggestions (aria-activedescendant).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { RepoThings } from "../plan/code-kinds.ts";
import { markMatches } from "../plan/code-kinds.ts";
import { afterPick, browseLevel, fieldsOf, lineOf, pagesOf, suggestAt, tablesOf, whereEntries, whereRefusal, withPick, wordAt, writtenOf, WHERE_TEXT, type WhereEntry, type WhereFrom, type WhereInner } from "../plan/where-lookup.ts";
import { WHERE_PAGES_MAX, type InnerAnswer } from "../plan/where-inner.ts";
import { ActionRefusal, call } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { TextBox } from "./TextBox.tsx";
import type { Picked } from "./WherePicks.tsx";
import "./where-lookup.css";

/** The names read for one client: what the box can offer, or why it can't. */
type Names =
  | { state: "idle" }
  | { state: "loading"; slow: boolean }
  | { state: "ready"; entries: WhereEntry[]; repos: number; problems: string[]; /** The client they were read for. */ client: string }
  | { state: "failed"; line: string; retry: boolean };

/** A second level once asked for: its rows (with a line when some couldn't be read), or why there are none. */
type Inner = { state: "loading" } | { state: "ready"; rows: WhereInner[]; note?: string; /** A one-file model's table: its name. */ title?: string } | { state: "failed"; line: string };

/** What the list shows: closed, the matches for the word being typed, or browsing (a level, or a thing's second level). */
type Mode = { type: "closed" } | { type: "typing" } | { type: "browse"; at: string | null; inner: string | null; /** Opened from typing: a pick replaces the word. */ replace: boolean; trail: { at: string | null; inner: string | null }[]; /** Back from its first level goes back to the matches. */ fromTyping?: boolean };

/** One row of the list as drawn and as the keys move through it. */
type Row =
  | { key: string; type: "entry"; entry: WhereEntry; opens: boolean }
  | { key: string; type: "folder"; at: string; label: string; count: number }
  | { key: string; type: "inner"; inner: WhereInner; /** RB-3b: a one-file model's table opens to its measures and columns. */ opens: boolean }
  | { key: string; type: "back"; label: string };

/** Past this long, the line says the read is still going (typing is never held up by it). */
const SLOW_MS = 3000;
const KIND_ICON: Record<WhereEntry["kind"], IconName> = { report: "report", model: "model", pipeline: "pipeline", notebook: "notebook", dataflow: "dataflow", lake: "lake", database: "sql", script: "sql-script", fabric: "fabric-item", other: "file" };

export type WhereBoxProps = {
  id: string;
  clientKey: string | null;
  clientName: string;
  from: WhereFrom;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  maxLength: number;
  className?: string;
  /** RB-3b: told of each pick (where its words start), so the form can take it out if its client changes. */
  onPicked?: ((p: Picked) => void) | undefined;
};

export function WhereBox({ id, clientKey, clientName, from, value, onChange, placeholder, maxLength, className, onPicked }: WhereBoxProps) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const listId = useId();
  const lineId = `${id}-line`;
  const [names, setNames] = useState<Names>({ state: "idle" });
  const [inner, setInner] = useState<ReadonlyMap<string, Inner>>(new Map());
  const [mode, setMode] = useState<Mode>({ type: "closed" });
  const [active, setActive] = useState(-1);
  const [cursor, setCursor] = useState(0);
  const [said, setSaid] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [up, setUp] = useState(false);
  // Which client the names in memory are for; a read that comes back for another one is dropped.
  const forClient = useRef<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => void (live.current = false);
  }, []);

  // A new client: what was typed stays (the form takes out names picked from the other client's code, ui/WherePicks.tsx);
  // the names are read again the next time the box is used.
  useEffect(() => {
    forClient.current = clientKey;
    setNames({ state: "idle" });
    setInner(new Map());
    setMode({ type: "closed" });
    setNote(null);
  }, [clientKey]);

  const read = useCallback(() => {
    if (!clientKey) return;
    const k = clientKey;
    setNames({ state: "loading", slow: false });
    const slow = setTimeout(() => live.current && forClient.current === k && setNames((n) => (n.state === "loading" ? { state: "loading", slow: true } : n)), SLOW_MS);
    call<{ repos: RepoThings[] }>("code.kinds", { clientKey: k, from }).then(
      (r) => {
        clearTimeout(slow);
        if (!live.current || forClient.current !== k) return;
        const entries = whereEntries(r.repos);
        const problems = r.repos.filter((x) => x.problem).map((x) => x.repo.name);
        if (!r.repos.length) return setNames({ state: "failed", line: WHERE_TEXT.noRepos(clientName), retry: false });
        if (!entries.length) return setNames(problems.length ? { state: "failed", ...whereRefusal("error", clientName) } : { state: "failed", line: WHERE_TEXT.nothingOffered(clientName), retry: false });
        setNames({ state: "ready", entries, repos: r.repos.filter((x) => x.repo.state === "ok").length, problems, client: k });
      },
      (e: unknown) => {
        clearTimeout(slow);
        if (!live.current || forClient.current !== k) return;
        setNames({ state: "failed", ...whereRefusal(e instanceof ActionRefusal ? e.code : null, clientName) });
      },
    );
  }, [clientKey, clientName, from]);

  // Only names read for the client chosen now are ever drawn (an answer for the one before can't show, even for a frame).
  const entries = names.state === "ready" && names.client === clientKey ? names.entries : null;
  const matches = useMemo(() => (entries && mode.type === "typing" ? suggestAt(entries, value, cursor) : null), [entries, mode.type, value, cursor]);
  const manyRepos = names.state === "ready" && names.repos > 1;

  /**
   * RB-3b: lists a report's pages (either format), a table's measures and columns, or a one-file model's tables, on the
   * server from only the files it needs (code.inner, one row in the Code log per listing). Only names come back.
   */
  const readInner = (e: WhereEntry) => {
    if (!clientKey || !e.more || inner.get(e.id)?.state === "ready" || inner.get(e.id)?.state === "loading") return;
    const k = clientKey;
    const list = e.more;
    setInner((m) => new Map(m).set(e.id, { state: "loading" }));
    call<InnerAnswer>("code.inner", { clientKey: k, repoId: e.repoId, path: e.file, list }).then(
      (r) => {
        if (!live.current || forClient.current !== k) return;
        const next = new Map<string, Inner>();
        if (r.list === "pages") {
          const note = r.unreadable ? WHERE_TEXT.pagesUnread(r.unreadable) : undefined;
          next.set(e.id, r.pages.length ? { state: "ready", rows: pagesOf(e, r.pages), ...(note ? { note } : {}) } : { state: "failed", line: note ?? WHERE_TEXT.innerNone.pages });
        } else if (r.list === "fields") {
          const note = r.partsSkipped ? WHERE_TEXT.partsSkipped : r.unreadable ? WHERE_TEXT.partsUnread : undefined;
          next.set(e.id, r.fields.length ? { state: "ready", rows: fieldsOf(e, r.fields), ...(note ? { note } : {}) } : { state: "failed", line: WHERE_TEXT.innerNone.fields });
        } else {
          const t = tablesOf(e, r.tables);
          next.set(e.id, t.rows.length ? { state: "ready", rows: t.rows } : { state: "failed", line: WHERE_TEXT.innerNone.tables });
          t.rows.forEach((row) => row.opens && next.set(row.opens, { state: "ready", rows: t.levels.get(row.opens) ?? [], title: row.name }));
        }
        setInner((m) => new Map([...m, ...next]));
      },
      (err: unknown) => {
        if (!live.current || forClient.current !== k) return;
        const code = err instanceof ActionRefusal ? err.code : null;
        const line = code === "not_logged" ? WHERE_TEXT.innerNotLogged : code === "too_many" ? WHERE_TEXT.tooManyPages(WHERE_PAGES_MAX) : code === "too_large" ? (list === "tables" ? WHERE_TEXT.modelTooLarge : WHERE_TEXT.innerTooLarge) : WHERE_TEXT.innerFailed;
        setInner((m) => new Map(m).set(e.id, { state: "failed", line }));
      },
    );
  };

  // The rows the list shows now, in order (the keys move through these).
  const rows: Row[] = useMemo(() => {
    if (!entries || mode.type === "closed") return [];
    if (mode.type === "typing") return (matches?.shown ?? []).map((e) => ({ key: e.id, type: "entry", entry: e, opens: e.more !== null || entries.some((x) => x.parent === e.id) }));
    const out: Row[] = [];
    if (mode.trail.length) out.push({ key: "back", type: "back", label: WHERE_TEXT.back });
    if (mode.inner) {
      const st = inner.get(mode.inner);
      if (st?.state === "ready") for (const x of st.rows) out.push({ key: x.id, type: "inner", inner: x, opens: !!x.opens });
      return out;
    }
    for (const g of browseLevel(entries, mode.at).groups)
      for (const r of g.rows) out.push(r.type === "entry" ? { key: r.entry.id, type: "entry", entry: r.entry, opens: r.opens } : { key: r.key, type: "folder", at: r.key, label: r.label, count: r.count });
    return out;
  }, [entries, mode, matches, inner]);
  // A word that matches nothing shows nothing: the box is just a text box then.
  const shownList = !!entries && (mode.type === "browse" || (mode.type === "typing" && (matches?.total ?? 0) > 0));

  // Where the list goes: under the box, or over it when the room left under it (the dialog's own edge, the screen's,
  // or the phone's keyboard) is short; never taller than the room it has.
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!shownList || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const vv = window.visualViewport;
    const frame = box.current.closest("[role=dialog], [data-overlay]")?.getBoundingClientRect();
    const bottom = Math.min(vv ? vv.offsetTop + vv.height : window.innerHeight, frame?.bottom ?? Infinity) - 16;
    const top = Math.max(vv ? vv.offsetTop : 0, frame?.top ?? -Infinity) + 16;
    const below = bottom - r.bottom;
    const above = r.top - top;
    const goUp = below < 200 && above > below;
    setUp(goUp);
    setRoom(Math.max(120, Math.min(320, goUp ? above : below)));
  }, [shownList, rows.length]);

  // What a screen reader hears as the list changes: how many there are, and whether Down chooses one.
  useEffect(() => {
    // A closed list leaves nothing stale to be read again ("Added <name>." after a pick stays).
    if (!shownList) return void setSaid((s) => (s.startsWith("Added ") ? s : ""));
    if (mode.type === "typing" && matches) setSaid(WHERE_TEXT.count(matches.total));
    else if (mode.type === "browse") setSaid(WHERE_TEXT.browsing(rows.filter((r) => r.type !== "back").length));
  }, [shownList, mode.type, matches?.total, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => (setMode({ type: "closed" }), setActive(-1));
  const caret = () => box.current?.selectionStart ?? cursor;

  /** Writes a pick at the cursor (replacing the word being typed when there is one), and says it was added. */
  const pick = (text: string, name: string, replace: boolean) => {
    const at = caret();
    // A phrase being typed ("load sa") is replaced whole when the pick came from its matches.
    const from = replace && matches && at === cursor ? matches.start : undefined;
    const next = withPick(value, at, text, replace, from);
    if (!next) return void (setSaid(WHERE_TEXT.noRoom), setNote(WHERE_TEXT.noRoom));
    onChange(next.text);
    onPicked?.({ start: next.at, text, in: next.text });
    setCursor(next.cursor);
    setNote(null);
    picked.current = { text: next.text, at: next.cursor };
    close();
    setSaid(WHERE_TEXT.added(name));
    caretAfter.current = next.cursor;
  };
  // The caret goes right after a pick in the same paint as its words, so a key pressed next lands there.
  const caretAfter = useRef<number | null>(null);
  /** The text and caret right after a pick, until the next keystroke. */
  const picked = useRef<{ text: string; at: number } | null>(null);
  useLayoutEffect(() => {
    const t = box.current;
    const at = caretAfter.current;
    if (!t || at === null) return;
    caretAfter.current = null;
    if (document.activeElement !== t) t.focus();
    t.setSelectionRange(at, at);
  }, [value]);

  const goTo = (to: { at: string | null; inner: string | null }) => {
    const m = mode.type === "browse" ? mode : { type: "browse" as const, at: null, inner: null, replace: true, trail: [] };
    setMode({ ...m, type: "browse", at: to.at, inner: to.inner, trail: [...m.trail, { at: m.at, inner: m.inner }] });
    setActive(1);
  };
  const back = () => {
    if (mode.type !== "browse" || !mode.trail.length) return close();
    if (mode.fromTyping && mode.trail.length === 1) return void (setMode({ type: "typing" }), setActive(0));
    const prev = mode.trail[mode.trail.length - 1]!;
    setMode({ ...mode, at: prev.at, inner: prev.inner, trail: mode.trail.slice(0, -1) });
    setActive(0);
  };
  /** Opens a row's next level: a second level read from its file, or what's inside it. */
  const openRow = (r: Row) => {
    if (r.type === "folder") return goTo({ at: r.at, inner: null });
    if (r.type === "back") return back();
    if (r.type === "inner") return void (r.inner.opens && mode.type === "browse" && goTo({ at: mode.at, inner: r.inner.opens }));
    if (r.type !== "entry" || !r.opens) return;
    if (mode.type === "typing") {
      // From typing: browsing starts at this thing, and a pick from it still replaces the word typed.
      setMode({ type: "browse", at: r.entry.more ? null : r.entry.id, inner: r.entry.more ? r.entry.id : null, replace: true, trail: [{ at: null, inner: null }], fromTyping: true });
      setActive(0);
    } else if (mode.type === "browse") goTo(r.entry.more ? { at: mode.at, inner: r.entry.id } : { at: r.entry.id, inner: null });
    if (r.entry.more) readInner(r.entry);
  };
  const choose = (r: Row) => {
    const replace = mode.type === "typing" || (mode.type === "browse" && mode.replace);
    if (r.type === "entry") pick(writtenOf(r.entry), r.entry.name, replace);
    else if (r.type === "inner") pick(r.inner.written, r.inner.name, replace);
    else openRow(r);
  };
  const browse = () => {
    if (!clientKey) return void setNote(WHERE_TEXT.chooseClientLine);
    if (names.state === "idle") read();
    box.current?.focus();
    setMode({ type: "browse", at: null, inner: null, replace: false, trail: [] });
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = e.nativeEvent.isComposing;
    if (composing) return;
    if (!shownList) {
      // The new keys with the list closed: Down in an empty box, or Alt+Down anywhere, opens the list by kind (the browse
      // button is out of the Tab order, so Tab still goes from this box to the next question).
      // After a failed read, Alt+Down tries again (Try again is out of the Tab order, so Tab is as before).
      if (e.key === "ArrowDown" && e.altKey && names.state === "failed" && names.retry) {
        e.preventDefault();
        return read();
      }
      if (e.key === "ArrowDown" && (!value || e.altKey) && !e.ctrlKey && !e.metaKey && !e.shiftKey && clientKey && names.state !== "failed") {
        e.preventDefault();
        browse();
      }
      return;
    }
    const mod = e.altKey || e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return close();
    }
    if (mod) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 ? (d > 0 ? 0 : rows.length - 1) : (a + d + rows.length) % rows.length));
      return;
    }
    const row = active >= 0 ? rows[active] : undefined;
    if ((e.key === "Enter" && !e.shiftKey) || (e.key === "Tab" && !e.shiftKey)) {
      // With no row chosen, Enter and Tab do what they always did.
      if (!row) return close();
      e.preventDefault();
      return choose(row);
    }
    if (e.key === "ArrowRight" && row && (row.type === "folder" || ((row.type === "entry" || row.type === "inner") && row.opens))) {
      e.preventDefault();
      return openRow(row);
    }
    if (e.key === "ArrowLeft" && mode.type === "browse" && mode.trail.length && active >= 0) {
      e.preventDefault();
      return back();
    }
  };

  /** Typing: the list follows the word at the cursor. */
  const onInput = (v0: string, at0: number) => {
    const p = picked.current;
    picked.current = null;
    const spaced = p && p.text === value && at0 === p.at + 1 ? afterPick(value, v0, at0) : null;
    const [v, at] = spaced ? [spaced.text, spaced.cursor] : [v0, at0];
    if (spaced) caretAfter.current = at;
    onChange(v);
    setCursor(at);
    setNote(null);
    const w = wordAt(v, at);
    if (w.word.length >= 2 && entries) (setMode({ type: "typing" }), setActive(-1));
    else if (mode.type !== "closed") close();
  };

  const activeRow = active >= 0 ? rows[active] : undefined;
  const activeId = shownList && activeRow ? `${listId}-${active}` : undefined;
  // The chosen row stays in sight as the keys move through a long list.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  const line =
    !clientKey ? note : names.state === "failed" ? names.line : names.state === "loading" ? (names.slow ? WHERE_TEXT.slow(clientName) : mode.type === "browse" ? WHERE_TEXT.reading(clientName) : null) : note ?? (names.state === "ready" && names.problems.length ? WHERE_TEXT.someRepos(names.problems.join(", ")) : null);
  const retry = names.state === "failed" && names.retry;
  const canLook = !!clientKey && names.state !== "failed";

  // Names that arrive while a word is already typed show its matches at once (browsing asked for before they arrived
  // opens then too); a failed read closes the list.
  useEffect(() => {
    if (names.state === "failed" && mode.type !== "closed") close();
    if (names.state !== "ready" || mode.type !== "closed" || document.activeElement !== box.current) return;
    const at = caret();
    setCursor(at);
    if (wordAt(value, at).word.length >= 2) (setMode({ type: "typing" }), setActive(-1));
  }, [names.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = (r: Row, n: number): ReactNode => {
    const rid = `${listId}-${n}`;
    const on = n === active;
    const common = { id: rid, role: "option", "aria-selected": on, className: `wl-row${on ? " on" : ""}`, onMouseDown: (e: ReactMouseEvent) => e.preventDefault(), onMouseMove: () => active !== n && setActive(n) } as const;
    if (r.type === "back")
      return (
        <li key={r.key} {...common} aria-label={r.label} className={`${common.className} wl-back`} onClick={back}>
          <Icon name="arrow-left" /> <span>{r.label}</span>
        </li>
      );
    if (r.type === "folder")
      return (
        <li key={r.key} {...common} aria-label={`${r.label}, ${r.count}`} onClick={() => openRow(r)}>
          <Icon name="folder" />
          <span className="wl-name">{r.label}</span>
          <span className="wl-what">{r.count.toLocaleString("en-US")}</span>
          <Icon name="arrow-right" className="wl-go" />
        </li>
      );
    if (r.type === "inner")
      return (
        <li key={r.key} {...common} aria-label={`${r.inner.name}, ${r.inner.line}${r.opens ? `. Right arrow: ${WHERE_TEXT.open.fields}` : ""}`} onClick={() => choose(r)} data-hidden={r.inner.hidden ? "" : undefined}>
          <Icon name={r.inner.what === "page" ? "report" : "table"} />
          <span className="wl-name">{r.inner.name}</span>
          <span className="wl-what">{r.inner.line}</span>
          {r.opens && (
            <button type="button" tabIndex={-1} className="wl-open link-btn" onMouseDown={(ev) => ev.preventDefault()} onClick={(ev) => (ev.stopPropagation(), openRow(r))}>
              {WHERE_TEXT.open.fields} <Icon name="arrow-right" />
            </button>
          )}
        </li>
      );
    const e = r.entry;
    const marked = mode.type === "typing" ? markMatches(e.name, matches?.typed.split(/\s+/).pop() ?? "") : [{ text: e.name, hit: false }];
    const what = `${lineOf(e)}${manyRepos ? ` · ${e.repoName}` : ""}`;
    const opener = e.more ? WHERE_TEXT.open[e.more] : WHERE_TEXT.open.list;
    return (
      <li key={r.key} {...common} aria-label={`${e.name}, ${what}${r.opens ? `. Right arrow: ${opener}` : ""}`} onClick={() => choose(r)}>
        <Icon name={KIND_ICON[e.kind]} />
        <span className="wl-name">{marked.map((m, i) => (m.hit ? <mark key={i}>{m.text}</mark> : <span key={i}>{m.text}</span>))}</span>
        <span className="wl-what">{what}</span>
        {r.opens && (
          <button type="button" tabIndex={-1} className="wl-open link-btn" onMouseDown={(ev) => ev.preventDefault()} onClick={(ev) => (ev.stopPropagation(), openRow(r))}>
            {opener} <Icon name="arrow-right" />
          </button>
        )}
      </li>
    );
  };

  const st = mode.type === "browse" && mode.inner ? inner.get(mode.inner) : undefined;
  const title = mode.type === "browse" && entries ? (mode.inner ? (entries.find((x) => x.id === mode.inner)?.name ?? (st?.state === "ready" ? st.title : undefined)) : mode.at ? browseLevel(entries, mode.at).title : null) : null;
  const groups = mode.type === "browse" && !mode.inner && entries ? browseLevel(entries, mode.at).groups : null;

  // The browse list's rows by group, with headings at the top level (the keys move through `rows` in the same order).
  const body: ReactNode = (() => {
    if (!shownList) return null;
    if (mode.type === "typing") return rows.map(draw);
    let n = 0;
    const out: ReactNode[] = [];
    if (mode.type === "browse" && mode.trail.length) out.push(draw(rows[n]!, n++));
    if (st && (st.state !== "ready" || st.note))
      out.push(
        <li key="inner-state" className="wl-note" role="presentation">
          {st.state === "loading" ? WHERE_TEXT.innerReading : st.state === "failed" ? st.line : st.note}
        </li>,
      );
    if (groups)
      for (const g of groups) {
        const items: ReactNode[] = [];
        for (let k = 0; k < g.rows.length; k++) items.push(draw(rows[n]!, n++));
        out.push(
          g.label ? (
            <li key={`g-${g.label}`} role="presentation" className="wl-group">
              <span className="wl-head" aria-hidden="true">{g.label}</span>
              <ul role="group" aria-label={g.label}>{items}</ul>
            </li>
          ) : (
            items
          ),
        );
      }
    else while (n < rows.length) out.push(draw(rows[n]!, n++));
    return out;
  })();

  return (
    <span className={`wl${up ? " wl-up" : ""}`} data-where-lookup="">
      <span className="wl-field">
        <TextBox
          id={id}
          ref={box}
          className={`${className ?? ""} wl-box`}
          data-question="where"
          minRows={1}
          maxRows={5}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          aria-autocomplete={canLook ? "list" : undefined}
          aria-controls={shownList ? listId : undefined}
          aria-activedescendant={activeId}
          aria-describedby={line ? lineId : undefined}
          onFocus={() => {
            if (clientKey && names.state === "idle") read();
          }}
          onBlur={() => close()}
          onChange={(e) => onInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="wl-browse"
          tabIndex={-1}
          aria-keyshortcuts="Alt+ArrowDown"
          aria-label={clientKey ? WHERE_TEXT.browse(clientName) : WHERE_TEXT.chooseClient}
          title={clientKey ? WHERE_TEXT.browse(clientName) : WHERE_TEXT.chooseClient}
          data-off={canLook ? undefined : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (canLook || !clientKey ? browse() : box.current?.focus())}
        >
          <Icon name="repo" />
        </button>
        {shownList && (
          <span className="wl-pop" style={room ? { maxHeight: room } : undefined}>
            {title && <span className="wl-title">{title}</span>}
            <ul id={listId} role="listbox" aria-label={title ?? (mode.type === "typing" ? WHERE_TEXT.listName(clientName) : WHERE_TEXT.browse(clientName))} className="wl-list">
              {body}
            </ul>
            {mode.type === "typing" && matches && matches.total > matches.shown.length && <span className="wl-more">{WHERE_TEXT.more(matches.total - matches.shown.length)}</span>}
          </span>
        )}
      </span>
      {line && (
        <span className="wl-line muted" id={lineId}>
          {line}
          {retry && (
            <>
              {" "}
              <button type="button" className="link-btn" tabIndex={-1} aria-keyshortcuts="Alt+ArrowDown" title="Alt+Down" onMouseDown={(e) => e.preventDefault()} onClick={() => (read(), box.current?.focus())}>
                {WHERE_TEXT.tryAgain}
              </button>
            </>
          )}
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </span>
  );
}
