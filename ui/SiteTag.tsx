// EV-1: the top bar's "Dev" (or "Local") beside the FocusTime name on a computer and beside the date on a phone. Words
// in a quiet pill, not a control (never in the Tab order); its title and a screen reader say what it means. Nothing on
// production, nothing while the environment isn't known, nothing when /version fails (ui/appenv.ts).
import { useSiteMark } from "./appenv.ts";

export function SiteTag() {
  const mark = useSiteMark();
  if (!mark) return null;
  return (
    <span className="site-tag" title={mark.say} data-site-tag={mark.word.toLowerCase()}>
      <span aria-hidden="true">{mark.word}</span>
      <span className="sr-only">{mark.say}</span>
    </span>
  );
}
