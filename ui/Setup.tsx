// First-run setup (S1, D451): four short screens before Today, then Done. Never in the way: every screen has Back and
// Skip, Esc skips, Enter continues, closing skips the rest, and each screen saves on its own (signing out halfway
// resumes there). Every save goes through the ordinary actions (settings.save, devops.set_write_pat, Google's
// connect); setup.mark keeps only which steps are done, skipped or closed.
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { nextStep, SETUP_STEPS, SETUP_TITLES, type SetupClient, type SetupPrefill, type SetupStep, type SetupView } from "../plan/setup.ts";
import { WEEKDAY_KEYS } from "../week/hours.ts";
import type { SettingsData } from "../actions/types.ts";
import { call } from "./api.ts";

type Props = {
  /** The step to open on. */
  start: SetupStep;
  /** Google Calendar is connected now (the calendars screen says so). */
  googleConnected: boolean;
  onConnectGoogle: () => void;
  /** The flow closed (Done, or closed early); `changed`: something was saved, so the app reloads. */
  onClose: (changed: boolean) => void;
  onPlanWeek: () => void;
  onGuide: () => void;
};

const DAY_LABELS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const ZONES: readonly string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export function SetupFlow(p: Props) {
  useReturnFocus();
  const [step, setStep] = useState<SetupStep | "done">(p.start);
  const [view, setView] = useState<SetupView | null>(null);
  const changed = useRef(false);
  const body = useRef<HTMLDivElement>(null);

  const mark = useCallback(async (s: SetupStep, status: "done" | "skipped") => {
    setView(await call<SetupView>("setup.mark", { step: s, status }));
    changed.current = true;
  }, []);
  const go = useCallback((s: SetupStep) => setStep(nextStep(s) ?? "done"), []);
  const skip = useCallback(
    async (s: SetupStep) => {
      await mark(s, "skipped").catch(() => null);
      go(s);
    },
    [mark, go],
  );
  const close = useCallback(async () => {
    if (step !== "done") await call("setup.mark", { closeFrom: step }).catch(() => null);
    p.onClose(true);
  }, [step, p]);

  const index = step === "done" ? SETUP_STEPS.length : SETUP_STEPS.indexOf(step);
  // Between screens (the next one may still be loading), focus stays in the dialog, so Esc and Tab keep working; each
  // screen then moves it to its first field once it's ready.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current && !box.current.contains(document.activeElement)) box.current.focus({ preventScroll: true });
  }, [step]);
  return (
    <div className="cap-backdrop setup-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        className="cap-dialog setup-dialog"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={step === "done" ? "Setup: done" : `Setup: ${SETUP_TITLES[step]}`}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          e.preventDefault();
          if (step === "done") p.onClose(changed.current);
          else void skip(step);
        }}
      >
        <div className="setup-head">
          <ol className="setup-steps" aria-label="Setup steps">
            {SETUP_STEPS.map((s, i) => (
              <li key={s} className={i < index ? "past" : i === index ? "now" : ""} aria-current={i === index ? "step" : undefined}>
                {SETUP_TITLES[s]}
              </li>
            ))}
          </ol>
          <CloseButton onClose={() => void close()} title="Close setup. Today keeps a line to finish it later" />
        </div>
        <div ref={body} className="setup-body">
          {step === "day" && <DayStep onSaved={() => mark("day", "done").then(() => go("day"))} onSkip={() => void skip("day")} />}
          {step === "clients" && <ClientsStep onDone={() => mark("clients", "done").then(() => go("clients"))} onSkip={() => void skip("clients")} onBack={() => setStep("day")} />}
          {step === "blocks" && <BlocksStep onSaved={() => mark("blocks", "done").then(() => go("blocks"))} onSkip={() => void skip("blocks")} onBack={() => setStep("clients")} />}
          {step === "calendars" && (
            <CalendarsStep connected={p.googleConnected} onConnect={p.onConnectGoogle} onDone={() => mark("calendars", "done").then(() => go("calendars"))} onSkip={() => void skip("calendars")} onBack={() => setStep("blocks")} />
          )}
          {step === "done" && <DoneStep view={view} onPlanWeek={() => (p.onClose(true), p.onPlanWeek())} onGuide={() => (p.onClose(true), p.onGuide())} onBack={() => setStep("calendars")} />}
        </div>
      </div>
    </div>
  );
}

