// UI-5: Start here. What FocusTime is for, the day in five steps, the week in three, and the two things that never
// change. The WeekMark unrolls once as the section opens (the brand's own Unroll; reduced motion shows its end), and
// a proposal card turns into "Done ✓ · Undo" once when it scrolls into view (CSS, under 600 ms; reduced motion: the
// end state, still). Show me starts a tour on the person's own screens; signed out there are none, so it says so.
import { useEffect, useRef, useState } from "react";
import { Unroll } from "../brand/Brand.tsx";
import { useReducedMotion } from "../brand/motion.ts";
import { START } from "./content.ts";
import { tourById } from "./tours.ts";

function Proposal() {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const [played, setPlayed] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setPlayed(true), io.disconnect()), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  const p = START.promises.proposal;
  const state = reduced ? "done still" : played ? "play" : "";
  return (
    <div ref={box} className="gs-proposal-wrap" role="img" aria-label={`${p.label}: ${p.ask} ${p.confirm}, then ${p.done} ${p.undo}`}>
      <div key={run} className={`gs-proposal ${state}`} aria-hidden="true">
        <span className="gs-ask">
          <span>{p.ask}</span>
          <span className="gs-confirm">{p.confirm}</span>
        </span>
        <span className="gs-done">
          <span className="gs-tick">{p.done}</span>
          <span className="gs-undo">{p.undo}</span>
        </span>
      </div>
      {!reduced && (
        <button type="button" className="link-btn gs-replay" onClick={() => (setPlayed(true), setRun((n) => n + 1))}>
          {p.replay}
        </button>
      )}
    </div>
  );
}

export function StartHere({ onTour }: { /** Null signed out: no screens to show. */ onTour: ((id: string) => void) | null }) {
  return (
    <div className="gs">
      <div className="gs-hero">
        <div>
          <div className="guide-eyebrow">{START.eyebrow}</div>
          <h1 tabIndex={-1}>{START.title}</h1>
          <ul className="gs-why">
            {START.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
        <div className="gs-mark" role="img" aria-label={START.markLabel}>
          <Unroll direction="open" height={150} />
        </div>
      </div>

      <h2 className="gs-h">{START.day.title}</h2>
      <ol className="gs-day">
        {START.day.steps.map((s, n) => (
          <li key={s.name} style={{ ["--i" as string]: n }}>
            <span className="gs-n" aria-hidden="true">{n + 1}</span>
            <span className="gs-step">
              <b>{s.name}</b>
              <span>{s.text}</span>
              {s.teams && <span className="gs-teams">{START.day.teams}</span>}
            </span>
          </li>
        ))}
      </ol>

      <h2 className="gs-h">{START.week.title}</h2>
      <ol className="gs-week">
        {START.week.steps.map((s, n) => {
          const tour = s.tour ? tourById(s.tour) : undefined;
          return (
            <li key={s.name}>
              <span className="gs-n" aria-hidden="true">{n + 1}</span>
              <b>{s.name}</b>
              <span className="gs-where">{s.where}</span>
              <span className="gs-text">{s.text}</span>
              <span className="gs-show">
                {tour && onTour ? (
                  <button type="button" className="primary" onClick={() => onTour(tour.id)} aria-label={`${START.showMe}: ${tour.title}`}>
                    {START.showMe}
                  </button>
                ) : tour ? (
                  <span className="muted">{START.signedOut}</span>
                ) : (
                  <span className="faint">{START.soon}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <h2 className="gs-h">{START.promises.title}</h2>
      <div className="gs-promises">
        {START.promises.items.map((x, n) => (
          <div key={x.name} className="gs-promise">
            <b>{x.name}</b>
            <p>{x.text}</p>
            {n === 0 && <Proposal />}
          </div>
        ))}
      </div>
    </div>
  );
}
