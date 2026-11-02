import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AuthGate } from "./Account.tsx";
import { StaleBanner } from "./Reopen.tsx";
import { StyleGuide } from "./StyleGuide.tsx";
import "./styles.css";
import { applyTheme, initialTheme } from "./theme.ts";

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StaleBanner />
    {location.pathname === "/styleguide" ? <StyleGuide /> : <AuthGate><App /></AuthGate>}
  </StrictMode>,
);
