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

// The style guide renders fixture data, so it exists only in development builds (no-demo-leak): Vite drops this
// branch, and the fixtures with it, from the production bundle.
const StyleGuide = import.meta.env.DEV ? lazy(() => import("./StyleGuide.tsx").then((m) => ({ default: m.StyleGuide }))) : null;

applyTheme(initialTheme());
applyReduceMotion();
applyTextSize(storedTextSize());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
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
