import { useEditorStore } from "../../store";
import { useVcsStore } from "../../vcsStore";
import { registerAssetUrls } from "../assets";
import { createDemoProject, demoMediaUrls } from "./project";

/** Only called inside the demo workspace, including explicit reset. */
export function installDemoProject(): void {
  const demo = createDemoProject();
  useEditorStore.getState().restoreHistory(demo.history);
  useVcsStore.getState().restoreRepo(demo.repo);
  registerAssetUrls(demoMediaUrls(import.meta.env.BASE_URL));
  useEditorStore.getState().selectClip("opening");
  useEditorStore.getState().setPlayhead(0);
}
