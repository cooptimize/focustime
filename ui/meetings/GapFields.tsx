// MC-1e: a call's new item, edited with the New form's fields (ui/NewItem.tsx): Level, Parent, Assigned to and Target
// date in the form's grid, and More for the description, the size and the three questions. The same field controls,
// the same rules from plan/quick-create.ts (which types a parent takes, the title's limit) and the same reads
// (new.options: the client's levels and its open parents). A field the client's process requires shows here marked
// Needed until it has a value; the row can't be sent before then. Every change is saved on the proposal at once
// (meeting.edit); the write itself goes only through the one DevOps preview.
import { useEffect, useMemo, useState } from "react";
import { aOr, parentTypesOf, type NewOptions } from "../../plan/quick-create.ts";
import { CALL_ROW, type ProposalCheck } from "../../plan/call-words.ts";
import type { GapProposal } from "../../plan/meetings.ts";
import { NO_ANSWERS, type Answers } from "../../plan/three-questions.ts";
import { PeopleField } from "../ahead/People.tsx";
import { call } from "../api.ts";
import { Segmented } from "../CellPopover.tsx";
import { DateField } from "../DatePicker.tsx";
import { Icon } from "../icons.tsx";
import { SelectField } from "../SelectField.tsx";
import { TextBox } from "../TextBox.tsx";
import { ThreeQuestions } from "../ThreeQuestions.tsx";

/** The client's levels and open parents, read once per page (as the New form reads them when it opens). */
const memo = new Map<string, Promise<NewOptions>>();
export function useNewOptions(clientKey: string, on: boolean): NewOptions | null {
  const [opts, setOpts] = useState<NewOptions | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const p = memo.get(clientKey) ?? call<NewOptions>("new.options", { clientKey });
    memo.set(clientKey, p);
    p.then((o) => live && setOpts(o), () => (memo.delete(clientKey), live && setOpts(null)));
    return () => void (live = false);
  }, [clientKey, on]);
  return opts;
}
/** Read fresh next time (a create can make a new parent). */
export const forgetCallOptions = () => memo.clear();

