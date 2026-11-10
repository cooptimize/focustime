// CAL-1: Settings › Accounts and calendars › Add a calendar by link. Every response is the person's own links, by
// name, color, host and their last check; never the link itself (it goes in, it never comes out). Read only: nothing
// here writes to a calendar.
import type { ActionResponse } from "./types.ts";
import type { CalendarLink, LinkKind, LinkMode } from "../store/calendar-links.ts";
import { COLOR, LinkAddError, NAME_MAX, type LinkCalendars } from "../sources/ics/source.ts";
import { FAILURE_TEXT, LINK_BROKEN, type IcsFailure } from "../sources/ics/fetch.ts";

export const CALENDAR_LINK_ACTIONS = ["calendar_link.list", "calendar_link.preview", "calendar_link.add", "calendar_link.update", "calendar_link.replace", "calendar_link.remove"] as const;
export type CalendarLinkAction = (typeof CALENDAR_LINK_ACTIONS)[number];

import type { CalendarLinkView } from "./calendar-link-types.ts";
export type { CalendarLinkView };

const view = (l: CalendarLink): CalendarLinkView => ({
  ...l,
  host: `${l.host}/…`,
  problem: l.failure ? (FAILURE_TEXT[l.failure as IcsFailure] ?? "The calendar couldn't be read") : null,
  broken: !!l.failure && LINK_BROKEN.has(l.failure as IcsFailure),
});

const bad = (error: string): ActionResponse => ({ ok: false, status: 400, error });
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const only = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).find((k) => !keys.includes(k));

function fields(o: Record<string, unknown>, partial: boolean): { ok: true; v: Partial<{ name: string; color: string; mode: LinkMode; kind: LinkKind }> } | { ok: false; error: string } {
  const v: Partial<{ name: string; color: string; mode: LinkMode; kind: LinkKind }> = {};
  if (o.name !== undefined || !partial) {
    if (typeof o.name !== "string" || !o.name.trim() || o.name.trim().length > NAME_MAX) return { ok: false, error: `Give the calendar a name (1 to ${NAME_MAX} characters)` };
    v.name = o.name.trim();
  }
  if (o.color !== undefined || !partial) {
    if (typeof o.color !== "string" || !COLOR.test(o.color)) return { ok: false, error: "Pick a color" };
    v.color = o.color.toLowerCase();
  }
  if (o.mode !== undefined || !partial) {
    if (o.mode !== "busy" && o.mode !== "titles") return { ok: false, error: "mode is busy or titles" };
    v.mode = o.mode;
  }
  if (o.kind !== undefined || !partial) {
    if (o.kind !== "personal" && o.kind !== "work") return { ok: false, error: "kind is personal or work" };
    v.kind = o.kind;
  }
  return { ok: true, v };
}

const ID = /^[a-f0-9]{16}$/;

export async function calendarLinkAction(links: LinkCalendars | undefined, action: CalendarLinkAction, input: unknown): Promise<ActionResponse> {
  if (!links) return { ok: false, status: 503, error: "Calendar links aren't available here" };
  const o = input === undefined ? {} : input;
  if (!isObj(o)) return bad(`${action} takes an object`);
  try {
    switch (action) {
      case "calendar_link.list": {
        if (only(o, [])) return bad("calendar_link.list takes no input");
        return { ok: true, data: { links: (await links.list()).map(view) } };
      }
      case "calendar_link.preview": {
        const x = only(o, ["url"]);
        if (x) return bad(`unknown input field ${x}`);
        return { ok: true, data: await links.preview(o.url) };
      }
      case "calendar_link.add": {
        const x = only(o, ["url", "name", "color", "mode", "kind"]);
        if (x) return bad(`unknown input field ${x}`);
        const f = fields(o, false);
        if (!f.ok) return bad(f.error);
        const v = f.v as { name: string; color: string; mode: LinkMode; kind: LinkKind };
        return { ok: true, data: { link: view(await links.add({ url: o.url, ...v })) } };
      }
      case "calendar_link.update": {
        const x = only(o, ["id", "name", "color", "mode", "kind"]);
        if (x) return bad(`unknown input field ${x}`);
        if (typeof o.id !== "string" || !ID.test(o.id)) return bad("id is a calendar link id");
        const f = fields(o, true);
        if (!f.ok) return bad(f.error);
        const l = await links.update(o.id, f.v);
        return l ? { ok: true, data: { link: view(l) } } : { ok: false, status: 404, error: "That calendar link isn't there any more" };
      }
      case "calendar_link.replace": {
        const x = only(o, ["id", "url"]);
        if (x) return bad(`unknown input field ${x}`);
        if (typeof o.id !== "string" || !ID.test(o.id)) return bad("id is a calendar link id");
        return { ok: true, data: { link: view(await links.replace(o.id, o.url)) } };
      }
      case "calendar_link.remove": {
        const x = only(o, ["id"]);
        if (x) return bad(`unknown input field ${x}`);
        if (typeof o.id !== "string" || !ID.test(o.id)) return bad("id is a calendar link id");
        return (await links.remove(o.id)) ? { ok: true, data: { removed: true } } : { ok: false, status: 404, error: "That calendar link isn't there any more" };
      }
    }
  } catch (e) {
    // A plain sentence of ours (never the link, never the server's words).
    if (e instanceof LinkAddError) return { ok: false, status: 422, error: e.message };
    if (e instanceof Error && /^At most \d+ calendar links/.test(e.message)) return { ok: false, status: 422, error: e.message };
    return { ok: false, status: 500, error: "The calendar link couldn't be saved" };
  }
}
