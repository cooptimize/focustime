// SA-4: real tabs for Admin's pages. A tablist of links (each tab has an address, so a tab survives a reload and Back),
// with the keys a tablist has: Left and Right (Up and Down too) move and open, Home and End go to the ends. The panel
// is labelled by its tab. On a phone the row scrolls sideways and the open tab stays in view.
import { useEffect, useRef, type ReactNode } from "react";

export type TabDef = { id: string; label: string; href: string };

export function Tabs({ label, tabs, current, onPick, children }: { label: string; tabs: readonly TabDef[]; current: string; onPick: (id: string) => void; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const base = `adm-tab-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current]);
  const move = (i: number) => {
    const t = tabs[(i + tabs.length) % tabs.length]!;
    onPick(t.id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(t.id)}"]`)?.focus());
  };
  const at = tabs.findIndex((t) => t.id === current);
  return (
    <div className="adm-tabs">
      <div ref={list} className="adm-tablist" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <a
            key={t.id}
            id={`${base}-${t.id}`}
            href={t.href}
            role="tab"
            data-tab={t.id}
            aria-selected={t.id === current}
            aria-controls={`${base}-panel`}
            tabIndex={t.id === current ? 0 : -1}
            className="adm-tab"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onPick(t.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), move(i + 1));
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), move(i - 1));
              else if (e.key === "Home") (e.preventDefault(), move(0));
              else if (e.key === "End") (e.preventDefault(), move(tabs.length - 1));
            }}
          >
            {t.label}
          </a>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={at >= 0 ? `${base}-${current}` : undefined} className="adm-tabpanel">
        {children}
      </div>
    </div>
  );
}
