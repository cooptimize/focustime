// The page's entry. The UI uses the built-in Temporal (D37), which Safari (iPhone included) doesn't have yet: there,
// and only there, the polyfill (temporal-polyfill, its own chunk) installs the global Temporal before any of the app's
// code runs. Browsers with Temporal never download it. The app itself starts from main.tsx.
const start = () => import("./main.tsx");

if (typeof globalThis.Temporal === "undefined") void import("temporal-polyfill/global").then(start);
else void start();
