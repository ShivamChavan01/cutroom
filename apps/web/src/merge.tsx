import { createRoot } from "react-dom/client";
import { MergeHarness } from "./MergeHarness";

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root");
createRoot(root).render(<MergeHarness />);
