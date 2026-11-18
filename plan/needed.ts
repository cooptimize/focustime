// RQ-1: the fields a client's process needs on a new item, as DevOps itself says when FocusTime asks it to check the
// item without saving it (sources/devops/write.ts checkCreate, run by the write framework before every create's
// preview). Which of FocusTime's controls fills each field, and every word said about them, in one place: the New
// form, a draft, a call's row and Break down read them from here. Pure: no I/O, no field, type or client names of its
// own (a needed field is whatever DevOps says; its reference names are only matched against the type's own fields).

/** A control FocusTime has for a field on a new item. */
export type NeededFill = "title" | "description" | "check" | "assignTo" | "date" | "start" | "size";
/** One field the process needs: its reference name (when known), its name as DevOps shows it, and the control that fills it (null: none). */
export type NeededField = { ref: string | null; name: string; fill: NeededFill | null };

/** What the check found for one new item: fine, the fields still needed, or it couldn't be made (no write token, DevOps not answering). */
export type NeededAnswer = { checked: true; needed: NeededField[]; /** DevOps named only the first field: check again once it is filled. */ partial: boolean } | { checked: false; needed: NeededField[] };

/** The type's own fields that FocusTime's controls write, as the write framework found them for this type. */
export type FillRefs = { target: string | null; start: string | null; size: string | null; acceptance: string; description: string; assignedTo: string; title: string };

/** The control for a reference name, or null when FocusTime has none for it. */
export function fillOf(ref: string | null, r: FillRefs): NeededFill | null {
  if (!ref) return null;
  if (ref === r.title) return "title";
  if (ref === r.description) return "description";
  if (ref === r.acceptance) return "check";
  if (ref === r.assignedTo) return "assignTo";
  if (r.target && ref === r.target) return "date";
  if (r.start && ref === r.start) return "start";
  if (r.size && ref === r.size) return "size";
  return null;
}

/**
 * DevOps's named fields as NeededFields: a name found from its reference name (the project's field list) or the other
 * way round, then the control that fills it. Unknown names are kept, with no control.
 */
export function neededFrom(named: readonly { ref: string | null; name: string | null }[], all: readonly { referenceName: string; name: string }[], r: FillRefs): NeededField[] {
  const out: NeededField[] = [];
  for (const f of named) {
    const byRef = f.ref ? all.find((x) => x.referenceName === f.ref) : undefined;
    const squash = (v: string) => v.toLowerCase().replace(/\s+/g, "");
    const byName = !byRef && f.name ? all.find((x) => squash(x.name) === squash(f.name!)) : undefined;
    const ref = f.ref ?? byName?.referenceName ?? null;
    const name = byRef?.name ?? f.name ?? byName?.name ?? (ref ? (ref.split(".").pop() ?? ref) : null);
    if (!name || out.some((x) => (ref && x.ref === ref) || x.name === name)) continue;
    out.push({ ref, name, fill: fillOf(ref, r) });
  }
  return out;
}

/** The two lists merged, DevOps's first; a field already in it isn't said twice. */
export function mergeNeeded(a: readonly NeededField[], b: readonly NeededField[]): NeededField[] {
  const out = [...a];
  for (const f of b) if (!out.some((x) => (f.ref && x.ref === f.ref) || x.name === f.name)) out.push(f);
  return out;
}

/** The fields a screen can fill (`has`) and those it can't: the latter are said in plain words with the way out. */
export function splitNeeded(n: readonly NeededField[], has: ReadonlySet<NeededFill>): { fill: NeededField[]; cant: NeededField[] } {
  return { fill: n.filter((f) => f.fill && has.has(f.fill)), cant: n.filter((f) => !f.fill || !has.has(f.fill)) };
}

