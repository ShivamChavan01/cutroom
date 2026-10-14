import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 rounded-md border border-border bg-[#16181d] px-2.5 text-[13px] text-foreground placeholder:text-faint outline-none focus:border-primary/70",
        className,
      )}
      {...props}
    />
  );
}