/** One screen: its title and words, the content, and Back, Skip and the primary button. Enter submits. */
/** Lunch as typed: "12:00-12:30", or one time ("12:00") for a split with no break. */
const lunchValue = (v: string) => {
  const t = v.replace(/\s+/g, "");
  return /^\d{1,2}:\d{2}$/.test(t) ? `${t}-${t}` : t;
};

function Screen(o: { title: string; intro: ReactNode; children?: ReactNode; onSubmit: () => void | Promise<void>; primary: string; onSkip?: () => void; onBack?: (() => void) | undefined; busy?: boolean; status?: string | null; ready?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const ready = o.ready ?? true;
  // Focus lands on the first field of each screen once it's there (else its primary button).
  useEffect(() => {
    if (!ready) return;
    const f = form.current;
    (f?.querySelector<HTMLElement>("input:not([type=hidden]):not([type=checkbox]), select, textarea") ?? f?.querySelector<HTMLElement>("button.setup-primary"))?.focus();
  }, [o.title, ready]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!o.busy) void o.onSubmit();
  };
  return (
    <form
      ref={form}
      className="setup-screen"
      onSubmit={submit}
      autoComplete="off"
      onKeyDown={(e) => {
        // Enter continues from any field (a field with suggestions, like the time zone, would keep it otherwise).
        const t = e.target as HTMLElement;
        if (e.key !== "Enter" || e.defaultPrevented || t.tagName === "BUTTON" || t.tagName === "TEXTAREA" || t.tagName === "A") return;
        e.preventDefault();
        form.current?.requestSubmit();
      }}
    >
      <h2>{o.title}</h2>
      <p className="setup-intro">{o.intro}</p>
      {o.children}
      {o.status && (
        <p className="field-problem" role="alert">
          {o.status}
        </p>
      )}
      <div className="setup-actions">
        <button type="button" className="mini quiet" onClick={o.onBack} disabled={!o.onBack} title={o.onBack ? "Back" : "This is the first step"}>
          Back
        </button>
        {o.onSkip && (
          <button type="button" className="mini quiet setup-skip" onClick={o.onSkip} title="Skip (Esc)">
            Skip
          </button>
        )}
        <button type="submit" className="mini primary setup-primary" disabled={o.busy}>
          {o.busy ? "Saving…" : o.primary}
        </button>
      </div>
    </form>
  );
}

