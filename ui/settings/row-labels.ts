// SA-4, shared in SA-5: a table on the phone is drawn as rows, each cell under its column's name. This writes each
// cell's column name as data-label; parts.css shows it before the value on the phone (Settings and Admin alike).
import { useEffect } from "react";

export function useRowLabels(root: () => HTMLElement | null, key: string) {
  useEffect(() => {
    const el = root();
    if (!el) return;
    const label = () => {
      for (const t of el.querySelectorAll<HTMLTableElement>("table")) {
        const heads = [...t.querySelectorAll<HTMLTableCellElement>("thead th")].map((h) => h.textContent?.trim() ?? "");
        for (const tr of t.querySelectorAll<HTMLTableRowElement>("tbody tr")) {
          [...tr.cells].forEach((c, i) => {
            if (c.colSpan === 1 && heads[i] && c.getAttribute("data-label") !== heads[i]) c.setAttribute("data-label", heads[i]!);
          });
        }
      }
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
