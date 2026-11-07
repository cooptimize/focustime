// Settings saves itself (fix/settings-autosave). Every field saves through the same settings.save action and its
// validation, one field at a time:
// - checkboxes, switches, radio buttons and selects save on change; text and number fields on blur or Enter (debounced,
//   and only when the value changed);
// - the save sends the last saved values with just this field changed, so a field still showing an error elsewhere is
//   never sent along with it;
// - on success a small "Saved" by the field for about 2 seconds, and an Undo toast that saves the previous value back;
// - on a validation error a plain message under the field, the typed value stays, nothing is saved;
// - on a network error "Couldn't save. Retry" by the field.
// A form left with an edited field (a section switch, Back, Esc) saves it as it closes; a refusal then comes back as a
// notice, never silently. Secrets are not here: they keep their own "Check and save" button.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FieldProblem, SettingsData } from "../../actions/types.ts";
import { ActionRefusal, call } from "../api.ts";

/** How long "Saved" stays by a field. */
export const SAVED_MS = 2000;
/** Text fields: a blur right after Enter is one save. */
export const DEBOUNCE_MS = 250;
/** How long the Undo toast stays. */
export const UNDO_MS = 8000;

export type FieldStatus = { kind: "saving" } | { kind: "saved" } | { kind: "error"; messages: string[] } | { kind: "retry" } | null;

type Undo = { id: number; text: string; run: () => Promise<void> };
type Ctx = {
  /** Shows "<what> saved · Undo" for a while. */
  offerUndo: (text: string, run: () => Promise<void>) => void;
  /** Tracks a save in flight, so leaving can wait for it. */
  track: (p: Promise<unknown>) => void;
  /** A save that failed after its form closed: said out loud, not dropped. */
  notice: (message: string) => void;
};
const AutoSaveCtx = createContext<Ctx | null>(null);

/** True for a refusal of the values (validation), false for anything that may work on a retry. */
export const isValidation = (e: unknown) => e instanceof ActionRefusal && (e.status === 400 || e.status === 422) && !!(e.fields.length || e.message);

/** A validation message without the config key it names at the end: "Must be at least the Watch value". */
export const plain = (m: string) => m.replace(/\s*\((?:[a-z]+[._])+[a-z_.\[\]0-9]*\)\s*$/, "").replace(/^[a-z_.]+\[?\d*\]?: /, "");

/** Deep equality for plain settings values (strings, numbers, booleans, arrays and objects of them). */
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The provider Settings wraps its sections in: the Undo toast, the saves in flight, and `leave` (blur the edited
 * field, wait for its save, then go).
 */
/** Where Settings' fields live (ST-1: the panel shell's body; Admin renders there too). */
const SETTINGS_BODY = ".settings .ps-body";

export function AutoSaveProvider({ children, onNotice }: { children: (leave: (go: () => void) => void) => ReactNode; onNotice?: ((m: string) => void) | undefined }) {
  const [undo, setUndo] = useState<Undo | null>(null);
  const [busyUndo, setBusyUndo] = useState(false);
  const pending = useRef(new Set<Promise<unknown>>());
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notice = useCallback((m: string) => onNotice?.(m), [onNotice]);
  const offerUndo = useCallback((text: string, run: () => Promise<void>) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setUndo({ id, text, run });
    timer.current = setTimeout(() => setUndo((u) => (u?.id === id ? null : u)), UNDO_MS);
  }, []);
  const track = useCallback((p: Promise<unknown>) => {
    pending.current.add(p);
    void p.finally(() => pending.current.delete(p));
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const leave = useCallback((go: () => void) => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.closest(SETTINGS_BODY)) el.blur();
    // The blur's save starts on the next tick (React's handler, then the debounce is flushed by the form).
    setTimeout(() => {
      void Promise.allSettled([...pending.current]).then(() => {
        // A field still showing an error isn't saved: stay, and put the person on it.
        const bad = document.querySelector<HTMLElement>(`${SETTINGS_BODY} [aria-invalid='true']`);
        if (bad) bad.focus();
        else go();
      });
    }, 0);
  }, []);
  const ctx = useMemo(() => ({ offerUndo, track, notice }), [offerUndo, track, notice]);
  return (
    <AutoSaveCtx.Provider value={ctx}>
      {children(leave)}
      <div className="set-undo" role="status" aria-live="polite">
        {undo && (
          <span className="set-undo-box">
            {undo.text}
            <button
              type="button"
              className="link-btn"
              disabled={busyUndo}
              onClick={async () => {
                setBusyUndo(true);
                try {
                  await undo.run();
                  setUndo(null);
                } catch (e) {
                  notice(`Couldn't undo: ${e instanceof Error ? e.message : "try again"}`);
                } finally {
                  setBusyUndo(false);
                }
              }}
            >
              Undo
            </button>
          </span>
        )}
      </div>
    </AutoSaveCtx.Provider>
  );
}

/** ADM-1: the Undo toast and save tracking, for forms that save through their own action (Admin). */
export const useSaveContext = () => useContext(AutoSaveCtx);

type Options<V> = {
  /** The settings.save section. */
  section: string;
  /** The values as loaded. */
  initial: V;
  /** The section's input from the values (the shape settings.save takes). */
  payload: (v: V) => unknown;
  onSaved: (d: SettingsData) => void;
  /** Words for the Undo toast, per field: "Focus length". Default: the section's name. */
  label?: (key: keyof V) => string;
};

