import { Upload } from "lucide-react";
import { UploadButton } from "./UploadButton";
import { ExportMenu } from "./ExportMenu";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { Badge } from "./ui/badge";

/** Top strip: identity, branch, primary actions. Nothing decorative. */
export function TopBar() {
  const authorId = useEditorStore((state) => state.authorId);
  const repo = useVcsStore((state) => state.repo);
  const projectId = useEditorStore((state) => state.timeline.id);
  const detachedAt = repo?.detachedAt ?? null;
  const branch = detachedAt ?? repo?.currentBranch ?? "—";

  return (
    <header className="studio-topbar">
      <div className="studio-brand"><span>cutroom<span className="studio-brand-dot">.</span></span></div>
      <div className="studio-project"><span className="studio-project-type">VIDEO PROJECT</span><span>{projectId === "untitled" ? "Untitled project" : projectId}</span></div>
      <Badge title={detachedAt !== null ? "Detached HEAD" : "Current branch"}>
        ⎇ {branch}
      </Badge>
      <span className="studio-topbar-spacer" />
      <UploadButton icon={<Upload />} label="Add video" />
      <ExportMenu />
      <span title="Local author identity" className="text-xs text-muted">
        <span className="studio-avatar">{authorId.slice(0, 1).toUpperCase()}</span>
      </span>
    </header>
  );
}
