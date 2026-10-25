import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { EXPORT_FORMATS, type ExportFormat } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { Button } from "./ui/button";
import { SidebarMenuButton } from "./ui/sidebar";

/**
 * Export menu. Every entry is a real interchange format the engine
 * serialises — the label says which tools open the file, so nobody has to
 * guess whether they picked the right one.
 */
export function ExportMenu({ sidebar = false }: { sidebar?: boolean } = {}) {
  const timeline = useEditorStore((state) => state.timeline);
  const [open, setOpen] = useState(false);
  const [lastFormat, setLastFormat] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) === false) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const download = (format: ExportFormat) => {
    const content = format.serialize(timeline);
    const blob = new Blob([content], { type: format.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${timeline.id || "timeline"}${format.extension}`;
    link.click();
    URL.revokeObjectURL(url);
    setOpen(false);
    setLastFormat(format.label);
  };

  const triggerProps = {
    onClick: () => setOpen((was) => !was),
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    title: "Export the timeline",
  };

  return (
    <div className="relative" ref={rootRef}>
      {sidebar ? <SidebarMenuButton {...triggerProps}><Download aria-hidden /><span>Export</span></SidebarMenuButton> : <Button size="sm" {...triggerProps}>
        <Download /> Export
      </Button>}
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 w-80 rounded-lg border border-border bg-card p-1 shadow-2xl"
        >
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format.id}
              role="menuitem"
              onClick={() => download(format)}
              className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-raised"
            >
              <span className="flex items-center gap-2 text-[12px] text-foreground">
                {format.label}
                <span className="font-mono text-[10px] text-faint">
                  {format.extension}
                </span>
              </span>
              <span className="text-[11px] text-muted">{format.opens}</span>
              <span className="text-[11px] text-faint">{format.description}</span>
            </button>
          ))}
        </div>
      )}
      {lastFormat !== null && !open && (
        <span className="ml-2 text-[11px] text-success">exported {lastFormat}</span>
      )}
    </div>
  );
}
