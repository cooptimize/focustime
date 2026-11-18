// SA-4: what every part of Admin shares: saving one team value at a time (Saved, Retry, Undo), a part's data from
// admin.load, the field row with its kind badge, the small inputs, and the Customers or All accounts choice.
// SA-4 F: every one of them is drawn with SA-2's parts (ui/settings/parts.tsx); Admin draws no row, group, table,
// button row or saved mark of its own (ui/settings/admin/admin.guard.test.ts).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { call } from "../../api.ts";
import { useReturnFocus } from "../../CloseButton.tsx";
import { plain, useSaveContext, type FieldStatus } from "../autosave.tsx";
import { Badge, Button, Buttons, Choice, Note, Num, Row, Switch, Text } from "../parts.tsx";
import type { SourceSystem } from "../../../plan/standards.ts";
import type { ClientProcess } from "../../../actions/types.ts";
import type { ClientScopeRow } from "../AdminScope.tsx";
import type { GapKind } from "../../../plan/fixnext.ts";

// ---------- saving ----------

export type SetResult = { old: unknown; value: unknown; warning: string | null };

/** SA-4: something Admin shows elsewhere changed (a saved setting, a registered call): the rail and the marks read again. */
const CHANGED = "focustime:admin-changed";
export const adminChanged = () => window.dispatchEvent(new Event(CHANGED));
export function useAdminChanged(run: () => void) {
  useEffect(() => {
    window.addEventListener(CHANGED, run);
    return () => window.removeEventListener(CHANGED, run);
  }, [run]);
}

