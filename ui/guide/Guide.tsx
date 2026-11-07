// UI-5: the in-app Guide (#/guide/<section>), on ST-1's panel shell (./GuideFrame.tsx). Start here and Your first day
// are the 10-minute path; then one section per tab and area, each the same shape: one line on what it's for, what you
// do there (with a link to the place and a Show me tour), a try-it or an animation where one helps, and "How it works"
// folded. Every word is in ./content.ts; keys come from ui/keys.ts. Example data only, labeled as such.
// Lumen: Start here's unroll, a tour's end and this footer (docs/design/brand.md).
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Checklist } from "../../actions/guide-actions.ts";
import { Lumen } from "../brand/Brand.tsx";
import { KEYS } from "../keys.ts";
import { TypeIcon } from "../TypeIcon.tsx";
import { AREA_UI, AREAS, DEVOPS, FIRST_DAY, FOOTER, QUESTION_POOL, RENAMED, SEARCH, SECTION_LINES, SHORTCUTS, START, TRY, type AreaBody, type Do, type Extra } from "./content.ts";
import { GuideFrame, useGuideList } from "./GuideFrame.tsx";
import { Keys, plainText, Rich } from "./Rich.tsx";
import { SECTIONS, sectionFor, type SectionId } from "./sections.ts";
import { keysFor } from "./shortcuts.ts";
import { StartHere } from "./StartHere.tsx";
import { tourById } from "./tours.ts";
import { TryIt, UrgentStrip } from "./TryIt.tsx";
import "./guide.css";

export { Keys, Rich };

const ANSWER = new Map(QUESTION_POOL.map((x) => [x.q, x.a]));
const nameOf = (id: string) => SECTIONS.find((s) => s.id === id)?.name ?? id;

function Faq({ q }: { q: string }) {
  return (
    <details className="guide-q" data-q={q}>
      <summary>{q}</summary>
      <p>
        <Rich text={ANSWER.get(q) ?? ""} />
      </p>
    </details>
  );
}

function ShowMe({ tour, onTour }: { tour: string; onTour: ((id: string) => void) | null }) {
  const t = tourById(tour);
  if (!t || !onTour) return null;
  return (
    <button type="button" className="quiet ga-show" onClick={() => onTour(t.id)} aria-label={`${START.showMe}: ${t.title}`}>
      {START.showMe}
    </button>
  );
}

function DoCard({ d, onTour, signedIn }: { d: Do; onTour: ((id: string) => void) | null; signedIn: boolean }) {
  const link = d.go && signedIn;
  const tour = d.tour && onTour && tourById(d.tour);
  return (
    <li className="ga-do">
      <b>{d.title}</b>
      <span className="ga-text">
        <Rich text={d.text} />
      </span>
      {(link || tour) && (
        <span className="ga-links">
          {link && (
            <a href={d.go!.href} className="ga-go">
              {d.go!.label}
            </a>
          )}
          {d.tour && <ShowMe tour={d.tour} onTour={onTour} />}
        </span>
      )}
    </li>
  );
}

