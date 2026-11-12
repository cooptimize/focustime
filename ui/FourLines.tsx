// TP-1: the four lines, as the New form, the draft editor and Admin's preview show them. Each line has its name as the
// label with a small help mark (why it matters to a builder, one sentence), the type's hint as the grey text in the box,
// and, while the person is in that line, "Example:" with the type's worked example under the box (on focus, not only
// on hover; the box names it for a screen reader). Wherever the answer comes from a short list there is a choice
// instead of typing: Environment and Touches, Checked by, Done when it is, Signed off by and Not without asking, each
// with "Other" for what the list can't cover. Everything is optional; nothing here is ever required.
import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { activeTypes, fullExample, helpFor, LINE_KEYS, LINE_NAMES, lineWords, typeById, type Brief, type LineKey, type WorkTemplates, type Who } from "../plan/work-templates.ts";
import { usePeople } from "./ahead/Editors.tsx";
import type { ListOption } from "./CellPopover.tsx";
import { SelectField } from "./SelectField.tsx";
import { TextBox } from "./TextBox.tsx";

const OTHER = "\u0000other";

/** A client change: people chosen from the old client's project go (a role typed in stays). */
export const withoutPeople = (b: Brief): Brief => ({ ...b, checkedBy: b.checkedBy?.email ? null : b.checkedBy, signedOffBy: b.signedOffBy?.email ? null : b.signedOffBy });
const ROLE = "\u0000role";

/** Type: one optional choice; each option shows its name and its one-line meaning, so the list explains itself. */
export function TypeField({ doc, value, onChange, label = "Type" }: { doc: WorkTemplates; value: string | null; onChange: (id: string | null) => void; label?: string }) {
  const gone = value ? typeById(doc, value) : null;
  const options: ListOption[] = [
    { key: "", label: "No type", sub: "The general hints", search: "none no type general" },
    ...activeTypes(doc).map((t) => ({ key: t.id, label: t.name, sub: t.meaning, search: `${t.name} ${t.meaning}` })),
    ...(gone?.removed ? [{ key: gone.id, label: `${gone.name} (no longer offered)`, sub: gone.meaning }] : []),
  ];
  return <SelectField label={label} value={value ?? ""} options={options} onChange={(k) => onChange(k || null)} className="nf-select fl-type" empty="Choose one (optional)" />;
}

/** The small "?" beside a line's name: its one sentence on hover, on keyboard focus, and pinned on a click. */
function HelpMark({ name, why }: { name: string; why: string }) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  return (
    <span className={`fl-help${pinned ? " pinned" : ""}`}>
      <button
        type="button"
        className="fl-help-btn"
        aria-label={`Why ${name} matters`}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={() => setPinned(!pinned)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && pinned) {
            e.stopPropagation();
            setPinned(false);
          }
        }}
        onBlur={() => setPinned(false)}
      >
        ?
      </button>
      <span id={id} role="tooltip" className="fl-why">
        {why}
      </span>
    </span>
  );
}

/** One choice from a list, with "Other" and a short box for what the list can't cover. */
function ChoiceSelect({ label, value, options, onChange }: { label: string; value: string | null; options: readonly string[]; onChange: (v: string | null) => void }) {
  const known = !value || options.some((o) => o.toLowerCase() === value.toLowerCase());
  const [other, setOther] = useState(!known);
  // While typing in Other, the box keeps what is typed even when it matches a choice.
  const [typed, setTyped] = useState(known ? "" : (value ?? ""));
  const shown = other ? OTHER : (value ?? "");
  const opts: ListOption[] = [{ key: "", label: "Not set" }, ...options.map((o) => ({ key: o, label: o })), { key: OTHER, label: "Other…", search: "other something else type" }];
  return (
    <span className="fl-choice">
      <span className="fl-choice-label" aria-hidden="true">
        {label}
      </span>
      <SelectField label={label} value={shown} options={opts} empty="Not set" className="nf-select" onChange={(k) => (k === OTHER ? (setOther(true), onChange(known ? null : value)) : (setOther(false), onChange(k || null)))} />
      {other && <input className="fl-other" aria-label={`${label}, other`} placeholder="Type it" maxLength={60} value={typed} onChange={(e) => (setTyped(e.target.value), onChange(e.target.value || null))} />}
    </span>
  );
}

