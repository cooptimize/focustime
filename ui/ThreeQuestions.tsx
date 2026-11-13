// TP-1b: the three optional questions on the New form and the draft editor: one plain box each, one line tall and
// growing to about five as the person types. No choices, chips, help marks or examples: the grey text inside each box
// is the only hint. Their words come from plan/three-questions.ts. In the New form's grid each label sits beside its
// box ("grid"); in the draft editor and on the phone the label sits above it ("stack").
import { ANSWER_MAX, QUESTION_KEYS, QUESTIONS, type Answers } from "../plan/three-questions.ts";
import { TextBox } from "./TextBox.tsx";

export function ThreeQuestions({ answers, onChange, idPrefix, layout = "grid" }: { answers: Answers; onChange: (a: Answers) => void; idPrefix: string; layout?: "grid" | "stack" }) {
  const rows = QUESTION_KEYS.map((k) => {
    const id = `${idPrefix}-${k}`;
    const q = QUESTIONS[k];
    const box = <TextBox id={id} className="tq-box" data-question={k} minRows={1} maxRows={5} maxLength={ANSWER_MAX} placeholder={q.hint} value={answers[k]} onChange={(e) => onChange({ ...answers, [k]: e.target.value })} />;
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
