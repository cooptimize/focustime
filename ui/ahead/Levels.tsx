// AH-6: "Show: Epics · Features · Stories", the same control in the Gantt and the Grid: a level for the whole tree (its
// names from the process model), with Expand all and Collapse all in its menu. Per-row carets work on top of it.
import { useContext } from "react";
import type { Tier } from "../../plan/ahead-model.ts";
import { atLevel, collapseAll, expandAll, LEVELS, type Fold } from "../../plan/gantt-tree.ts";
import { MenuCtx } from "../Menus.tsx";
import { Icon } from "../icons.tsx";

export function LevelControl({ fold, setFold, names }: { fold: Fold; setFold: (f: Fold) => void; names: Record<Tier, string> }) {
  const { open } = useContext(MenuCtx);
  const touched = Object.keys(fold.rows).length > 0;
  return (
    <span className="ah-levels">
      <span className="muted ah-levels-word" id="ah-levels-word">
        Show
      </span>
      <span className="rm-seg" role="group" aria-labelledby="ah-levels-word" title={touched ? "Some rows are opened or closed by hand; a level starts them over" : undefined}>
        {LEVELS.map((t) => (
          <button key={t} type="button" aria-pressed={fold.level === t && !touched} data-level={t} className={fold.level === t && touched ? "partly" : undefined} onClick={() => setFold(atLevel(t))} title={`Show down to ${names[t].toLowerCase()}`}>
            {names[t]}
          </button>
        ))}
        <button
          type="button"
          className="ah-levels-more"
          aria-label="More: Expand all, Collapse all"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            open({ x: r.left, y: r.bottom + 4 }, {
              title: "Rows",
              items: [
                { id: "expand-all", label: "Expand all", run: () => setFold(expandAll()) },
                { id: "collapse-all", label: "Collapse all", run: () => setFold(collapseAll()) },
              ],
            });
          }}
        >
          <Icon name="more" />
        </button>
      </span>
    </span>
  );
}
