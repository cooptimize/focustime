# U5 counts

Same demo day as U1 to U4: a throwaway demo-mode server with fictional data, the clock at Mon Nov 2, 9:30 AM, Monday planned through the app's own actions, and one draft story not planned. "Before" is the code at 7ca8bf4, the end of U4.

Method:
- **Text styles:** the distinct font size, weight, style, transform and decoration combinations among visible text, counting the top bar.
- **UI words and elements:** U1's method, with the top bar excluded from words.
- **Dialogs:** each is counted over the page it opens on.

Raw numbers are in `screens/before/metrics-*.json` and `screens/after/metrics-*.json`.

## 1920x1080, Default text size

Dark and light give the same counts on every screen.

| Screen | Text styles before → U5 | UI words before → U5 | Elements before → U5 |
|---|---|---|---|
| Roadmap | 16 → **8** | 446 → 414 | 98 → 97 |
| Roadmap › Plan ahead | 22 → **10** | 301 → 248 | 114 → 114 |
| Inbox | 17 → **9** | 223 → 117 | 51 → 47 |
| Settings › You | 11 → **6** | 244 → 174 | 34 → 34 |
| Settings › Working hours | 13 → **7** | 133 → 99 | 38 → 38 |
| Settings › Standing blocks | 11 → **7** | 72 → 64 | 34 → 34 |
| Settings › Planning | 16 → **7** | 638 → 420 | 58 → 58 |
| Settings › Focus | 14 → **7** | 298 → 222 | 38 → 38 |
| Settings › Notifications | 14 → **7** | 340 → 238 | 44 → 44 |
| Settings › Roadmap | 12 → **7** | 122 → 84 | 31 → 31 |
| Settings › Risk rules | 11 → **7** | 94 → 94 | 32 → 32 |
| Settings › Clients | 14 → **7** | 499 → 379 | 64 → 64 |
| Settings › Connections | 14 → **7** | 194 → 164 | 44 → 44 |
| Settings › Display | 12 → **8** | 163 → 121 | 37 → 40 |
| Settings › Data | 13 → **6** | 250 → 210 | 30 → 30 |
| Settings › About | 9 → **6** | 47 → 47 | 29 → 29 |
| Focus screen | 7 → **6** | 21 → 21 | 16 → 16 |
| Sign-in | 5 → **4** | 56 → 56 | 3 → 3 |
| Capture dialog (over Today) | 12 → **10** | 129 → 129 | 70 → 70 |
| Timebox… dialog (over Plan the day) | 11 → **9** | 133 → 133 | 59 → 59 |
| VM write preview (over Today) | 12 → **8** | 115 → 115 | 62 → 62 |
| Draft editor (over Plan the day) | 16 → **10** | 155 → 155 | 81 → 81 |
| Today › Now, for reference | 8 → 8 | 78 → 78 | 60 → 60 |
| Week, for reference | 9 → 9 | 115 → 115 | 74 → 74 |
| Plan the week, for reference | 10 → 10 | 277 → 277 | 115 → 115 |
| Plan the day, for reference | 9 → 9 | 107 → 107 | 54 → 54 |

Notes:
- **Targets:** under 10 styles per screen and under 12 with a dialog open. Every screen meets them except Plan ahead and Plan the week, which are at exactly 10.
- **Settings › Display:** it has three more elements because of the new Text size choices.
- **Type scale checks** run in `e2e/textsize.test.ts` against the active base, at both Default and Larger, on:
  - Roadmap and Plan ahead;
  - Inbox;
  - every Settings section;
  - the focus screen and sign-in;
  - the four dialogs.

## Same size between views

I opened Today, Plan the day, Check-in, Week, Plan the week, Roadmap, Plan ahead, Inbox and two Settings sections in sequence at Default. All of these kept the same size and weight on every view:
- the top bar tabs: 13/500;
- the brand: 15/600;
- page titles: 15/600;
- the body: 13.

The mode switch shows 600 on its active button and 500 on the others, as designed.
