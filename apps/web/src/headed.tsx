import { createRoot } from "react-dom/client";
import { HeadedHarness } from "./HeadedHarness";

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root");
createRoot(root).render(<HeadedHarness />);
