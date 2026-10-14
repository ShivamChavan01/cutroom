import { useRef, useState } from "react";
import { stringifyOTIO } from "@cutroom/engine";
import { uploadFiles } from "../lib/upload";
import { useEditorStore } from "../store";

/** Download the current timeline as .otio for Premiere/Resolve/Blender. */
export function ExportOitioButton() {
  const timeline = useEditorStore((state) => state.timeline);
  return (
    <button
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
      Export .otio
    </button>
  );
}

/**
 * File-picker half of uploads. The pipeline lives in lib/upload so the
 * drop zone behaves identically; this component is just the button.
 */
export function UploadButton() {
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
    <span>
      <button onClick={() => inputRef.current?.click()}>Add video</button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          void onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {status !== null && (
        <span style={{ fontSize: 12, color: "#868e96", marginLeft: 6 }}>{status}</span>
      )}
    </span>
  );
}