export type AutoSave<V> = {
  v: V;
  /** Updates the shown value only (typing). */
  set: <K extends keyof V>(key: K, value: V[K]) => void;
  /** Saves this field (debounced; nothing when it hasn't changed). With a value: that value. */
  commit: <K extends keyof V>(key: K, value?: V[K]) => void;
  /** set and save at once: checkboxes, radios, selects, list Add and Remove. */
  change: <K extends keyof V>(key: K, value: V[K]) => void;
  status: (key: keyof V) => FieldStatus;
  /** Props for a text or number input: blur and Enter save it; aria-invalid while it shows an error. */
  text: <K extends keyof V>(key: K) => { onBlur: () => void; onKeyDown: (e: React.KeyboardEvent) => void; "aria-invalid": boolean };
};

export function useAutoSave<V extends Record<string, unknown>>(o: Options<V>): AutoSave<V> {
  const ctx = useContext(AutoSaveCtx);
  const [v, setV] = useState<V>(o.initial);
  const [statuses, setStatuses] = useState<Partial<Record<keyof V, FieldStatus>>>({});
  const saved = useRef<V>(o.initial);
  const shown = useRef<V>(o.initial);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timers = useRef(new Map<keyof V, ReturnType<typeof setTimeout>>());
  const live = useRef(true);
  const opts = useRef(o);
  opts.current = o;

  const setStatus = useCallback((key: keyof V, s: FieldStatus) => {
    if (live.current) setStatuses((all) => ({ ...all, [key]: s }));
  }, []);

  const send = useCallback(async (values: V) => {
    const r = await call<{ settings: SettingsData }>("settings.save", { section: opts.current.section, values: opts.current.payload(values) });
    return r.settings;
  }, []);

  /** Saves one field now (in order with the form's other saves). */
  const run = useCallback(
    (key: keyof V) => {
      const p = (chain.current = chain.current.then(async () => {
        const before = saved.current;
        const next = { ...before, [key]: shown.current[key] } as V;
        if (same(next[key], before[key])) {
          // Typed back to the saved value: nothing to save, and an old error no longer applies.
          setStatus(key, null);
          return;
        }
        setStatus(key, { kind: "saving" });
        try {
          const data = await send(next);
          saved.current = next;
          setStatus(key, { kind: "saved" });
          setTimeout(() => setStatuses((all) => (all[key]?.kind === "saved" ? { ...all, [key]: null } : all)), SAVED_MS);
          opts.current.onSaved(data);
          const what = opts.current.label?.(key) ?? "Setting";
          ctx?.offerUndo(`${what} saved.`, async () => {
            const back = { ...saved.current, [key]: before[key] } as V;
            const d = await send(back);
            saved.current = back;
            shown.current = { ...shown.current, [key]: before[key] };
            if (live.current) setV(shown.current);
            setStatus(key, null);
            opts.current.onSaved(d);
          });
        } catch (e) {
          if (isValidation(e)) {
            const r = e as ActionRefusal;
            const messages = r.fields.length ? [...new Set(r.fields.map((f: FieldProblem) => plain(f.message)))] : [plain(r.message)];
            setStatus(key, { kind: "error", messages });
            if (!live.current) ctx?.notice(`Not saved: ${messages.join("; ")}`);
          } else {
            setStatus(key, { kind: "retry" });
            if (!live.current) ctx?.notice("A setting couldn't be saved. Open Settings and try again");
          }
        }
      }));
      ctx?.track(p);
      return p;
    },
    [ctx, send, setStatus],
  );

  const commit = useCallback(
    <K extends keyof V>(key: K, value?: V[K]) => {
      if (value !== undefined) shown.current = { ...shown.current, [key]: value };
      const t = timers.current.get(key);
      if (t) clearTimeout(t);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          void run(key);
        }, DEBOUNCE_MS),
      );
    },
    [run],
  );

  const set = useCallback(<K extends keyof V>(key: K, value: V[K]) => {
    shown.current = { ...shown.current, [key]: value };
    setV(shown.current);
  }, []);

  const change = useCallback(
    <K extends keyof V>(key: K, value: V[K]) => {
      set(key, value);
      const t = timers.current.get(key);
      if (t) clearTimeout(t), timers.current.delete(key);
      void run(key);
    },
    [set, run],
  );

  // Closing with an edited field (or a save still waiting on its debounce): save it on the way out.
  useEffect(() => {
    live.current = true;
    const pendingTimers = timers.current;
    return () => {
      live.current = false;
      for (const [key, t] of pendingTimers) {
        clearTimeout(t);
        void run(key);
      }
      pendingTimers.clear();
      for (const key of Object.keys(shown.current) as (keyof V)[]) if (!same(shown.current[key], saved.current[key])) void run(key);
    };
  }, [run]);

  const status = useCallback((key: keyof V) => statuses[key] ?? null, [statuses]);
  const text = useCallback(
    <K extends keyof V>(key: K) => ({
      onBlur: () => commit(key),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(key);
        }
      },
      "aria-invalid": statuses[key]?.kind === "error",
    }),
    [commit, statuses],
  );
  return { v, set, commit, change, status, text };
}

/** By the field: "Saving…", "Saved", "Couldn't save. Retry", or the plain error under it. */
export function SaveMark({ s, retry }: { s: FieldStatus; retry: () => void }) {
  return (
    <>
      <span className="set-mark" aria-live="polite">
        {s?.kind === "saving" && <span className="muted">Saving…</span>}
        {s?.kind === "saved" && <span className="set-saved">Saved</span>}
        {s?.kind === "retry" && (
          <span className="set-retry">
            Couldn't save.{" "}
            <button type="button" className="link-btn" onClick={retry}>
              Retry
            </button>
          </span>
        )}
      </span>
      {s?.kind === "error" && (
        <span className="field-problem" role="alert">
          {s.messages.join("; ")}
        </span>
      )}
    </>
  );
}
