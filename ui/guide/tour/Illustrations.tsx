// UI-5: the small drawings a tour step shows where the real screen has nothing to point at yet. The Guide's example
// data (content.ts TOUR_EXAMPLES), always labeled as an example; never the person's data, never a screenshot, never
// demo source data (no-demo-leak).
// GU-1: each is drawn in one of the app's own three shapes, with the app's buttons, pills and icons, so it looks like
// the thing it stands for: a block card (the client edge and border, to-do rows), a list of rows (no boxes; a status is
// a pill with a wash), or a preview (one quiet card, a line per change, one filled button). The drawings of the old
// Plan the week screen went with that screen.
import type { CSSProperties } from "react";
import { TOUR_EXAMPLES as X, TOUR_UI, type ExampleCard, type ExampleColor } from "../content.ts";
import type { IllustrationId } from "../tours.ts";

const tint = (c: ExampleColor | null): CSSProperties => (c ? { ["--c" as string]: `var(--client-${c})` } : {});

/** The buttons a drawing would have: the main one filled, the rest outlined. Drawn, never pressed. */
function Acts({ c }: { c: ExampleCard }) {
  if (!c.actions.length) return null;
  return (
    <div className="ti-acts">
      {c.actions.map((a) => (
        <span key={a} className={`ti-btn${a === c.main ? " main" : ""}`}>
          {a}
        </span>
      ))}
    </div>
  );
}

function Head({ c }: { c: ExampleCard }) {
  return (
    <div className="ti-head">
      <b>{c.head}</b>
      {c.meta && <span className="ti-meta">{c.meta}</span>}
    </div>
  );
}

/** A block card: the client's edge, its header, to-do rows with their size. */
function Block({ c }: { c: ExampleCard }) {
  return (
    <div className="ti-block" style={tint(c.color)}>
      <Head c={c} />
      {c.rows.map(([a, b]) => (
        <div key={a} className="ti-todo">
          <span className="ti-check" />
          <span className="ti-title">{a}</span>
          {b && <span className="ti-size">{b}</span>}
        </div>
      ))}
      <Acts c={c} />
    </div>
  );
}

/** A list: plain rows, the second part as a status pill. */
function Rows({ c }: { c: ExampleCard }) {
  return (
    <div className="ti-rows" style={tint(c.color)}>
      <Head c={c} />
      {c.rows.map(([a, b]) => (
        <div key={a} className="ti-row">
          <span className="ti-title">{a}</span>
          {b && <span className="ti-pill">{b}</span>}
        </div>
      ))}
      <Acts c={c} />
    </div>
  );
}

/** A preview: what would change, a line each, before and after. */
function Preview({ c }: { c: ExampleCard }) {
  return (
    <div className="ti-preview" style={tint(c.color)}>
      <Head c={c} />
      {c.rows.map(([a, b]) => (
        <div key={a} className="ti-change">
          <span className="ti-field">{a}</span>
          <span className="ti-title">{b}</span>
        </div>
      ))}
      <Acts c={c} />
    </div>
  );
}

const DRAW = { block: Block, rows: Rows, preview: Preview } as const;

/** One example drawing, labeled as such for sight and screen readers. */
export function Illustration({ id }: { id: IllustrationId }) {
  const c = X.cards[id]!;
  const D = DRAW[c.kind];
  return (
    <figure className="ti-figure" aria-label={TOUR_UI.example} data-example={id} data-kind={c.kind}>
      <figcaption className="guide-example">{TOUR_UI.example}</figcaption>
      <D c={c} />
    </figure>
  );
}
