// SA-2: one way to draw a setting. Every Settings section (ui/settings/sections/) draws only through these parts: a
// page (one column, about 760 px at most), a group (a card with an optional heading and one intro line), a row (one
// setting: its label and help on the left, its control on the right; under the label on a narrow window and the
// phone), a fold, a table, a button row, the saved mark and the team line; and the controls, one per kind of choice:
// on or off is a switch, one of two to four the segmented control, one of more a select, a number with its unit beside
// it, a time the app's time field, a list as rows with Remove and one Add at its foot, an action a button with its
// result said on the row. A row's label, help and unit come from the registry (ui/settings/registry.ts), so the page,
// search, links to it and the Undo message read one name. docs/design/style-guide.md section 12 has the rules;
// ui/settings/sections.guard.test.ts keeps the sections on them.
import { createContext, Fragment, useContext, useId, type ChangeEvent, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { FieldStatus } from "./autosave.tsx";
import { settingOf, settingsHref, type SettingDef } from "./registry.ts";
import { TimeField } from "../TimeField.tsx";
import { Icon } from "../icons.tsx";
import "./parts.css";

/** The words the team line says, the same everywhere. */
export const TEAM_LINE = "Set by your FocusTime admin";
/** The words behind a long help line. */
export const MORE = "More about this";

type RowCtx = { labelId: string; helpId: string; label: string; unit: string | undefined };
const RowContext = createContext<RowCtx | null>(null);
const useRow = () => useContext(RowContext);

/** The registry's entry for a row, or a loud error (a row with no entry has no one name). */
export function defOf(id: string): SettingDef {
  const d = settingOf(id);
  if (!d) throw new Error(`Settings row "${id}" has no entry in ui/settings/registry.ts`);
  return d;
}
/** A setting's label, from the registry: what the page, search, links and the Undo message all say. */
export const labelOf = (id: string) => defOf(id).label;

/** The section's column. Its title and one line under it are the panel's header (the registry's section entry). */
export function Page({ children }: { children: ReactNode }) {
  return <div className="sp-page">{children}</div>;
}

/** A card of rows, with an optional heading and one intro line. `sid` is the group's own registry id, for deep links. */
export function Group({ title, intro, more, sid, children, label }: { more?: ReactNode; title?: string | undefined; intro?: ReactNode | undefined; sid?: string | undefined; children: ReactNode; label?: string | undefined }) {
  const name = title ?? label;
  // The intro is one line too: a long one ends at a sentence or clause, the rest behind More about this.
  const [shown, spill] = typeof intro === "string" ? splitHelp(intro) : [intro, null];
  const folded = spill ? (more ? <>{spill} {more}</> : spill) : more;
  return (
    <section className="sp-group" data-setting={sid} aria-label={name}>
      {title && <h3 className="sp-group-h">{title}</h3>}
      {shown && <p className="sp-intro">{shown}</p>}
      {folded && <More>{folded}</More>}
      {children}
    </section>
  );
}

type RowProps = {
  /** The registry id: the row's label, help, "More about this" and unit come from there, and its deep link lands here. */
  id: string;
  /** SA-4: Admin's rows name themselves (Admin's settings are its own list, ui/settings/admin/settings-list.ts). */
  def?: { label: string; help?: string | undefined; more?: string | undefined; unit?: string | undefined } | undefined;
  /** SA-4: a small word beside the label (Admin's Rule, Default, Default by level). */
  badge?: ReactNode;
  /** Help that depends on the data (in place of the registry's); null for none. */
  help?: ReactNode;
  more?: ReactNode;
  /** The saved mark: "Saved" for 2 s, Saving…, Couldn't save. Retry, or the error under the row. */
  mark?: { s: FieldStatus; retry: () => void } | undefined;
  /** The team line ("Set by your FocusTime admin"), or a team default with Reset. */
  team?: true | ReactNode | undefined;
  /** The control under the label at every width (a list, a long text, several controls). */
  wide?: boolean | undefined;
  /** Under the row, full width: what an action found, a confirm, a form it opens. */
  below?: ReactNode;
  /** No data-setting here (a group or an outer element already carries the id). */
  noSid?: boolean | undefined;
  /** The help is a status the row reports (a check's answer, a connection's state): shown whole, never folded. */
  status?: boolean | undefined;
  children?: ReactNode;
};

/** A small heading inside a group, over the rows it names (Notifications' kinds). */
export function Subhead({ children, sid }: { children: ReactNode; sid?: string | undefined }) {
  return (
    <h4 className="sp-subhead" data-setting={sid}>
      {children}
    </h4>
  );
}

/**
 * SA-2: a help line keeps to about two lines on a phone: past `max` characters it ends at a sentence (or, failing
 * that, a clause) and the rest goes behind "More about this", word for word. Cut inside a sentence, the shown part
 * ends with "…" and the rest starts with it, so neither reads as finished (SA-2 review).
 */
export function splitHelp(t: string, max = 80): [string, string | null] {
  if (t.length <= max) return [t, null];
  const dot = t.lastIndexOf(". ", max);
  if (dot > 20) return [t.slice(0, dot + 1), t.slice(dot + 2)];
  for (const sep of [": ", "; ", ", "]) {
    const j = t.lastIndexOf(sep, max);
    if (j > 20) return [`${t.slice(0, j)}…`, `…${t.slice(j + 2)}`];
  }
  for (const word of [" (", " when ", " with "]) {
    const j = t.lastIndexOf(word, max);
    if (j > 20) return [`${t.slice(0, j)}…`, `…${t.slice(j + 1)}`];
  }
  return max < 90 ? splitHelp(t, max + 12) : [t, null];
}

/** One setting. */
export function Row({ id, def, badge, help, more, mark, team, wide, below, noSid, status, children }: RowProps) {
  const d = def ?? defOf(id);
  const labelId = useId();
  const helpId = useId();
  const given = help === undefined ? d.help : help;
  const givenMore = more === undefined ? d.more : more;
  const [shownHelp, spill] = typeof given === "string" && !status ? splitHelp(given) : [given, null];
  const shownMore = spill ? (givenMore ? <>{spill} {givenMore}</> : spill) : givenMore;
  const error = mark?.s?.kind === "error" ? mark.s.messages.join("; ") : null;
  return (
    <RowContext.Provider value={{ labelId, helpId, label: d.label, unit: d.unit }}>
      <div className={`sp-row${wide ? " sp-wide" : ""}${children ? "" : " sp-bare"}`} data-setting={noSid ? undefined : id}>
        <div className="sp-text">
          <span className="sp-label-line">
            <span className="sp-label" id={labelId}>{d.label}</span>
            {badge}
            {mark && <Mark s={mark.s} retry={mark.retry} />}
          </span>
          {(shownHelp || team) && (
            <span className="sp-help" id={helpId} data-status={status ? "" : undefined}>
              {shownHelp}
              {team && (shownHelp ? " " : "")}
              {team === true ? <TeamLine /> : team}
            </span>
          )}
          {shownMore && <More>{shownMore}</More>}
        </div>
        {children && <div className="sp-control">{children}</div>}
        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}
        {below && <div className="sp-below">{below}</div>}
      </div>
    </RowContext.Provider>
  );
}

