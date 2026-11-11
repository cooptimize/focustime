// WD-1: Week's client chips, in its one header row. They replace Plan the week's per-client card lines: each chip says
// "Northwind 6h of 8h" (amber when over) with a count of features that aren't ready; its popover has the fit, the
// musts done, what isn't ready (Needs stories · Break down) and Keep open for walk-ins. The budget is the Board's and
// Commit's (planBudget through weekMusts), so they never disagree.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { clientChip, storiesUnder } from "../plan/addwork.ts";
import { clientColor } from "./labels.ts";
import { weekMusts } from "./WeekMusts.tsx";
import { BreakDown } from "./DetailPanel.tsx";
import { call } from "./api.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";

const KEEP_STEPS = [0, 10, 20, 30, 40, 50] as const;
const say = (text: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: text }));

export function ClientChips({ data, now, onChanged }: { data: WeekLoadData; now: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  // The chips scroll sideways in the one header row, so the popover is placed on the page, under its chip.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const m = weekMusts(data, data.weekStart, now);
  const work = new Map((data.devops ?? []).map((w) => [w.clientKey, w]));
  const keys = [...new Set([...m.fits.filter((f) => f.blocks.length > 0).map((f) => f.clientKey), ...m.rows.map((r) => r.clientKey)])];
  if (!keys.length) return null;
  const notReady = (k: string) => {
    const w = work.get(k);
    if (!w) return [];
    return m.items.filter((i) => i.clientKey === k && i.level === "feature" && !i.done && storiesUnder(w, i.itemId).length === 0);
  };
  const keepOpen = (k: string, name: string, pct: number) =>
    void call("settings.save", { section: "keep_open", values: { key: k, percent: pct } }).then(
      () => (say(pct ? `Keeping ${pct}% of ${name}'s hours open for walk-ins` : `Planning all of ${name}'s hours`), onChanged()),
      (e: unknown) => say(e instanceof Error ? e.message : "Couldn't save that"),
    );
  return (
    <div className="client-chips" ref={box} role="group" aria-label="Clients this week">
      {keys.map((k) => {
        const fit = m.fits.find((f) => f.clientKey === k);
        const row = m.rows.find((r) => r.clientKey === k);
        const name = fit?.clientName ?? row?.name ?? k;
        const nr = notReady(k);
        const c = clientChip({ name, plannedMinutes: (fit?.plannedMinutes ?? 0) + (fit?.nicePlannedMinutes ?? 0), freeMinutes: fit?.freeMinutes ?? 0, notReady: nr.length });
        const pct = fit?.keepOpen ?? 0;
        return (
          <span key={k} className="cc-wrap">
            <button type="button" className={`cc-chip${c.over ? " over" : ""}`} style={{ "--c": clientColor(k, data.clients) } as CSSProperties} aria-expanded={open === k} onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 316)) });
                setOpen((o) => (o === k ? null : k));
              }} title={fit ? fit.text : name}>
              <span className="swatch" aria-hidden="true" />
              {c.text}
              {c.badge !== null && <span className="cc-badge" title={`${c.badge} not ready`}>{c.badge}</span>}
            </button>
            {open === k && (
              <div className="cc-pop" role="dialog" aria-label={name} style={at ? { top: at.top, left: at.left } : undefined}>
                <h3>{name}</h3>
                {fit && (
                  <p className={fit.over ? "cc-over" : undefined}>
                    {fit.text}
                    {fit.over ? ` · ${fit.over}` : ""}
                  </p>
                )}
                {row && row.musts > 0 && <p>{row.done} of {row.musts} musts done{row.track ? ` · ${row.track.text}` : ""}</p>}
                {nr.length > 0 && (
                  <>
                    <h4 className="pl-label">Not ready</h4>
                    <ul className="cc-ready">
                      {nr.map((f) => (
                        <li key={f.itemId}>
                          <span className="cc-ready-title">{f.title}</span>
                          <span className="aw-needs">
                            <span className="aw-needs-word">Needs stories</span>
                            <BreakDown clientKey={k} item={{ id: f.itemId, title: f.title }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {fit && (
                  <label className="cc-keep" title={`The share of ${name}'s block hours left unplanned, for work that walks in`}>
                    Keep open for walk-ins
                    <select value={KEEP_STEPS.includes(pct as (typeof KEEP_STEPS)[number]) ? pct : ""} onChange={(e) => keepOpen(k, name, Number(e.target.value))}>
                      {!KEEP_STEPS.includes(pct as (typeof KEEP_STEPS)[number]) && <option value="">{pct}%</option>}
                      {KEEP_STEPS.map((v) => (
                        <option key={v} value={v}>
                          {v ? `${v}%` : "None"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}
