// TP-1: Admin › Work templates. A FocusTime admin edits the team's request types (name, what it means, a hint and an
// example per line, the stories it usually breaks into), the generic hints for "no type", why each line matters, and
// the choice lists; the New form, exactly as people will see it, sits beside the editor. One Save with one line of why
// (audited with who and when); a save made from an older version is refused, never merged silently. A type's tag is set
// once, from its first name; renaming keeps it, and removing only takes the type off the form. Per type: how many
// items were created with it and how many had all four lines, counts only. Settings shows the same templates read-only.
import { useEffect, useMemo, useState } from "react";
import type { TemplatesView } from "../../actions/template-actions.ts";
import { activeTypes, EMPTY_BRIEF, LIMITS, LINE_KEYS, LINE_NAMES, LIST_NAMES, newTag, STORY_KINDS, TAG_PREFIX, type Brief, type ChoiceLists, type LineHelp, type LineKey, type StoryKind, type TemplateType, type WorkTemplates } from "../../plan/work-templates.ts";
import { call } from "../api.ts";
import { FourLines, TypeField } from "../FourLines.tsx";
import { Stamp } from "../Stamp.tsx";
import { templatesSaved, useTemplates } from "../templates.ts";
import { TextBox } from "../TextBox.tsx";

type Sel = "generic" | "why" | "lists" | string;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "12 created · 5 with all four lines", or nothing yet. */
function usesText(v: TemplatesView, tag: string): string {
  const u = v.uses?.[tag];
  return u ? `${plural(u.created, "item")} created · ${u.complete} with all four lines` : "None created yet";
}

function HelpEditor({ help, onChange, label }: { help: Record<LineKey, LineHelp>; onChange: (h: Record<LineKey, LineHelp>) => void; label: string }) {
  return (
    <>
      {LINE_KEYS.map((k) => (
        <fieldset key={k} className="wt-line">
          <legend>{LINE_NAMES[k]}</legend>
          <label className="wt-field">
            <span className="set-label">Hint</span>
            <TextBox className="fl-box" aria-label={`${label}: ${LINE_NAMES[k]} hint`} minRows={1} maxRows={4} maxLength={LIMITS.hint} value={help[k].hint} onChange={(e) => onChange({ ...help, [k]: { ...help[k], hint: e.target.value } })} />
          </label>
          <label className="wt-field">
            <span className="set-label">Example</span>
            <TextBox className="fl-box" aria-label={`${label}: ${LINE_NAMES[k]} example`} minRows={1} maxRows={6} maxLength={LIMITS.example} value={help[k].example} onChange={(e) => onChange({ ...help, [k]: { ...help[k], example: e.target.value } })} />
          </label>
        </fieldset>
      ))}
    </>
  );
}

function TypeEditor({ t, view, tags, onChange, onRemove, onMove, first, last }: { t: TemplateType; view: TemplatesView; tags: string[]; onChange: (t: TemplateType) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; first: boolean; last: boolean }) {
  const saved = view.doc.types.some((x) => x.id === t.id);
  const tag = saved ? t.tag : newTag(t.name, tags);
  const toggle = (s: StoryKind) => onChange({ ...t, stories: t.stories.includes(s) ? t.stories.filter((x) => x !== s) : STORY_KINDS.filter((x) => x === s || t.stories.includes(x)) });
  return (
    <div className="wt-editor">
      <div className="wt-row">
        <label className="wt-field">
          <span className="set-label">Name</span>
          <input aria-label="Type name" maxLength={LIMITS.name} value={t.name} onChange={(e) => onChange({ ...t, name: e.target.value })} />
        </label>
        <span className="wt-tag">
          <span className="set-label">Tag</span>
          <code>
            {TAG_PREFIX}
            {tag}
          </code>
          <span className="muted">{saved ? "Kept when you rename it" : "Set when you save, then kept"}</span>
        </span>
      </div>
      <label className="wt-field">
        <span className="set-label">What it means</span>
        <input aria-label="What it means" maxLength={LIMITS.meaning} value={t.meaning} onChange={(e) => onChange({ ...t, meaning: e.target.value })} />
      </label>
      <HelpEditor label={t.name} help={t.lines} onChange={(lines) => onChange({ ...t, lines })} />
      <div className="wt-field" role="group" aria-label="Typical stories">
        <span className="set-label">Typical stories</span>
        <span className="wt-stories">
          {STORY_KINDS.map((s) => (
            <button key={s} type="button" className="chip-btn" aria-pressed={t.stories.includes(s)} onClick={() => toggle(s)}>
              {s}
            </button>
          ))}
        </span>
        <span className="muted">Kept for Break down; not used yet.</span>
      </div>
      <div className="wt-type-actions">
        <button type="button" className="mini" disabled={first} onClick={() => onMove(-1)}>
          Move up
        </button>
        <button type="button" className="mini" disabled={last} onClick={() => onMove(1)}>
          Move down
        </button>
        <button type="button" className="mini quiet" onClick={onRemove}>
          {t.removed ? "Offer it again" : saved ? "Take off the form" : "Remove"}
        </button>
        {saved && <span className="muted">{usesText(view, t.tag)}</span>}
      </div>
      {t.removed && <p className="muted">Not offered in the New form. Items and drafts with its tag still show its name.</p>}
    </div>
  );
}