/** What doesn't fit in a row's one help line, word for word, behind "More about this". */
export function More({ children }: { children: ReactNode }) {
  return (
    <details className="sp-more">
      <summary>{MORE}</summary>
      <span className="sp-more-text">{children}</span>
    </details>
  );
}

/** "Saved" by the row's label for 2 s, drawn out of the flow so nothing on the page moves; Saving… and Retry the same. */
export function Mark({ s, retry }: { s: FieldStatus; retry: () => void }) {
  return (
    <span className="sp-mark" aria-live="polite">
      {s?.kind === "saving" && <span className="sp-saving">Saving…</span>}
      {s?.kind === "saved" && <span className="sp-saved">Saved</span>}
      {s?.kind === "retry" && (
        <span className="sp-retry">
          Couldn't save.{" "}
          <button type="button" className="sp-link" onClick={retry}>
            Retry
          </button>
        </span>
      )}
    </span>
  );
}

/** SA-4: a small word beside a row's label: Admin's kind of setting (Rule, Default, Default by level), with what it means for screen readers and on hover. */
export function Badge({ children, title }: { children: ReactNode; title?: string | undefined }) {
  return (
    <span className="sp-badge" title={title}>
      {children}
      {title && <span className="sr-only">: {title}</span>}
    </span>
  );
}

/** A value the team set: one line, the same everywhere. */
export function TeamLine() {
  return <span className="sp-team">{TEAM_LINE}</span>;
}