/** Saves team settings one field at a time, with Saved, the plain error, Retry and Undo. */
export function useAdminSave(onSaved: () => unknown) {
  const ctx = useSaveContext();
  const [statuses, setStatuses] = useState<Record<string, FieldStatus>>({});
  // The value just chosen, shown at once while it saves and the section reloads.
  const [pending, setPending] = useState<Record<string, { v: unknown }>>({});
  const unpend = (id: string) => setPending(({ [id]: _, ...rest }) => rest);
  const [warning, setWarning] = useState<string | null>(null);
  const setStatus = (id: string, s: FieldStatus) => setStatuses((all) => ({ ...all, [id]: s }));
  const send = (scope: string, key: string, value: unknown) => call<SetResult>("admin.set", value === undefined ? { scope, key, clear: true } : { scope, key, value });
  const save = useCallback(
    async (scope: string, key: string, value: unknown, label: string) => {
      const id = `${scope}/${key}`;
      setStatus(id, { kind: "saving" });
      setPending((all) => ({ ...all, [id]: { v: value } }));
      const p = (async () => {
        try {
          const r = await send(scope, key, value);
          setStatus(id, { kind: "saved" });
          setWarning(r.warning);
          setTimeout(() => setStatuses((all) => (all[id]?.kind === "saved" ? { ...all, [id]: null } : all)), 2000);
          await onSaved();
          adminChanged();
          unpend(id);
          ctx?.offerUndo(`${label} saved.`, async () => {
            await send(scope, key, r.old === null ? undefined : r.old);
            setStatus(id, null);
            await onSaved();
            adminChanged();
          });
        } catch (e) {
          unpend(id);
          const m = e instanceof Error ? plain(e.message) : "";
          setStatus(id, m && !/network|fetch/i.test(m) ? { kind: "error", messages: [m] } : { kind: "retry" });
        }
      })();
      ctx?.track(p);
      return p;
    },
    [ctx, onSaved], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** The saved value, or the one being saved. */
  const shown = <T,>(scope: string, key: string, saved: T): T => (`${scope}/${key}` in pending ? (pending[`${scope}/${key}`]!.v as T) : saved);
  return { save, shown, status: (scope: string, key: string) => statuses[`${scope}/${key}`] ?? null, warning };
}
export type Saver = ReturnType<typeof useAdminSave>;

/** A section's data from admin.load, reloaded after each save. */
export function useSection<T>(section: string, extra: Record<string, unknown> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(extra);
  const load = useCallback(async () => {
    try {
      setData(await call<T>("admin.load", { section, ...extra }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this");
    }
  }, [section, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [load]);
  /** Once with more input (Admin › Clients' Refresh reads DevOps again). */
  const loadWith = useCallback(
    async (more: Record<string, unknown>) => {
      try {
        setData(await call<T>("admin.load", { section, ...extra, ...more }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load this");
      }
    },
    [section, key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { data, error, load, loadWith };
}

const KIND_HINT = { Rule: "applies to everyone", Default: "people may change it for themselves", "Default by level": "per level; people may change it for themselves" } as const;
export type SettingKind = keyof typeof KIND_HINT;
/** The kind of a team value, beside its label: Rule, Default, Default by level. */
export function Kind({ kind }: { kind: SettingKind }) {
  return <Badge title={KIND_HINT[kind]}>{kind}</Badge>;
}

/** SA-4 F: one Admin setting is SA-2's row: its label and kind, the help, the saved mark, the control on the right. */
export function AField({ label, kind, hint, more, s, retry, wide, below, children }: { label: string; kind: SettingKind; hint?: ReactNode; more?: ReactNode; s: FieldStatus; retry: () => void; wide?: boolean | undefined; below?: ReactNode; children?: ReactNode }) {
  return (
    <Row id={label} def={{ label }} noSid badge={<Kind kind={kind} />} help={hint ?? null} more={more} mark={{ s, retry }} wide={wide} below={below}>
      {children}
    </Row>
  );
}

/** A read-only line in Admin, as a row: a label and what it says (Last synced, Budget). */
export function ARead({ label, children, help, wide }: { label: string; children: ReactNode; help?: ReactNode; wide?: boolean | undefined }) {
  return (
    <Row id={label} def={{ label }} noSid help={help ?? null} wide={wide}>
      {children}
    </Row>
  );
}

/** A switch saved as it changes, with the same accessible name it always had. */
export function ASwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean | undefined }) {
  return <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />;
}

export const csv = (v: string) => [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))];

const enter = (commit: () => void) => (e: { key: string; preventDefault: () => void }) => e.key === "Enter" && (e.preventDefault(), commit());

/** A comma list saved on blur or Enter (only when changed). */
export function ListInput({ value, onSave, label, placeholder }: { value: readonly string[]; onSave: (v: string[]) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value.join("\u0000")]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const next = csv(text);
    if (next.join("\u0000") !== value.join("\u0000")) onSave(next);
  };
  return <Text wide label={label} value={text} placeholder={placeholder ?? "none"} onChange={setText} bind={{ onBlur: commit, onKeyDown: enter(commit) }} />;
}

/** A number saved on blur or Enter, its unit beside it. */
export function NumInput({ value, onSave, label, min, max, step = 1, unit }: { value: number; onSave: (v: number) => void; label: string; min: number; max: number; step?: number; unit?: string | undefined }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && n !== value) onSave(n);
  };
  return <Num label={label} value={text.trim() === "" ? Number.NaN : Number(text)} min={min} max={max} step={step} unit={unit} onChange={(n) => setText(Number.isFinite(n) ? String(n) : "")} bind={{ onBlur: commit, onKeyDown: enter(commit) }} />;
}

/** A line of text saved on blur or Enter. */
export function TextInput({ value, onSave, label, placeholder, maxLength = 100 }: { value: string; onSave: (v: string) => void; label: string; placeholder?: string; maxLength?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onSave(text.trim());
  return <Text label={label} value={text} maxLength={maxLength} placeholder={placeholder} onChange={setText} bind={{ onBlur: commit, onKeyDown: enter(commit) }} />;
}

/** A problem or a warning line, in the problem color. */
export function Problem({ children, live }: { children: ReactNode; live?: boolean | undefined }) {
  return (
    <Note tone="problem" live={live}>
      {children}
    </Note>
  );
}

export const colorVar = (c: string | null) => (c ? (c.startsWith("#") ? c : `var(--client-${c})`) : "var(--client-none)");

// ---------- Clients ----------

export type ClientRow = { /** KB-1. */ sourceSystems?: SourceSystem[] | null; key: string; isClient: boolean; whyText: string; names: string[]; types: string[]; treatAsClient: boolean; hidden: boolean; hasSettings: boolean; color: string | null; colorFrom: "suggested" | "admin"; allowAi: boolean; openStates: string[]; noBreakdown: string[]; background: string[]; /** GD-2 */ aliases?: string[]; /** HK-7 */ exactCase?: boolean; exactCaseDefault?: boolean; houseStyle: string | null; fixGaps?: GapKind[]; /** RB-1 */ codeAccess?: "company" | "team"; process: ClientProcess; scope: ClientScopeRow | null; leads: { personId: string; name: string; primary: boolean; why: string[] }[]; /** CV-3, CV-4 */ groupWithoutAi: boolean; attachmentsAi: boolean; /** SA-4: why a chat can't be registered here by me, or null. */ chatRefusal?: string | null };
export type ClientFilterValue = "customers" | "all";
export type ClientCounts = { customers: number; all: number };
export type ClientsData = { palette: string[]; suggested: string[]; filter: ClientFilterValue; accountsRead: boolean; counts: ClientCounts; clients: ClientRow[] };

/** ADM-2: Customers (the default) or All accounts, on Admin › Clients: SA-2's segmented control. */
export function ClientFilter({ value, counts, onChange }: { value: ClientFilterValue; counts: ClientCounts | undefined; onChange: (v: ClientFilterValue) => void }) {
  const n = (v: number | undefined) => (v === undefined ? "" : ` ${v}`);
  return <Choice label="Which accounts" value={value} onChange={onChange} options={[{ value: "customers", label: `Customers${n(counts?.customers)}` }, { value: "all", label: `All accounts${n(counts?.all)}` }]} />;
}

/** A moment in the admin's own words ("Nov 18, 9:05 AM"), or "never". */
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

/**
 * SA-4: Admin's one confirm, at the control that asked: what happens and for whom, then the danger button and Cancel
 * (focus starts on Cancel and goes back to the control when it closes). `children` is any field the confirm needs.
 */
export function AdminConfirm({ label, text, confirm, onConfirm, onCancel, disabled = false, children }: { label: string; text: ReactNode; confirm: string; onConfirm: () => void; onCancel: () => void; disabled?: boolean; children?: ReactNode }) {
  useReturnFocus();
  // The one element Admin keeps of its own: the confirm's dialog role, so Esc and the screen reader know what it is.
  return (
    <div className="sp-confirm" role="alertdialog" aria-label={label} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), e.preventDefault(), onCancel())}>
      <Note>{text}</Note>
      {children}
      <Buttons>
        <Button kind="danger" disabled={disabled} onClick={onConfirm}>
          {confirm}
        </Button>
        <CancelFirst focus={!children} onCancel={onCancel} />
      </Buttons>
    </div>
  );
}

/** Cancel, focused when the confirm opens (nothing to type first). */
function CancelFirst({ focus, onCancel }: { focus: boolean; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <Button kind="quiet" buttonRef={ref} onClick={onCancel}>
      Cancel
    </Button>
  );
}
