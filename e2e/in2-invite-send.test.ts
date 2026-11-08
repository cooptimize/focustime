// IN-2: send the invite from FocusTime, the main path, on the demo (its person is an admin in their own demo, and its
// sign-in allows Teams and Outlook drafts but not Send now, like LP-1's demo). Nothing leaves FocusTime: the demo's
// sends stay in memory (sources/demo/send.ts). Invite on Taylor Kim, who hasn't signed in: Send in Teams opens the
// preview (who, how, the final text), Send sends, the result says so, and the row reads "Invited by Alex Rivera via
// Teams, <day>". Without the permission (the probe answered as consent) the sheet shows only IN-1's buttons with
// LP-1's note. At 390 px nothing scrolls sideways. Screenshots in docs/ux/in2 when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 120_000;

async function openWhoSetUp(page: Page) {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("who's set up");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.hash === "#/settings/admin-people/whos-set-up");
  const table = page.getByRole("table", { name: "Who's set up" });
  await table.waitFor();
  await page.getByRole("radio", { name: /Not signed in/ }).click();
  return table;
}

describe.skipIf(!CHROMIUM)("IN-2: send the invite from FocusTime", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("Send in Teams: preview, send, result, and the row reads Invited by Alex via Teams", async () => {
    const { page, errors } = await freshPage(h);
    const table = await openWhoSetUp(page);
    await table.getByRole("button", { name: "Invite", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Invite Taylor Kim" });
    const sendGroup = sheet.getByRole("group", { name: "Send from FocusTime" });
    await sendGroup.waitFor();
    await sheet.getByText("Send it from FocusTime as you, or open it in Teams or Outlook and send it there.").waitFor();
    // The demo allows a draft but not Send now: that one waits for its permission, with the note and no consent link.
    await expect(sendGroup.getByRole("radio", { name: "Send now" }).isDisabled()).resolves.toBe(true);
    await sheet.getByText("Send email now needs one more permission, which an admin may need to approve.", { exact: false }).waitFor();
    expect(await sheet.getByRole("link", { name: /^Allow/ }).count()).toBe(0);
    // IN-1's buttons stay.
    for (const name of ["Open in Teams", "Open in Outlook", "Copy message"]) await sheet.getByRole("button", { name, exact: true }).waitFor();
    await shotBoth(page, "in2-sheet", sheet);

    await sheet.getByLabel("Message").fill("Hi {first name}, try FocusTime.");
    await sendGroup.getByRole("button", { name: "Send in Teams" }).click();
    const preview = sheet.getByRole("region", { name: "Preview" });
    await preview.waitFor();
    expect(await preview.locator(".sl-facts").textContent()).toBe("Send byTeams: a 1:1 chat with Taylor, as youToTaylor Kim");
    expect(await preview.locator(".sl-text").allTextContents()).toEqual(["Hi Taylor, try FocusTime."]);
    await preview.getByText("Sent Teams messages and emails can't be undone.").waitFor();
    await shotBoth(page, "in2-preview", sheet);

    await preview.getByRole("button", { name: "Send in Teams" }).click();
    const result = sheet.getByRole("region", { name: "Result" });
    await result.getByText("Sent in Teams to Taylor Kim.").waitFor();
    await result.getByText(/Taylor Kim: Sent in Teams/).waitFor();
    await result.getByRole("link", { name: "Open in Teams" }).waitFor();
    await shotBoth(page, "in2-result", sheet);
    await result.getByRole("button", { name: "Done" }).click();
    await table.getByText(/^Invited by Alex Rivera via Teams, .+$/).waitFor();
    await page.getByText("Sent in Teams to Taylor Kim.").waitFor();

    // An Outlook draft, the default for email, the same way.
    await table.getByRole("button", { name: "Invite", exact: true }).click();
    const again = page.getByRole("dialog", { name: "Invite Taylor Kim" });
    await again.getByRole("group", { name: "Send from FocusTime" }).getByRole("button", { name: "Create Outlook draft" }).click();
    const p2 = again.getByRole("region", { name: "Preview" });
    await p2.getByText("Email, an Outlook draft in your mailbox, as you").waitFor();
    await p2.getByRole("button", { name: "Create Outlook draft" }).click();
    await again.getByText("Outlook draft for Taylor Kim. Send it from Outlook.").waitFor();
    await again.getByRole("button", { name: "Done" }).click();
    await table.getByText(/^Invited by Alex Rivera via Email \(Outlook draft\), .+$/).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("without the permission: IN-1's buttons with LP-1's note, and no send buttons", async () => {
    const { page, errors } = await freshPage(h);
    // The probe answered as a tenant that hasn't approved sending yet (the demo's own allows it).
    await page.route("**/api/action", async (route) => {
      if (!(route.request().postData() ?? "").includes('"admin.invite_access"')) return route.continue();
      const res = await route.fetch();
      const json = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
      const d = (json.data ?? json) as Record<string, unknown>;
      const note = "FocusTime isn't allowed to post in Teams for you yet. Sending from FocusTime needs an admin to approve access. Until then, open it prefilled and mark it sent.";
      d.teams = { state: "consent", consent: "teams_send", note };
      d.draft = { state: "consent", consent: "mail_draft", note };
      d.send = { state: "consent", consent: "mail_send", note };
      await route.fulfill({ response: res, json });
    });
    const table = await openWhoSetUp(page);
    await table.getByRole("button", { name: "Invite", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Invite Taylor Kim" });
    await sheet.getByText("Sending from FocusTime needs an admin to approve access. Until then, open it in Teams or Outlook prefilled and send it there.").waitFor();
    await sheet.getByText("FocusTime doesn't send this. It opens in Teams or Outlook for you to send.").waitFor();
    expect(await sheet.getByRole("group", { name: "Send from FocusTime" }).count()).toBe(0);
    expect(await sheet.getByRole("button", { name: /^Send|^Create Outlook draft/ }).count()).toBe(0);
    for (const name of ["Open in Teams", "Open in Outlook", "Copy message"]) await sheet.getByRole("button", { name, exact: true }).waitFor();
    await shotBoth(page, "in2-sheet-no-permission", sheet);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("at 390 px the sheet and its preview don't scroll sideways", async () => {
    const { page } = await freshPage(h, { width: 390, height: 844 });
    await page.evaluate(() => {
      const st = document.createElement("style");
      st.textContent = "html{font-size:17px}";
      document.head.append(st);
    });
    await page.evaluate(() => void (location.hash = "#/settings/admin-people/whos-set-up"));
    const table = page.getByRole("table", { name: "Who's set up" });
    await table.waitFor();
    await page.getByRole("radio", { name: /Not signed in/ }).click();
    await table.getByRole("button", { name: "Invite", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Invite Taylor Kim" });
    await sheet.getByRole("group", { name: "Send from FocusTime" }).getByRole("button", { name: "Send in Teams" }).click();
    await sheet.getByRole("region", { name: "Preview" }).waitFor();
    const wide = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sheet: (() => {
        const el = document.querySelector(".invite-sheet")!;
        return el.scrollWidth - el.clientWidth;
      })(),
      right: document.querySelector(".invite-sheet")!.getBoundingClientRect().right <= window.innerWidth + 0.5,
    }));
    expect(wide).toEqual({ page: 0, sheet: 0, right: true });
    for (const b of await sheet.getByRole("button").all()) if ((await b.textContent())?.trim()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/in2-phone-preview.png` });
    await page.close();
  }, T);
});