/** Any of a list, as chips that toggle, with "Other" adding one typed in. */
function ChoiceChips({ label, values, options, onChange }: { label: string; values: readonly string[]; options: readonly string[]; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const has = (o: string) => values.some((v) => v.toLowerCase() === o.toLowerCase());
  const toggle = (o: string) => onChange(has(o) ? values.filter((v) => v.toLowerCase() !== o.toLowerCase()) : [...values, o]);
  const extra = values.filter((v) => !options.some((o) => o.toLowerCase() === v.toLowerCase()));
  const add = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t && !has(t)) onChange([...values, t]);
    setText("");
    setAdding(false);
  };
  return (
    <span className="fl-choice fl-chips" role="group" aria-label={label}>
      <span className="fl-choice-label" aria-hidden="true">
        {label}
      </span>
      {[...options, ...extra].map((o) => (
        <button key={o} type="button" className="chip-btn" aria-pressed={has(o)} onClick={() => toggle(o)}>
          {o}
        </button>
      ))}
      {adding ? (
        <input
          className="fl-other"
          aria-label={`${label}, other`}
          placeholder="Type it, then Enter"
          maxLength={60}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              add();
            } else if (e.key === "Enter") {
              // Ctrl+Enter creates: what was typed here goes in first, then the form gets the keys once it has it.
              e.preventDefault();
              e.stopPropagation();
              const dialog = e.currentTarget.closest('[role="dialog"]');
              add();
              setTimeout(() => dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })), 0);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setText("");
              setAdding(false);
            }
          }}
        />
      ) : (
        <button type="button" className="chip-btn fl-chip-other" onClick={() => setAdding(true)}>
          Other…
        </button>
      )}
    </span>
  );
}

/** A person on the client's DevOps project (never another client's), or a role typed in ("the finance lead"). */
function WhoPick({ label, value, onChange, clientKey }: { label: string; value: Who | null; onChange: (w: Who | null) => void; clientKey: string | null }) {
  const [role, setRole] = useState(!!value && !value.email);
  return (
    <span className="fl-choice">
      <span className="fl-choice-label" aria-hidden="true">
        {label}
      </span>
      {clientKey ? <PeopleSelect label={label} clientKey={clientKey} value={role ? ROLE : (value?.email ?? "")} onPick={(k, name) => (k === ROLE ? (setRole(true), onChange(value && !value.email ? value : null)) : (setRole(false), onChange(k ? { name, email: k } : null)))} /> : null}
      {(role || !clientKey) && <input className="fl-other" aria-label={`${label}, a role`} placeholder="A role, like the finance lead" maxLength={100} value={value && !value.email ? value.name : ""} onChange={(e) => onChange(e.target.value ? { name: e.target.value, email: null } : null)} />}
    </span>
  );
}
function PeopleSelect({ label, clientKey, value, onPick }: { label: string; clientKey: string; value: string; onPick: (key: string, name: string) => void }) {
  const { data } = usePeople(clientKey);
  const people = data?.people ?? [];
  const opts: ListOption[] = [{ key: "", label: "Not set" }, { key: ROLE, label: "A role (type it)", search: "role lead owner type" }, ...people.map((p) => ({ key: p.email, label: p.me ? `${p.name} (me)` : p.name, sub: p.domain, search: `${p.name} ${p.domain}` }))];
  const known = value && value !== ROLE && !people.some((p) => p.email === value) ? [{ key: value, label: value }] : [];
  return <SelectField label={label} value={value} options={[...opts, ...known]} empty="Not set" className="nf-select" onChange={(k) => onPick(k, people.find((p) => p.email === k)?.name ?? k)} />;
}

/**
 * The four lines for a brief. `layout`: "grid" puts each line's name in the form's label column; "stack" puts it above
 * the box (the phone, the draft editor's narrow column).
 */
