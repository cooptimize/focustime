# Settings: how it is put together, and how to add a setting

ST-1. Settings is one panel over the app (`#/settings…`) on the shared panel shell. What each setting does is unchanged
from before ST-1; only where and how it is shown moved. The before and after map is `docs/settings-inventory.md`.

## The pieces

- **`ui/settings/registry.ts`** is the one list: the groups (SA-3: You, Your work, Connected, Yours; Admin for admins),
  the eleven sections in (id, label, a one-line description, old labels, `phoneReadOnly`, `parent` for a sub-page) and every setting a
  person looks for (id, section, label, old labels, keywords, `devOnly`, `demoOnly`). The rail, search, deep links, the
  command menu and the Guide read it. `OLD_SECTIONS` maps section ids from before ST-1 and SA-3 to where they open now,
  and a setting addressed under the section it had before opens in the section it is in now (`resolveSettings`).
  `FOLDS` names the two folds (Fine tuning, Each kind of notice); a setting with `fold` sits inside one.
- **`ui/PanelShell.tsx`** is the shell: the rail with its groups on the left (a list page of its own on a phone), the
  title, description, Back (only on a sub-page or a phone page) and × at the top, and the body that scrolls on its own.
  Esc closes. Focus goes to the title on every page and back to what opened the panel when it closes.
- **`ui/Settings.tsx`** fills the shell: the search box at the top of the rail, the results in its place while typing,
  `SectionBody` for each section, and Admin's sections as a last group for admins (Admin keeps its own pages in
  `ui/settings/Admin.tsx`).
- **`ui/settings/autosave.tsx`**: fields save as they change, with Saved by the field and Undo. Closing Settings saves
  a field still being typed in first.
- **Addresses** (`ui/nav.ts`): `#/settings` (the rail on a phone, Profile on a big screen), `#/settings/<section>` and
  `#/settings/<section>/<setting>` (that setting highlighted for a moment and focused). A client's own page is
  `#/settings/client/<client key>`. A link into Settings opens it over the tab I'm on, and closing goes back there.

## Adding a setting

SA-2: every Settings section is drawn with one set of parts (`ui/settings/parts.tsx`), one file per section in
`ui/settings/sections/`, in one column about 760 px wide. A section file draws nothing itself: no class names, no
inline styles, no raw elements (`ui/settings/sections.guard.test.ts` fails on one).

1. **Where it does its job.** The config key and `settingsEdit` in `config/settings.ts`, as for any setting, and the
   field in its section's `useAutoSave` (`ui/settings/autosave.tsx`). Change nothing in the shell for this.
2. **The registry.** Add a row to `SETTINGS` in `ui/settings/registry.ts`: a unique kebab-case `id` (the address's
   last part), its `section`, its `group` when the page shows one, the `label` (the one name: the page, search, links
   and the Undo message all read it), its `kind` (switch, choice for two to four, select for more, number with its
   `unit`, time, text, list, action or status), its `help` (what it does first, one line) and `more` (the rest, behind
   More about this), `keywords` people might type, and `old` if it replaces an older label. `devOnly` shows it only in
   the developer loop, `demoOnly` only in a demo; `part` marks a setting's own rows (a weekday, one notice kind).
3. **Draw it.** In its section file, inside a `Group`, a `Row id="<id>"` with the control its kind takes: `Switch`,
   `Choice`, `Select`, `Num` (or `NumRow` and `SwitchRow` in `sections/fields.tsx`), `Time`, `Text`, a `List` of
   `ListItem`s with one Add at its foot, or a `Button` with its result said on the row. Pass `mark={markOf(a, key)}`
   for the saved mark and `team` for a team value ("Set by your FocusTime admin") or a `TeamDefault` with Reset. A
   switch's label says what on means; it has no words of its own. The row carries `data-setting` for deep links.
4. **Link to it.** `settingsHref(section, id)` for an `<a>`, `openSettings(section, id)` from the command menu
   (`ui/menu.ts`), or `GoLink` inside Settings. Don't write `#/settings/...` strings by hand.
5. **Check it.** `e2e/settings/panel-shell.test.ts` fails when a registry setting has no `data-setting` on its page;
   `e2e/settings/sa2.test.ts` that a row's label isn't the registry's or its kind's control is missing;
   `ui/settings/registry.test.ts` checks the ids, the names and search.

A **new section**: add it to `SECTIONS` with its group and a one-line description (no em dashes), a `case` in
`SectionBody`, and, when it replaces an old one, its old id in `OLD_SECTIONS` so bookmarks and notifications still land.
A section laid out for a big screen gets `phoneReadOnly`: on a phone it shows read-only with "Changing these works best
on a bigger screen".

**Never** put a secret in Settings: no field shows or takes an app secret (they go in only through `infra/scripts/` and
the keyring), and a person's PAT is a masked box that is cleared after Check and save; status rows say only whether one
is set and when it expires.

**Team values** are an admin's (Rule, Default, Default by level): they stay in Admin, and a person's section shows the
value read-only with "Set by your FocusTime admin".

## The panel shell for other panels (UI-5)

The Guide sits on the same shell (`ui/guide/GuideFrame.tsx`), and so can any other panel:

```tsx
<PanelShell
  name="Guide"                       // the rail's heading and the panel's accessible name
  groups={[{ id: "start", label: "Start here", items: [{ id: "basics", label: "The basics", href: "#/guide/basics" }] }]}
  current={chapter}                  // null: the rail as a list page (phone)
  onPick={(id) => go(id)}
  onClose={close}                    // ×, Esc
  onBack={phone && chapter ? () => go(null) : null}
  title={title}
  description={oneLine}
  railTop={<search box />}           // optional
  railOverride={results}             // optional: in place of the groups while searching
  phone={phone}                      // usePhone()
  pageKey={chapter}                  // focus to the title and scroll to the top when it changes
>
  {body}
</PanelShell>
```

The shell owns Esc (after the controls inside it: a picker or menu that handles Esc and stops it keeps it), the ×,
focus on the title, focus return and the phone layout. Styles are `.panel-shell` and `.ps-*` in `ui/styles.css`.

## Where a setting goes (SA-3)

Eleven sections, by what a person is doing, not by which system stores it:

| Group | Section | What goes there |
|---|---|---|
| You | Profile, Working hours, Display | who I am, my hours and zone, how FocusTime looks |
| Your work | Reminders and notices | every reminder as one row with one time (app and Teams alike), where notices reach me, Quiet, each kind of notice (folded) |
| | Planning | how planning behaves; the numbers few people change under Fine tuning (folded) |
| | Focus | the focus timer, sounds, Teams status |
| | Clients | the clients list, Keep following, what FocusTime looks for in chats, the chats it reads, a client's own page |
| Connected | Connections | one card per connection: Microsoft, Google, calendars by link, Pocket, DevOps (read, write access, Find an item), My VM |
| | AI and assistant | unchanged |
| Yours | Your data | What FocusTime keeps (numbers from constants), What FocusTime changed in other apps, Export and Delete, Diagnostics |
| | About | the app, Send feedback |

A setting a person changes rarely, and that has a safe default, goes in its section's fold, which says how many it holds
and how many the person changed. A link or search result inside a fold opens it. Admin-only lines (the Dataverse
environment and user, Start over) show only to admins on a test site; the test-site switch only on a test site.

## Settings added since (a record)

- **Suggest work for empty blocks** (SG-1): Settings › Planning, id `suggest-empty-blocks`, config `[plan] suggest_empty_blocks`, on by default. The same switch is Suggestions under Day's and Week's View options (it saves the same setting). Off, nothing is loaded or computed.
