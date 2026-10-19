import { createRoot } from "react-dom/client";
import "./index.css";
import { ScenariosPage } from "./dev/ScenariosPage";

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root");
createRoot(root).render(<ScenariosPage />);
