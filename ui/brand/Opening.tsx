// BR-1: the app open. The loader is index.html's own week mark (ui/brand/boot.ts); this component only tells it what
// the opening is still waiting on and when the first load is done. There is no Close out reverse or first-launch
// moment any more; InlineMoment goes with Settings' reconnect line.
import { useEffect, useRef } from "react";
import { Lumen } from "./Brand.tsx";
import { bootReady, bootWaiting } from "./boot.ts";
import { waitingLine, type SourceLine } from "./opening.ts";

/**
 * The app open: tells the loader what the opening is still waiting on (its one line after 8 seconds) and when the
 * first load is done (or failed: a failed source never holds it back). `onFinished` runs once the app shows.
 */
export function Opening({ ready, lines, onFinished }: { ready: boolean; lines: SourceLine[]; onFinished?: () => void }) {
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const line = ready ? null : waitingLine(lines);
  useEffect(() => bootWaiting(line), [line]);
  useEffect(() => {
    if (ready) bootReady(() => finished.current?.());
  }, [ready]);
  return null;
}

/** An inline moment (a successful reconnect in Settings > Connections): Lumen settles and bobs beside one line. */
export function InlineMoment({ line }: { line: string }) {
  return (
    <div className="brand-empty" role="status">
      <Lumen pose="bob" size={26} />
      <p>{line}</p>
    </div>
  );
}
