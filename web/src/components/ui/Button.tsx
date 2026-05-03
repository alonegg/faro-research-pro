import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "destructive" | "default";
type Size = "sm" | "md" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        "btn",
        variant === "primary" && "btn--primary",
        variant === "ghost" && "btn--ghost",
        variant === "destructive" && "btn--destructive",
        size === "sm" && "btn--sm",
        size === "icon" && "btn--icon",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
