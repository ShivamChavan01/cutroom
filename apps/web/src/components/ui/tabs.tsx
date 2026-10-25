import type { ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/utils";

/** Shadcn composition with Radix keyboard navigation and panel relationships. */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex min-h-0 min-w-0 flex-col", className)} {...props} />;
}

export function TabsList({ className, variant = "default", ...props }: ComponentProps<typeof TabsPrimitive.List> & { variant?: "default" | "line" }) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn("workspace-tab-list", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn("workspace-tab-trigger", className)} {...props} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("min-h-0 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/50", className)} {...props} />;
}
