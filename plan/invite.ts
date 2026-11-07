// IN-1: Who's set up and Invite to FocusTime, pure. A Cooptimizer's setup is four yes or no marks from what FocusTime
// already keeps (signed in, a DevOps write PAT for any client, the Outlook calendar's refresh token, the Teams app's
// 1:1 chat with the bot); never which PAT, its client, scope or expiry. The invite is a message an admin sends
// themselves: a Teams deep link to a 1:1 chat with the message prefilled, an Outlook on the web compose link (with a
// mailto fallback) or a copy. FocusTime sends nothing. Links carry only the recipients' addresses, the subject and the
// message the admin sees and can edit; never a token, an id of theirs or anything about a client.

export type SetupMarks = {
  signedIn: boolean;
  devops: boolean;
  calendar: boolean;
  /** null: FocusTime can't know here (the Teams app isn't set up in this environment). */
  teams: boolean | null;
};

/** One Cooptimizer in Who's set up: yes or no marks, days and names only. Never a PAT, its client, scope or expiry. */
export type SetupRow = SetupMarks & {
  id: string;
  name: string;
  /** For the invite's To (Teams and Outlook); only shown to admins, as Admin › People already does. */
  email: string | null;
  me: boolean;
  /** The day they were last active (the admin's day), never a time. */
  lastActiveDay: string | null;
  invited: { day: string; byName: string } | null;
};

export type SetupFilter = "all" | "not_signed_in" | "partly";
export const SETUP_FILTERS: readonly (readonly [SetupFilter, string])[] = [
  ["all", "All"],
  ["not_signed_in", "Not signed in"],
  ["partly", "Set up partly"],
];

/** Signed in with something left to connect. Teams counts only where FocusTime can know it. */
export function partlySetUp(m: SetupMarks): boolean {
  return m.signedIn && (!m.devops || !m.calendar || m.teams === false);
}

export function matchesFilter(m: SetupMarks, f: SetupFilter): boolean {
  return f === "all" ? true : f === "not_signed_in" ? !m.signedIn : partlySetUp(m);
}

/** "6 of 9 signed in · 2 set up partly". */
export function setupCounts(all: readonly SetupMarks[]): { total: number; signedIn: number; partly: number; notSignedIn: number; text: string } {
  const signedIn = all.filter((m) => m.signedIn).length;
  const partly = all.filter(partlySetUp).length;
  const text = `${signedIn} of ${all.length} signed in` + (partly ? ` · ${partly} set up partly` : "");
  return { total: all.length, signedIn, partly, notSignedIn: all.length - signedIn, text };
}

/** The word put where each person's first name goes. Several people in one email read "Hi all,". */
export const NAME_TOKEN = "{first name}";

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name.trim();

export const INVITE_SUBJECT = "Try FocusTime";

/** The editable message: what FocusTime is, the app link, the first three steps, and the Teams app when it's set up. */
export function inviteTemplate(o: { appUrl: string; teamsAppLink: string | null; from: string }): string {
  const lines = [
    `Hi ${NAME_TOKEN},`,
    "",
    "FocusTime is Cooptimize's planner for your week: your focus blocks, meetings and DevOps work in one place.",
    "",
    `Open it here: ${o.appUrl}`,
    "",
    "To get started:",
    "1. Sign in with your Cooptimize Microsoft account.",
    "2. Connect DevOps in Settings › DevOps.",
    "3. Look at Week to see your blocks and what's planned.",
  ];
  if (o.teamsAppLink) lines.push("", `You can also add FocusTime in Teams: ${o.teamsAppLink}`);
  lines.push("", firstName(o.from) || "Thanks");
  return lines.join("\n");
}

/** The message for one person ("Ana"), or for several at once ("all"). */
export function personalize(message: string, name: string | null): string {
  return message.split(NAME_TOKEN).join(name ? firstName(name) : "all");
}

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
export const validEmail = (e: string | null | undefined): e is string => !!e && EMAIL.test(e.trim());

const enc = encodeURIComponent;

/** Teams: a new 1:1 chat with them, the message prefilled (they see it only once the admin sends it). */
export function teamsChatLink(email: string, message: string): string {
  if (!validEmail(email)) throw new Error("Not an email address");
  return `https://teams.microsoft.com/l/chat/0/0?users=${enc(email.trim())}&message=${enc(message)}`;
}

/** Outlook on the web: a new email to all of them with the subject and message prefilled. */
export function outlookComposeLink(emails: readonly string[], subject: string, body: string): string {
  const to = emails.filter(validEmail).map((e) => e.trim());
  if (!to.length) throw new Error("No email address");
  return `https://outlook.office.com/mail/deeplink/compose?to=${enc(to.join(";"))}&subject=${enc(subject)}&body=${enc(body)}`;
}

/** The fallback: the computer's own mail app. */
export function mailtoLink(emails: readonly string[], subject: string, body: string): string {
  const to = emails.filter(validEmail).map((e) => e.trim());
  if (!to.length) throw new Error("No email address");
  return `mailto:${to.map(enc).join(",")}?subject=${enc(subject)}&body=${enc(body)}`;
}

/** The Teams app's page in the Teams store of this organization, from the environment's app id (when it's set up). */
export function teamsAppLink(appId: string | null): string | null {
  return appId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId) ? `https://teams.microsoft.com/l/app/${appId}` : null;
}