export function GapFields({ b, id, clientKey, opts, today, editable, check, onEdit }: { b: GapProposal; id: number; clientKey: string; opts: NewOptions | null; today: string; editable: boolean; check: ProposalCheck | undefined; onEdit: (patch: Record<string, unknown>) => void }) {
  const needs = new Set((check?.needs ?? []).map((n) => n.fill));
  const ladder = useMemo(() => opts?.levels.map((l) => l.types) ?? [], [opts]);
  const types = useMemo(() => opts?.levels.flatMap((l) => l.types) ?? [], [opts]);
  const allowed = useMemo(() => new Set(parentTypesOf(ladder, b.type)), [ladder, b.type]);
  const parents = useMemo(() => (opts?.parents ?? []).filter((p) => allowed.has(p.type)), [opts, allowed]);
  const [more, setMore] = useState(needs.has("description") || needs.has("size") || needs.has("check"));
  useEffect(() => {
    if (needs.has("description") || needs.has("size") || needs.has("check")) setMore(true);
  }, [check]); // eslint-disable-line react-hooks/exhaustive-deps
  const [description, setDescription] = useState(b.description);
  useEffect(() => setDescription(b.description), [b.description]);
  const [size, setSize] = useState(b.size === undefined || b.size === null ? "" : String(b.size));
  useEffect(() => setSize(b.size === undefined || b.size === null ? "" : String(b.size)), [b.size]);
  const [answers, setAnswers] = useState<Answers>(b.answers ?? NO_ANSWERS);
  useEffect(() => setAnswers(b.answers ?? NO_ANSWERS), [b.answers]);
  const assignTo = b.assignTo === undefined ? "me" : (b.assignTo ?? "");
  const parentWords = [...allowed].join(" or ").toLowerCase();
  const parentLabel = b.parentId !== null ? `#${b.parentId}${b.parentTitle ? ` ${b.parentTitle}` : ""}` : null;
  const need = (fill: NonNullable<ProposalCheck["needs"]>[number]["fill"]) => (needs.has(fill) ? <span className="mtg-needed">{CALL_ROW.needed}</span> : null);

  if (!editable) {
    // An attendee looks: the same fields, as words.
    return (
      <p className="muted mtg-where">
        {b.type} · {parentLabel ? `under ${parentLabel}` : "No parent"} · {assignTo === "me" ? "Assigned to the reviewer" : assignTo ? `Assigned to ${assignTo}` : "Assigned to nobody"}{b.date ? ` · Target ${b.date}` : ""}
      </p>
    );
  }
  const typeOptions = (types.length ? types : [b.type]).map((t) => ({ value: t, label: t }));
  const parentOptions = [
    { key: "", label: "None", search: "none no parent" },
    ...parents.map((p) => ({ key: String(p.id), label: `#${p.id} ${p.title}`, search: `${p.id} ${p.title} ${p.type}`, sub: p.type })),
    ...(b.parentId !== null && !parents.some((p) => p.id === b.parentId) ? [{ key: String(b.parentId), label: parentLabel ?? `#${b.parentId}` }] : []),
  ];
  const sizeNum = size.trim() ? Number(size) : null;
  const sizeProblem = sizeNum !== null && (!Number.isFinite(sizeNum) || sizeNum < 0 || sizeNum > 10_000) ? "Size is a number" : null;
  return (
    <div className="mtg-gap-fields">
      <div className="nf-grid mtg-nf">
        <span className="set-label">Level</span>
        <span className="nf-types">
          {opts && !types.length ? <span className="muted">{opts.problem}</span> : <Segmented label={`Level for ${b.title}`} options={typeOptions} value={b.type} onChange={(t) => {
            // Changing the type keeps the parent only when it can still hold it (as the New form does).
            const keeps = b.parentId === null || (opts?.parents.find((p) => p.id === b.parentId) && new Set(parentTypesOf(ladder, t)).has(opts.parents.find((p) => p.id === b.parentId)!.type));
            onEdit({ type: t, ...(keeps ? {} : { parentId: null }) });
          }} />}
        </span>
        <span className="set-label">Parent</span>
        <span className="nf-parent">
          {opts && types.length && !allowed.size ? (
            <span className="muted">{aOr(b.type.toLowerCase()).replace(/^a/, "A")} is at the top: no parent</span>
          ) : (
            <>
              <SelectField label={`Parent for ${b.title}`} value={b.parentId === null ? "" : String(b.parentId)} options={parentOptions} onChange={(k) => {
                const p = parents.find((x) => x.id === Number(k));
                onEdit(k ? { parentId: Number(k), parentTitle: p?.title ?? null } : { parentId: null });
              }} className="nf-select" />
              <span className="muted nf-why">{b.parentId === null ? CALL_ROW.noParent : parents.length ? `Optional. Any open ${parentWords}` : `Optional. No open ${parentWords} to choose`}</span>
            </>
          )}
        </span>
        <span className="set-label">Assigned to{need("assignTo")}</span>
        <span className="nf-people"><PeopleField clientKey={clientKey} value={assignTo} onChange={(v) => onEdit({ assignTo: v === "me" ? "me" : v || null })} label={`Assigned to, for ${b.title}`} /></span>
        <span className="set-label" id={`mtg-date-${id}`}>Target date{need("date")}</span>
        <span className="nf-date">
          <DateField value={b.date ?? null} onChange={(d) => onEdit({ date: d })} label={`Target date for ${b.title}${needs.has("date") ? ", needed" : ""}`} today={today} placeholder={needs.has("date") ? "Choose a date" : "None"} />
          <span className={needs.has("date") ? "mtg-need-why" : "muted nf-why"}>{needs.has("date") ? "Needed by this client's process" : "Optional"}</span>
        </span>
      </div>
      <button type="button" className="link-btn nf-more" aria-expanded={more} onClick={() => setMore(!more)}>
        <Icon name={more ? "open" : "closed"} /> More: description, size and details{needs.has("description") || needs.has("size") || needs.has("check") ? ` (${CALL_ROW.needed.toLowerCase()})` : ""}
      </button>
      {more && (
        <div className="nf-grid nf-more-body mtg-nf">
          <label className="set-label" htmlFor={`mtg-desc-${id}`}>Description{need("description")}</label>
          <span><TextBox id={`mtg-desc-${id}`} minRows={2} maxRows={10} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== b.description && onEdit({ description: description.trim() || null })} /></span>
          <label className="set-label" htmlFor={`mtg-size-${id}`}>Size{need("size")}</label>
          <span className="nf-size">
            <input id={`mtg-size-${id}`} inputMode="decimal" value={size} placeholder={needs.has("size") ? "Needed" : "None"} onChange={(e) => setSize(e.target.value)} onBlur={() => !sizeProblem && sizeNum !== (b.size ?? null) && onEdit({ size: sizeNum })} />
            <span className="muted nf-why">{sizeProblem ?? "The process's size field (points or effort), if the type has one"}</span>
          </span>
          <span className="mtg-q" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && JSON.stringify(answers) !== JSON.stringify(b.answers ?? NO_ANSWERS) && onEdit({ answers })}>
            <ThreeQuestions answers={answers} onChange={setAnswers} idPrefix={`mtg-q-${id}`} layout="stack" />
          </span>
        </div>
      )}
    </div>
  );
}
