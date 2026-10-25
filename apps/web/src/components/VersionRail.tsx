import { GitBranch, Plus } from "lucide-react";
import { diffTimelines } from "@cutroom/engine";
import { currentCommit } from "../lib/vcs";
import { useVcsStore } from "../vcsStore";
import { useEditorStore } from "../store";

export function VersionRail() {
  const repo = useVcsStore((state) => state.repo);
  const timeline = useEditorStore((state) => state.timeline);
  if (repo === null) return <aside className="version-rail" aria-label="Timeline versions" />;
  const choose = (name: string) => {
    if (name === repo.currentBranch && repo.detachedAt === null) return;
    const diff = diffTimelines(currentCommit(repo).timeline, timeline);
    if ((diff.changes.length + (diff.metadataChanges?.length ?? 0)) > 0 && !window.confirm("Switch versions and discard uncommitted edits? Commit or create a new version to preserve them.")) return;
    useVcsStore.getState().checkoutBranch(name);
  };
  return <aside className="version-rail" aria-label="Timeline versions">
    <h2>Versions</h2>
    {Object.entries(repo.branches).map(([name,id]) => <button type="button" key={name} className={repo.currentBranch === name && repo.detachedAt === null ? "is-active" : ""} aria-label={`Switch to version ${name}`} aria-current={repo.currentBranch === name ? "true" : undefined} onClick={() => choose(name)}><GitBranch size={13} /><span><strong>{name}</strong><small>{id}</small></span></button>)}
    <button type="button" className="add-version" onClick={() => {
      const name = window.prompt("New version name", `cut-${Object.keys(repo.branches).length + 1}`);
      if (name === null) return;
      try { useVcsStore.getState().forkBranch(name.trim()); }
      catch (reason) { window.alert(reason instanceof Error ? reason.message : "Could not create version."); }
    }}><Plus size={16} /> Add version</button>
  </aside>;
}
