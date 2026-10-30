import { useRef, useState, type ReactNode } from "react";
import { importMedia } from "../lib/upload";
import { Button } from "./ui/button";

/**
 * File-picker half of uploads. The pipeline lives in lib/upload so the
 * drop zone behaves identically; this component is just the button.
 */
export function UploadButton({ icon, label = "Add video", accept = "video/*,audio/*,image/*" }: { icon?: ReactNode; label?: string; accept?: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const report = await importMedia(files, setStatus);
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
        accept={accept}
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
