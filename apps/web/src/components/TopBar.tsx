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
  const detachedAt = repo?.detachedAt ?? null;
  const branch = detachedAt ?? repo?.currentBranch ?? "—";

  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-3.5 py-2">
      <span className="text-[15px] font-bold">Cutroom</span>
      <Badge title={detachedAt !== null ? "Detached HEAD" : "Current branch"}>
        ⎇ {branch}
      </Badge>
      <span className="flex-1" />
      <UploadButton icon={<Upload />} label="Add video" />
      <ExportMenu />
      <span title="Local author identity" className="text-xs text-muted">
        {authorId}
      </span>
    </header>
  );
}