/** A team default a person changed: "Team default: <value>" with Reset; only "Team default: <value>" while it is theirs. */
export function TeamDefault({ value, onReset }: { value: string; onReset: (() => void) | null }) {
  return (
    <span className="sp-team">
      Team default: {value}.
      {onReset && (
        <>
          {" "}
          <button type="button" className="sp-link" aria-label="Reset to team default" onClick={onReset}>
            Reset
          </button>
        </>
      )}
    </span>
  );
}

/** SA-4: quieter words inside a cell or a line (an email under a name, how a value was found); `block` on its own line. */
export function Faint({ children, block }: { children: ReactNode; block?: boolean | undefined }) {
  return <span className={`sp-faint${block ? " sp-block" : ""}`}>{children}</span>;
}

/** A read-only value; "not set" when there is none. */
export function Value({ children }: { children?: ReactNode | undefined }) {
  return <span className="sp-value">{children || <span className="sp-faint">not set</span>}</span>;
}

/** A line of its own in a group: a status, an empty state, a problem. */
export function Note({ children, tone, live, sid, site }: { children: ReactNode; tone?: "problem" | "warn" | "ok" | undefined; live?: boolean | undefined; sid?: string | undefined; site?: boolean | undefined }) {
  return (
    <p className={`sp-note${tone ? ` ${tone}` : ""}`} role={live ? "status" : tone === "problem" ? "alert" : undefined} data-setting={sid} data-site-line={site || undefined}>
      {children}
    </p>
  );
}

/**
 * A closed fold that says how many it holds. SA-3: a fold of settings says "Fine tuning · 14 more", and "· 2 changed"
 * when the person changed some inside; a link or a search result for one inside opens it (ui/Settings.tsx).
 */
export function Fold({ label, count, children, sid, more, changed }: { label: string; count?: number | undefined; children: ReactNode; sid?: string | undefined; more?: boolean | undefined; changed?: number | undefined }) {
  const said = count === undefined ? label : `${label} · ${count}${more ? " more" : ""}${changed ? ` · ${changed} changed` : ""}`;
  return (
    <details className="sp-fold" data-setting={sid}>
      <summary>{said}</summary>
      <div className="sp-fold-body">{children}</div>
    </details>
  );
}

