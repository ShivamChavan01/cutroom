import {useState} from "react";
import {useEditorStore} from "../store";
import {useVcsStore} from "../vcsStore";
import {useUiStore} from "../uiStore";
import {head} from "../lib/vcs";
import {resetProject} from "../lib/persistence/usePersistence";
import {describeDemo} from "../lib/demo/guide";
import {Button} from "./ui/button";

export function DemoGuide() {
  const [hidden, setHidden] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repo = useVcsStore(state => state.repo);
  const pending = useVcsStore(state => state.pending);
  const diff = useVcsStore(state => state.diffOverlay);
  const timeline = useEditorStore(state => state.timeline);
  const rail = useUiStore(state => state.rail);
  const tab = useUiStore(state => state.editorTab);
  if (repo === null) return null;
  const view = describeDemo({repo, pending, diff, timeline, rail, tab});
  const advance = () => {
    try {
      const vcs = useVcsStore.getState(), ui = useUiStore.getState();
      const liveRepo = vcs.repo;
      if (liveRepo === null) throw new Error("The workspace is still loading.");
      const current = describeDemo({repo: liveRepo, pending: vcs.pending, diff: vcs.diffOverlay, timeline: useEditorStore.getState().timeline, rail: ui.rail, tab: ui.editorTab});
      switch (current.kind) {
        case "intro": case "return": ui.setRail("versions"); break;
        case "versions": case "comparison":
          vcs.setDiff(head(liveRepo, "main").timeline, "main", head(liveRepo, "alternate").timeline, "alternate");
          ui.openTab("diff"); break;
        case "compare": ui.openTab(vcs.beginMerge("alternate") === "pending" ? "merge" : "timeline"); break;
        case "conflict": case "resolved": ui.openTab("merge"); break;
        case "merged": ui.setRail("issues"); ui.openTab("verification"); break;
        case "findings": ui.setRail("assistant"); setHidden(true); break;
        case "changed": if (vcs.pending !== null) ui.openTab("merge"); else ui.setRail("versions"); break;
        default: {const exhaustive: never = current.kind; return exhaustive;}
      }
      setError(null);
    } catch (cause) {setError(cause instanceof Error ? cause.message : "Could not continue the sample.");}
  };
  const reset = async () => {
    if (!window.confirm("Reset only the sample workspace? Sample edits and any pending merge will be discarded. Your personal project is untouched.")) return;
    setResetting(true);
    const ok = await resetProject();
    setResetting(false);
    if (ok) {setHidden(false); setError(null);}
    else setError("Could not reset the sample. Check the storage message below.");
  };
  return <aside className={`demo-guide${hidden ? " is-collapsed" : ""}`} aria-label="Demo walkthrough">
    {hidden ? <><span>Sample workspace. Your personal project stays separate.</span><Button variant="outline" size="sm" onClick={() => setHidden(false)}>Show walkthrough</Button></> : <>
      <div className="demo-guide-copy"><span className="demo-eyebrow">GUIDED SAMPLE · {view.step} / 6</span><h2>{view.title}</h2><p>{view.text}</p>{error !== null && <p role="alert">{error}</p>}</div>
      <div className="demo-guide-actions"><Button size="sm" onClick={advance}>{view.label}</Button><button onClick={() => setHidden(true)}>Skip guide</button></div>
    </>}
    <button className="demo-reset" disabled={resetting} onClick={() => void reset()}>{resetting ? "Resetting…" : "Reset sample"}</button>
  </aside>;
}
