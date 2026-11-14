// RS-1: an icon before every menu and command menu item, from the one family (ui/icons.tsx). An item may name its
// own (`icon`); otherwise it comes from what the item does, read from its registry action first and its words second,
// so a new item gets a fitting icon without a list to keep. Pure: names only, no drawing (the menus draw them).
import type { IconName } from "./icons.tsx";

type Item = { id?: string; label: string; action?: string | undefined; group?: string | undefined; icon?: IconName | undefined; danger?: boolean | undefined; next?: unknown };

/** By the registry action (or UI command id): the most certain reading. First match wins. */
const BY_ACTION: readonly (readonly [RegExp, IconName])[] = [
  [/^timer\.(start|resume)/, "focus"], [/^timer\.pause/, "pause"], [/^timer\.(stop|done)/, "stop"], [/^timer\./, "timer"],
  [/^capture\./, "capture"], [/^assistant\.|^ask\./, "ask"], [/^code\./, "code"],
  [/^devops\.(preview|confirm)|^item\.new|^draft\.create/, "add"], [/^draft\./, "edit"],
  [/^timebox\.|^pick\.time/, "time"], [/^pick\.(done|tick)/, "done"], [/^pick\.(move|carry)/, "move"], [/^pick\.(drop|remove)/, "remove"], [/^pick\.add/, "add"],
  [/^followup\.close|^loop\./, "loop"], [/^followup\./, "promise"], [/^promise\./, "promise"],
  [/^week\.(prev|next|today)|^nav\.week/, "week"], [/^refresh|\.refresh$|^sources\./, "refresh"],
  [/^settings\.|^ui\.settings/, "settings"], [/^guide\.|^ui\.guide/, "guide"], [/^docs\.|^ui\.docs/, "docs"], [/^ui\.keys/, "keys"], [/^ui\.commands/, "commands"],
  [/^feedback\./, "feedback"], [/^ui\.about/, "about"], [/^vm\./, "vm"], [/^presence\./, "focus"], [/^rsvp\./, "meeting"], [/^invite\.|^help\./, "people"],
  [/^send\.|^priority\./, "send"], [/^deploy\./, "deploy"], [/^meeting\./, "meeting"], [/^unavailable\.|^hours\./, "time"], [/^flex\.|^borrow\./, "time"],
  [/^ui\.text_size|^ui\.textsize/, "text-size"], [/^ui\.theme/, "theme"], [/^inbox\./, "inbox"], [/^ahead\.|^backlog\./, "backlog"], [/^status\./, "status"],
];

