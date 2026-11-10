// CAL-1: the link rules: webcal:// converts, only https on 443, never a private, internal or metadata address.
import { describe, expect, it } from "vitest";
import { blockedAddress, blockedHostName, LinkError, normalizeLink, redactLink } from "./link.ts";

describe("normalizeLink (CAL-1)", () => {
  it("turns webcal:// and webcals:// into https://", () => {
    expect(normalizeLink("webcal://p01-calendars.example.com/published/2/abc").toString()).toBe("https://p01-calendars.example.com/published/2/abc");
    expect(normalizeLink(" WEBCALS://calendar.example.com/x.ics ").toString()).toBe("https://calendar.example.com/x.ics");
    expect(normalizeLink("https://calendar.example.com/x.ics#frag").toString()).toBe("https://calendar.example.com/x.ics");
  });

  it("refuses everything that isn't https on the standard port, or carries a user name", () => {
    const problem = (u: string) => {
      try {
        normalizeLink(u);
        return null;
      } catch (e) {
        return e instanceof LinkError ? e.problem : "other";
      }
    };
    expect(problem("")).toBe("empty");
    expect(problem("calendar")).toBe("not_a_link");
    expect(problem("http://calendar.example.com/x.ics")).toBe("not_https");
    expect(problem("ftp://calendar.example.com/x.ics")).toBe("not_https");
    expect(problem("file:///etc/passwd")).toBe("not_https");
    expect(problem("https://user:pw@calendar.example.com/x.ics")).toBe("credentials");
    expect(problem("https://calendar.example.com:8443/x.ics")).toBe("port");
    expect(problem("https://calendar.example.com:443/x.ics")).toBeNull();
  });

  it("refuses localhost, private, link-local and metadata addresses, however they are written", () => {
    for (const u of [
      "https://localhost/x.ics", "https://app.localhost/x", "https://127.0.0.1/x", "https://127.1/x", "https://2130706433/x", "https://0x7f000001/x",
      "https://10.1.2.3/x", "https://172.16.0.1/x", "https://172.31.255.255/x", "https://192.168.1.10/x", "https://100.64.0.1/x",
      "https://169.254.169.254/latest/meta-data", "https://metadata.google.internal/x", "https://[::1]/x", "https://[fe80::1]/x", "https://[fd00::1]/x",
      "https://[::ffff:127.0.0.1]/x", "https://[::ffff:169.254.169.254]/x", "https://0.0.0.0/x", "https://intranet/x", "https://printer.local/x", "https://vault.internal/x",
    ])
      expect(() => normalizeLink(u), u).toThrow(LinkError);
    for (const u of ["https://calendar.google.com/calendar/ical/x/basic.ics", "https://outlook.office365.com/owa/calendar/x/calendar.ics", "https://p42-caldav.icloud.com/published/2/x", "https://8.8.8.8/x", "https://[2606:4700::1111]/x"])
      expect(() => normalizeLink(u), u).not.toThrow();
  });
});

describe("blockedAddress (CAL-1)", () => {
  it("blocks every non-public range and the IPv4 hidden in IPv6", () => {
    for (const a of ["0.0.0.0", "10.0.0.1", "127.0.0.53", "169.254.169.254", "172.20.1.1", "192.168.0.1", "100.100.100.100", "224.0.0.1", "255.255.255.255", "192.0.2.5", "::", "::1", "fe80::abcd", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "2001:db8::1", "fec0::1", "not-an-ip"])
      expect(blockedAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "17.253.144.10", "142.250.80.46", "2607:f8b0:4004:c1b::64", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(blockedAddress(a), a).toBe(false);
  });

  it("blocks host names with no dot and internal suffixes", () => {
    expect(blockedHostName("metadata")).toBe(true);
    expect(blockedHostName("calendar.google.com")).toBe(false);
  });
});

describe("redactLink (CAL-1)", () => {
  it("shows only the host", () => {
    expect(redactLink("webcal://p01-caldav.icloud.com/published/2/SECRET-TOKEN")).toBe("p01-caldav.icloud.com/…");
    expect(redactLink(new URL("https://calendar.google.com/calendar/ical/me%40example.com/private-SECRET/basic.ics"))).toBe("calendar.google.com/…");
    expect(redactLink("garbage")).toBe("a link");
  });
});
