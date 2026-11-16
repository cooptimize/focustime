// TP-1b: the three optional questions on the New form and the draft editor: one plain box each, one line tall and
// growing to about five as the person types. No choices, chips, help marks or examples: the grey text inside each box
// is the only hint. Their words come from plan/three-questions.ts. In the New form's grid each label sits beside its
// box ("grid"); in the draft editor and on the phone the label sits above it ("stack").
// RB-3: with `lookup`, "Where is it?" offers the client's real things as you type (ui/WhereLookup.tsx); a pick only
// writes words into the box. The other two boxes are unchanged.
import { ANSWER_MAX, QUESTION_KEYS, QUESTIONS, type Answers } from "../plan/three-questions.ts";
import type { WhereFrom } from "../plan/where-lookup.ts";
import { TextBox } from "./TextBox.tsx";
import { WhereBox } from "./WhereLookup.tsx";

/** RB-3: the client the item is for (null until one is chosen) and where the form is, for the first question's lookup. */
export type WhereLookupFor = { clientKey: string | null; clientName: string; from: WhereFrom };

export function ThreeQuestions({ answers, onChange, idPrefix, layout = "grid", lookup }: { answers: Answers; onChange: (a: Answers) => void; idPrefix: string; layout?: "grid" | "stack"; lookup?: WhereLookupFor }) {
  const rows = QUESTION_KEYS.map((k) => {
    const id = `${idPrefix}-${k}`;
    const q = QUESTIONS[k];
    const box = k === "where" && lookup ? (
      <WhereBox id={id} className="tq-box" clientKey={lookup.clientKey} clientName={lookup.clientName} from={lookup.from} maxLength={ANSWER_MAX} placeholder={q.hint} value={answers.where} onChange={(v) => onChange({ ...answers, where: v })} />
    ) : (
      <TextBox id={id} className="tq-box" data-question={k} minRows={1} maxRows={5} maxLength={ANSWER_MAX} placeholder={q.hint} value={answers[k]} onChange={(e) => onChange({ ...answers, [k]: e.target.value })} />
    );
    const label = (
      <label className="set-label" htmlFor={id}>
        {q.label}
      </label>
    );
    return layout === "grid" ? (
      <span key={k} className="tq-row">
        {label}
        {box}
      </span>
    ) : (
      <span key={k} className="set-field tq-row">
        {label}
        {box}
      </span>
    );
  });
  return <div className={`tq tq-${layout}`}>{rows}</div>;
}
