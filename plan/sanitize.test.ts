import { describe, expect, it } from "vitest";
import { bodyKind, sanitizeMessageHtml } from "./sanitize.ts";

describe("sanitizeMessageHtml", () => {
  it("keeps the mention chip, a 2x2 table and a link; drops a script and an inline style", () => {
    const body = `<div style="color:red" onclick="x()"><at id="0">Eric</at> can you look?<script>alert(1)</script>
      <table class="t" style="width:1px"><tbody><tr><td>PMD</td><td>12,400</td></tr><tr><td>PFEP</td><td>4,700</td></tr></tbody></table>
      <a href="https://contoso.example/report" target="_blank" onmouseover="y()">report</a></div>`;
    const out = sanitizeMessageHtml(body, { contentType: "html", mentions: [{ name: "Eric Frisk" }] });
    expect(out).toContain('<span class="mention">Eric Frisk</span>');
    expect(out).toContain("<table><tbody><tr><td>PMD</td><td>12,400</td></tr><tr><td>PFEP</td><td>4,700</td></tr></tbody></table>");
    expect(out).toContain('<a href="https://contoso.example/report">report</a>');
    expect(out).not.toMatch(/script|alert|style|onclick|onmouseover|target|class="t"/);
  });
  it("never keeps a javascript href, an image or a hosted image URL", () => {
    const out = sanitizeMessageHtml(`<p><a href="javascript:alert(1)">x</a><img src="https://graph.microsoft.com/v1.0/chats/1/messages/2/hostedContents/abc/$value"></p>`, { contentType: "html" });
    expect(out).toBe('<p><a>x</a><span class="attached">Image attached</span></p>');
  });
  it("balances what it opens and escapes text", () => {
    expect(sanitizeMessageHtml("<div><b>bold <i>both</div> 1 < 2 &amp; done", { contentType: "html" })).toBe("<div><strong>bold <em>both</em></strong></div> 1 &lt; 2 &amp; done");
  });
  it("uses the name between the at tags when the mentions array lacks it", () => {
    expect(sanitizeMessageHtml(`<at id="3">Leon</at> thanks`, { contentType: "html", mentions: [] })).toBe('<span class="mention">Leon</span> thanks');
  });
  it("escapes a plain-text body with its line breaks", () => {
    expect(sanitizeMessageHtml("a <b>\nb", { contentType: "text" })).toBe("a &lt;b&gt;<br>b");
  });
  it("drops quoted-reply markers and keeps emoji characters", () => {
    expect(sanitizeMessageHtml(`<attachment id="17"></attachment><p>yes <emoji id="smile" alt="😄" title="Smile"></emoji></p>`, { contentType: "html" })).toBe("<p>yes 😄</p>");
  });
});

describe("bodyKind", () => {
  it("tells emoji-only, GIFs, stickers and pictures apart", () => {
    expect(bodyKind(`<p><emoji alt="👍"></emoji></p>`).emojiOnly).toBe(true);
    expect(bodyKind(`<p>👍🏽</p>`).emojiOnly).toBe(true);
    expect(bodyKind(`<p>123</p>`).emojiOnly).toBe(false);
    expect(bodyKind(`<img itemtype="http://schema.skype.com/Giphy" src="https://media4.giphy.com/x.gif">`).gif).toBe(true);
    expect(bodyKind(`<img itemtype="http://schema.skype.com/AMSImage" alt="sticker">`).sticker).toBe(true);
    expect(bodyKind(`<p>see</p><img src="https://graph.microsoft.com/v1.0/chats/1/messages/2/hostedContents/a/$value">`).hostedImages).toBe(1);
  });
});
