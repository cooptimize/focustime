// IN-1: Who's set up and Invite, the main path, on the demo (its person is an admin in their own demo). The list shows
// Cooptimizers only (never the partner guest or the helper bot), plain counts and the filters; Invite on the one person
// who hasn't signed in opens the sheet with the note and the editable message; Open in Teams opens a 1:1 chat link
// with that person and the edited message (window.open is caught, nothing leaves the browser) and the row then reads
// "Invited <day> by Alex"; Invite several opens one Outlook email. The command menu finds Invite and Who's set up.
// Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

const T = 120_000;

describe.skipIf(!CHROMIUM)("Who's set up and Invite", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("lists Cooptimizers with yes or no marks, invites the one who hasn't signed in, and records it", async () => {
    const { page, errors } = await freshPage(h);
    // Catch what the sheet opens (a hash change never reloads the page, so this stays in place).
    await page.evaluate(() => {
      (window as unknown as { opened: string[] }).opened = [];
      window.open = ((url?: string | URL) => {
        (window as unknown as { opened: string[] }).opened.push(String(url));
        return null;
      }) as typeof window.open;
    });
    // The command menu finds it by either name.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("invite");
    await page.getByText("Invite to FocusTime (Who's set up)").first().waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("who's set up");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash === "#/settings/admin-people/whos-set-up");
    const table = page.getByRole("table", { name: "Who's set up" });
    await table.waitFor();
    await expect(page.locator(".adm-setup-counts").textContent()).resolves.toBe("4 of 5 signed in · 2 set up partly");
    const names = await table.locator("tbody th").allTextContents();
    expect(names.map((n) => n.replace(" (you)", "")).sort()).toEqual(["Alex Rivera", "Jordan Lee", "Priya Shah", "Sam Ortiz", "Taylor Kim"]);
    // Yes or no only; nothing says which DevOps clients anyone has.
    expect(await table.textContent()).not.toMatch(/Northwind|Harbor|Atlas|PAT/);
    await page.getByRole("radio", { name: /Set up partly/ }).click();
    expect((await table.locator("tbody th").allTextContents()).sort()).toEqual(["Jordan Lee", "Priya Shah"]);
    await page.getByRole("radio", { name: /Not signed in/ }).click();
    expect(await table.locator("tbody th").allTextContents()).toEqual(["Taylor Kim"]);
    await shotBoth(page, "in1-whos-set-up", table);

    // Invite: the sheet, the note, the editable message.
    await table.getByRole("button", { name: "Invite", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Invite Taylor Kim" });
    await sheet.waitFor();
    await expect(sheet.getByText("FocusTime doesn't send this. It opens in Teams or Outlook for you to send.").isVisible()).resolves.toBe(true);
    const message = sheet.getByLabel("Message");
    expect(await message.inputValue()).toContain("Open it here: http");
    await shotBoth(page, "in1-invite-sheet", sheet);
    await message.fill("Hi {first name}, try FocusTime.");
    await sheet.getByRole("button", { name: "Open in Teams" }).click();
    await sheet.getByText("Opened a Teams chat with Taylor Kim").waitFor();
    const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
    expect(opened).toHaveLength(1);
    const u = new URL(opened[0]!);
    expect(u.origin + u.pathname).toBe("https://teams.microsoft.com/l/chat/0/0");
    expect(u.searchParams.get("users")).toBe("taylor.kim@example.com");
    expect(u.searchParams.get("message")).toBe("Hi Taylor, try FocusTime.");
    await sheet.getByRole("button", { name: "Close" }).click();
    await table.getByText(/^Invited .+ by Alex Rivera$/).waitFor();

    // Invite several: one Outlook email to everyone ticked; the same person can be invited again.
    await table.getByRole("checkbox", { name: "Select Taylor Kim" }).check();
    await page.getByRole("button", { name: "Invite several (1)" }).click();
    const again = page.getByRole("dialog", { name: "Invite Taylor Kim" });
    await again.getByRole("button", { name: "Open in Outlook" }).click();
    await again.getByText("Opened an email in Outlook").waitFor();
    const mail = new URL((await page.evaluate(() => (window as unknown as { opened: string[] }).opened))[1]!);
    expect(mail.origin + mail.pathname).toBe("https://outlook.office.com/mail/deeplink/compose");
    expect(mail.searchParams.get("to")).toBe("taylor.kim@example.com");
    expect(mail.searchParams.get("subject")).toBe("Try FocusTime");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
