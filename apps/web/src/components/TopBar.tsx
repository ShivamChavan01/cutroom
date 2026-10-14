import { Download, Upload } from "lucide-react";
import { ExportOitioButton, UploadButton } from "./UploadButton";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { Badge } from "./ui/badge";

/** Top strip: identity, branch, primary actions. Nothing decorative. */
export function TopBar() {
  const authorId = useEditorStore((state) => state.authorId);
  const branch = useVcsStore((state) => state.repo?.currentBranch ?? "—");

  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-3.5 py-2">
      <span className="text-[15px] font-bold">Cutroom</span>
      <Badge title="Current branch">⎇ {branch}</Badge>
      <span className="flex-1" />
      <UploadButton icon={<Upload />} label="Add video" />
      <ExportOitioButton icon={<Download />} />
      <span title="Local author identity" className="text-xs text-muted">
        {authorId}
      </span>
    </header>
  );
}
