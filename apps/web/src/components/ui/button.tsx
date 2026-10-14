import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
  {
    variants: {
      variant: {
        default: "bg-primary text-black hover:bg-primary/85",
        secondary: "bg-[#23262c] text-foreground hover:bg-[#2b2f36] border border-border",
        outline: "border border-border bg-transparent hover:bg-[#1a1d22] text-foreground",
        ghost: "hover:bg-[#1a1d22] text-muted hover:text-foreground",
        destructive: "bg-destructive/15 text-destructive border border-destructive/40 hover:bg-destructive/25",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-xs",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