function ListsEditor({ lists, onChange }: { lists: ChoiceLists; onChange: (l: ChoiceLists) => void }) {
  return (
    <div className="wt-editor">
      <p className="muted">One choice per line, at most {LIMITS.listItems} each. People can always choose Other and type their own.</p>
      {(Object.keys(LIST_NAMES) as (keyof ChoiceLists)[]).map((k) => (
        <label key={k} className="wt-field">
          <span className="set-label">{LIST_NAMES[k]}</span>
          <TextBox className="fl-box" aria-label={`${LIST_NAMES[k]} choices`} minRows={3} maxRows={12} value={lists[k].join("\n")} onChange={(e) => onChange({ ...lists, [k]: e.target.value.split("\n").map((s) => s.replace(/\s+/g, " ").replace(/^ /, "")) })} />
        </label>
      ))}
    </div>
  );
}

/** The lists as saved: blank lines dropped. */
const tidy = (d: WorkTemplates): WorkTemplates => ({ ...d, lists: Object.fromEntries(Object.entries(d.lists).map(([k, v]) => [k, (v as string[]).map((s) => s.trim()).filter(Boolean)])) as ChoiceLists });

export function AdminTemplates() {
  const { view: loaded, error: loadError } = useTemplates(true);
  const [view, setView] = useState<TemplatesView | null>(null);
  const [doc, setDoc] = useState<WorkTemplates | null>(null);
  const [sel, setSel] = useState<Sel>("generic");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; conflict: boolean } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [preview, setPreview] = useState<Brief>(EMPTY_BRIEF);
  useEffect(() => {
    if (loaded && !view) (setView(loaded), setDoc(clone(loaded.doc)));
  }, [loaded, view]);
  const tags = useMemo(() => view?.doc.types.map((t) => t.tag) ?? [], [view]);
  useEffect(() => {
    if (sel !== "generic" && sel !== "why" && sel !== "lists") setPreview((b) => ({ ...b, type: sel }));
    else if (sel === "generic") setPreview((b) => ({ ...b, type: null }));
  }, [sel]);
  if (loadError && !view) return <p className="set-problem">{loadError}</p>;
  if (!view || !doc) return <p className="muted">Loading…</p>;
  const dirty = JSON.stringify(tidy(doc)) !== JSON.stringify(view.doc);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const idx = doc.types.findIndex((t) => t.id === sel);
  const setType = (t: TemplateType) => setDoc({ ...doc, types: doc.types.map((x) => (x.id === t.id ? t : x)) });
  const addType = () => {
    const id = `new-${Date.now()}`;
    setDoc({ ...doc, types: [...doc.types, { id, name: `New type ${doc.types.length + 1}`, tag: "", meaning: "", lines: clone(doc.generic), stories: [] }] });
    setSel(id);
  };
  const remove = (t: TemplateType) => {
    if (view.doc.types.some((x) => x.id === t.id)) setType({ ...t, removed: !t.removed });
    else (setDoc({ ...doc, types: doc.types.filter((x) => x.id !== t.id) }), setSel("generic"));
  };
  const move = (i: number, d: -1 | 1) => {
    const types = [...doc.types];
    [types[i], types[i + d]] = [types[i + d]!, types[i]!];
    setDoc({ ...doc, types });
  };
  const save = async () => {
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const v = await call<TemplatesView>("templates.save", { doc: tidy(doc), version: view.version, why });
      templatesSaved(v);
      setView(v);
      setDoc(clone(v.doc));
      setWhy("");
      setSaved("Saved. The New form uses them now.");
      if (!v.doc.types.some((t) => t.id === sel) && sel.startsWith("new-")) setSel(v.doc.types.at(-1)?.id ?? "generic");
    } catch (e) {
      const text = e instanceof Error ? e.message : "Couldn't save";
      setProblem({ text, conflict: /Another admin saved/.test(text) });
    }
    setBusy(false);
  };
  const reloadTheirs = async () => {
    const v = await call<TemplatesView>("templates.load", {});
    templatesSaved(v);
    setView(v);
    setDoc(clone(v.doc));
    setProblem(null);
  };
  const nav = (id: Sel, label: string, sub?: string, gone?: boolean) => (
    <li key={id}>
      <button type="button" className={`wt-nav${sel === id ? " on" : ""}${gone ? " gone" : ""}`} aria-current={sel === id ? "true" : undefined} onClick={() => setSel(id)}>
        <span>{label}</span>
        {sub && <span className="muted">{sub}</span>}
      </button>
    </li>
  );
  return (
    <div className="wt-admin">
      <p className="muted set-intro">
        The request types and hints in the New form. Everything in the four lines is optional for people; these only guide them. Last saved {view.updatedBy ? `by ${view.updatedBy} ` : ""}
        <Stamp at={view.updatedAt} tz={zone} />.
      </p>
      <div className="wt-layout">
        <nav className="wt-list" aria-label="Work templates">
          <ul>
            {nav("generic", "No type chosen", "The general hints")}
            {nav("why", "Why each line matters", "The ? beside each line")}
            {nav("lists", "Choice lists", "Environment, Touches and more")}
          </ul>
          <h4 className="set-sub">Types ({activeTypes(doc).length})</h4>
          <ul>{doc.types.map((t) => nav(t.id, t.name || "Untitled", t.removed ? "Not offered" : view.doc.types.some((x) => x.id === t.id) ? usesText(view, t.tag) : "New, not saved", t.removed))}</ul>
          <button type="button" className="mini" onClick={addType} disabled={doc.types.length >= LIMITS.types}>
            + Add a type
          </button>
        </nav>
        <div className="wt-edit">
          {sel === "generic" ? (
            <div className="wt-editor">
              <p className="muted">Shown when someone adds the four lines without choosing a type.</p>
              <HelpEditor label="No type" help={doc.generic} onChange={(generic) => setDoc({ ...doc, generic })} />
            </div>
          ) : sel === "why" ? (
            <div className="wt-editor">
              <p className="muted">One sentence each, shown on the ? beside the line's name, for every type.</p>
              {LINE_KEYS.map((k) => (
                <label key={k} className="wt-field">
                  <span className="set-label">{LINE_NAMES[k]}</span>
                  <TextBox className="fl-box" aria-label={`Why ${LINE_NAMES[k]} matters`} minRows={1} maxRows={4} maxLength={LIMITS.why} value={doc.why[k]} onChange={(e) => setDoc({ ...doc, why: { ...doc.why, [k]: e.target.value } })} />
                </label>
              ))}
            </div>
          ) : sel === "lists" ? (
            <ListsEditor lists={doc.lists} onChange={(lists) => setDoc({ ...doc, lists })} />
          ) : idx >= 0 ? (
            <TypeEditor t={doc.types[idx]!} view={view} tags={tags} onChange={setType} onRemove={() => remove(doc.types[idx]!)} onMove={(d) => move(idx, d)} first={idx === 0} last={idx === doc.types.length - 1} />
          ) : null}
        </div>
        <section className="wt-preview" aria-label="Preview: the New form">
          <h4 className="set-sub">Preview: the New form</h4>
          <p className="muted">As people see it, with your unsaved edits. Click into a line to see its example.</p>
          <div className="nf-grid with-lines">
            <span className="set-label">Request type</span>
            <span className="nf-reqtype">
              <TypeField doc={tidy(doc)} label="Request type" value={preview.type} onChange={(type) => setPreview({ ...preview, type })} />
            </span>
            <FourLines doc={tidy(doc)} brief={preview} onChange={setPreview} clientKey={null} />
          </div>
        </section>
      </div>
      <div className="wt-save">
        <label className="wt-field wt-why">
          <span className="set-label">Why (one line, for the audit)</span>
          <input aria-label="Why, for the audit" maxLength={200} value={why} placeholder="For example: clearer hint for reports" onChange={(e) => setWhy(e.target.value)} />
        </label>
        <button type="button" className="commit" disabled={!dirty || !why.trim() || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="mini quiet" disabled={!dirty || busy} onClick={() => (setDoc(clone(view.doc)), setProblem(null))}>
          Discard changes
        </button>
        {!dirty && !saved && <span className="muted">No changes</span>}
        {dirty && !why.trim() && <span className="muted">Say why to save</span>}
        {saved && !dirty && (
          <span className="muted" role="status">
            {saved}
          </span>
        )}
      </div>
      {problem && (
        <p className="set-problem" role="alert">
          {problem.text}
          {problem.conflict && (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={() => void reloadTheirs()}>
                Reload theirs
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Settings › Today and Week: the team's work templates, read-only, "Set by your FocusTime admin". */
export function TemplatesReadOnly() {
  const { view, error } = useTemplates();
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <p className="set-problem">{error}</p>;
  if (!view) return <p className="muted">Loading…</p>;
  const d = view.doc;
  return (
    <div className="wt-readonly">
      <p className="muted">Set by your FocusTime admin. The New form offers these request types; each gives the four lines its own hints and examples. All of it is optional.</p>
      <ul className="wt-ro-list">
        {activeTypes(d).map((t) => (
          <li key={t.id}>
            <button type="button" className="link-btn" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
              {open === t.id ? "▾" : "▸"} {t.name}
            </button>{" "}
            <span className="muted">{t.meaning}</span>
            {open === t.id && (
              <dl className="wt-ro-lines">
                {LINE_KEYS.map((k) => (
                  <div key={k}>
                    <dt>{LINE_NAMES[k]}</dt>
                    <dd>
                      {t.lines[k].hint}
                      {t.lines[k].example && <span className="muted"> Example: {t.lines[k].example}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
