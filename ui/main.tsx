import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AuthGate } from "./Account.tsx";
import { DbBanner, StaleBanner } from "./Reopen.tsx";
import "./fonts.css";
import "./styles.css";
import { applyTheme, initialTheme } from "./theme.ts";
import { applyReduceMotion } from "./brand/motion.ts";
import { applyTextSize, storedTextSize } from "./textsize.ts";
import { startPwa } from "./pwa.ts";
import { startKeyboardInset } from "./keyboard.ts";
import { OfflineLine } from "./Offline.tsx";
import { HOME, locScreens, parseHash } from "./nav.ts";
import { loadScreen } from "./screens.ts";

// The style guide renders fixture data, so it exists only in development builds (no-demo-leak): Vite drops this
// branch, and the fixtures with it, from the production bundle.
const StyleGuide = import.meta.env.DEV ? lazy(() => import("./StyleGuide.tsx").then((m) => ({ default: m.StyleGuide }))) : null;

// PF-1: opened at an address whose screen loads on demand: its file is asked for now, alongside the sign-in check
// and the week's read, not after them.
for (const n of locScreens(parseHash(location.hash) ?? HOME)) void loadScreen(n);

applyTheme(initialTheme());
applyReduceMotion();
applyTextSize(storedTextSize());
startPwa();
startKeyboardInset();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OfflineLine />
    <StaleBanner />
    <DbBanner />
    {StyleGuide && location.pathname === "/styleguide" ? (
      <Suspense fallback={null}>
        <StyleGuide />
      </Suspense>
    ) : (
      <AuthGate>
        <App />
      </AuthGate>
    )}
  </StrictMode>,
);