function Ladder() {
  return (
    <details className="guide-q ga-ladder">
      <summary>{TRY.ladderTitle}</summary>
      <div className="guide-principle">
        <div>
          <div className="guide-quote">
            {DEVOPS.quote[0]}
            <span>{DEVOPS.quote[1]}</span>
          </div>
          <p className="guide-sub">{DEVOPS.body}</p>
        </div>
        <div className="guide-ladder">
          {DEVOPS.ladder.map((r) => (
            <div key={r.level} className={`rung${r.flag ? " flag" : ""}`}>
              <span className="lvl">
                {r.icon && <TypeIcon type={r.level} look={{ icon: r.icon, color: null }} decorative />} {r.level}
              </span>
              <span>
                <Rich text={r.text} />
              </span>
            </div>
          ))}
        </div>
        <p className="guide-icons-intro">{DEVOPS.icons.intro}</p>
        <ul className="guide-icons" aria-label="Work item type icons">
          {DEVOPS.icons.legend.map((l) => (
            <li key={l.name}>
              <TypeIcon type={l.name} look={{ icon: l.icon, color: l.color }} decorative /> <span>{l.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function KeyList() {
  return (
    <div className="ga-keys">
      <h3 className="ga-h">{SHORTCUTS.title}</h3>
      <p className="guide-sub">
        <Rich text={SHORTCUTS.sub} />
      </p>
      <div className="guide-keygrid">
        {SHORTCUTS.cards.map((c) => (
          <div key={c.label} className="guide-key" data-shortcut={c.label}>
            <span>{c.label}</span>
            <Keys keys={keysFor(c.keys, c.all)} />
          </div>
        ))}
      </div>
      <details className="guide-q guide-every">
        <summary>{SHORTCUTS.every}</summary>
        <dl className="key-list">
          {KEYS.map((k) => (
            <Fragment key={k.does}>
              <dt>
                <Keys keys={k.keys} />
              </dt>
              <dd>{k.does}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </div>
  );
}

const EXTRA: Record<Exclude<Extra, "keys">, () => ReactNode> = { urgent: () => <UrgentStrip />, ladder: () => <Ladder /> };

function Area({ body, onTour, signedIn }: { body: AreaBody; onTour: ((id: string) => void) | null; signedIn: boolean }) {
  return (
    <div className="ga">
      <h3 className="ga-h">{AREA_UI.does}</h3>
      <ul className="ga-does">
        {body.does.map((d) => (
          <DoCard key={d.title} d={d} onTour={onTour} signedIn={signedIn} />
        ))}
      </ul>
      {!onTour && body.does.some((d) => d.tour) && <p className="muted ga-notour">{AREA_UI.noTour}</p>}
      {body.extras?.map((x) => (x === "keys" ? null : <Fragment key={x}>{EXTRA[x]()}</Fragment>))}
      {body.tryIts && (
        <div className="ga-tries">
          {body.tryIts.map((t) => (
            <TryIt key={t} id={t} />
          ))}
        </div>
      )}
      {body.extras?.includes("keys") && <KeyList />}
      <h3 className="ga-h">{AREA_UI.how}</h3>
      <div className="ga-faqs">
        {body.faqs.map((q) => (
          <Faq key={q} q={q} />
        ))}
      </div>
    </div>
  );
}

const MARK = { done: "✓", todo: "", skipped: "–", unknown: "" } as const;

function FirstDay({ checklist, onTour, signedIn }: { checklist: (() => Promise<Checklist>) | null; onTour: ((id: string) => void) | null; signedIn: boolean }) {
  const [list, setList] = useState<Checklist | "loading" | "problem" | null>(checklist ? "loading" : null);
  useEffect(() => {
    if (!checklist) return;
    let live = true;
    checklist().then(
      (c) => live && setList(c),
      () => live && setList("problem"),
    );
    return () => void (live = false);
  }, [checklist]);
  const ids = Object.keys(FIRST_DAY.checks) as (keyof typeof FIRST_DAY.checks)[];
  const got = typeof list === "object" && list !== null ? list : null;
  const known = got && !got.demo ? got : null;
  const stateOf = (id: string) => known?.checks.find((c) => c.id === id)?.state ?? "unknown";
  const done = known ? known.checks.filter((c) => c.state === "done").length : 0;
  const note = !signedIn ? FIRST_DAY.signedOut : list === "loading" ? FIRST_DAY.loading : list === "problem" ? FIRST_DAY.problem : got?.demo ? FIRST_DAY.demo : known ? FIRST_DAY.progress(done, ids.length) : null;
  return (
    <div className="ga gd">
      <p className="ga-lead">{FIRST_DAY.lead}</p>
      {note && (
        <p className="gd-note" role="status" data-progress={known ? done : undefined}>
          {note}
        </p>
      )}
      <ol className="gd-checks">
        {ids.map((id) => {
          const c: { title: string; text: string; go: { href: string; label: string }; tour?: string } = FIRST_DAY.checks[id];
          const st = stateOf(id);
          return (
            <li key={id} className={`gd-check ${st}`} data-check={id} data-state={st}>
              <span className="gd-mark" aria-hidden="true">
                {MARK[st]}
              </span>
              <span className="gd-body">
                <span className="gd-top">
                  <b>{c.title}</b>
                  {st !== "unknown" && <span className="gd-state">{FIRST_DAY.states[st]}</span>}
                </span>
                <span className="ga-text">{c.text}</span>
              </span>
              <span className="ga-links">
                {signedIn && (
                  <a href={c.go.href} className="ga-go">
                    {c.go.label}
                  </a>
                )}
                {c.tour && <ShowMe tour={c.tour} onTour={onTour} />}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="faint gd-never">{FIRST_DAY.never}</p>
      <h3 className="ga-h">{FIRST_DAY.faqTitle}</h3>
      <div className="ga-faqs">
        {FIRST_DAY.faqs.map((q) => (
          <Faq key={q} q={q} />
        ))}
      </div>
    </div>
  );
}

function Renamed() {
  return (
    <div className="ga">
      <p className="ga-lead">
        <Rich text={RENAMED.lead} />
      </p>
      <table className="gr-table">
        <thead>
          <tr>
            <th scope="col">{RENAMED.was}</th>
            <th scope="col">{RENAMED.now}</th>
          </tr>
        </thead>
        <tbody>
          {RENAMED.rows.map(([was, now]) => (
            <tr key={was}>
              <td>{was}</td>
              <td>{now}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Search ----------

export type Hit = { section: SectionId; title: string; text: string; q?: string };

/** Everything the Guide says, as entries to search: each section, what you do there, each question and each rename. */
export function guideIndex(): Hit[] {
  const out: Hit[] = [];
  for (const s of SECTIONS) out.push({ section: s.id, title: s.name, text: SECTION_LINES[s.id] ?? "" });
  for (const st of [...START.day.steps, ...START.week.steps]) out.push({ section: "start", title: st.name, text: st.text });
  for (const [id, body] of Object.entries(AREAS) as [SectionId, AreaBody][]) {
    for (const d of body.does) out.push({ section: id, title: d.title, text: plainText(d.text) });
    for (const q of body.faqs) out.push({ section: id, title: q, text: plainText(ANSWER.get(q) ?? ""), q });
  }
  for (const c of Object.values(FIRST_DAY.checks)) out.push({ section: "first-day", title: c.title, text: c.text });
  for (const q of FIRST_DAY.faqs) out.push({ section: "first-day", title: q, text: plainText(ANSWER.get(q) ?? ""), q });
  for (const [was, now] of RENAMED.rows) out.push({ section: "renamed", title: `${was} → ${now}`, text: "" });
  return out;
}

/** Entries with every typed word, ones whose title has them all first; at most 20. */
export function searchGuide(q: string, index: readonly Hit[]): Hit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  const hits = index.filter((h) => has(`${h.title} ${h.text}`));
  return [...hits.filter((h) => has(h.title)), ...hits.filter((h) => !has(h.title))].slice(0, 20);
}

function SearchBox({ q, setQ, first }: { q: string; setQ: (s: string) => void; first: () => void }) {
  return (
    <div className="ps-search">
      <input
        type="search"
        aria-label={SEARCH.label}
        placeholder={SEARCH.placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) (e.preventDefault(), e.stopPropagation(), e.nativeEvent.stopImmediatePropagation(), setQ(""));
          else if (e.key === "Enter") (e.preventDefault(), first());
          else if (e.key === "ArrowDown") (e.preventDefault(), document.querySelector<HTMLElement>(".gsr-hit")?.focus());
        }}
      />
    </div>
  );
}

function Results({ q, hits, onGo }: { q: string; hits: Hit[]; onGo: (h: Hit) => void }) {
  return (
    <div className="gsr" role="region" aria-label={SEARCH.results(hits.length)}>
      <div className="gsr-count" role="status">
        {hits.length ? SEARCH.results(hits.length) : SEARCH.none(q)}
      </div>
      {hits.map((h, i) => (
        <button
          key={`${h.section}${h.title}${i}`}
          type="button"
          className="gsr-hit"
          onClick={() => onGo(h)}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            const prev = el.previousElementSibling as HTMLElement | null;
            if (e.key === "ArrowDown") (e.preventDefault(), (el.nextElementSibling as HTMLElement | null)?.focus());
            if (e.key === "ArrowUp") (e.preventDefault(), (prev?.classList.contains("gsr-hit") ? prev : document.querySelector<HTMLElement>(".ps-search input"))?.focus());
          }}
        >
          <span className="gsr-title">{h.title}</span>
          <span className="gsr-in">{SEARCH.in(nameOf(h.section))}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- The Guide ----------

function Section({ id, onTour, signedIn, checklist }: { id: SectionId; onTour: ((id: string) => void) | null; signedIn: boolean; checklist: (() => Promise<Checklist>) | null }) {
  switch (id) {
    case "start":
      return <StartHere onTour={onTour} />;
    case "first-day":
      return <FirstDay checklist={checklist} onTour={onTour} signedIn={signedIn} />;
    case "renamed":
      return <Renamed />;
    default:
      return <Area body={AREAS[id]} onTour={onTour} signedIn={signedIn} />;
  }
}

/**
 * The Guide (UI-5). In the app it sits over the current place (× or Esc goes back); signed out it is a page of its own
 * from the sign-in screen (`standalone`). `chapter` is the section in the address (#/guide/<section>; none or unknown:
 * Start here; an old G1 chapter: where its content is now; `contents`: the phone's list). `onTour` starts a Show me
 * tour (null signed out), and `checklist` reads Your first day's states (null signed out).
 */
export function Guide({
  chapter,
  onClose,
  onSection,
  onTour = null,
  checklist = null,
  standalone = false,
}: {
  chapter: string | null;
  onClose: () => void;
  onSection: (id: string) => void;
  onTour?: ((id: string) => void) | null;
  checklist?: (() => Promise<Checklist>) | null;
  standalone?: boolean;
}) {
  // A big screen always has a section open; on a phone the list is a page of its own.
  const list = useGuideList();
  const current = sectionFor(chapter) ?? (list ? null : "start");
  const [q, setQ] = useState("");
  const [openQ, setOpenQ] = useState<string | null>(null);
  const index = useMemo(guideIndex, []);
  const hits = useMemo(() => searchGuide(q, index), [q, index]);
  const signedIn = !standalone;
  const go = (h: Hit) => {
    setQ("");
    setOpenQ(h.q ?? null);
    onSection(h.section);
  };
  // A search hit on a question: open it, bring it into view and focus it (after the shell's own focus on the title).
  useEffect(() => {
    if (!openQ) return;
    const t = setTimeout(() => {
      const d = document.querySelector<HTMLDetailsElement>(`.guide-body details[data-q="${CSS.escape(openQ)}"]`);
      if (!d) return;
      d.open = true;
      d.scrollIntoView?.({ block: "center" });
      d.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
      setOpenQ(null);
    }, 80);
    return () => clearTimeout(t);
  }, [openQ, current]);
  return (
    <GuideFrame
      current={current}
      title={current ? nameOf(current) : "Guide"}
      description={current ? SECTION_LINES[current] : undefined}
      onPick={(id) => (setQ(""), onSection(id))}
      onClose={onClose}
      standalone={standalone}
      railTop={<SearchBox q={q} setQ={setQ} first={() => hits[0] && go(hits[0])} />}
      railOverride={q.trim() ? <Results q={q} hits={hits} onGo={go} /> : undefined}
    >
      {current && (
        <div className="guide-body" data-section={current}>
          <Section id={current} onTour={onTour} signedIn={signedIn} checklist={checklist} />
          <footer className="guide-footer">
            <Lumen pose="still" size={22} />
            <span>
              <Rich text={FOOTER} />
            </span>
          </footer>
        </div>
      )}
    </GuideFrame>
  );
}

export default Guide;
