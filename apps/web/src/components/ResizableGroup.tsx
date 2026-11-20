import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator, useGroupRef } from "react-resizable-panels";
import { type PanelLayout, layoutForPanels, readLayout, writeLayout } from "../lib/layout";

interface Props {
  readonly groupId: string;
  readonly orientation: "horizontal" | "vertical";
  readonly children: ReactNode;
  /** Panel ids in order, matching the Panel children. */
  readonly panelIds: readonly string[];
  readonly defaultLayout: PanelLayout;
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
}: Props) {
  const groupRef = useGroupRef();
  const activeGroup = useRef(groupId);
  const restore = (): PanelLayout => {
    try { return layoutForPanels(readLayout(window.localStorage, groupId), panelIds, defaultLayout); }
    catch { return defaultLayout; }
  };
  const [layout] = useState<PanelLayout>(restore);
  useLayoutEffect(() => {
    if (activeGroup.current === groupId) return;
    activeGroup.current = groupId;
    groupRef.current?.setLayout({ ...restore() });
  }, [groupId, panelIds, defaultLayout, groupRef]);

  return (
    <Group
      orientation={orientation}
      groupRef={groupRef}
      defaultLayout={layout}
      onLayoutChange={(next) => {
        if (activeGroup.current !== groupId) return;
        try { writeLayout(window.localStorage, groupId, next); } catch { /* Resizing remains available without browser storage. */ }
      }}
    >
      {children}
    </Group>
  );
}

export { Panel, Separator };

/** The drag affordance: a thin rule that highlights on hover/focus. */
export function ResizeHandle({ orientation, disabled = false }: { orientation: "horizontal" | "vertical"; disabled?: boolean }) {
  return (
    <Separator
      disabled={disabled}
      hidden={disabled}
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
