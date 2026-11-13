// ED-1: editing an item on its story card. Edit turns the title, the description and (where the type has the field)
// the acceptance criteria into boxes in place; the description and acceptance use light marks with small format
// buttons and a live look of how DevOps will show them. Save opens one preview through the write framework; nothing
// is written while typing. A field FocusTime can't keep exactly isn't offered as a box: one line says why, with Add
// to the end and Copy DevOps link. Move… picks a new parent one level up from the client's own items (the New form's
// pool), or No parent. The server checks everything again; these are only the boxes.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { EditFieldOffer, EditOffer } from "../actions/types.ts";
import { applyMark, lookHtml, LOSSY_TEXT } from "../plan/light-format.ts";
import type { NewOptions, NewParent } from "../plan/quick-create.ts";
import { call } from "./api.ts";
import { TextBox } from "./TextBox.tsx";
import { TypeIcon } from "./TypeIcon.tsx";
import { copyWorkLink } from "./WorkLink.tsx";

export type EditDraft = { rev: number; title: string; description: string; acceptance: string; /** The acceptance box is open (it was empty: "Add acceptance criteria"). */ acceptanceOpen: boolean };

export const draftOf = (o: EditOffer, acceptanceOpen = false): EditDraft => ({ rev: o.rev, title: o.title, description: o.description?.text ?? "", acceptance: o.acceptance?.text ?? "", acceptanceOpen: acceptanceOpen || !!o.acceptance?.text });

/** The parts that differ from what Edit read (only these go in the patch). */
export function changedParts(o: EditOffer, d: EditDraft): { title?: string; description?: string; acceptance?: string } {
  const out: { title?: string; description?: string; acceptance?: string } = {};
  if (d.title.replace(/\s+/g, " ").trim() !== o.title) out.title = d.title;
  if (o.description?.editable && d.description.replace(/\s+$/, "") !== o.description.text.replace(/\s+$/, "")) out.description = d.description;
  if (o.acceptance?.editable && d.acceptance.replace(/\s+$/, "") !== o.acceptance.text.replace(/\s+$/, "")) out.acceptance = d.acceptance;
  return out;
}
export const isDirty = (o: EditOffer | null, d: EditDraft | null) => !!o && !!d && Object.keys(changedParts(o, d)).length > 0;

const MARKS = [
  { mark: "bold", label: "Bold", text: "B", key: "Ctrl+B" },
  { mark: "italic", label: "Italic", text: "I", key: "Ctrl+I" },
  { mark: "bullets", label: "Bullets", text: "•", key: null },
  { mark: "numbers", label: "Numbers", text: "1.", key: null },
  { mark: "link", label: "Link", text: "Link", key: null },
] as const;

/** One description or acceptance box: format buttons, the box, and how it will read in DevOps. */
export function LightEditor({ label, value, onChange, placeholder, onSave, boxRef, markdown, lossy }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; onSave: () => void; boxRef?: (el: HTMLTextAreaElement | null) => void; markdown?: boolean; /** The stored text had fonts or colors this drops: said before Save, and again in the preview. */ lossy?: boolean }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const lookId = useId();
  const mark = (m: (typeof MARKS)[number]["mark"]) => {
    const t = ref.current;
    if (!t) return;
    const r = applyMark(value, t.selectionStart, t.selectionEnd, m);
    pending.current = { start: r.start, end: r.end };
    onChange(r.value);
  };
  // The marked text stays selected, set as the new value lands (before anything else is typed).
  const pending = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    const p = pending.current;
    if (!t || !p) return;
    pending.current = null;
    t.focus();
    t.setSelectionRange(p.start, p.end);
  }, [value]);
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === "b" || e.key === "B")) return void (e.preventDefault(), mark("bold"));
    if (mod && !e.shiftKey && !e.altKey && (e.key === "i" || e.key === "I")) return void (e.preventDefault(), mark("italic"));
    if (mod && e.key === "Enter") return void (e.preventDefault(), onSave());
  };
  const look = useMemo(() => lookHtml(value), [value]);
  return (
    <div className="sc-light">
      <div className="sc-tools" role="toolbar" aria-label={`Format ${label.toLowerCase()}`}>
        {MARKS.map((m) => (
          <button key={m.mark} type="button" className={`mini sc-tool sc-tool-${m.mark}`} aria-label={m.label} title={m.key ? `${m.label} (${m.key})` : m.label} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(m.mark)}>
            {m.text}
          </button>
        ))}
        {markdown && <span className="muted sc-tools-note">Kept as Markdown, as DevOps stores it</span>}
      </div>
      {lossy && <p className="sc-lossy">{LOSSY_TEXT}</p>}
      <TextBox
        aria-label={label}
        aria-describedby={lookId}
        className="sc-light-box"
        value={value}
        minRows={3}
        maxRows={14}
        maxLength={32_000}
        placeholder={placeholder}
        ref={(el) => ((ref.current = el), boxRef?.(el))}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keys}
      />
      <div className="sc-look" id={lookId}>
        <span className="sc-look-label">How it will read in DevOps</span>
        {value.trim() ? <div className="sc-html" dangerouslySetInnerHTML={{ __html: look }} /> : <p className="muted">Nothing yet.</p>}
      </div>
    </div>
  );
}

