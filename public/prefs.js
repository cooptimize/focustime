// BR-1: before the first paint, the person's theme, text size and reduce motion from the copies the app keeps
// locally (ui/theme.ts, ui/textsize.ts, ui/brand/motion.ts set them; this only reads), so the loader's week mark is
// drawn in the right colors, size and motion from the start and nothing jumps when the app's own script arrives.
// A file of its own, not inline: the page's CSP allows no inline script. ui/brand/boot.test.ts keeps it in step.
(function () {
  var root = document.documentElement;
  var theme = "cooptimize-dark";
  try {
    var t = localStorage.getItem("focustime.theme");
    if (t === "cooptimize-dark" || t === "cooptimize-light" || t === "neutral") theme = t;
    var s = localStorage.getItem("focustime.textSize");
    if (s === "large" || s === "larger") root.setAttribute("data-text-size", s);
    if (localStorage.getItem("focustime.reduceMotion") === "1") root.setAttribute("data-reduce-motion", "");
  } catch (e) {
    // Storage can be unavailable (a private window, blocked site data): the defaults, and the app applies the rest.
  }
  root.setAttribute("data-theme", theme);
})();
