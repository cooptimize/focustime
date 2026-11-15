// Step 17.5: the brand marks as components (docs/design/brand.md). BR-1: the week mark is the only brand mark. Colors
// come from the brand tokens. Every mark is decorative (aria-hidden)
// except the lockup, one image named "FocusTime by Cooptimize"; words around a mark carry the meaning.
import { Fragment, useId } from "react";
import wordRaw from "../../assets/brand/wordmark.svg?raw";
import { WEEK } from "./geometry.ts";
import "./brand.css";

/**
 * A generated asset inlined (the wordmark): any :root token block of its own dropped (the page's tokens apply), every
 * style attribute dropped too (HK-7: the CSP allows no inline style), its title and fixed size dropped, ids made unique.
 */
export function inline(raw: string, uid: string): string {
  return raw
    .replace(/<style>\s*:root\{[^}]*\}\s*<\/style>/, "")
    .replace(/ style="[^"]*"/g, "")
    .replace(/<title>.*?<\/title><desc>.*?<\/desc>/, "")
    .replace(/ width="\d+" height="\d+"/, "")
    .replace(/id="([\w-]+)"/g, `id="$1-${uid}"`)
    .replace(/url\(#([\w-]+)\)/g, `url(#$1-${uid})`);
}

/** The unrolled week: four columns Mon to Thu, AM over PM, Mon AM hollow. The top bar's mark and the icon. */
export function WeekMark({ height = 18, className = "" }: { height?: number; className?: string }) {
  const { cols, bw, am, pm, rx } = WEEK;
  return (
    <svg className={`brand-svg week-mark ${className}`} viewBox={`0 0 ${WEEK.w} ${WEEK.h}`} height={height} width={(height * WEEK.w) / WEEK.h} aria-hidden="true" focusable="false">
      {cols.map((x, i) => (
        <g key={x}>
          {i === 0 ? (
            <rect x={x + 1.5} y={am.y + 1.5} width={bw - 3} height={am.h - 3} rx={rx - 1} fill="none" stroke="var(--brand-accent)" strokeWidth={3} />
          ) : (
            <rect x={x} y={am.y} width={bw} height={am.h} rx={rx} fill="var(--brand-am)" />
          )}
          <rect x={x} y={pm.y} width={bw} height={pm.h} rx={rx} fill="var(--brand-pm)" />
        </g>
      ))}
    </svg>
  );
}

/**
 * BR-1: the loader's mark: the week mark's own drawing (WEEK, the same rects as WeekMark), each block with its place in
 * reading order by day, morning then afternoon (wl-0 Mon AM to wl-7 Thu PM), its colors and its pass in
 * ui/brand/boot.css. index.html carries this same markup so it shows from the first paint (ui/brand/boot.test.ts).
 */
export function WeekLoader() {
  const { cols, bw, am, pm, rx } = WEEK;
  return (
    <svg className="week-loader" viewBox={`0 0 ${WEEK.w} ${WEEK.h}`} aria-hidden="true" focusable="false">
      {cols.map((x, i) => (
        <Fragment key={x}>
          {i === 0 ? (
            <rect className="wl wl-0 wl-hollow" x={x + 1.5} y={am.y + 1.5} width={bw - 3} height={am.h - 3} rx={rx - 1} fill="none" strokeWidth={3} />
          ) : (
            <rect className={`wl wl-${i * 2} wl-am`} x={x} y={am.y} width={bw} height={am.h} rx={rx} />
          )}
          <rect className={`wl wl-${i * 2 + 1} wl-pm`} x={x} y={pm.y} width={bw} height={pm.h} rx={rx} />
        </Fragment>
      ))}
    </svg>
  );
}

/** The lockup (BR-1): the week mark, the outlined wordmark and "by Cooptimize". About in Settings. */
export function Lockup({ height = 64 }: { height?: number }) {
  const uid = useId().replace(/:/g, "");
  return (
    <span className="lockup" role="img" aria-label="FocusTime by Cooptimize">
      <WeekMark height={height} />
      <span className="lockup-words" aria-hidden="true">
        <span className="brand-svg wordmark" dangerouslySetInnerHTML={{ __html: inline(wordRaw, uid) }} />
        <span className="lockup-by">by Cooptimize</span>
      </span>
    </span>
  );
}
