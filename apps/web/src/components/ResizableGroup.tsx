import { useEffect, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { type PanelLayout, readLayout, writeLayout } from "../lib/layout";

interface Props {
  readonly groupId: string;
  readonly orientation: "horizontal" | "vertical";
  readonly children: ReactNode;
  /** Panel ids in order, matching the Panel children. */
  readonly panelIds: readonly string[];
  readonly defaultLayout: PanelLayout;
  readonly minSize?: number;
}

/**
 * Resizable group with sizes persisted per group id. The library handles
 * the drag mechanics; this wrapper only reads the saved layout on mount
 * and writes it back when the user resizes.
 */
export function ResizableGroup({
  groupId,
  orientation,
  children,
  panelIds,
  defaultLayout,
  minSize = 10,
}: Props) {
  const [layout, setLayout] = useState<PanelLayout>(() => {
    if (typeof window === "undefined") return defaultLayout;
    return readLayout(window.localStorage, groupId) ?? defaultLayout;
  });

  // A saved layout from an older session may not cover the current panels.
  useEffect(() => {
    const known = panelIds.every((id) => layout[id] !== undefined);
    if (!known) setLayout(defaultLayout);
  }, [layout, panelIds, defaultLayout]);

  return (
    <Group
      orientation={orientation}
      defaultLayout={layout}
      onLayoutChange={(next) => {
        setLayout(next);
        writeLayout(window.localStorage, groupId, next);
      }}
    >
      {children}
    </Group>
  );
}

export { Panel, Separator };

/** The drag affordance: a thin rule that highlights on hover/focus. */
export function ResizeHandle({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return (
    <Separator
      className={
        orientation === "vertical"
          ? "group relative w-px bg-border data-[resize-handle-active]:bg-primary"
          : "group relative h-px bg-border data-[resize-handle-active]:bg-primary"
      }
    >
      <span
        aria-hidden
        className="absolute inset-0 transition-colors group-hover:bg-primary/40"
        style={orientation === "vertical" ? { left: -2, right: -2 } : { top: -2, bottom: -2 }}
      />
    </Separator>
  );
}
