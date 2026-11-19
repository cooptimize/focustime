## BR-1

- Should the 8 s line ("Still waiting on Outlook") stay? It is the loader's only words. Until the week arrives every source is still loading, so it names all four ("Dataverse, Outlook and 2 more"); naming the slow one needs the sources to report one by one.
- Do Close out's end and the first launch feel bare now? Close out ends on Today with its toast; the first launch opens straight on the app. Nothing was put in Lumen's place.
- Places left with no mark that had one: the Guide's footer, a Guide tour's last card ("You're set"), Close out's reverse and the fun moments (first launch, musts done, a reconnect). Sign-in, About and the Guide's Start here changed mark (the bent mark and Lumen became the week mark).
- Generated assets: rerunning `gen.py`, `outline.mjs` and `bake.py` changed only mark-week.svg's token block (it no longer names `--lime` and `--beam-blend`); the drawing is the same (hash pinned). The PWA and Teams icons came out byte for byte the same.
- `--brand-ghost` is still in every theme but nothing uses it (it drew the bent mark's dashed band). Removed in a later step, or kept for the week mark's next drawing?
- `ui.first_launch` is still recorded on the first launch (its marker in the plan store), but nothing shows for it now. Keep the action, or drop it with a later step?
- Taken as the reading that changes less:
  - `public/prefs.js` is a small script the page waits for before the first paint (a same-origin file, cached by the service worker). It is how the loader shows in the person's theme and text size without an inline script.
  - The loader's timing is measured from its CSS start, so a load that takes 400 to 1000 ms in all is held to about 1 s, as before: the 600 ms minimum counts from when the loader appeared.
  - "Musts done. See you tomorrow." went with Lumen's moment; Close out's own toast is unchanged.
  - The loader's screen-reader words ("Loading FocusTime", "FocusTime is ready") are the only new words besides the 8 s line and the Reduce motion hint.
- From review 1 (the frames only), not changed here:
  - Should the loader's mark be larger on a big desktop window? It is 96 px wide at Default text size, scaled with the text size only.
  - Every block dims together at the end of a pass, so a frame caught then looks stalled. Keep one block lit through the dim?
  - The mark crosses the app's first rows while it moves (0.4 s), as the old week did. Fade it as it goes instead?
  - The empty-state pair (Inbox › Done) isn't empty in the demo; no empty state drew Lumen before BR-1 (they went in U2 and IB-1), so nothing there changed.
  - Settings' reconnect shot says "Outlook is connected again." while the row still says it needs sign-in. That is the shot's routed answer, before and after, not the app.
- From review 2 (the diff), not changed here:
  - The loader's line ships as "Still waiting on FocusTime" in `index.html`, for when the app's script or the sign-in check itself takes over 8 s (the app names the sources once it runs). It is the one place the line can name FocusTime.
  - The 400 and 600 ms now count from the first paint, not from the app's script starting, so the script's own loading counts. Timed side by side it isn't slower, but a load right at 400 ms can now show the loader where it showed nothing before.
  - `public/prefs.js` is served `no-cache`, so a load with a cold service worker revalidates it before the first paint (one small request).
  - Sign-in, About and the Guide's Start here show the week mark where the bent mark or the unroll was; the prompt made the week mark the only mark, so they carry it.
  - While the loader finishes, a key skips it and does nothing else, and a click skips it, as Close out's reverse did before. Keys before the app is ready reach nothing, as before.