export function FourLines({ doc, brief, onChange, clientKey, layout = "grid", readOnly = false }: { doc: WorkTemplates; brief: Brief; onChange: (b: Brief) => void; clientKey: string | null; layout?: "grid" | "stack"; readOnly?: boolean }) {
  const base = useId();
  const [active, setActiveNow] = useState<LineKey | null>(null);
  // Showing or hiding an example moves what is under it. With a mouse or a finger down, the change waits until it is
  // released, so the press that moved focus still lands on the control it started on (keyboard focus shows at once).
  const pressing = useRef(false);
  const pending = useRef<((a: LineKey | null) => LineKey | null) | null>(null);
  useEffect(() => {
    const down = () => void (pressing.current = true);
    const up = () => {
      pressing.current = false;
      const f = pending.current;
      pending.current = null;
      if (f) setTimeout(() => setActiveNow(f), 0);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);
  const setActive = (f: (a: LineKey | null) => LineKey | null) => {
    if (!pressing.current) return setActiveNow(f);
    const before = pending.current;
    pending.current = before ? (a) => f(before(a)) : f;
  };
  const help = helpFor(doc, brief.type);
  const set = (p: Partial<Brief>) => onChange({ ...brief, ...p });
  const leave = (k: LineKey) => (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive((a) => (a === k ? null : a));
  };
  const choices = (k: LineKey): ReactNode => {
    if (k === "where")
      return (
        <span className="fl-choices">
          <ChoiceSelect label="Environment" value={brief.env} options={doc.lists.environments} onChange={(env) => set({ env })} />
          <ChoiceChips label="Touches" values={brief.touches} options={doc.lists.touches} onChange={(touches) => set({ touches })} />
        </span>
      );
    if (k === "check")
      return (
        <span className="fl-choices">
          <WhoPick label="Checked by" value={brief.checkedBy} clientKey={clientKey} onChange={(checkedBy) => set({ checkedBy })} />
        </span>
      );
    if (k === "done")
      return (
        <span className="fl-choices">
          <ChoiceSelect label="Done when it is" value={brief.doneWhen} options={doc.lists.doneWhen} onChange={(doneWhen) => set({ doneWhen })} />
          <WhoPick label="Signed off by" value={brief.signedOffBy} clientKey={clientKey} onChange={(signedOffBy) => set({ signedOffBy })} />
          <ChoiceChips label="Not without asking" values={brief.notWithout} options={doc.lists.notWithout} onChange={(notWithout) => set({ notWithout })} />
        </span>
      );
    return null;
  };
  return (
    <div className={`fl-lines fl-${layout}`} role="group" aria-label="The four lines">
      {LINE_KEYS.map((k) => {
        const id = `${base}-${k}`;
        const ex = help[k].example;
        return (
          <div key={k} className={`fl-line${active === k ? " active" : ""}`} data-line={k} onFocus={() => setActive(() => k)} onBlur={leave(k)}>
            <span className="fl-head">
              <label className="set-label" htmlFor={id}>
                {LINE_NAMES[k]}
              </label>
              <HelpMark name={LINE_NAMES[k]} why={doc.why[k]} />
            </span>
            <span className="fl-body">
              {readOnly ? (
                <span className="fl-read">{lineWords(brief, k).join(" ") || <span className="muted">Empty</span>}</span>
              ) : (
                <TextBox id={id} className="fl-box" minRows={1} maxRows={6} maxLength={2000} placeholder={help[k].hint} value={brief[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<Brief>)} {...(ex ? { "aria-describedby": `${id}-ex` } : {})} />
              )}
              {ex && (
                <span id={`${id}-ex`} className="fl-example" aria-live="off">
                  <span className="fl-ex-label">Example:</span> {ex}
                </span>
              )}
              {!readOnly && choices(k)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "See a full example": a complete made-up item for the chosen type, all four lines filled. Nothing is copied into the form. */
export function FullExample({ doc, typeId, onClose }: { doc: WorkTemplates; typeId: string | null; onClose: () => void }) {
  const { brief } = fullExample(doc, typeId);
  const t = typeById(doc, typeId);
  return (
    <aside
      className="nf-example"
      aria-label="A full example"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="nf-example-head">
        <h3>A full example{t ? `: ${t.name}` : ""}</h3>
        <button type="button" className="link-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted">Made up, to show what each line holds. Nothing here is copied into your form.</p>
      <dl>
        {LINE_KEYS.map((k) => (
          <div key={k}>
            <dt>{LINE_NAMES[k]}</dt>
            <dd>{lineWords(brief, k).join(" ") || <span className="muted">Left empty for this type</span>}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