/** The line shown in place of a box FocusTime can't keep, with Add to the end and Copy DevOps link. */
export function CantEdit({ field, url, onAppend }: { field: EditFieldOffer; url: string; onAppend: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="sc-cant" role="group" aria-label={`${field.label} can't be edited here`}>
      <p className="sc-cant-why">{field.why}</p>
      {!open ? (
        <div className="sc-edit-acts start">
          <button type="button" className="mini" onClick={() => setOpen(true)}>
            Add to the end
          </button>
          <button type="button" className="mini" onClick={() => void copyWorkLink(url)}>
            Copy DevOps link
          </button>
        </div>
      ) : (
        <>
          <LightEditor label={`Text to add to the end of the ${field.label.toLowerCase()}`} value={text} onChange={setText} onSave={() => text.trim() && onAppend(text)} markdown={field.format === "markdown"} boxRef={(el) => el && !text && el.focus()} />
          <div className="sc-edit-acts">
            <button type="button" className="mini" onClick={() => (setOpen(false), setText(""))}>
              Cancel
            </button>
            <button type="button" className="mini primary" disabled={!text.trim()} onClick={() => onAppend(text)}>
              Preview
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The card's ⋯: Move… and Copy DevOps link, as a small menu inside the card (arrow keys move, Esc closes). */
export function CardMore({ items }: { items: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  const close = () => (setOpen(false), btn.current?.focus());
  return (
    <span className="sc-more">
      <button ref={btn} type="button" className="more-btn" aria-label="More for this item" aria-haspopup="menu" aria-expanded={open} title="More" onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div
          ref={list}
          className="sc-more-menu"
          role="menu"
          aria-label="More for this item"
          onKeyDown={(e) => {
            const all = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
            const at = all.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "Escape") return void (e.preventDefault(), e.stopPropagation(), close());
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
            }
          }}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}
        >
          {items.map((i) => (
            <button key={i.label} type="button" role="menuitem" onClick={() => (setOpen(false), i.run())}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * Move…: the client's open items exactly one level up (the New form's pool), with search, the current parent marked,
 * and No parent. Only ids from that list can be chosen; the server checks the level, the project and the state again.
 */
export function MoveEditor({ offer, clientKey, onCancel, onPreview }: { offer: EditOffer; clientKey: string; onCancel: () => void; onPreview: (parentId: number | null) => void }) {
  const [opts, setOpts] = useState<NewParent[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string>(offer.parent ? String(offer.parent.id) : "none");
  useEffect(() => {
    let live = true;
    call<NewOptions>("new.options", { clientKey }).then(
      (r) => live && (setOpts(r.parents.filter((p) => offer.parentTypes.includes(p.type) && p.id !== offer.itemId)), setProblem(r.problem)),
      (e: unknown) => live && setProblem(e instanceof Error ? e.message : "That didn't work"),
    );
    return () => void (live = false);
  }, [clientKey, offer.itemId, offer.parentTypes]);
  const words = q.trim().toLowerCase();
  const shown = (opts ?? []).filter((p) => !words || p.title.toLowerCase().includes(words) || String(p.id).includes(words)).slice(0, 50);
  const now = offer.parent?.id ?? null;
  const pick = chosen === "none" ? null : Number(chosen);
  const types = offer.parentTypes.join(" or ").toLowerCase();
  return (
    <div className="sc-edit sc-move" role="group" aria-label={`Move #${offer.itemId} under a different parent`}>
      <p className="sc-move-now">
        Now under: {offer.parent ? (
          <>
            <TypeIcon clientKey={clientKey} type={offer.parent.type} decorative /> #{offer.parent.id} {offer.parent.title}
          </>
        ) : (
          "no parent"
        )}
      </p>
      <input aria-label={`Find a ${types}`} placeholder={`Find a ${types}`} value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
      {opts === null && !problem ? (
        <p className="muted">Reading {types}s…</p>
      ) : (
        <select aria-label="Move under" size={Math.min(8, shown.length + 1)} value={chosen} onChange={(e) => setChosen(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pick !== now && (e.preventDefault(), onPreview(pick))}>
          <option value="none">No parent{now === null ? " (now)" : ""}</option>
          {shown.map((p) => (
            <option key={p.id} value={String(p.id)}>
              #{p.id} {p.title} · {p.state}
              {p.id === now ? " (now)" : ""}
            </option>
          ))}
        </select>
      )}
      {problem && <p className="wrap-error">{problem}</p>}
      <p className="muted sc-move-note">Only the parent link changes. Area, iteration, state, dates, assignee and backlog order stay as they are.</p>
      <div className="sc-edit-acts">
        <button type="button" className="mini" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="mini primary" disabled={pick === now || opts === null} onClick={() => onPreview(pick)}>
          Preview
        </button>
      </div>
    </div>
  );
}

/** "This changed in DevOps since you opened it": what it says now, my words kept, and Save again against it. */
export function ChangedSince({ now, onUse, children }: { now: EditOffer; onUse: () => void; children?: ReactNode }) {
  return (
    <div className="sc-changed" role="alert">
      <p>
        <strong>This changed in DevOps since you opened it.</strong> Nothing was written. Your words are still in the boxes. DevOps has now:
      </p>
      <dl className="sc-changed-now">
        <dt>Title</dt>
        <dd>{now.title}</dd>
        {now.description && (
          <>
            <dt>Description</dt>
            <dd>{now.description.editable ? (now.description.text ? <div className="sc-html" dangerouslySetInnerHTML={{ __html: lookHtml(now.description.text) }} /> : "(none)") : now.description.why}</dd>
          </>
        )}
        {now.acceptance && (
          <>
            <dt>Acceptance criteria</dt>
            <dd>{now.acceptance.editable ? (now.acceptance.text ? <div className="sc-html" dangerouslySetInnerHTML={{ __html: lookHtml(now.acceptance.text) }} /> : "(none)") : now.acceptance.why}</dd>
          </>
        )}
      </dl>
      {children}
      <div className="sc-edit-acts start">
        <button type="button" className="mini primary" onClick={onUse}>
          Save again
        </button>
      </div>
    </div>
  );
}
