// BR-1: before the first paint, the person's theme, text size and reduce motion from the copies the app keeps
// locally (ui/theme.ts, ui/textsize.ts, ui/brand/motion.ts set them; this only reads), so the loader's week mark is
// drawn in the right colors, size and motion from the start and nothing jumps when the app's own script arrives. PH-1:
// the phone's Desktop version too, so the app never flashes the other version.
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
    // PH-1: the Desktop version, chosen on this phone (ui/desktop-version.ts): the page laid out at 1280 px wide before
    // anything is drawn, zoomed out by the browser to fit, pinch to zoom in. Only ever set from the phone's More.
    if (localStorage.getItem("focustime.desktopVersion") === "1") {
      var vp = document.querySelector('meta[name="viewport"]');
      // The starting zoom fits the 1280 px page to the screen (screen.width is the phone's width in CSS px).
      var fit = Math.min(1, Math.round(((screen.width || 390) / 1280) * 10000) / 10000);
      if (vp) vp.setAttribute("content", "width=1280, initial-scale=" + fit + ", viewport-fit=cover");
      root.setAttribute("data-desktop-version", "");
    }
  } catch (e) {
    // Storage can be unavailable (a private window, blocked site data): the defaults, and the app applies the rest.
  }
  root.setAttribute("data-theme", theme);
})();
