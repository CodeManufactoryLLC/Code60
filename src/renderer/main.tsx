import { createRoot } from "react-dom/client";
import type { DesktopApi } from "../bridge/index.js";
import { App } from "./app.js";
import { migrateAppearance } from "./appearance.js";
import { migrateTypography } from "./typography.js";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-sans/700-italic.css";
import "@fontsource/ibm-plex-serif/400.css";
import "@fontsource/ibm-plex-serif/500.css";
import "@fontsource/ibm-plex-serif/600.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/600.css";
import "./fonts.css";
import "./style.css";

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

migrateAppearance(localStorage);
migrateTypography(localStorage);
const root = document.getElementById("root");
if (root) createRoot(root).render(<App api={window.desktop} />);