const and = (names: readonly string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** RQ-1's words (docs/design/wording.md "RQ-1 words"). */
export const NEEDED_WORDS = {
  /** The mark beside a field's label. */
  needed: "Needed",
  /** Under a needed field, and kept once it is filled. */
  why: "Required by this client's process",
  /** Optional fields say so, as before. */
  optional: "Optional",
  /** A preview held back: the fields it still needs, which this screen fills. */
  fillFirst: (names: readonly string[], type: string) => `${and(names)} ${names.length === 1 ? "is" : "are"} needed: this client's process requires ${names.length === 1 ? "it" : "them"} on a new ${type}. Fill ${names.length === 1 ? "it" : "them"} in, then preview again.`,
  /** A field FocusTime has no control for (the New form's way out). */
  cant: (project: string, names: readonly string[], type: string) => `${project}'s process needs ${and(names)} on a new ${type}, which FocusTime doesn't fill. Create this one in DevOps, or save it as a draft.`,
  /** The draft editor: a field only the New form has; Create in DevOps opens it there. */
  inNewForm: (names: readonly string[]) => `${and(names)} ${names.length === 1 ? "is" : "are"} needed by this client's process. Create in DevOps opens the New form to fill ${names.length === 1 ? "it" : "them"} in.`,
  /** Break down: a story still needs a value. */
  storyNeeds: (names: readonly string[]) => `Needs ${and(names)} before it can be created`,
  /** Break down's button: one value on every story. */
  useForAll: "Use for all",
  /** Break down: the stories start with the feature's value. */
  fromFeature: (name: string) => `${name} starts from the feature's. Change any one, or use one for all.`,
  /** Break down's Preview, held. */
  holdPublish: (n: number) => `${n === 1 ? "1 story needs" : `${n} stories need`} a value before the preview`,
  /** A refusal at Confirm, or one stored from before RQ-1: the field in plain words, never DevOps's own text. */
  refusedField: (field: string, type: string | null) => `DevOps says ${field} is needed on a new ${type ?? "item"}. Fill it in and try again.`,
  refusedFields: "DevOps refused one of this item's fields. Check the fields and try again.",
  /** A call's row: Create and break down, and Break down on a feature created from the call. */
  createAndBreakDown: "Create and break down",
  createAndBreakDownWhy: "Creates it through the preview, then opens Break down on it and starts Run. Nothing more is created until you confirm the stories.",
  breakDown: "Break down",
} as const;

/** A rule error's text as DevOps words it ("TF401320: Rule Error for field <name>.") made plain, or the message as it was. */
export function plainRefusal(message: string, type: string | null): string {
  const field = /TF401320: Rule Error for field ([^.]{1,120})\./.exec(message)?.[1]?.trim();
  if (field) return NEEDED_WORDS.refusedField(field, type);
  if (/TF401320/.test(message)) return NEEDED_WORDS.refusedFields;
  return message;
}

/** The preview's refusal for a create that still needs fields: the ones a person can fill, then the ones they can't. */
export function neededMessage(n: readonly NeededField[], o: { project: string; type: string; has: ReadonlySet<NeededFill> }): string {
  const { fill, cant } = splitNeeded(n, o.has);
  return [fill.length ? NEEDED_WORDS.fillFirst(fill.map((f) => f.name), o.type) : "", cant.length ? NEEDED_WORDS.cant(o.project, cant.map((f) => f.name), o.type) : ""].filter(Boolean).join(" ");
}

/** A process level as the New form's options carry it: its kind and the types at it, highest first. */
export type LevelOf = { kind: "portfolio" | "requirement" | string; types: readonly string[] };
/** RQ-1: is this type at story level in the client's process (by its levels' kinds, never by a type's or level's name)? */
export const isStoryLevel = (levels: readonly LevelOf[] | undefined, type: string): boolean => !!type && levels?.find((l) => l.types.includes(type))?.kind === "requirement";
/** RQ-1: is this type at the feature tier (the lowest portfolio level of the client's process)? */
export const isFeatureTier = (levels: readonly LevelOf[] | undefined, type: string): boolean => !!type && !!levels?.filter((l) => l.kind === "portfolio").at(-1)?.types.includes(type);
