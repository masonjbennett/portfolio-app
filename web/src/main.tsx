// Entry point: the self-hosted faces (only the weights base.css uses), the tokens, the page-wide
// defaults, then <App/> into #root, or the guide in its place when the address asks for it (?guide,
// src/guide/route.ts). The guide is its own chunk, fetched only then, so the page's first chunk carries
// none of its words.
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles/tokens.css";
import "./styles/base.css";
import App from "./App.tsx";
import { isGuide } from "./guide/route.ts";

const Guide = lazy(() => import("./guide/GuidePage.tsx"));

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    {isGuide(window.location.search) ? (
      <Suspense fallback={null}>
        <Guide />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
