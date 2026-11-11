# Settings: how it is put together, and how to add a setting

ST-1. Settings is one panel over the app (`#/settings…`) on the shared panel shell. What each setting does is unchanged
from before ST-1; only where and how it is shown moved. The before and after map is `docs/settings-inventory.md`.

## The pieces

- **`ui/settings/registry.ts`** is the one list: the groups (You, Planning, Clients, Connections, Data), the sections in
  each (id, label, a one-line description, old labels, `phoneReadOnly`, `parent` for a sub-page) and every setting a
  person looks for (id, section, label, old labels, keywords, `devOnly`, `demoOnly`). The rail, search, deep links, the
  command menu and the Guide read it. `OLD_SECTIONS` maps section ids from before ST-1 to where they open now.
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

1. **Where it does its job.** The config key, `settingsEdit` in `config/settings.ts` and the field in its form in
   `ui/Settings.tsx`, as for any setting. Change nothing in the shell for this.
2. **The registry.** Add a row to `SETTINGS` in `ui/settings/registry.ts`: a unique kebab-case `id` (it becomes the
   address's last part), its `section`, the `label` exactly as the page shows it, `keywords` people might type, and
   `old` if it replaces an older label. `devOnly` shows it only in the developer loop, `demoOnly` only in a demo.
3. **Mark it on the page.** Give its field `sid="<id>"` (`Field`, `AutoField`, `ReadOnly` and `Group` take it), or
   put `data-setting="<id>"` on the element around it. An `AutoField` whose key is in `SID` gets it already.
4. **Link to it.** `settingsHref(section, id)` for an `<a>`, `openSettings(section, id)` from the command menu
   (`ui/menu.ts`), or `go(section, id)` inside Settings. Don't write `#/settings/...` strings by hand.
5. **Check it.** `e2e/settings-shell.test.ts` opens every section and fails when a registry setting has no
   `data-setting` on its page; `ui/settings/registry.test.ts` checks the ids and search.

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

The Guide can sit on the same shell once ST-1 is merged:

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

## Settings added since (a record)

- **Suggest work for empty blocks** (SG-1): Settings › Planning, id `suggest-empty-blocks`, config `[plan] suggest_empty_blocks`, on by default. The same switch is Suggestions in Day's and Week's ⋯ (it saves the same setting). Off, nothing is loaded or computed.
