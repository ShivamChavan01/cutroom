import { useState } from "react";
import { diffTimelines, lint } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { useUiStore } from "../uiStore";
import { head } from "../lib/vcs";
import { resetProject } from "../lib/persistence/usePersistence";
import { createDemoProject } from "../lib/demo/project";
import { Button } from "./ui/button";

export function DemoGuide() {
  const [step, setStep] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repo = useVcsStore((state) => state.repo);
  const pending = useVcsStore((state) => state.pending);
  const timeline = useEditorStore((state) => state.timeline);
  if (repo === null) return null;
  const merged = head(repo).parents.length === 2;
  const stage = pending !== null ? pending.result.clean ? 4 : 3 : merged ? Math.max(5, step) : Math.min(step, 2);
  const openMerge = () => useUiStore.getState().openTab("merge");
  const run = (action: () => void) => {
    try { action(); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not continue the demo."); }
  };
  const actions = [
    {title: "A timeline you can version", text: "Play this motion study. Every move and trim is a structured operation you can undo and replay.", label: "See two versions", action: () => {useUiStore.getState().setRail("versions"); setStep(1);}},
    {title: "Two editors. Two decisions.", text: "Main delays the middle shot; alternate brings the ending forward. Switch versions or open Graph to explore.", label: "Compare edits", action: () => {useVcsStore.getState().setDiff(head(repo, "main").timeline, "main", head(repo, "alternate").timeline, "alternate"); useUiStore.getState().openTab("diff"); setStep(2);}},
    {title: "Compare before combining", text: "The diff shows real moves and trims. Merging these independent decisions will reveal a timing collision.", label: "Merge versions", action: () => {if (repo.currentBranch !== "main" || repo.detachedAt !== null) throw new Error("Return to main in Versions before merging the sample."); const expected = createDemoProject();
        if (["main", "alternate"].some((branch) => {const diff = diffTimelines(head(expected.repo, branch).timeline, head(repo, branch).timeline); return diff.changes.length > 0 || (diff.metadataChanges?.length ?? 0) > 0;}) || diffTimelines(head(repo).timeline, timeline).changes.length > 0) throw new Error("The sample has changed. Use Versions to explore your edits, or Reset sample to repeat the guided scenario.");
        useVcsStore.getState().beginMerge("alternate"); openMerge();}},
    {title: "Independent edits collide", text: "The engine found unresolved conflicts. For the sample overlap, keep one clip below to remove the other. Nothing shifts automatically.", label: "Review conflict", action: openMerge},
    {title: "Your timing decision is recorded", text: "The engine reports no unresolved conflicts. Enter a message and commit the merge below; both parents are preserved.", label: "Review merge", action: openMerge},
    {title: "Merged does not mean verified", text: "Inspect structural findings next. A gap is an editing decision to review, not something to close automatically.", label: "Inspect findings", action: () => {useUiStore.getState().setRail("issues"); useUiStore.getState().openTab("verification"); setStep(6);}},
    {title: "Verification uses the actual timeline", text: `${lint(timeline).length} structural findings now. Click one to locate it. AI explanations require reviewer access on the hosted app.`, label: "Open assistant", action: () => {useUiStore.getState().setRail("assistant"); setHidden(true);}},
  ];
  const active = actions[stage]!;
  return <aside className={`demo-guide${hidden ? " is-collapsed" : ""}`} aria-label="Demo walkthrough">
    {hidden ? <><span>Sample workspace · your personal project is in its original tab.</span><Button variant="outline" size="sm" onClick={() => setHidden(false)}>Show walkthrough</Button></> : <>
      <div className="demo-guide-copy"><span className="demo-eyebrow">GUIDED SAMPLE · {Math.min(stage + 1, 6)} / 6</span><h2>{active.title}</h2><p>{active.text}</p>{error !== null && <p role="alert">{error}</p>}{pending !== null && <p className="text-warn">Pending merges are not saved. Refresh cancels this merge; committed work remains.</p>}</div>
      <div className="demo-guide-actions"><Button size="sm" onClick={() => run(active.action)}>{active.label}</Button><button onClick={() => setHidden(true)}>Skip guide</button></div>
    </>}
    <button className="demo-reset" onClick={() => {if (window.confirm("Reset only the sample workspace? Sample edits and any pending merge will be discarded. Your personal project is untouched.")) {void resetProject().then((ok) => {if (ok) {setStep(0); setHidden(false); setError(null);} else setError("Could not reset the sample. Check the storage error in the status bar.");});}}}>Reset sample</button>
  </aside>;
}
