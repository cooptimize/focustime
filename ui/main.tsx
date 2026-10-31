import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { StyleGuide } from "./StyleGuide.tsx";
import "./styles.css";
import { applyTheme, initialTheme } from "./theme.ts";

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname === "/styleguide" ? <StyleGuide /> : <App />}
  </StrictMode>,
);
