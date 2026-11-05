// CV-2: Show messages renders like Teams: one person's consecutive messages grouped under one name and avatar, mine on
// the other side, a quote block with the quoted author and first line (or "Quoted an earlier message"), the sanitized
// body (a table, a link, a mention chip), reactions as counts, and Show earlier only when there is more.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../plan/conversation-views.ts";
import { sanitizeMessageHtml } from "../plan/sanitize.ts";
import { groupMessages, MessageThread } from "./MessageThread.tsx";

const msg = (o: Partial<ConversationMessage> & Pick<ConversationMessage, "messageId" | "at">): ConversationMessage => ({
  author: "Blake Novak", authorKey: "p1", name: "Blake Novak", email: null, external: true, mine: false, html: "<p>Hi</p>", text: "Hi", quote: null, reactions: [], ...o,
});

const thread: ConversationMessage[] = [
  msg({ messageId: "1", at: "2026-11-04T21:13:00Z", html: sanitizeMessageHtml('<p><at id="0">Evan</at> the totals differ:</p><table><tr><td>MD</td><td>12,400 lb</td></tr></table><p>See <a href="https://contoso.example/report">the report</a>, <b>please</b>.</p>', { mentions: [{ name: "Evan Ford" }] }) }),
  msg({ messageId: "2", at: "2026-11-04T21:15:00Z", html: "<p>Any news?</p>" }),
  msg({ messageId: "3", at: "2026-11-04T22:13:00Z", author: "You", authorKey: "p2", name: "Lena Hart", email: "lena@contoso.example", external: false, mine: true, html: "<p>Looking now</p>", quote: { author: "Blake Novak", text: "Evan the totals differ:" }, reactions: [{ emoji: "👍", count: 2 }, { emoji: "😂", count: 1 }] }),
  msg({ messageId: "4", at: "2026-11-04T22:30:00Z", author: "Evan Ford", authorKey: "p3", name: "Evan Ford", email: "evan@contoso.example", external: false, html: "<p>On it</p>", quote: { author: null, text: null } }),
  msg({ messageId: "5", at: "2026-11-04T22:55:00Z", author: "Evan Ford", authorKey: "p3", name: "Evan Ford", email: "evan@contoso.example", external: false, html: "<p>Later one</p>" }),
];

const render = (o: Partial<Parameters<typeof MessageThread>[0]> = {}) =>
  renderToStaticMarkup(createElement(MessageThread, { messages: thread, tz: "America/Chicago", photoFor: (e) => (e === "evan@contoso.example" ? "data:image/png;base64,AAAA" : null), earlier: false, onEarlier: () => {}, ...o }));

describe("Show messages like Teams", () => {
  it("groups one person's consecutive messages, a few minutes apart", () => {
    expect(groupMessages(thread).map((g) => g.messages.map((m) => m.messageId))).toEqual([["1", "2"], ["3"], ["4"], ["5"]]);
  });

  it("puts mine on the other side, with no avatar or name", () => {
    const html = render();
    const groups = html.split('<li class="tm-group').slice(1);
    expect(groups).toHaveLength(4);
    expect(groups[1]).toMatch(/^ mine"/);
    expect(groups[1]).not.toContain('class="avatar');
    expect(groups[1]).not.toContain("tm-name");
    // Theirs: avatar (a Cooptimizer's photo, an external person's initials), name once per group, External marked.
    expect(groups[0]).toContain('class="avatar-initials">BN<');
    expect(groups[0]!.match(/tm-name/g)).toHaveLength(1);
    expect(groups[0]).toContain("External");
    expect(groups[2]).toContain('src="data:image/png;base64,AAAA"');
  });

  it("shows a quote block with the quoted author and first line, or says it quoted an earlier message", () => {
    const html = render();
    expect(html).toContain('<blockquote class="tm-quote"><span class="tm-quote-who">Blake Novak</span><span class="tm-quote-text">Evan the totals differ:</span></blockquote>');
    expect(html).toContain("Quoted an earlier message");
  });

  it("renders the table, the link, bold and the mention chip from the sanitized body; reactions as counts", () => {
    const html = render();
    expect(html).toContain('<span class="mention">Evan Ford</span>');
    expect(html).toContain("<table><tr><td>MD</td><td>12,400 lb</td></tr></table>");
    expect(html).toMatch(/<a href="https:\/\/contoso\.example\/report"[^>]*>the report<\/a>/);
    expect(html).toContain("<strong>please</strong>");
    expect(html).toContain('<span class="tm-reaction">👍<span class="tm-reaction-n">2</span></span><span class="tm-reaction">😂</span>');
  });

  it("offers Show earlier only when there is more", () => {
    expect(render()).not.toContain("Show earlier");
    expect(render({ earlier: true })).toContain("Show earlier");
  });
});
