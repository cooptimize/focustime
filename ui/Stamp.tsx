// IB-2: a timestamp on screen: the Teams-style words, with the full date, seconds and time zone on hover.
import type { ReactNode } from "react";
import { stampFull, stampInstant, stampText } from "./stamp.ts";

export function Stamp({ at, tz, today, dateOnlyIfOld, className }: { at: string; tz: string; today?: string | undefined; dateOnlyIfOld?: boolean | undefined; className?: string | undefined }): ReactNode {
  return (
    <time className={className} dateTime={stampInstant(at)} title={stampFull(at, tz)}>
      {stampText(at, tz, today, { dateOnlyIfOld: !!dateOnlyIfOld })}
    </time>
  );
}
