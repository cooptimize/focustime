// The Guide's copy with its {key:…}, {size:…} and {b:…} marks drawn (keys from ui/keys.ts, so they can't drift).
import { Fragment } from "react";
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
  return (
    <>
      {richParts(text).map((p, i) =>
        p.kind === "text" ? <Fragment key={i}>{p.text}</Fragment> : p.kind === "keys" ? <Keys key={i} keys={p.keys} /> : p.kind === "size" ? <span key={i} className="guide-tag">{p.text}</span> : <b key={i}>{p.text}</b>,
      )}
    </>
  );
}

/** The words a reader sees, with the marks resolved (for search and the word budgets). */
export const plainText = (text: string) => richParts(text).map((p) => (p.kind === "keys" ? p.keys.join(" ") : p.text)).join("");
