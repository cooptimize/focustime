// Step 15.4: who Coopilot works for (one Microsoft sign-in) and my Azure VM. The sign-in screen on first open and after
// sign-out, the person in the top bar, the VM chip (top bar and Today) with Start, Stop and the auto-shutdown choices,
// their preview, Today's morning prompt and "still changed" warning, Settings > You (sign out, find and confirm my VM)
// and the Azure write log in Settings > Data.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuthStatus, AzureWriteEntry, Person, TeamsStatusEntry, VmPreview, VmPreviewOp, VmStatus } from "../actions/account-types.ts";
import type { TeamsStatusView } from "../actions/types.ts";
import { ActionRefusal, call } from "./api.ts";
import { MenuCtx } from "./Menus.tsx";
import type { MenuItem, MenuStep } from "./menu.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";

const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

// ---- Sign-in ----

type AuthApi = { status: AuthStatus | null; refresh: () => Promise<void>; signIn: (azure?: boolean, teams?: boolean) => Promise<string | null>; signOut: () => Promise<void> };
export const AuthCtx = createContext<AuthApi>({ status: null, refresh: async () => {}, signIn: async () => null, signOut: async () => {} });

/** Shows the sign-in screen until someone is signed in (when a Microsoft app registration is set up); then the app. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setStatus(await call<AuthStatus>("auth.status", {}));
    } catch {
      // The app shows what's wrong (a stale launch link, a stopped server).
      setFailed(true);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);
  const [offline, setOffline] = useState(false);
  const signIn = useCallback(async (azure = true, teams = false) => {
    const r = await call<{ status: string; message?: string; offline?: boolean }>("auth.sign_in", { azure, ...(teams ? { teams } : {}) });
    setOffline(!!r.offline);
    await refresh();
    return r.status === "connected" ? null : (r.message ?? "Sign-in not completed");
  }, [refresh]);
  const signOut = useCallback(async () => {
    await call("auth.sign_out", {});
    setSkipped(false);
    await refresh();
  }, [refresh]);
  const api = useMemo(() => ({ status, refresh, signIn, signOut }), [status, refresh, signIn, signOut]);
  if (!status && !failed) return <div className="center-note"><p>Loading…</p></div>;
  // Q88 (step 15.5): real data needs the sign-in. Without it: the demo, or, when Microsoft can't be reached, offline use.
  if (status?.configured && status.state === "signed_out" && !skipped)
    return <SignInScreen status={status} signIn={signIn} offline={offline || (typeof navigator !== "undefined" && navigator.onLine === false)} onSkip={() => setSkipped(true)} />;
  return <AuthCtx.Provider value={api}>{children}</AuthCtx.Provider>;
}

function SignInScreen({ status, signIn, offline, onSkip }: { status: AuthStatus; signIn: (azure?: boolean) => Promise<string | null>; offline: boolean; onSkip: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(status.message);
  return (
    <main className="signin">
      <div className="signin-card">
        <span className="logo signin-logo" aria-hidden="true" />
        <h1>Coopilot</h1>
        <p>Sign in with your Microsoft work account. Coopilot uses it for your calendar and your Azure VM, and to find you in Dataverse.</p>
        <button
          type="button"
          className="top-btn primary signin-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              setMessage(await signIn(true));
            } catch (e) {
              setMessage(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Waiting for your browser…" : "Sign in with Microsoft"}
        </button>
        {busy && <p className="muted">Your browser opened Microsoft's sign-in page. Come back here when it says you can close the tab.</p>}
        {message && <p className="set-problem" role="alert">{message}</p>}
        <p className="set-hint">The first time, Microsoft asks you to allow calendar and Azure access for Coopilot Desktop. Tokens stay in your keyring on this computer.</p>
        <div className="signin-alt">
          <button type="button" className="link-btn muted" onClick={() => void call("demo.set", { on: true }).then(() => location.reload(), (e: unknown) => setMessage(errText(e)))}>Try the demo (fictional data)</button>
          {offline && <button type="button" className="link-btn muted signin-skip" onClick={onSkip}>Continue offline</button>}
        </div>
        {offline && <p className="set-hint">Offline: Coopilot shows your local plan and what it saved from the last sign-in. Sign in when you're back online.</p>}
      </div>
    </main>
  );
}

/** The signed-in person in the top bar: initials, name on hover; opens Settings > You. */
/**
 * Step 16.2: my initials at the right of the top bar, with a menu: Settings and Sign out (or Sign in). Without a
 * sign-in configured it still opens Settings, so Settings is always one click away.
 */
