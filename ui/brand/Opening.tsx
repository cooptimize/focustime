// BR-1: the app open. The loader is index.html's own week mark (ui/brand/boot.ts); this component only tells it what
// the opening is still waiting on and when the first load is done. There is no Close out reverse or first-launch
// moment any more, and Settings' reconnect line is a plain line.
import { useEffect, useRef } from "react";
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
  // Once per opening: StrictMode runs an effect twice in development, and onFinished must not.
  const told = useRef(false);
  useEffect(() => {
    if (!ready || told.current) return;
    told.current = true;
    bootReady(() => finished.current?.());
  }, [ready]);
  return null;
}
