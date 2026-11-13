// The Guide's copy with its {key:…}, {size:…}, {b:…} and {icon:…} marks drawn (keys from ui/keys.ts and icons from
// ui/icons.tsx, so they can't drift from the app's).
import { Fragment, type ReactNode } from "react";
import { Icon, type IconName } from "../icons.tsx";
import { caps, richParts } from "./shortcuts.ts";

export function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="guide-keys">
      {keys.map((k, i) => (
        <span key={`${k}${i}`} className="guide-combo">
          {caps(k).map((c, j) => (
            <kbd key={j}>{c}</kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

export function Rich({ text }: { text: string }) {
  const parts = richParts(text);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.kind === "text") out.push(<Fragment key={i}>{p.text}</Fragment>);
    else if (p.kind === "keys") out.push(<Keys key={i} keys={p.keys} />);
    else if (p.kind === "size") out.push(<span key={i} className="guide-tag">{p.text}</span>);
    else if (p.kind === "b") out.push(<b key={i}>{p.text}</b>);
    else {
      // An icon stays on the line with the first word of the control's name ("+ Add" never breaks between the two).
      const next = parts[i + 1];
      const word = next?.kind === "text" ? /^ (\S+)/.exec(next.text) : null;
      const icon = <Icon name={p.name as IconName} className="guide-icon" />;
      if (word && next?.kind === "text") {
        out.push(<span key={i} className="guide-ctl">{icon} {word[1]}</span>);
        out.push(<Fragment key={`${i}w`}>{next.text.slice(word[0].length)}</Fragment>);
        i++;
      } else out.push(<Fragment key={i}>{icon}</Fragment>);
    }
  }
  return <>{out}</>;
}

/** The words a reader sees, with the marks resolved (for search and the word budgets). */
export const plainText = (text: string) => richParts(text).map((p) => (p.kind === "keys" ? p.keys.join(" ") : p.kind === "icon" ? "" : p.text)).join("").replace(/ {2,}/g, " ");