export function PersonChip({ onOpen, onSettings }: { onOpen: (at: { x: number; y: number }, step: MenuStep) => void; onSettings: () => void }) {
  const { status, signIn, signOut } = useContext(AuthCtx);
  const p: Person | null = status?.person ?? null;
  const signedIn = status?.state === "signed_in" || status?.state === "unavailable";
  const label = !status?.configured ? "Settings" : p ? `Signed in as ${p.name}${status.state === "unavailable" ? " (offline)" : ""}` : "Not signed in";
  return (
    <button
      type="button"
      className="person-chip"
      aria-haspopup="menu"
      title={p ? `${p.name} (${p.username}): Settings and Sign out` : "Settings (,)"}
      aria-label={`${label}. Menu: Settings${status?.configured ? (signedIn ? ", Sign out" : ", Sign in") : ""}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const items: MenuItem[] = [{ id: "settings", label: "Settings", hint: ",", run: onSettings }];
        if (status?.configured && signedIn) items.push({ id: "signout", label: "Sign out", action: "auth.sign_out", run: () => void signOut() });
        else if (status?.configured) items.push({ id: "signin", label: "Sign in", run: () => void signIn() });
        onOpen({ x: r.right, y: r.bottom + 4 }, { title: p ? p.name : "You", items });
      }}
    >
      {p ? p.initials : status?.configured ? "?" : "Me"}
    </button>
  );
}

// ---- My VM ----

type VmApi = { status: VmStatus | null; refresh: (fresh?: boolean) => Promise<void>; act: (op: VmPreviewOp, anchor?: { x: number; y: number }) => void; openMenu: (at: { x: number; y: number }) => void };
export const VmCtx = createContext<VmApi>({ status: null, refresh: async () => {}, act: () => {}, openMenu: () => {} });

export const VM_MENU_EVENT = "coopilot:vm-menu";
const TONE: Record<string, string> = { running: "ok", deallocated: "off", billing: "warn", starting: "busy", stopping: "busy", unknown: "off" };

/** Holds my VM's status for the window: refreshed every 60 s while visible, every 10 s while it starts or stops. */
export function VmProvider({ children, onSettings }: { children: ReactNode; onSettings: () => void }) {
  const { status: auth, signIn } = useContext(AuthCtx);
  const signedIn = auth?.state === "signed_in" || auth?.state === "unavailable";
  const [status, setStatus] = useState<VmStatus | null>(null);
  const [preview, setPreview] = useState<VmPreview | null>(null);
  const { open } = useContext(MenuCtx);
  const timer = useRef<number | null>(null);
  const refresh = useCallback(async (fresh = false) => {
    try {
      setStatus(await call<VmStatus>("vm.status", fresh ? { fresh: true } : {}));
    } catch {
      /* keeps the last status */
    }
  }, []);
  useEffect(() => {
    if (!signedIn) return setStatus(null);
    void refresh();
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [signedIn, refresh]);
  // The next refresh, at the pace the status asks for (only while the window is visible).
  useEffect(() => {
    if (!status?.vm) return;
    timer.current = window.setTimeout(() => document.visibilityState === "visible" ? void refresh() : undefined, status.refreshMs);
    return () => void (timer.current !== null && window.clearTimeout(timer.current));
  }, [status, refresh]);

  const act = useCallback((op: VmPreviewOp) => {
    void call<VmPreview>("vm.preview", { op, ...(status?.vm ? { vmId: status.vm.id } : {}) }).then(setPreview, (e: unknown) => notify(errText(e)));
  }, [status]);
  const openMenu = useCallback((at: { x: number; y: number }) => {
    const s = status;
    const items: MenuItem[] = [];
    if (s?.vm) {
      if (s.canStart) items.push({ id: "start", label: "Start", action: "vm.preview", run: () => act("start") });
      if (s.canStop) items.push({ id: "stop", label: "Stop (deallocate)…", action: "vm.preview", danger: true, run: () => act("deallocate") });
      if (s.schedule) {
        const off = s.schedule.status === "Disabled" ? "Auto-shutdown is already off tonight" : undefined;
        items.push({ id: "d1", label: "Delay shutdown 1h", group: "Auto-shutdown", action: "vm.preview", ...(off ? { disabled: off } : {}), run: () => act("delay60") });
        items.push({ id: "d2", label: "Delay shutdown 2h", group: "Auto-shutdown", action: "vm.preview", ...(off ? { disabled: off } : {}), run: () => act("delay120") });
        items.push({ id: "skip", label: "Skip tonight", group: "Auto-shutdown", action: "vm.preview", ...(off ? { disabled: off } : {}), run: () => act("skip") });
      }
      if (s.change) items.push({ id: "restore", label: "Restore auto-shutdown", group: "Auto-shutdown", hint: s.change.text, action: "vm.preview", run: () => act("restore") });
      if (s.needsConsent) items.push({ id: "consent", label: "Allow Azure access…", run: () => void signIn(true).then((m) => (m ? notify(m) : void refresh(true))) });
      items.push({ id: "refresh", label: "Refresh", run: () => void refresh(true) });
    }
    items.push({ id: "choose", label: s?.vm ? "Choose another VM…" : "Find my VM…", action: "vm.choose", run: onSettings });
    open(at, { title: s?.vm ? `${s.vm.name}: ${s.label ?? "Unknown"}` : "My VM", items });
  }, [status, act, open, onSettings, refresh, signIn]);
  const api = useMemo(() => ({ status, refresh, act, openMenu }), [status, refresh, act, openMenu]);
  // The command menu's VM commands open this menu (top right, under the chip).
  useEffect(() => {
    const on = () => {
      const chip = document.querySelector<HTMLElement>(".topbar .vm-chip");
      const r = chip?.getBoundingClientRect();
      openMenu(r ? { x: r.left, y: r.bottom + 4 } : { x: window.innerWidth - 320, y: 56 });
    };
    window.addEventListener(VM_MENU_EVENT, on);
    return () => window.removeEventListener(VM_MENU_EVENT, on);
  }, [openMenu]);
  return (
    <VmCtx.Provider value={api}>
      {children}
      {preview && (
        <VmPreviewDialog
          p={preview}
          onClose={() => setPreview(null)}
          onDone={(msg) => {
            setPreview(null);
            notify(msg);
            void refresh(true);
          }}
        />
      )}
    </VmCtx.Provider>
  );
}

const DONE: Record<VmPreviewOp, string> = {
  start: "Starting your VM. Coopilot follows it until it's running",
  deallocate: "Stopping your VM. Coopilot follows it until it's deallocated",
  delay60: "Auto-shutdown delayed 1 hour. It goes back tomorrow morning",
  delay120: "Auto-shutdown delayed 2 hours. It goes back tomorrow morning",
  skip: "Auto-shutdown skipped tonight. It goes back tomorrow morning",
  restore: "Auto-shutdown restored",
};

function VmPreviewDialog({ p, onClose, onDone }: { p: VmPreview; onClose: () => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cap-dialog vm-preview" data-overlay="modal" role="dialog" aria-modal="true" aria-label={p.title} onKeyDown={(e) => e.key === "Escape" && !busy && (e.stopPropagation(), onClose())}>
        <div className="cap-dialog-head">
          <h2>{p.title}</h2>
          <span className="muted">{p.vm}</span>
        </div>
        {p.warning && <p className="vm-warning" role="alert">{p.warning}</p>}
        <dl className="vm-change">
          {p.lines.map((l) => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd><span className="muted">{l.before}</span> <span aria-hidden="true">→</span><span className="sr-only">to</span> <strong>{l.after}</strong></dd>
            </div>
          ))}
        </dl>
        <ul className="vm-notes">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        {error && <p className="set-problem" role="alert">{error}</p>}
        <div className="wd-actions">
          <button
            ref={first}
            type="button"
            className={`commit${p.op === "deallocate" ? " danger" : ""}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await call("vm.confirm", { previewId: p.previewId });
                onDone(DONE[p.op]);
              } catch (e) {
                setError(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : p.confirmLabel}
          </button>
          <button type="button" className="mini quiet" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
        <p className="set-hint">Logged in Settings &gt; Data. {p.op === "start" || p.op === "deallocate" ? "No undo: use the opposite action instead." : "Coopilot puts the schedule back itself."}</p>
      </div>
    </div>
  );
}

/**
 * The VM chip (step 16.3: the single place for VM status, in the header on every tab): "VM Running · off at 7:30 PM".
 * Opens the VM menu: Start, Stop, Delay 1h / 2h, Skip tonight, Restore, Allow Azure access.
 */
export function VmChip() {
  const { status, openMenu } = useContext(VmCtx);
  if (!status?.vm) return null;
  const chip = status.chip ?? "unknown";
  const text = status.text ?? status.label ?? "Unknown";
  const extra = [status.change?.text, status.needsConsent ? "Coopilot needs your OK to use Azure: open this menu and choose Allow Azure access" : status.error?.message].filter(Boolean).join(". ");
  return (
    <button
      type="button"
      className={`vm-chip vm-${TONE[chip]}`}
      aria-haspopup="menu"
      title={`${status.vm.name} (${status.vm.resourceGroup}): ${text}${extra ? `. ${extra}` : ""}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openMenu({ x: r.left, y: r.bottom + 4 });
      }}
    >
      <span className="vm-dot" aria-hidden="true" />
      <span className="vm-word">VM</span> <span className="vm-label">{text}</span>
      {status.needsConsent && <span className="vm-attn" aria-hidden="true">!</span>}
    </button>
  );
}

/**
 * Today (step 16.3): only the prompts that need me now. The morning "Your VM is off. Start it?" box, and the
 * "Auto-shutdown is still changed" warning after a restore failed. Everything else is on the header chip.
 */
export function VmToday() {
  const { status, refresh, act } = useContext(VmCtx);
  const [busy, setBusy] = useState(false);
  if (!status?.vm) return null;
  return (
    <>
      {status.stillChanged && status.change && (
        <div className="vm-banner vm-banner-warn" role="alert">
          <strong>Auto-shutdown is still changed</strong>
          <span>{status.change.text}.{status.change.message ? ` Coopilot couldn't put it back: ${status.change.message}.` : ""}</span>
          <button
            type="button"
            className="mini primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await call<{ message: string }>("vm.restore", { vmId: status.vm!.id });
                notify(r.message);
              } catch (e) {
                notify(errText(e));
              } finally {
                setBusy(false);
                void refresh(true);
              }
            }}
          >
            Restore
          </button>
        </div>
      )}
      {status.prompt && (
        <div className="vm-banner">
          <strong>Your VM is off. Start it?</strong>
          <span className="muted">{status.vm.name} · {status.label}</span>
          <button
            type="button"
            className="mini primary"
            disabled={busy}
            onClick={async () => {
              // Step 15.5 (Q87): one click when Settings > You says so (this box names the VM and says it starts; the
              // start is logged and read back like any other); else the usual preview.
              if (!status.startWithoutAsking) return act("start");
              setBusy(true);
              try {
                await call("vm.start_now", { vmId: status.vm!.id });
                notify(DONE.start);
              } catch (e) {
                // The setting changed since this status was read: show the preview after all.
                if (e instanceof ActionRefusal && e.code === "ask_first") act("start");
                else notify(errText(e));
              } finally {
                setBusy(false);
                void refresh(true);
              }
            }}
          >
            Start
          </button>
          <button type="button" className="mini quiet" onClick={() => void call("vm.dismiss_prompt", {}).then(() => refresh())}>Not today</button>
        </div>
      )}
    </>
  );
}

