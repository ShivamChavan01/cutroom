import type { ComponentProps } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

// Shadcn sidebar menu composition, scoped to this editor's fixed sidebar.
export function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" data-sidebar="menu" className={cn("flex w-full min-w-0 flex-col gap-1", className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className={cn("relative", className)} {...props} />;
}

export function SidebarMenuButton({ isActive = false, className, children, ...props }: ComponentProps<"button"> & { isActive?: boolean }) {
  return <button type="button" data-slot="sidebar-menu-button" data-sidebar="menu-button" data-active={isActive}
    aria-current={isActive ? "page" : undefined}
    className={cn("sidebar-menu-button", className)} {...props}>
    {children}
    {isActive && <Check className="sidebar-current-marker" data-current-marker aria-hidden="true" />}
  </button>;
}
