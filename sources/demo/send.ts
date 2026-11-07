// LP-1, demo mode: Close the loop's sends, pretended. Nothing leaves FocusTime: a post, a 1:1 chat and an Outlook
// draft are kept in memory and read back from there, so the demo shows Draft › Preview › Sent end to end. Send now
// isn't allowed in the demo (its probe says consent), so the demo also shows the fallback: open it prefilled, Mark sent.
import type { SendClient } from "../graph/send.ts";

export function demoSender(): SendClient & { sent: () => { chats: number; drafts: number } } {
  const posts = new Map<string, string>();
  const drafts = new Map<string, { sent: boolean }>();
  let n = 1700000000000;
  let d = 0;
  return {
    async oneOnOne(_me, them) {
      return `19:demo-${them.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || "person"}_me@unq.gbl.spaces`;
    },
    async post(chatId, html) {
      const id = String(++n);
      posts.set(`${chatId}|${id}`, html);
      return id;
    },
    async readMessage(chatId, messageId) {
      return { found: posts.has(`${chatId}|${messageId}`) };
    },
    async draft() {
      const id = `demo-draft-${++d}`;
      drafts.set(id, { sent: false });
      return { id, webLink: "https://outlook.office.com/mail/drafts" };
    },
    async send(id) {
      const x = drafts.get(id);
      if (x) x.sent = true;
    },
    async readMail(id) {
      const x = drafts.get(id);
      return x ? { state: x.sent ? "sent" : "draft", webLink: "https://outlook.office.com/mail/drafts", sentAt: x.sent ? new Date().toISOString() : null } : { state: "missing", webLink: null, sentAt: null };
    },
    sent: () => ({ chats: posts.size, drafts: drafts.size }),
  };
}
