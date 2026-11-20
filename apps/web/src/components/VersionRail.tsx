import { useRef, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import { useVcsStore } from "../vcsStore";
import { Button } from "./ui/button";

export function VersionRail() {
  const repo = useVcsStore(state => state.repo);
  const pending = useVcsStore(state => state.pending);
  const [name, setName] = useState("");
  const [switchCut, setSwitchCut] = useState(true);
  const [error, setError] = useState("");
  const create = useRef<HTMLDetailsElement>(null);
  if (!repo) return <section className="version-rail" aria-label="Timeline versions" />;
  return <section className="version-rail" aria-label="Timeline versions">
    <label htmlFor="current-cut" className="cut-caption"><GitBranch size={14} aria-hidden />Current cut</label>
    <select id="current-cut" value={repo.detachedAt === null ? repo.currentBranch : ""} onChange={event => {
      try { useVcsStore.getState().checkoutBranch(event.target.value); setError(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open this cut."); }
    }}>
      {repo.detachedAt !== null && <option value="" disabled>Viewing saved version · {repo.detachedAt}</option>}
      {Object.keys(repo.branches).map(branch => <option key={branch}>{branch}</option>)}
    </select>
    <details ref={create} className="cut-create">
      <summary><Plus size={14} aria-hidden />Create another cut</summary>
      <form onSubmit={event => {
        event.preventDefault();
        if (!name.trim() || pending) return;
        try {
          const store = useVcsStore.getState();
          if (switchCut) store.forkBranch(name.trim());
          else store.createBranch(name.trim());
          setName(""); setError("");
          if (create.current) {
            create.current.open = false;
            create.current.querySelector("summary")?.focus();
          }
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the cut."); }
      }}>
        <label>Cut name<input value={name} onChange={event => setName(event.target.value)} required /></label>
        <label className="cut-switch"><input type="checkbox" checked={switchCut} onChange={event => setSwitchCut(event.target.checked)} />Switch to this cut</label>
        <Button size="sm" disabled={!name.trim() || pending !== null}>Create cut</Button>
        {pending && <p>Finish or cancel the merge before creating a cut.</p>}
      </form>
    </details>
    {error && <p role="alert" className="editor-error">{error}</p>}
  </section>;
}
