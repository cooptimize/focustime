import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AuthGate } from "./Account.tsx";
import { DbBanner, StaleBanner } from "./Reopen.tsx";
import { StyleGuide } from "./StyleGuide.tsx";
import "./fonts.css";
import "./styles.css";
import { applyTheme, initialTheme } from "./theme.ts";
import { applyReduceMotion } from "./brand/motion.ts";
import { applyTextSize, storedTextSize } from "./textsize.ts";

applyTheme(initialTheme());
applyReduceMotion();
applyTextSize(storedTextSize());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StaleBanner />
    <DbBanner />
    {location.pathname === "/styleguide" ? <StyleGuide /> : <AuthGate><App /></AuthGate>}
  </StrictMode>,
);
