// SA-4: what every part of Admin shares: saving one team value at a time (Saved, Retry, Undo), a part's data from
// admin.load, the field row with its kind badge, the small inputs, and the Customers or All accounts choice.
// Moved from ui/settings/Admin.tsx unchanged.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { call } from "../../api.ts";
import { useReturnFocus } from "../../CloseButton.tsx";
import { SaveMark, plain, useSaveContext, type FieldStatus } from "../autosave.tsx";
import type { SourceSystem } from "../../../plan/standards.ts";
import type { ClientProcess } from "../../../actions/types.ts";
import type { ClientScopeRow } from "../AdminScope.tsx";
import type { GapKind } from "../../../plan/fixnext.ts";

// ---------- saving ----------

export type SetResult = { old: unknown; value: unknown; warning: string | null };

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
          unpend(id);
          ctx?.offerUndo(`${label} saved.`, async () => {
            await send(scope, key, r.old === null ? undefined : r.old);
            setStatus(id, null);
            onSaved();
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

export function Kind({ kind }: { kind: "Rule" | "Default" | "Default by level" }) {
  const hint = kind === "Rule" ? "Applies to everyone" : kind === "Default" ? "People may change it for themselves" : "Per level; people may change it for themselves";
  return (
    <span className="adm-kind" title={hint}>
      {kind}
    </span>
  );
}

export function AField({ label, kind, hint, s, retry, children }: { label: string; kind: "Rule" | "Default" | "Default by level"; hint?: ReactNode; s: FieldStatus; retry: () => void; children: ReactNode }) {
  return (
    <div className="set-field adm-field">
      <span className="set-label">
        {label} <Kind kind={kind} />
      </span>
      {children}
      <SaveMark s={s} retry={retry} />
      {hint && <span className="set-hint">{hint}</span>}
    </div>
  );
}

export const csv = (v: string) => [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))];

/** A comma list saved on blur or Enter (only when changed). */
export function ListInput({ value, onSave, label, placeholder }: { value: readonly string[]; onSave: (v: string[]) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value.join("\u0000")]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const next = csv(text);
    if (next.join("\u0000") !== value.join("\u0000")) onSave(next);
  };
  return <input aria-label={label} value={text} placeholder={placeholder ?? "none"} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />;
}

/** A number saved on blur or Enter. */
export function NumInput({ value, onSave, label, min, max, step = 1 }: { value: number; onSave: (v: number) => void; label: string; min: number; max: number; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && n !== value) onSave(n);
  };
  return <input type="number" aria-label={label} min={min} max={max} step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />;
}

/** A line of text saved on blur or Enter. */
export function TextInput({ value, onSave, label, placeholder, maxLength = 100 }: { value: string; onSave: (v: string) => void; label: string; placeholder?: string; maxLength?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onSave(text.trim());
  return <input aria-label={label} value={text} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />;
}

export const colorVar = (c: string | null) => (c ? (c.startsWith("#") ? c : `var(--client-${c})`) : "var(--client-none)");

// ---------- Clients ----------

export type ClientRow = { /** KB-1. */ sourceSystems?: SourceSystem[] | null; key: string; isClient: boolean; whyText: string; names: string[]; types: string[]; treatAsClient: boolean; hidden: boolean; hasSettings: boolean; color: string | null; colorFrom: "suggested" | "admin"; allowAi: boolean; openStates: string[]; noBreakdown: string[]; background: string[]; /** GD-2 */ aliases?: string[]; /** HK-7 */ exactCase?: boolean; exactCaseDefault?: boolean; houseStyle: string | null; fixGaps?: GapKind[]; /** RB-1 */ codeAccess?: "company" | "team"; process: ClientProcess; scope: ClientScopeRow | null; leads: { personId: string; name: string; primary: boolean; why: string[] }[]; /** CV-3, CV-4 */ groupWithoutAi: boolean; attachmentsAi: boolean; /** SA-4: why a chat can't be registered here by me, or null. */ chatRefusal?: string | null };
export type ClientFilterValue = "customers" | "all";
export type ClientCounts = { customers: number; all: number };
export type ClientsData = { palette: string[]; suggested: string[]; filter: ClientFilterValue; accountsRead: boolean; counts: ClientCounts; clients: ClientRow[] };

/** ADM-2: Customers (the default) or All accounts, on Admin › Clients and AI. */
export function ClientFilter({ value, counts, onChange }: { value: ClientFilterValue; counts: ClientCounts | undefined; onChange: (v: ClientFilterValue) => void }) {
  return (
    <span className="adm-filter" role="radiogroup" aria-label="Which accounts">
      {(["customers", "all"] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {v === "customers" ? "Customers" : "All accounts"}
          {counts ? <span className="muted"> {v === "customers" ? counts.customers : counts.all}</span> : null}
        </button>
      ))}
    </span>
  );
}

/** A moment in the admin's own words ("Nov 18, 9:05 AM"), or "never". */
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

/**
 * SA-4: Admin's one confirm, at the control that asked: what happens and for whom, then the danger button and Cancel
 * (focus starts on Cancel and goes back to the control when it closes). `children` is any field the confirm needs.
 */
export function AdminConfirm({ label, text, confirm, onConfirm, onCancel, disabled = false, children }: { label: string; text: ReactNode; confirm: string; onConfirm: () => void; onCancel: () => void; disabled?: boolean; children?: ReactNode }) {
  useReturnFocus();
  return (
    <div className="adm-confirm" role="alertdialog" aria-label={label} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), e.preventDefault(), onCancel())}>
      <p>{text}</p>
      {children}
      <span className="set-inline">
        <button type="button" className="mini danger" disabled={disabled} onClick={onConfirm}>
          {confirm}
        </button>
        <button type="button" className="mini quiet" autoFocus={!children} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}
