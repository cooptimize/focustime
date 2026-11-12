// MB-1: the phone's shell pieces. One bottom sheet (focus kept inside, Esc and the backdrop close it, focus returns to
// what opened it), the header's status dot with its sheet (the sources and their state, the VM, Refresh, and Settings
// for Disconnect: the source footer isn't on the phone), and the notice for Ahead, which is made for a bigger screen.
// Phone only (under 600 px, `usePhone`); the desktop never renders these.
import { useEffect, useRef, type ReactNode } from "react";
import type { SourceSummary } from "../actions/types.ts";
import type { ClientWork } from "../week/types.ts";
import { causeLines, notConnected, SOURCE_NAMES, sourceKey, sourceLabel, stateOf } from "./status.ts";
import { devopsSummary, workStatusLabel } from "./work.ts";
import { updatedAgo } from "./refresh.ts";
import { useReturnFocus } from "./CloseButton.tsx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet over the page, above the bottom bar. Tab and Shift+Tab stay inside; Esc, the backdrop and the close
 * button close it; focus goes to its first control on open and back to the opener on close.
 */
export function PhoneSheet({ label, title, onClose, children, className = "" }: { label: string; title?: ReactNode; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useReturnFocus();
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="ph-sheet-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`ph-sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-overlay="modal"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const all = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((x) => x.offsetParent !== null);
          if (!all.length) return;
          const first = all[0]!;
          const last = all[all.length - 1]!;
          if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) (e.preventDefault(), last.focus());
          else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
        }}
      >
        <div className="ph-sheet-grip" aria-hidden="true" />
        <div className="ph-sheet-head">
          <h2 className="ph-sheet-title">{title ?? label}</h2>
          <button type="button" className="ph-sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** How the sources are, as one word for the header dot: all live, something old or waiting, or something failing. */
export type Health = "live" | "stale" | "trouble";
export function sourceHealth(sources: readonly SourceSummary[], devops: readonly ClientWork[] | null): Health {
  if (causeLines(sources, devops).length) return "trouble";
  const st = sources.map((s) => stateOf(s).cls);
  if (st.some((c) => c === "error" || c === "signin")) return "trouble";
  const dv = devopsSummary(devops as ClientWork[] | null);
  if (st.some((c) => c === "cached") || (dv && dv.level !== "live")) return "stale";
  return "live";
}
const HEALTH_WORDS: Record<Health, string> = { live: "All sources live", stale: "Some data is older", trouble: "A source needs attention" };

/** The header's status dot on the phone: its colour says how the sources are; it opens the status sheet. */
export function StatusDot({ health, onOpen, open }: { health: Health; onOpen: () => void; open: boolean }) {
  return (
    <button type="button" className={`top-btn status-dot-btn ${health}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`${HEALTH_WORDS[health]}. Show sources`} onClick={onOpen}>
      <span className="status-dot" aria-hidden="true" />
    </button>
  );
}

/**
 * The status sheet: each source with its state and age, DevOps per client, what needs fixing (Retry, Connect,
 * Reconnect), the VM and the personal-events switch when given, Refresh, and Settings for Disconnect.
 */
export function StatusSheet({ sources, devops, clock, zone, loading, busy, extra, vm, onRefresh, onConnect, onSettings, onClose }: {
  sources: readonly SourceSummary[];
  devops: readonly ClientWork[] | null;
  clock: number;
  zone: string;
  loading: boolean;
  busy: "outlook" | "google" | null;
  /** The "N personal hidden" switch, when personal events are hidden. */
  extra?: ReactNode;
  /** The VM chip (it has its own Start menu); nothing when there is no VM. */
  vm?: ReactNode;
  onRefresh: () => void;
  onConnect: (c: "outlook" | "google") => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const lines = causeLines(sources, devops);
  const dv = devopsSummary(devops as ClientWork[] | null);
  return (
    <PhoneSheet label="Sources" onClose={onClose} className="ph-status">
      {lines.length > 0 && (
        <ul className="ph-status-problems">
          {lines.map((l) => (
            <li key={l.key} role="status">
              <span>{l.text}.</span>
              {l.step && <span className="muted"> {l.step}, then</span>}
              {l.fixes.map((f, i) =>
                f.kind === "replace_link" ? (
                  <button key={i} type="button" className="mini primary" onClick={onSettings}>
                    Replace link
                  </button>
                ) : f.kind === "retry" ? (
                  <button key={i} type="button" className="mini primary" disabled={loading} onClick={onRefresh}>
                    {loading ? "Retrying…" : "Retry"}
                  </button>
                ) : (
                  <button key={i} type="button" className="mini primary" disabled={busy !== null} onClick={() => onConnect(f.calendar)}>
                    {f.kind === "connect" ? "Connect" : "Reconnect"} {SOURCE_NAMES[f.calendar]}
                  </button>
                ),
              )}
            </li>
          ))}
        </ul>
      )}
      <ul className="ph-status-list">
        {sources.map((s) => {
          const st = stateOf(s);
          const detail = s.source === "dataverse" ? `${s.itemCount} ${s.itemCount === 1 ? "pattern" : "patterns"}` : s.source === "pto" ? `${s.itemCount} ${s.itemCount === 1 ? "day" : "days"}` : s.sample || notConnected(s) ? "" : `${s.itemCount} events`;
          return (
            <li key={sourceKey(s)} className={`source ${st.cls}`}>
              <span className="dot" aria-hidden="true" />
              <span className="ph-src-name">{sourceLabel(s)}</span>
              <span className={`state ${st.cls}`}>{st.label}</span>
              <span className="muted ph-src-detail">{[detail, s.fetchedAt ? updatedAgo(s.fetchedAt, clock, zone) : ""].filter(Boolean).join(" · ")}</span>
            </li>
          );
        })}
        {dv && devops && (
          <li className={`source devops ${dv.level === "live" ? "live" : dv.level === "partial" ? "cached" : "error"}`}>
            <span className="dot" aria-hidden="true" />
            <span className="ph-src-name">DevOps</span>
            <span className="state">{dv.label}</span>
            <span className="muted ph-src-detail">{devops.map((c) => `${c.clientName}: ${workStatusLabel(c)}`).join(" · ")}</span>
          </li>
        )}
      </ul>
      {(vm || extra) && (
        <div className="ph-status-extra">
          {vm}
          {extra}
        </div>
      )}
      <div className="ph-status-acts">
        <button type="button" className="primary" onClick={onRefresh} disabled={loading} aria-label="Refresh all sources">
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button type="button" className="link-btn" onClick={onSettings}>
          Connect or disconnect in Settings
        </button>
      </div>
    </PhoneSheet>
  );
}

/** BL-1: the phone's notice for Backlog (was Ahead): made for a bigger screen, with Open anyway (Ahead as it is, read only). */
export function AheadNotice({ onOpen, onToday }: { onOpen: () => void; onToday: () => void }) {
  return (
    <main className="ahead-notice" aria-label="Backlog">
      <h1>Backlog is made for a bigger screen</h1>
      <p className="muted">Grid, Gantt, Gaps and Backlog need room for the whole roadmap. Open FocusTime on a computer to plan ahead.</p>
      <div className="an-acts">
        <button type="button" className="primary" onClick={onOpen}>
          Open anyway
        </button>
        <button type="button" onClick={onToday}>
          Back to Today
        </button>
      </div>
    </main>
  );
}
