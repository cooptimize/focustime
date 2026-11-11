// WD-1: Week's client chips, in its one header row. They replace Plan the week's per-client card lines: each chip says
// the room left, "Northwind · 2h free" or "Northwind · 6h over" (amber only when over), with a count of features that
// aren't ready; its popover has the same total (musts plus nice to have), the musts done, what isn't ready (Needs
// stories · Break down) and Keep open for walk-ins. The budget is the Board's and Commit's (planBudget through
// weekMusts), so they never disagree. Chips that don't fit the row collapse into "+N", which opens the rest; they never
// clip (WD-1 review).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { chipsThatFit, clientChip, storiesUnder } from "../plan/addwork.ts";
import { clientColor } from "./labels.ts";
import { weekMusts } from "./WeekMusts.tsx";
import { BreakDown } from "./DetailPanel.tsx";
import { call } from "./api.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";
import { PopupMenu } from "./Menus.tsx";

const KEEP_STEPS = [0, 10, 20, 30, 40, 50] as const;
const MORE = "\u0000more";
const say = (text: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: text }));

export function ClientChips({ data, now, onChanged }: { data: WeekLoadData; now: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  // The popover is placed on the page, under its chip (or under "+N" for a chip opened from it).
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [keepAt, setKeepAt] = useState<{ x: number; y: number; k: string; name: string; pct: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState<number | null>(null);
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
  const notReady = (k: string) => {
    const w = work.get(k);
    if (!w) return [];
    return m.items.filter((i) => i.clientKey === k && i.level === "feature" && !i.done && storiesUnder(w, i.itemId).length === 0);
  };
  const chips = keys.map((k) => {
    const fit = m.fits.find((f) => f.clientKey === k);
    const row = m.rows.find((r) => r.clientKey === k);
    const name = fit?.clientName ?? row?.name ?? k;
    const nr = notReady(k);
    // One total everywhere: musts plus nice to have.
    const c = clientChip({ name, plannedMinutes: (fit?.plannedMinutes ?? 0) + (fit?.nicePlannedMinutes ?? 0), freeMinutes: fit?.freeMinutes ?? 0, notReady: nr.length });
    return { k, fit, row, name, nr, c };
  });
  const sig = chips.map((x) => `${x.c.text}|${x.c.badge ?? ""}`).join("\n");

  // Measure every chip in a hidden copy and show the ones that fit the row's width; the rest go under "+N".
  useLayoutEffect(() => {
    const el = box.current;
    const ms = measure.current;
    if (!el || !ms) return;
    const fitNow = () => {
      const widths = [...ms.querySelectorAll<HTMLElement>("[data-chip]")].map((x) => x.getBoundingClientRect().width);
      const more = ms.querySelector<HTMLElement>("[data-more]")?.getBoundingClientRect().width ?? 40;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 6;
      const n = chipsThatFit(widths, el.clientWidth, gap, more);
      setShown((s) => (s === n ? s : n));
    };
    fitNow();
    const ro = new ResizeObserver(fitNow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sig]);

  if (!keys.length) return null;
  const visible = chips.slice(0, shown ?? chips.length);
  const rest = chips.slice(shown ?? chips.length);
  const keepOpen = (k: string, name: string, pct: number) =>
    void call("settings.save", { section: "keep_open", values: { key: k, percent: pct } }).then(
      () => (say(pct ? `Keeping ${pct}% of ${name}'s hours open for walk-ins` : `Planning all of ${name}'s hours`), onChanged()),
      (e: unknown) => say(e instanceof Error ? e.message : "Couldn't save that"),
    );
  const place = (el: HTMLElement, width = 316) => {
    const r = el.getBoundingClientRect();
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width)) });
  };
  const chipButton = (x: (typeof chips)[number], under: () => HTMLElement | null = () => null) => (
    <button
      key={x.k}
      type="button"
      className={`cc-chip${x.c.over ? " over" : ""}`}
      style={{ "--c": clientColor(x.k, data.clients) } as CSSProperties}
      aria-expanded={open === x.k}
      onClick={(e) => {
        place(under() ?? e.currentTarget);
        setKeepAt(null);
        setOpen((o) => (o === x.k ? null : x.k));
      }}
      title={x.c.detail}
    >
      <span className="swatch" aria-hidden="true" />
      {x.c.text}
      {x.c.badge !== null && <span className="cc-badge" title={`${x.c.badge} not ready`}>{x.c.badge}</span>}
    </button>
  );
  const opened = chips.find((x) => x.k === open) ?? null;
  return (
    <div className="client-chips" ref={box} role="group" aria-label="Clients this week">
      <div className="cc-measure" ref={measure} aria-hidden="true">
        {chips.map((x) => (
          <span key={x.k} data-chip className={`cc-chip${x.c.over ? " over" : ""}`}>
            <span className="swatch" />
            {x.c.text}
            {x.c.badge !== null && <span className="cc-badge">{x.c.badge}</span>}
          </span>
        ))}
        <span data-more className="cc-chip cc-more">+{chips.length}</span>
      </div>
      {visible.map((x) => chipButton(x))}
      {rest.length > 0 && (
        <button
          ref={moreBtn}
          type="button"
          className={`cc-chip cc-more${rest.some((x) => x.c.over) ? " over" : ""}`}
          aria-expanded={open === MORE}
          aria-label={`${rest.length} more ${rest.length === 1 ? "client" : "clients"}`}
          title={rest.map((x) => x.c.text).join(", ")}
          onClick={(e) => {
            place(e.currentTarget, 260);
            setOpen((o) => (o === MORE ? null : MORE));
          }}
        >
          +{rest.length}
        </button>
      )}
      {open === MORE && (
        <div className="cc-pop cc-rest" role="dialog" aria-label="More clients" style={at ? { top: at.top, left: at.left } : undefined}>
          {rest.map((x) => chipButton(x, () => moreBtn.current))}
        </div>
      )}
      {opened && (
        <div className="cc-pop" role="dialog" aria-label={opened.name} style={at ? { top: at.top, left: at.left } : undefined}>
          <h3>{opened.name}</h3>
          <p className={opened.c.over ? "cc-over" : undefined}>
            {opened.c.room} · {opened.c.detail}
          </p>
          {opened.row && opened.row.musts > 0 && (
            <p>
              {/* One total (WD-1 review): the hours are on the line above, so this line counts musts only. */}
              {opened.row.done} of {opened.row.musts} musts done
            </p>
          )}
          {opened.nr.length > 0 && (
            <>
              <h4 className="pl-label">Not ready</h4>
              <ul className="cc-ready">
                {opened.nr.map((f) => (
                  <li key={f.itemId}>
                    <span className="cc-ready-title">{f.title}</span>
                    <span className="aw-needs">
                      <span className="aw-needs-word">Needs stories</span>
                      <BreakDown clientKey={opened.k} item={{ id: f.itemId, title: f.title }} short />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {opened.fit && (
            <div className="cc-keep">
              <span>Keep open for walk-ins</span>
              <button
                type="button"
                className="mini cc-keep-btn"
                aria-haspopup="menu"
                aria-label={`Keep open for walk-ins: ${opened.fit.keepOpen ? `${opened.fit.keepOpen}%` : "None"}`}
                title={`The share of ${opened.name}'s block hours left unplanned, for work that walks in`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setKeepAt({ x: r.left, y: r.bottom + 4, k: opened.k, name: opened.name, pct: opened.fit?.keepOpen ?? 0 });
                }}
              >
                {opened.fit.keepOpen ? `${opened.fit.keepOpen}%` : "None"} ▾
              </button>
            </div>
          )}
          {keepAt && keepAt.k === opened.k && (
            <PopupMenu
              at={{ x: keepAt.x, y: keepAt.y }}
              step={{
                title: "Keep open for walk-ins",
                items: KEEP_STEPS.map((v) => ({ id: `keep-${v}`, label: v ? `${v}%` : "None", checked: v === keepAt.pct, run: () => keepOpen(keepAt.k, keepAt.name, v) })),
              }}
              onClose={() => setKeepAt(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
