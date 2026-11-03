// A2: a person's settings are kept as rows, one per top-level section of the settings text ([hours] with its
// [[hours.override]] tables, [ui], [[standing_blocks]], ...), in the order they appear. The text is still what the
// parser and every Settings edit work on; it is put together from the rows (plus the app's keys) when loaded and split
// back into rows when saved. App-level keys (the Dataverse, Microsoft and Google registrations) are never kept in a
// person's rows: they come from the app config every time.

/** Settings the app owns: removed from a person's text before it is stored. */
const APP_KEYS: Record<string, readonly string[] | "all"> = {
  dataverse: ["environment_url", "tenant_id", "client_id"],
  outlook: "all",
  google: ["client_id"],
  // A1 removed these; older files still have them.
  edge: "all",
  chromium: "all",
};

export type SettingsRow = { section: string; position: number; body: string };

const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;

/** The top-level name of a table header's key ("hours" for [[hours.override]], "T&W" for ["T&W".x]). */
function rootOf(key: string): string {
  const k = key.trim();
  if (k.startsWith('"')) {
    const end = k.indexOf('"', 1);
    return end > 0 ? k.slice(1, end) : k;
  }
  return k.split(".")[0]!.trim();
}

/**
 * Splits settings text into rows by top-level section. Comment lines right above a header go with that header's
 * section; lines before the first header (top-level keys, the file's opening comments) are the "" section.
 */
export function splitSettings(text: string): SettingsRow[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = new Map<string, string[]>();
  const order: string[] = [];
  let current = "";
  let pending: string[] = [];
  const add = (section: string, ls: string[]) => {
    if (!blocks.has(section)) {
      blocks.set(section, []);
      order.push(section);
    }
    blocks.get(section)!.push(...ls);
  };
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m && !line.trim().startsWith("#")) {
      current = rootOf(m[1]!);
      add(current, [...pending, line]);
      pending = [];
    } else if (/^\s*#/.test(line) || line.trim() === "") {
      pending.push(line);
    } else {
      add(current, [...pending, line]);
      pending = [];
    }
  }
  if (pending.some((l) => l.trim())) add(current, pending);
  return order
    .map((section, position) => ({ section, position, body: trimBlank(blocks.get(section)!).join("\n") }))
    .filter((r) => r.body.trim() !== "");
}

const trimBlank = (ls: string[]) => {
  let a = 0;
  let b = ls.length;
  while (a < b && ls[a]!.trim() === "") a++;
  while (b > a && ls[b - 1]!.trim() === "") b--;
  return ls.slice(a, b);
};

/** The settings text for rows, in their order. */
export function joinSettings(rows: readonly SettingsRow[]): string {
  return `${[...rows].sort((x, y) => x.position - y.position).map((r) => r.body).join("\n\n")}\n`;
}

/** A person's rows: the text split, with every app-level key and section taken out. */
export function personalRows(text: string): SettingsRow[] {
  const out: SettingsRow[] = [];
  for (const r of splitSettings(text)) {
    const app = APP_KEYS[r.section];
    if (app === "all") continue;
    if (!app) {
      out.push(r);
      continue;
    }
    const keyRe = new RegExp(`^\\s*(${app.join("|")})\\s*=`);
    // The key's line goes, and the comment lines right above it (they describe it).
    const kept: string[] = [];
    let comments: string[] = [];
    for (const l of r.body.split("\n")) {
      if (/^\s*#/.test(l)) comments.push(l);
      else {
        if (!keyRe.test(l)) kept.push(...comments, l);
        comments = [];
      }
    }
    kept.push(...comments);
    out.push({ ...r, body: kept.join("\n") });
  }
  return out.map((r, position) => ({ ...r, position }));
}
