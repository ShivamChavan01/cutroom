import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "./index.css";
import { App } from "./App";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("missing #root element");
}
createRoot(root).render(
  <StrictMode>
    <App />
    {import.meta.env.VITE_VERCEL_ANALYTICS === "true" && <Analytics />}
  </StrictMode>,
);