function DayStep({ onSaved, onSkip }: { onSaved: () => Promise<void>; onSkip: () => void }) {
  const [pre, setPre] = useState<SetupPrefill | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [zone, setZone] = useState("");
  const [days, setDays] = useState<Record<string, boolean>>({});
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [lunch, setLunch] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    call<SetupPrefill>("setup.prefill", {})
      .then((r) => {
        setPre(r);
        setZone(r.timeZone);
        setLunch(r.lunch);
        setDays(Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, (r.weekdays[k] ?? []).length > 0])));
        const first = WEEKDAY_KEYS.map((k) => r.weekdays[k]?.[0]).find(Boolean);
        if (first) {
          const [a, b] = first.split("-");
          setStart(a!);
          setEnd(b!);
        }
      })
      .catch((e) => setFailed(errText(e)));
  }, []);
  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      // The main span on each working day; any evening span already saved stays.
      const weekdays = Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, days[k] ? [`${start}-${end}`, ...(pre?.weekdays[k] ?? []).slice(1)] : []]));
      await call("settings.save", { section: "hours", values: { timeZone: zone, lunch: lunchValue(lunch), weekdays } });
      await onSaved();
    } catch (e) {
      setStatus(`Not saved: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title="Your day"
      intro={pre?.from === "outlook" ? "From your Outlook working hours. FocusTime splits each day into a morning and an afternoon at lunch." : "When you work. FocusTime splits each day into a morning and an afternoon at lunch."}
      onSubmit={save}
      primary="Continue"
      onSkip={onSkip}
      busy={busy || (!pre && !failed)}
      status={status}
      ready={!!pre || !!failed}
    >
      {failed && <p className="muted">Your settings couldn't be read ({failed}). Skip this for now; Settings › Working hours has the same fields.</p>}
      {pre?.note && <p className="muted setup-note">{pre.note}</p>}
      {pre && (
        <div className="setup-fields">
          <label className="set-field">
            <span className="set-label">Time zone</span>
            <select value={zone} onChange={(e) => setZone(e.target.value)}>
              {[...new Set([zone, ...ZONES])].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="setup-days">
            <legend className="set-label">Work days</legend>
            {WEEKDAY_KEYS.map((k) => (
              <label key={k} className="setup-day">
                <input type="checkbox" checked={!!days[k]} onChange={(e) => setDays({ ...days, [k]: e.target.checked })} />
                {DAY_LABELS[k]}
              </label>
            ))}
          </fieldset>
          <div className="setup-row">
            <label className="set-field">
              <span className="set-label">Start</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="set-field">
              <span className="set-label">End</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <label className="set-field">
              <span className="set-label">Lunch</span>
              <input value={lunch} placeholder="12:00-12:30" onChange={(e) => setLunch(e.target.value)} />
            </label>
          </div>
        </div>
      )}
    </Screen>
  );
}

type ClientChoice = "write" | "read";

function ClientsStep({ onDone, onSkip, onBack }: { onDone: () => Promise<void>; onSkip: () => void; onBack: () => void }) {
  const [data, setData] = useState<(SetupView & { clients: SetupClient[]; clientsProblem: string | null }) | null>(null);
  const [choice, setChoice] = useState<Record<string, ClientChoice>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => call<SetupView & { clients: SetupClient[]; clientsProblem: string | null }>("setup.load", { clients: true }).then(setData), []);
  useEffect(() => {
    void load().catch(() => setData({ demo: false, state: {}, open: null, next: "clients", line: null, left: null, through: false, clients: [], clientsProblem: "FocusTime couldn't read your clients just now." }));
  }, [load]);
  const finish = async () => {
    setBusy(true);
    try {
      await onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Your clients" intro="The clients you're on in Dataverse. FocusTime reads their DevOps work for everyone; writing back (states, comments, new items) needs your own PAT." onSubmit={finish} primary="Continue" onSkip={onSkip} onBack={onBack} busy={busy || !data} ready={!!data}>
      {data?.clientsProblem && <p className="muted">{data.clientsProblem}</p>}
      {data && !data.clientsProblem && data.clients.length === 0 && (
        <p className="setup-note">No clients list you in Dataverse yet. Ask your manager (or whoever runs Dataverse at Cooptimize) to add you as an Account Worker on your clients; they'll show up here and in Settings › Clients.</p>
      )}
      {data && data.clients.length > 0 && (
        <ul className="setup-clients">
          {data.clients.map((c) => {
            const pick = c.write ? "write" : (choice[c.key] ?? "read");
            return (
              <li key={c.key} className="setup-client">
                <div className="setup-client-head">
                  <strong>{c.name}</strong>
                  {c.write ? (
                    <span className="state live">DevOps write access on, as {c.write.name}</span>
                  ) : (
                    <span className="setup-choice" role="group" aria-label={`DevOps for ${c.name}`}>
                      <button type="button" className={`mini${pick === "write" ? " primary" : " quiet"}`} aria-pressed={pick === "write"} onClick={() => setChoice({ ...choice, [c.key]: "write" })}>
                        Add DevOps write access
                      </button>
                      <button type="button" className={`mini${pick === "read" ? " primary" : " quiet"}`} aria-pressed={pick === "read"} onClick={() => setChoice({ ...choice, [c.key]: "read" })}>
                        Read only for now
                      </button>
                    </span>
                  )}
                </div>
                {!c.write && pick === "write" && <PatBox client={c} onSaved={() => void load()} />}
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}

/** Where a DevOps organization's PATs are made. */
export const patPage = (org: string) => `https://dev.azure.com/${encodeURIComponent(org)}/_usersSettings/tokens`;

/** Paste a PAT; Check and save reads back whose it is; the PAT is never shown again. A failed check saves nothing. */
function PatBox({ client: c, onSaved }: { client: SetupClient; onSaved: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!c.org) return <p className="muted setup-pat">DevOps isn't set up for {c.name} in Dataverse yet, so there's nowhere to write. Read only for now; ask whoever runs Dataverse to add its DevOps organization.</p>;
  const check = async () => {
    const pat = ref.current?.value.trim() ?? "";
    if (!pat) return setError("Paste the PAT first");
    setBusy(true);
    setError(null);
    try {
      await call("devops.set_write_pat", { clientKey: c.key, pat });
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      // Never shown again, saved or not.
      if (ref.current) ref.current.value = "";
      setBusy(false);
    }
  };
  return (
    <div className="setup-pat">
      <ol>
        <li>
          Make a PAT on{" "}
          <a href={patPage(c.org)} target="_blank" rel="noreferrer">
            DevOps › Personal access tokens ({c.org})
          </a>
          .
        </li>
        <li>
          Scopes: <strong>Work Items: Read &amp; write</strong>. Nothing else. Organization: {c.org}.
        </li>
        <li>Paste it here. FocusTime checks it's yours before saving it, and never shows it again.</li>
      </ol>
      <div className="setup-row">
        <input
          ref={ref}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          placeholder="Paste your PAT"
          aria-label={`DevOps write PAT for ${c.name} (masked)`}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              void check();
            }
          }}
        />
        <button type="button" className="mini primary" disabled={busy} onClick={() => void check()}>
          {busy ? "Checking…" : "Check and save"}
        </button>
      </div>
      {error && (
        <p className="field-problem" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type BlockRow = { day: string; half: string; client: string };

function BlocksStep({ onSaved, onSkip, onBack }: { onSaved: () => Promise<void>; onSkip: () => void; onBack: () => void }) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [rows, setRows] = useState<BlockRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    call<SettingsData>("settings.load", {})
      .then((d) => {
        setSettings(d);
        setRows(d.standingBlocks.map((b) => ({ day: b.day, half: b.half, client: b.clientKey })));
      })
      .catch(() => null);
  }, []);
  const keys = settings?.clients.map((c) => c.key) ?? [];
  const before = settings?.standingBlocks.length ?? 0;
  const save = async () => {
    // Nothing added or changed: Skip is the default.
    if (rows.length === 0 && before === 0) return onSkip();
    setBusy(true);
    setStatus(null);
    try {
      await call("settings.save", { section: "standing", values: { blocks: rows } });
      await onSaved();
    } catch (e) {
      setStatus(`Not saved: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title="Standing blocks"
      intro="Optional. A half-day that's always the same client (Internal on Monday mornings, say), shown when Dataverse has no focus block there."
      onSubmit={save}
      primary={rows.length === 0 && before === 0 ? "Skip" : "Save and continue"}
      onBack={onBack}
      {...(rows.length || before ? { onSkip } : {})}
      busy={busy}
      status={status}
      ready={!!settings}
    >
      {rows.map((r, i) => (
        <div key={i} className="set-row">
          <select value={r.day} aria-label="Day" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))}>
            {["Mon", "Tue", "Wed", "Thu"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select value={r.half} aria-label="Half" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, half: e.target.value } : x)))}>
            <option>AM</option>
            <option>PM</option>
          </select>
          <select value={r.client} aria-label="Client" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, client: e.target.value } : x)))}>
            {[...new Set([r.client, ...keys])].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button type="button" className="mini quiet" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="mini" onClick={() => setRows([...rows, { day: "Mon", half: "AM", client: keys[0] ?? "Internal" }])}>
          Add a standing block
        </button>
      </div>
    </Screen>
  );
}

function CalendarsStep({ connected, onConnect, onDone, onSkip, onBack }: { connected: boolean; onConnect: () => void; onDone: () => Promise<void>; onSkip: () => void; onBack: () => void }) {
  return (
    <Screen
      title="Calendars"
      intro="Optional. Outlook is already connected through your sign-in. Connect a personal Google Calendar to see school runs and appointments next to your blocks; FocusTime only reads it."
      onSubmit={connected ? onDone : onSkip}
      primary={connected ? "Continue" : "Skip"}
      onBack={onBack}
    >
      {connected ? (
        <p className="state live">Google Calendar is connected.</p>
      ) : (
        <div>
          <button type="button" className="mini" onClick={onConnect}>
            Connect Google Calendar
          </button>
        </div>
      )}
    </Screen>
  );
}

function DoneStep({ view, onPlanWeek, onGuide, onBack }: { view: SetupView | null; onPlanWeek: () => void; onGuide: () => void; onBack: () => void }) {
  const left = view?.line?.text ?? null;
  return (
    <Screen title="You're set up" intro={left ? `${left}. Day keeps a line to finish them, and Settings › Setup runs this again.` : "Settings › Setup runs this again whenever you like."} onSubmit={onPlanWeek} primary="Plan your week" onBack={onBack}>
      <p>
        New here? The{" "}
        <a
          href="#/guide"
          onClick={(e) => {
            e.preventDefault();
            onGuide();
          }}
        >
          Guide
        </a>{" "}
        walks through a week in a few minutes.
      </p>
    </Screen>
  );
}
