// Step 13.5: moving a pick to a day with no working hours asks first. One prompt for every Move (ui/api.ts calls it):
// "Friday has no working hours. Add hours for that day?" with Add hours (opens Settings > Working hours) or Move anyway.
import { useEffect, useRef, useState } from "react";
import { setNoHoursPrompt, type NoHoursChoice } from "./api.ts";

type Ask = { question: string; resolve: (c: NoHoursChoice) => void };

export function NoHoursPrompt({ onAddHours }: { onAddHours: (date: string) => void }) {
  const [ask, setAsk] = useState<(Ask & { date: string }) | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setNoHoursPrompt((question, date) => new Promise<NoHoursChoice>((resolve) => setAsk({ question, date, resolve })));
    return () => setNoHoursPrompt(null);
  }, []);
  useEffect(() => {
    if (ask) first.current?.focus();
  }, [ask]);
  if (!ask) return null;
  const done = (c: NoHoursChoice) => {
    ask.resolve(c);
    setAsk(null);
    if (c === "add") onAddHours(ask.date);
  };
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done("cancel")}>
      <div
        className="cap-dialog nohours-dialog"
        data-overlay="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="No working hours"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            done("cancel");
          }
        }}
      >
        <p className="nohours-q">{ask.question}</p>
        <div className="cap-acts">
          <button ref={first} type="button" className="top-btn primary" onClick={() => done("add")}>Add hours</button>
          <button type="button" className="top-btn" onClick={() => done("anyway")}>Move anyway</button>
          <button type="button" className="mini quiet" onClick={() => done("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
