import { useRef, useState, type ReactNode } from "react";
import { stringifyOTIO } from "@cutroom/engine";
import { uploadFiles } from "../lib/upload";
import { useEditorStore } from "../store";
import { Button } from "./ui/button";

/** Download the current timeline as .otio for Premiere/Resolve/Blender. */
export function ExportOitioButton({ icon }: { icon?: ReactNode }) {
  const timeline = useEditorStore((state) => state.timeline);
  return (
    <Button
      size="sm"
      onClick={() => {
        const blob = new Blob([stringifyOTIO(timeline)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${timeline.id || "timeline"}.otio`;
        link.click();
        URL.revokeObjectURL(url);
      }}
      title="Export OpenTimelineIO for Premiere / Resolve / Blender"
    >
      {icon} Export .otio
    </Button>
  );
}

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
