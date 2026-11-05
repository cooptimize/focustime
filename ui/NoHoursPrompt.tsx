// Step 13.5: moving a pick to a day with no working hours asks first. One prompt for every Move (ui/api.ts calls it):
// "Friday has no working hours. Add hours for that day?" with Add hours (opens Settings > Working hours) or Move anyway.
import { useEffect, useRef, useState } from "react";
import { setNoHoursPrompt, type NoHoursChoice } from "./api.ts";
import { useReturnFocus } from "./CloseButton.tsx";

type Ask = { question: string; resolve: (c: NoHoursChoice) => void };

export function NoHoursPrompt({ onAddHours }: { onAddHours: (date: string) => void }) {
  const [ask, setAsk] = useState<(Ask & { date: string }) | null>(null);
  useEffect(() => {
    setNoHoursPrompt((question, date) => new Promise<NoHoursChoice>((resolve) => setAsk({ question, date, resolve })));
    return () => setNoHoursPrompt(null);
  }, []);
  if (!ask) return null;
  const done = (c: NoHoursChoice) => {
    ask.resolve(c);
    setAsk(null);
    if (c === "add") onAddHours(ask.date);
  };
  return <NoHoursDialog question={ask.question} done={done} />;
}

/** The prompt itself, mounted while it asks, so focus goes back to what asked when it closes (HK-3). */
function NoHoursDialog({ question, done }: { question: string; done: (c: NoHoursChoice) => void }) {
  useReturnFocus();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
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
        <p className="nohours-q">{question}</p>
        <div className="cap-acts">
          <button ref={first} type="button" className="top-btn primary" onClick={() => done("add")}>Add hours</button>
          <button type="button" className="top-btn" onClick={() => done("anyway")}>Move anyway</button>
          <button type="button" className="mini quiet" onClick={() => done("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
