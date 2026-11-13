// RB-1 D10: Format for JSON squashed onto one or a few long lines (Power BI report definitions, exported pipelines).
// For reading only: it lays the file out with two-space indents by changing only whitespace outside strings, so every
// string and number keeps its exact characters (JSON.parse and stringify would change 1.0 or a large number). Broken
// JSON is left alone with a plain reason. Copy still copies the file exactly unless Format is on ("Copy formatted").

/** Squashed: a line over 400 characters, in a file of at most 3 lines, or any line over 2,000. */
export function looksSquashed(text: string): boolean {
  const lines = text.split("\n");
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
  return longest > 2000 || (lines.filter((l) => l.trim()).length <= 3 && longest > 400);
}

export type Formatted = { ok: true; text: string } | { ok: false; reason: string };

export function formatJson(text: string): Formatted {
  try {
    JSON.parse(text);
  } catch (e) {
    const where = e instanceof SyntaxError ? /position (\d+)/.exec(e.message)?.[1] : undefined;
    return { ok: false, reason: `This isn't valid JSON${where ? ` (it breaks at character ${Number(where) + 1})` : ""}, so it's shown as it is.` };
  }
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  const pad = () => "\n" + "  ".repeat(depth);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out.push(ch);
      if (ch === "\\") out.push(text[++i] ?? "");
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    if (ch === '"') {
      inString = true;
      out.push(ch);
    } else if (ch === "{" || ch === "[") {
      // An empty object or array stays on one line.
      let j = i + 1;
      while (/\s/.test(text[j] ?? "")) j++;
      if (text[j] === (ch === "{" ? "}" : "]")) {
        out.push(ch, text[j]!);
        i = j;
        continue;
      }
      depth++;
      out.push(ch, pad());
    } else if (ch === "}" || ch === "]") {
      depth--;
      out.push(pad(), ch);
    } else if (ch === ",") out.push(ch, pad());
    else if (ch === ":") out.push(": ");
    else out.push(ch);
  }
  return { ok: true, text: out.join("") + (text.endsWith("\n") ? "\n" : "") };
}
