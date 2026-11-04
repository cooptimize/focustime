// F1: Send feedback (⋯ › Send feedback). Pure: what a feedback item is, and the exact title, description and tags
// that become a User Story under the FocusTime feature in Cooptimize's DevOps. The payload is built only from what the
// person typed, their name and email, the optional "where I am" lines and the environment: the builder has no way to
// reach the plan, clients or work items, so none of it can end up in DevOps. No I/O.

export const FEEDBACK_KINDS = ["idea", "problem", "question"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const KIND_LABEL: Record<FeedbackKind, string> = { idea: "Idea", problem: "Problem", question: "Question" };

/** The title's text after the type prefix. */
export const TITLE_MAX = 80;
/** What one feedback may hold. */
export const TEXT_MAX = 4000;
/** Sends per person per day (their local day). */
export const DAILY_LIMIT = 10;
export const FEEDBACK_TAG = "FocusTime feedback";
export const DESTINATION = "Goes to the FocusTime backlog in Cooptimize's DevOps";
export const NOT_SET_UP = "Feedback isn't set up yet. Message the FocusTime team in Teams.";
export const LIMIT_REACHED = `That's ${DAILY_LIMIT} for today, the most FocusTime sends in a day. Message the FocusTime team in Teams, or send it tomorrow.`;

/** "Include where I am": the view, ⋯ › About's version line, the browser and the screen size. */
export type Where = { view: string; version: string; browser: string; screen: string };
export type FeedbackDraft = { kind: FeedbackKind; text: string; where: Where | null };
export type Sender = { name: string; email: string | null };
/** What is created: the story's title, its description (plain text; HTML is made from it at the edge) and tags. */
export type FeedbackPayload = { title: string; description: string; tags: string[] };

const WHERE_MAX: Record<keyof Where, number> = { view: 60, version: 120, browser: 120, screen: 40 };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** One line: control characters out, spaces collapsed. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** The draft from the window's input, or why not. Unknown fields are refused; nothing else is accepted. */
export function parseDraft(input: unknown): FeedbackDraft | { error: string } {
  if (!isObj(input)) return { error: "feedback takes { kind, text, where? }" };
  for (const k of Object.keys(input)) if (!["kind", "text", "where"].includes(k)) return { error: `unknown input field ${k}` };
  const kind = input.kind;
  if (typeof kind !== "string" || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) return { error: "kind must be idea, problem or question" };
  if (typeof input.text !== "string") return { error: "text is required" };
  const text = input.text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!text) return { error: "Write something first" };
  if (text.length > TEXT_MAX) return { error: `That's more than ${TEXT_MAX} characters. Shorten it a little` };
  let where: Where | null = null;
  if (input.where !== undefined && input.where !== null) {
    const w = input.where;
    if (!isObj(w) || Object.keys(w).some((k) => !(k in WHERE_MAX))) return { error: "where takes { view, version, browser, screen }" };
    const pick = (k: keyof Where) => (typeof w[k] === "string" ? oneLine(w[k] as string).slice(0, WHERE_MAX[k]) : "");
    where = { view: pick("view"), version: pick("version"), browser: pick("browser"), screen: pick("screen") };
  }
  return { kind: kind as FeedbackKind, text, where };
}

/** "Idea: <first line, up to 80 characters>", with "[dev] " first on dev. */
export function feedbackTitle(kind: FeedbackKind, text: string, dev: boolean): string {
  const first = oneLine(text.split("\n").find((l) => l.trim()) ?? "");
  const cut = first.length > TITLE_MAX ? first.slice(0, TITLE_MAX).trimEnd() : first;
  return `${dev ? "[dev] " : ""}${KIND_LABEL[kind]}: ${cut}`;
}

/** The exact story: title, description (what was typed, who sent it, where if included, the environment) and tags. */
export function buildFeedback(d: FeedbackDraft, sender: Sender, env: string): FeedbackPayload {
  const from = `From ${oneLine(sender.name) || "someone"}${sender.email ? ` (${oneLine(sender.email)})` : ""}`;
  const lines = [d.text, "", from];
  if (d.where) {
    if (d.where.view) lines.push(`View: ${d.where.view}`);
    if (d.where.version) lines.push(`Version: ${d.where.version}`);
    if (d.where.browser) lines.push(`Browser: ${d.where.browser}`);
    if (d.where.screen) lines.push(`Screen: ${d.where.screen}`);
  }
  lines.push(`Environment: ${env}`);
  return { title: feedbackTitle(d.kind, d.text, env === "dev"), description: lines.join("\n"), tags: [FEEDBACK_TAG, KIND_LABEL[d.kind]] };
}

/** How many a person has sent on a day, from the stored count (anything malformed counts as none). */
export const sentToday = (stored: unknown, date: string): number =>
  isObj(stored) && stored.date === date && typeof stored.count === "number" && stored.count >= 0 ? stored.count : 0;
