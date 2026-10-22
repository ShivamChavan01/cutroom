import { useRef, useState, type ReactNode } from "react";
import { uploadFiles } from "../lib/upload";
import { usePersistenceStore } from "../lib/persistence/persistenceStore";
import { useEditorStore } from "../store";
import { Button } from "./ui/button";

/**
 * File-picker half of uploads. The pipeline lives in lib/upload so the
 * drop zone behaves identically; this component is just the button.
 */
export function UploadButton({ icon, label = "Add video" }: { icon?: ReactNode; label?: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const report = await uploadFiles(files, setStatus);
    if (report.storageWarning !== null) {
      // The file works for this session, but it will not survive a refresh.
      usePersistenceStore.getState().setMediaWarning(report.storageWarning);
    }
    if (report.skipped.length > 0) {
      setStatus(
        report.skipped
          .map((s) => `skipped ${s.name}: ${s.reason}`)
          .join("; "),
      );
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button size="sm" onClick={() => inputRef.current?.click()}>
        {icon} {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {status !== null && (
        <span className="text-xs text-muted">{status}</span>
      )}
    </span>
  );
}
