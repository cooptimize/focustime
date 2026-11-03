// G1: the Guide's keys come from ui/keys.ts, never typed into its copy, so they can't drift from what works.
import { KEYS, type KeyRow } from "../keys.ts";
import type { KeyRef } from "./content.ts";

/** The KEYS row a reference names: by the command it mirrors, or by its first key. */
export function keyRow(ref: KeyRef): KeyRow | undefined {
  return "command" in ref ? KEYS.find((k) => k.command === ref.command) : KEYS.find((k) => k.keys[0] === ref.key);
}

/** The keys to show for some references: each row's first key, or (all) every key of each row. Throws on a reference keys.ts doesn't have. */
export function keysFor(refs: readonly KeyRef[], all = false): string[] {
  return refs.flatMap((r) => {
    const row = keyRow(r);
    if (!row) throw new Error(`ui/keys.ts has no key for ${JSON.stringify(r)}`);
    return all ? row.keys : [row.keys[0]!];
  });
}

/** A key as the caps to draw: "Ctrl K" is Ctrl and K; "+" and "−" stay one cap. */
export const caps = (key: string): string[] => key.split(" ").filter(Boolean);

/** "{key:capture.add}" or "{key:Ctrl K}" as a reference (a dot means a command). */
export const refOf = (s: string): KeyRef => (s.includes(".") ? { command: s } : { key: s });

export type RichPart = { kind: "text"; text: string } | { kind: "keys"; keys: string[] } | { kind: "size"; text: string } | { kind: "b"; text: string };

/** The Guide's copy, with {key:…}, {size:…} and {b:…} marks, as parts to draw. */
export function richParts(text: string): RichPart[] {
  const out: RichPart[] = [];
  const re = /\{(key|size|b):([^}]+)\}/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    const [, kind, v] = m as unknown as [string, "key" | "size" | "b", string];
    out.push(kind === "key" ? { kind: "keys", keys: keysFor([refOf(v)]) } : { kind, text: v });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}