/** One table style: a head row, rows of cells, its own sideways scroll on a narrow screen. */
export function Table({ label, head, rows, rowKey, rowTone, after, rowHeads }: { /** SA-4: the first cell names its row (a row header for screen readers). */ rowHeads?: boolean | undefined; label: string; head: readonly ReactNode[]; rows: readonly (readonly ReactNode[])[]; rowKey?: (i: number) => string | number | undefined; rowTone?: ((i: number) => string | undefined) | undefined; /** SA-4: a full-width line under a row (a confirm at that row), or nothing. */ after?: ((i: number) => ReactNode) | undefined }) {
  return (
    <div className="sp-table-wrap">
      <table className="sp-table" aria-label={label}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const more = after?.(i);
            return (
              <Fragment key={rowKey ? rowKey(i) : i}>
                <tr className={rowTone?.(i)}>
                  {r.map((c, j) =>
                    rowHeads && j === 0 ? (
                      <th key={j} scope="row">
                        {c}
                      </th>
                    ) : (
                      <td key={j}>{c}</td>
                    ),
                  )}
                </tr>
                {more && (
                  <tr className="sp-after">
                    <td colSpan={head.length}>{more}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Buttons side by side, and the result of the last one said on the same row. */
export function Buttons({ children, result, tone }: { children: ReactNode; result?: ReactNode | undefined; tone?: "problem" | "ok" | undefined }) {
  return (
    <div className="sp-buttons">
      {children}
      {result && (
        <span className={`sp-result${tone ? ` ${tone}` : ""}`} role="status">
          {result}
        </span>
      )}
    </div>
  );
}

/** A result line under a row's controls (an action's answer). */
export function Result({ children, tone }: { children: ReactNode; tone?: "problem" | "ok" | undefined }) {
  return (
    <span className={`sp-result${tone ? ` ${tone}` : ""}`} role={tone === "problem" ? "alert" : "status"}>
      {children}
    </span>
  );
}

type ButtonKind = "main" | "plain" | "quiet" | "danger";
/** The style guide's small button (28, 44 on the phone): main (the row's one main action), plain, quiet, danger. */
export function Button({ kind = "plain", children, onClick, disabled, type = "button", label, pressed, expanded, title, buttonRef, describedBy }: { kind?: ButtonKind | undefined; children: ReactNode; onClick?: (() => unknown) | undefined; disabled?: boolean | undefined; type?: "button" | "submit" | undefined; label?: string | undefined; pressed?: boolean | undefined; expanded?: boolean | undefined; title?: string | undefined; buttonRef?: Ref<HTMLButtonElement> | undefined; describedBy?: string | undefined }) {
  return (
    <button ref={buttonRef} type={type} className={`sp-btn ${kind}`} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={pressed} aria-expanded={expanded} title={title} aria-describedby={describedBy}>
      {children}
    </button>
  );
}

/** A link to another place in Settings (never a #/settings string by hand). */
export function GoLink({ section, setting, go, children, kind }: { section: string; setting?: string | null | undefined; go: (section: string, setting?: string | null) => void | undefined; children: ReactNode; kind?: "button" | undefined }) {
  return (
    <a className={kind === "button" ? "sp-btn plain" : "sp-go"} href={settingsHref(section, setting)} onClick={(e) => (e.preventDefault(), go(section, setting))}>
      {children}
    </a>
  );
}

/** A link out of FocusTime (a guide, a doc). */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="sp-go" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** A state word as a status pill (no line): live, cached, error, or plain. */
export function State({ tone, children, sr }: { tone?: "live" | "cached" | "error" | "signin" | "muted" | undefined; children: ReactNode; sr?: boolean | undefined }) {
  if (sr) return <span className="sr-only">{children}</span>;
  return <span className={`state${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

/** A status list (sources, permissions, DevOps per client): one row each, a dot, a name, a state, a line, its actions. */
export function StatusList({ children, label }: { children: ReactNode; label?: string | undefined }) {
  return (
    <ul className="sp-status" aria-label={label}>
      {children}
    </ul>
  );
}
export function StatusItem({ name, state, tone, detail, actions, below, style, data }: { name: ReactNode; state?: ReactNode | undefined; tone?: "live" | "cached" | "error" | "signin" | "sample" | "muted" | undefined; detail?: ReactNode | undefined; actions?: ReactNode | undefined; below?: ReactNode | undefined; style?: CSSProperties | undefined; data?: Record<string, string> | undefined }) {
  return (
    <li className={`sp-status-item ${tone ?? ""}`} style={style} {...data}>
      <span className="sp-dot" aria-hidden="true" />
      <strong className="sp-status-name">{name}</strong>
      {state && <span className={`state ${tone ?? ""}`}>{state}</span>}
      {detail && <span className="sp-status-detail">{detail}</span>}
      {actions && <span className="sp-status-actions">{actions}</span>}
      {below && <div className="sp-below">{below}</div>}
    </li>
  );
}

/** A list setting: one row per entry with Remove, and one Add at its foot. */
export function List({ children, add, empty, label }: { children?: ReactNode | undefined; add?: ReactNode | undefined; empty?: ReactNode | undefined; label?: string | undefined }) {
  const has = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <div className="sp-list-wrap">
      {has ? (
        <ul className="sp-list" aria-label={label}>
          {children}
        </ul>
      ) : (
        empty && <span className="sp-faint">{empty}</span>
      )}
      {add && <div className="sp-list-add">{add}</div>}
    </div>
  );
}
export function ListItem({ children, onRemove, removeLabel, removeText = "Remove", disabled, below, extra }: { children: ReactNode; onRemove?: (() => void) | undefined; removeLabel?: string | undefined; removeText?: string | undefined; disabled?: boolean | undefined; below?: ReactNode | undefined; extra?: ReactNode | undefined }) {
  return (
    <li className="sp-item">
      <span className="sp-item-main">{children}</span>
      {(extra || onRemove) && (
        <span className="sp-item-actions">
          {extra}
          {onRemove && (
            <Button kind="quiet" onClick={onRemove} label={removeLabel} disabled={disabled}>
              {removeText}
            </Button>
          )}
        </span>
      )}
      {below && <div className="sp-below">{below}</div>}
    </li>
  );
}

/** Several controls in one row's control slot. */
export function Controls({ children, sid }: { children: ReactNode; sid?: string | undefined }) {
  return (
    <span className="sp-controls" data-setting={sid}>
      {children}
    </span>
  );
}

/** A labelled control inside a row (Friday at, Expires): its words beside it. */
export function Sub({ text, children, sid }: { text: string; children: ReactNode; sid?: string | undefined }) {
  return (
    <label className="sp-sub" data-setting={sid}>
      <span>{text}</span>
      {children}
    </label>
  );
}

// ---- Controls, one per kind of choice ----

type TextBind = { onBlur?: () => void; onKeyDown?: (e: KeyboardEvent) => void; "aria-invalid"?: boolean; autoFocus?: boolean };
const named = (r: RowCtx | null, label?: string) => (label ? { "aria-label": label } : r ? { "aria-labelledby": r.labelId, "aria-describedby": r.helpId } : {});

/** SA-4: picking rows (a table's select boxes), not a setting: a plain box with its own name. */
export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean | undefined }) {
  return (
    <label className="sp-check-box">
      <input type="checkbox" className="sp-check" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** On or off. Its row's label says what on means; the switch has no words of its own. */
export function Switch({ checked, onChange, disabled, label, text, sid }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean | undefined; label?: string | undefined; text?: string | undefined; sid?: string | undefined }) {
  const r = useRow();
  return (
    <label className={`sp-switch-box${text ? " with-text" : ""}`} data-setting={sid}>
      <input type="checkbox" role="switch" className="sp-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} {...named(r, text ?? label)} />
      {text && <span>{text}</span>}
    </label>
  );
}

/** One of two to four: the app's segmented control (a radio group; arrows move between the sides). */
export function Choice<T extends string | number>({ options, value, onChange, disabled, label }: { options: readonly { value: T; label: string; /** SA-4: one side not offered now (it says why in its title). */ disabled?: boolean | undefined; title?: string | undefined }[]; value: T; onChange: (v: T) => void; disabled?: boolean | undefined; label?: string | undefined }) {
  const r = useRow();
  return (
    <span className="seg sp-choice" role="radiogroup" {...named(r, label)} aria-disabled={disabled || undefined}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value || (i === 0 && !options.some((x) => x.value === value)) ? 0 : -1}
          disabled={disabled || o.disabled}
          title={o.title}
          className={`seg-btn${value === o.value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const n = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : null;
            if (n === null) return;
            e.preventDefault();
            e.stopPropagation();
            // Skip a side that isn't offered now.
            let k = (n + options.length) % options.length;
            const step = n > i ? 1 : -1;
            for (let tries = 0; options[k]!.disabled && tries < options.length; tries++) k = (k + step + options.length) % options.length;
            if (options[k]!.disabled) return;
            onChange(options[k]!.value);
            (e.currentTarget.parentElement?.children[k] as HTMLElement | undefined)?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** One of more than four. */
export function Select<T extends string | number>({ options, value, onChange, disabled, label, describedBy }: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean | undefined; label?: string | undefined; describedBy?: string | undefined }) {
  const r = useRow();
  return (
    <select className="sp-select" value={String(value)} disabled={disabled} {...named(r, label)} aria-describedby={describedBy ?? (label ? undefined : r?.helpId)} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A number with its unit beside it (the row's unit from the registry unless given). */
export function Num({ value, onChange, min, max, step = 1, unit, bind, disabled, label, onText }: { value: number; onChange: (n: number) => void; /** SA-4: the box's text as typed, so an emptied box isn't read as 0 (Admin saves on blur). */ onText?: ((s: string) => void) | undefined; min?: number | undefined; max?: number | undefined; step?: number | undefined; unit?: string | undefined; bind?: TextBind | undefined; disabled?: boolean | undefined; label?: string | undefined }) {
  const r = useRow();
  const u = unit ?? r?.unit;
  return (
    <span className="sp-num">
      <input type="number" inputMode="numeric" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ""} disabled={disabled} onChange={(e) => (onText ? onText(e.target.value) : onChange(Number(e.target.value)))} {...named(r, label)} {...bind} />
      {u && <span className="sp-unit">{u}</span>}
    </span>
  );
}

/** Text: a name, a list of phrases, a span of hours. `wide` takes the row's whole width. */
export function Text({ value, onChange, placeholder, bind, list, maxLength, wide, disabled, label, inputMode, spellCheck }: { value: string; onChange: (s: string) => void; placeholder?: string | undefined; bind?: TextBind | undefined; list?: string | undefined; maxLength?: number | undefined; wide?: boolean | undefined; disabled?: boolean | undefined; label?: string | undefined; inputMode?: "numeric" | "text" | undefined; spellCheck?: boolean | undefined }) {
  const r = useRow();
  return <input type="text" className={`sp-text-input${wide ? " wide" : ""}`} value={value} placeholder={placeholder} list={list} maxLength={maxLength} disabled={disabled} inputMode={inputMode} spellCheck={spellCheck} onChange={(e) => onChange(e.target.value)} {...named(r, label)} {...bind} />;
}

/** The list of choices a Text offers as you type (time zones). */
export function Suggestions({ id, values }: { id: string; values: readonly string[] }) {
  return (
    <datalist id={id}>
      {values.map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  );
}

/** A secret: masked, never filled from anything kept, cleared after it is checked. */
export function Secret({ inputRef, placeholder, label, disabled }: { inputRef: Ref<HTMLInputElement>; placeholder: string; label: string; disabled?: boolean | undefined }) {
  return <input ref={inputRef} type="password" className="sp-text-input wide" autoComplete="new-password" spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder={placeholder} aria-label={label} disabled={disabled} />;
}

/** A date (a PAT's expiry). */
export function DateInput({ value, onChange, label, title }: { value: string; onChange: (s: string) => void; label?: string | undefined; title?: string | undefined }) {
  const r = useRow();
  return <input type="date" className="sp-date" value={value} title={title} onChange={(e) => onChange(e.target.value)} {...named(r, label)} />;
}

/** A time: the app's time field. `clearable` offers No time (an empty time turns a nudge off). */
export function Time({ value, onChange, label, clearable, disabled }: { value: string; onChange: (t: string) => void; label?: string | undefined; clearable?: boolean | undefined; disabled?: boolean | undefined }) {
  const r = useRow();
  return <TimeField value={value} onChange={onChange} label={label ?? r?.label ?? "Time"} clearable={clearable} disabled={disabled} className="sp-time" />;
}

/** A level from 0 to 100 (the volume), its value said beside it. */
export function Level({ value, onChange, onCommit, min = 0, max = 100, step = 5 }: { value: number; onChange: (n: number) => void; onCommit: () => void; min?: number | undefined; max?: number | undefined; step?: number | undefined }) {
  const r = useRow();
  return (
    <span className="sp-num">
      <input type="range" className="sp-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} {...named(r)} />
      <span className="sp-unit">{value}</span>
    </span>
  );
}

/** A colour, drawn as swatches to pick from (a radio group). */
export function Swatches({ values, value, onChange, name, label }: { values: readonly string[]; value: string; onChange: (v: string) => void; name: string; label?: string | undefined }) {
  const r = useRow();
  return (
    <span className="sp-swatches" role="radiogroup" {...named(r, label)}>
      {values.map((slot) => (
        <label key={slot} className="sp-swatch" title={slot}>
          <input type="radio" name={name} checked={value === slot} onChange={() => onChange(slot)} aria-label={slot} />
          <span className="sp-swatch-fill" style={{ background: `var(--client-${slot})` }} />
        </label>
      ))}
    </span>
  );
}

/** A form inside a row (a PAT, an item number): Enter sends it. */
export function Form({ children, onSubmit, label }: { children: ReactNode; onSubmit: () => void; label: string }) {
  return (
    <form className="sp-form" autoComplete="off" aria-label={label} onSubmit={(e) => (e.preventDefault(), onSubmit())}>
      {children}
    </form>
  );
}

/** Pre-formatted text kept as written (a house style). */
export function Pre({ children }: { children: ReactNode }) {
  return <span className="sp-pre">{children}</span>;
}

/** A client's color as a CSS value: a palette slot, a custom #hex, or none. */
export const colorVar = (c: string) => (c ? (c.startsWith("#") ? c : `var(--client-${c})`) : "var(--client-none)");

/** A list of places to open (the clients, each opening its own page): a swatch, a name, a line, a chevron. */
export function Links({ children, label }: { children: ReactNode; label?: string | undefined }) {
  return (
    <ul className="sp-links" aria-label={label}>
      {children}
    </ul>
  );
}
export function LinkItem({ href, onGo, color, name, detail, data }: { href: string; onGo: () => void; color?: string | undefined; name: string; detail: ReactNode; data?: Record<string, string> | undefined }) {
  return (
    <li>
      <a className="sp-link-item" {...data} href={href} onClick={(e) => (e.preventDefault(), onGo())} style={color === undefined ? undefined : ({ "--c": colorVar(color) } as CSSProperties)}>
        {color !== undefined && <span className="sp-swatch-dot" aria-hidden="true" />}
        <span className="sp-label">{name}</span>
        <span className="sp-help">{detail}</span>
        <span className="sp-chev" aria-hidden="true">
          <Icon name="next" />
        </span>
      </a>
    </li>
  );
}
