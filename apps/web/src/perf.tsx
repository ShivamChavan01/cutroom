import { createRoot } from "react-dom/client";
import { PerfHarness } from "./PerfHarness";

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root");
createRoot(root).render(<PerfHarness />);
