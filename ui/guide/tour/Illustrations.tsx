// UI-5: the small drawings a tour step shows where the real screen has nothing to point at yet. Simple shapes in the
// app's tokens with the Guide's example data (content.ts TOUR_EXAMPLES), always labeled as an example; never the
// person's data, never a screenshot, never demo source data (no-demo-leak).
import type { CSSProperties } from "react";
import { DAYS, TOUR_EXAMPLES as X, TOUR_UI, type ExampleColor } from "../content.ts";
import type { IllustrationId } from "../tours.ts";
import { Icon } from "../../icons.tsx";

const tint = (c: ExampleColor | null): CSSProperties => ({ ["--c" as string]: c ? `var(--client-${c})` : "var(--border-strong)" });

function Grid() {
  return (
    <div className="ti-grid">
      <span />
      {DAYS.map((d) => (
        <span key={d} className="ti-day">{d}</span>
      ))}
      {(["AM", "PM"] as const).map((h) => (
        <div key={h} className="ti-row">
          <span className="ti-half">{h}</span>
          {X.grid[h].map((c, i) => (
            <span key={i} className={`ti-cell${c.color ? "" : i === 3 ? " pto" : " catchup"}`} style={tint(c.color)}>
              {c.client}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Carry() {
  return (
    <ul className="ti-list">
      {X.carry.map((r) => (
        <li key={r.title}>
          <span className="ti-title">{r.title}</span>
          <span className="ti-hint">{r.hint}</span>
          <span className="ti-btn">{r.action}</span>
        </li>
      ))}
    </ul>
  );
}

function Card() {
  return (
    <div className="ti-card" style={tint(X.card.color)}>
      <div className="ti-card-head">
        <b>{X.card.client}</b>
        <span className="ti-hint">{X.card.fit}</span>
      </div>
      <div className="ti-label">This week</div>
      {X.card.features.map((m) => (
        <div key={m.title} className="ti-must">
          <span className="ti-title">{m.title}</span>
          <span className="ti-chip">{m.hours}</span>
        </div>
      ))}
    </div>
  );
}

function Add() {
  return (
    <div className="ti-add">
      <div className="ti-label">Add to {X.add.client}</div>
      {X.add.rows.map((r) => (
        <div key={r} className="ti-must">
          <span className="ti-title">{r}</span>
          <span className="ti-btn"><Icon name="add" /> Add</span>
        </div>
      ))}
      <div className="ti-box">{X.add.box}</div>
    </div>
  );
}

function Next() {
  return <div className="ti-next">{X.next.label}</div>;
}

/** The other tours' drawings: one small card each (content.ts TOUR_EXAMPLES.cards). */
function SmallCard({ id }: { id: string }) {
  const c = X.cards[id]!;
  return (
    <div className="ti-card" style={tint(c.color)}>
      <div className="ti-card-head">
        <b>{c.head}</b>
        {c.meta && <span className="ti-hint">{c.meta}</span>}
      </div>
      {c.rows.map(([a, b]) => (
        <div key={a} className="ti-must">
          <span className="ti-title">{a}</span>
          {b && <span className="ti-chip">{b}</span>}
        </div>
      ))}
      <div className="ti-acts">
        {c.actions.map((a) => (
          <span key={a} className="ti-btn">
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

const DRAW: Partial<Record<IllustrationId, () => React.JSX.Element>> = { "pw-grid": Grid, "pw-carry": Carry, "pw-card": Card, "pw-add": Add, "pw-next": Next };

/** One example drawing, labeled as such for sight and screen readers. */
export function Illustration({ id }: { id: IllustrationId }) {
  const D = DRAW[id];
  return (
    <figure className="ti-figure" aria-label={TOUR_UI.example}>
      {D ? <D /> : <SmallCard id={id} />}
      <figcaption className="guide-example">{TOUR_UI.example}</figcaption>
    </figure>
  );
}
