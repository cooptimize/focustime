// UI-5's search in a panel's rail, shared by the Guide and the Technical docs (DOC-1): the box at the rail's top and
// its results in place of the rail while typing. Esc clears the box first (the panel's Esc closes after), Enter goes
// to the first result, the arrow keys move between the box and the results. Styles: .ps-search (ui/styles.css) and
// .gsr (./search.css, imported here, so the docs need none of the Guide's styles).
import "./search.css";

/** Entries with every typed word, ones whose title has them all first; at most `max`. */
export function searchEntries<T extends { title: string; text: string }>(q: string, index: readonly T[], max = 20): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  const hits = index.filter((h) => has(`${h.title} ${h.text}`));
  return [...hits.filter((h) => has(h.title)), ...hits.filter((h) => !has(h.title))].slice(0, max);
}

export function SearchBox({ q, setQ, first, label, placeholder }: { q: string; setQ: (s: string) => void; first: () => void; label: string; placeholder: string }) {
  return (
    <div className="ps-search">
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) (e.preventDefault(), e.stopPropagation(), e.nativeEvent.stopImmediatePropagation(), setQ(""));
          else if (e.key === "Enter") (e.preventDefault(), first());
          else if (e.key === "ArrowDown") (e.preventDefault(), document.querySelector<HTMLElement>(".gsr-hit")?.focus());
        }}
      />
    </div>
  );
}

export type ResultRow = { key: string; title: string; where: string };

/** `label` names the results region ("3 results"); `count` is the line shown above them (or the nothing-found line). */
export function SearchResults({ rows, label, count, onGo }: { rows: readonly ResultRow[]; label: string; count: string; onGo: (i: number) => void }) {
  return (
    <div className="gsr" role="region" aria-label={label}>
      <div className="gsr-count" role="status">
        {count}
      </div>
      {rows.map((h, i) => (
        <button
          key={h.key}
          type="button"
          className="gsr-hit"
          onClick={() => onGo(i)}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            const prev = el.previousElementSibling as HTMLElement | null;
            if (e.key === "ArrowDown") (e.preventDefault(), (el.nextElementSibling as HTMLElement | null)?.focus());
            if (e.key === "ArrowUp") (e.preventDefault(), (prev?.classList.contains("gsr-hit") ? prev : document.querySelector<HTMLElement>(".ps-search input"))?.focus());
          }}
        >
          <span className="gsr-title">{h.title}</span>
          <span className="gsr-in">{h.where}</span>
        </button>
      ))}
    </div>
  );
}