/** By the item's words, in order: the first that fits. Plain words, the ones the menus use. */
const BY_WORDS: readonly (readonly [RegExp, IconName])[] = [
  [/^(Undo|Put back|Restore|Reopen|Not done)\b/i, "undo"],
  [/^(Delete|Remove|Drop|Discard|Clear|Take off|Cancel|Dismiss|Not needed|Decline)\b/i, "remove"],
  [/^Close the loop/i, "loop"], [/^(Send|Pass)\b/i, "send"],
  [/^(Start focus|Deep focus|Focus)\b/i, "focus"], [/^Pause\b/i, "pause"], [/^Resume\b/i, "play"], [/^Stop\b/i, "stop"], [/^(Break|\+15|Next to-do)\b/i, "timer"],
  [/^(Join|Start a call|Call)\b/i, "call"], [/\b(meeting|client calls?)\b/i, "meeting"],
  [/^(Timebox|Custom time|Custom…|Remove time|Start and length|Change end|Put on Outlook|Tonight|Morning|Afternoon|Evening|Free |Move to \d|Keep \d|\d+ min|Open (AM|PM|the evening)|Working hours|Use the usual hours|Block time|I'll make it up|Add a flex|No borrowed)/i, "time"],
  [/^(Snooze|Due|Another (day|date)|Date|Plan a deployment|Deployment details)/i, "schedule"],
  [/^(Done|Mark done|Accept|Confirm|Keep|Tentative|Completed|Resolve)\b/i, "done"],
  [/^(Copy)\b/i, "copy"], [/\b(link)\b/i, "link"],
  [/^(Open in (Outlook|Teams|DevOps|browser)|Open .* in your browser|Open in)/i, "external"],
  [/^(Edit|Rename|Retitle|Change|Set |Size|Estimate|Note|Propose)\b/i, "edit"],
  [/^(Move|To |Carry)\b/i, "move"], [/^Pin\b/i, "pin"],
  [/^(Add work|Add to|Add a|Add|New|Create|\+ )/i, "add"],
  [/^(Break down|Draft|AI)\b/i, "ai"], [/^(Ask to collaborate|Assign|Take|Who|Send to)\b/i, "people"], [/^Ask\b/i, "ask"],
  [/^(Refresh|Retry|Check again|Reload|Sync)\b/i, "refresh"],
  [/^(Search|Find|Look up)\b/i, "search"], [/^Filter\b/i, "filter"], [/^Sort\b/i, "sort"],
  [/^(Hide|Show less)\b/i, "hide"], [/^(Show me)\b/i, "guide"], [/^(Show|View|Preview|Cards|Timeline|Timelines|Personal events|Callouts|Every weekend)\b/i, "preview"],
  [/^Code\b/i, "code"], [/^Capture/i, "capture"], [/^Guide\b/i, "guide"], [/^Technical docs\b/i, "docs"], [/^Keyboard\b/i, "keys"], [/^Commands?\b/i, "commands"],
  [/^(Send feedback|Feedback)\b/i, "feedback"], [/^About\b/i, "about"], [/^Settings\b/i, "settings"], [/^Admin\b/i, "admin"], [/^Sign out\b/i, "sign-out"],
  [/^Notifications?\b/i, "notices"], [/^(Install|On your phone)\b/i, "phone"], [/^(Text size|Larger text|Smaller text)\b/i, "text-size"], [/^Theme\b/i, "theme"],
  [/^(Export|Download)\b/i, "download"], [/^Demo\b/i, "data"], [/^Diagnostics\b/i, "activity"], [/^DevOps patterns\b/i, "backlog"],
  [/^(Day|Today|Go to today|Back to today)\b/i, "day"], [/^(Week|Previous week|Next week|Back to this week|Friday)\b/i, "week"],
  [/^Backlog\b/i, "backlog"], [/^Status\b/i, "status"], [/^Inbox\b/i, "inbox"], [/^Promises?\b|What I owe/i, "promise"], [/^From chats\b/i, "chats"],
  [/^(Previous|Next) region\b/i, "keys"], [/^Open\b/i, "next"], [/^Start\b/i, "play"], [/^VM\b/i, "vm"], [/^(PTO|Holiday)\b/i, "pto"],
];

/** By the item's group (the command menu's headings): what the item belongs to, when neither its action nor its words say more. */
const BY_GROUP: Readonly<Record<string, IconName>> = {
  Conversations: "chats", "From chats": "chats", Settings: "settings", DevOps: "backlog", "Work items": "backlog", Week: "week", "To-dos": "done", Promises: "promise",
  Admin: "admin", Views: "preview", Display: "theme", Team: "people", Focus: "focus", Meetings: "meeting", Inbox: "inbox", Help: "help", Sources: "connect",
  "My VM": "vm", "Close out": "day", Assistant: "ask", Day: "day", Capture: "capture", Timebox: "time", Time: "time", Code: "code", Keyboard: "keys", Calendar: "calendar",
};

/** The icon for a menu item: its own, else by action, by its words, then by its group; a step into another list is "next"; else a plain dot. */
export function menuIcon(it: Item): IconName {
  if (it.icon) return it.icon;
  for (const [re, name] of BY_WORDS.slice(0, 2)) if (re.test(it.label)) return name;
  if (it.action) for (const [re, name] of BY_ACTION) if (re.test(it.action)) return name;
  for (const [re, name] of BY_WORDS) if (re.test(it.label)) return name;
  const byGroup = it.group ? BY_GROUP[it.group] : undefined;
  return byGroup ?? (it.next ? "next" : "dot");
}