// ---- Settings > You ----

type Found = { tag: string; value: string; vms: { id: string; name: string; resourceGroup: string; location: string; power: string }[]; chosen: string | null };

export function YouAccount() {
  const { status, signIn, signOut } = useContext(AuthCtx);
  const vm = useContext(VmCtx);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [manual, setManual] = useState("");
  const [consent, setConsent] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await f();
    } catch (e) {
      if (e instanceof ActionRefusal && e.code === "consent") setConsent(true);
      setMessage(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const choose = (vmId: string | null) => run(async () => {
    await call("vm.choose", { vmId });
    setFound(null);
    setManual("");
    await vm.refresh(true);
    notify(vmId ? "This VM is yours in Coopilot" : "VM choice cleared");
  });
  if (!status?.configured) return <p className="muted">Microsoft sign-in needs the Coopilot Desktop app registration: set [outlook] client_id in config.</p>;
  const p = status.person;
  const signedIn = status.state !== "signed_out";
  return (
    <div className="set-account">
      <div className="set-field">
        <span className="set-label">Signed in</span>
        <span className="set-value">{p && signedIn ? <>{p.name} <span className="muted">{p.username}</span></> : <span className="muted">Not signed in</span>}</span>
        <span className="set-hint">{status.state === "unavailable" ? `Offline or keyring locked: showing who was signed in. ${status.message ?? ""}` : "One Microsoft sign-in for you, your calendar and your Azure VM."}</span>
        <span className="set-actions">
          {signedIn ? (
            <button type="button" className="mini" disabled={busy} onClick={() => void run(signOut)}>Sign out</button>
          ) : (
            <button type="button" className="mini primary" disabled={busy} onClick={() => void run(async () => setMessage(await signIn(true)))}>Sign in with Microsoft</button>
          )}
        </span>
        {signedIn && <span className="set-hint">Sign out removes the sign-in from your keyring on this computer. Your local plan stays.</span>}
      </div>
      {signedIn && (
        <div className="set-field set-vm">
          <span className="set-label">My VM</span>
          <span className="set-value">
            {vm.status?.vm ? <>{vm.status.vm.name} <span className="muted">{vm.status.vm.resourceGroup} · {vm.status.vm.location}</span></> : <span className="muted">None chosen yet</span>}
          </span>
          <span className="set-hint">Coopilot only reads its state, starts it, stops (deallocates) it and changes its auto-shutdown, and only for this VM.</span>
          <span className="set-actions">
            <button type="button" className="mini" disabled={busy} onClick={() => void run(async () => setFound(await call<Found>("vm.find", {})))}>Find my VM</button>
            {vm.status?.vm && <button type="button" className="mini quiet" disabled={busy} onClick={() => void choose(null)}>Forget</button>}
            {(consent || vm.status?.needsConsent) && (
              <button type="button" className="mini primary" disabled={busy} onClick={() => void run(async () => {
                const m = await signIn(true);
                setMessage(m);
                if (!m) {
                  setConsent(false);
                  await vm.refresh(true);
                }
              })}>Allow Azure access</button>
            )}
          </span>
          {found && (
            <div className="vm-found">
              <p className="muted">VMs tagged {found.tag} = “{found.value}” in the Azure subscriptions you can see:</p>
              {found.vms.length === 0 ? (
                <p>None found. Check the tag on your VM, or enter its resource ID below.</p>
              ) : (
                <ul>
                  {found.vms.map((v) => (
                    <li key={v.id}>
                      <strong>{v.name}</strong> <span className="muted">{v.resourceGroup} · {v.location}</span>{" "}
                      {found.chosen?.toLowerCase() === v.id.toLowerCase() ? <span className="muted">Your VM</span> : <button type="button" className="mini primary" disabled={busy} onClick={() => void choose(v.id)}>This is my VM</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <form className="vm-manual" onSubmit={(e) => (e.preventDefault(), manual.trim() && void choose(manual.trim()))}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="/subscriptions/…/resourceGroups/…/providers/Microsoft.Compute/virtualMachines/…" aria-label="VM resource ID" spellCheck={false} />
            <button type="submit" className="mini" disabled={busy || !manual.trim()}>Use this VM</button>
          </form>
          <span className="set-hint">Finds VMs by the Owner tag with your display name. Change the tag in config.toml ([azure] owner_tag, owner_value).</span>
        </div>
      )}
      {message && <p className="set-problem" role="alert">{message}</p>}
    </div>
  );
}

// ---- Settings > Data ----

const AZ_OP: Record<AzureWriteEntry["op"], string> = { start: "Started", deallocate: "Stopped (deallocated)", shutdown_change: "Changed auto-shutdown", shutdown_restore: "Restored auto-shutdown" };
const AZ_STATUS: Record<AzureWriteEntry["status"], string> = { pending: "In progress", confirmed: "Confirmed", failed: "Failed", timed_out: "Timed out", refused: "Refused" };
const sched = (v: unknown) => {
  const o = v as { time?: string; status?: string; power?: string } | null;
  if (!o) return "";
  if (o.power) return o.power;
  if (o.status === "Disabled") return "Off";
  return o.time ? `${o.time.slice(0, 2)}:${o.time.slice(2)} (schedule time)` : "";
};

export function AzureWriteLog({ tz }: { tz: string }) {
  const [log, setLog] = useState<AzureWriteEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<{ entries: AzureWriteEntry[] }>("vm.log", {}).then((r) => setLog(r.entries), (e: unknown) => setError(errText(e)));
  }, []);
  const stamp = (s: string) => Temporal.Instant.from(s).toZonedDateTimeISO(tz).toPlainDateTime().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section className="write-log" aria-label="Azure write log">
      <h3>Azure write log</h3>
      <p className="muted">Every start, stop and auto-shutdown change on your VM: when, the result and what it was before. Power actions have no undo; the opposite action is in the VM menu.</p>
      {error && <p className="set-problem">{error}</p>}
      {log && !log.length && <p className="muted">Nothing written yet.</p>}
      {log && log.length > 0 && (
        <table className="wl-table">
          <thead>
            <tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Result</th><th scope="col">Before</th></tr>
          </thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id} className={`wl-${e.status === "timed_out" ? "failed" : e.status}`}>
                <td>{stamp(e.at)}</td>
                <td>{AZ_OP[e.op]} <strong>{e.vmName}</strong>{e.auto && <span className="muted"> · automatic</span>}</td>
                <td>{AZ_STATUS[e.status]}{e.attempts > 1 && <span className="muted"> · {e.attempts} tries</span>}{e.message && <div className="muted">{e.message}</div>}</td>
                <td className="muted">{sched(e.before) || "Nothing"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---- Step 16.3: Teams status during focus ----

const TEAMS_OP: Record<TeamsStatusEntry["op"], string> = { set: "Set", clear: "Cleared (back to automatic)", left: "Left as you set it in Teams" };
const TEAMS_WORD: Record<string, string> = { Busy: "Busy", DoNotDisturb: "Do not disturb" };

/** Settings > Data: every time focus set or cleared my Teams status. */
export function TeamsStatusLog({ tz }: { tz: string }) {
  const [log, setLog] = useState<TeamsStatusEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<{ entries: TeamsStatusEntry[] }>("presence.log", {}).then((r) => setLog(r.entries), (e: unknown) => setError(errText(e)));
  }, []);
  const stamp = (s: string) => Temporal.Instant.from(s).toZonedDateTimeISO(tz).toPlainDateTime().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section className="write-log" aria-label="Teams status log">
      <h3>Teams status log</h3>
      <p className="muted">Each time focus set your Teams status (with how long it lasts at most) or put it back to automatic. Only your own status; teammates' presence is never kept.</p>
      {error && <p className="set-problem">{error}</p>}
      {log && !log.length && <p className="muted">Nothing yet.</p>}
      {log && log.length > 0 && (
        <table className="wl-table">
          <thead>
            <tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Result</th></tr>
          </thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id} className={`wl-${e.result === "failed" ? "failed" : "confirmed"}`}>
                <td>{stamp(e.at)}</td>
                <td>{TEAMS_OP[e.op]}{e.status && e.op === "set" ? <> <strong>{TEAMS_WORD[e.status]}</strong></> : null}{e.minutes ? <span className="muted"> · for up to {e.minutes} min</span> : null}</td>
                <td>{e.result === "failed" ? "Failed" : "Done"}{e.message && <div className="muted">{e.message}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Settings > Focus: whether Coopilot can set my Teams status, and Allow Teams status when it needs consent. */
export function TeamsAccessLine() {
  const { signIn } = useContext(AuthCtx);
  const [v, setV] = useState<TeamsStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const check = useCallback(() => void call<TeamsStatusView>("presence.status", { check: true }).then(setV, () => setV(null)), []);
  useEffect(check, [check]);
  if (!v) return <span className="set-hint">Checking Teams…</span>;
  const words: Record<string, string> = {
    ok: "Teams is connected: focus can set your status, and teammates' presence shows next to their names.",
    consent: "Coopilot needs your OK to use Teams status and presence. One more sign-in; no admin approval is needed.",
    signed_out: "Sign in with Microsoft (Settings > You) to use Teams status.",
    unavailable: "Teams can't be reached right now.",
    off: "",
  };
  return (
    <span className="set-teams-access">
      <span className="set-hint">{words[v.access ?? "unavailable"]}</span>
      {v.access === "consent" && (
        <button type="button" className="mini primary" disabled={busy} onClick={async () => {
          setBusy(true);
          const m = await signIn(true, true).catch((e: unknown) => errText(e));
          setMessage(m);
          setBusy(false);
          check();
        }}>Allow Teams status</button>
      )}
      {message && <span className="set-problem" role="alert">{message}</span>}
    </span>
  );
}
