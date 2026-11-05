// HK-1: values the telemetry redaction tests plant, fake but shaped like the real ones, and the check that none of
// them (or its distinctive start) appears in what was sent. Test-only.
export const PLANTED = {
  jwt: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvaWQtYW5hIiwibmFtZSI6IkFuYSJ9.c2lnbmF0dXJlLXZhbHVlLXRoYXQtaXMtbG9uZw",
  pat: "a7k2m9q4x8v3c6b1n5z0w2e7r4t9y3u8i6o1p5l2j7h4g9f3d6s1",
  secret: "Xy7~Qw.9_Ab3Cd5Ef7Gh9Ij1Kl3Mn5Op7Qr9St",
  chat: "can we push the Contoso go-live to Friday, the board is nervous",
  body: '{"input":{"note":"left off on the invoice export"}}',
  client: "Contoso Secret Client",
  email: "ana.person@contoso.example",
  chatId: "19:abcdef0123456789@thread.v2",
};

export const leaks = (sent: string): string[] =>
  Object.values(PLANTED).flatMap((v) => [v, v.slice(0, 24)].filter((x) => sent.toLowerCase().includes(x.toLowerCase())));
