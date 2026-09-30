import * as React from "react";
import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

export type StatusBadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: StatusBadgeVariant;
  dot?: boolean;
  icon?: LucideIcon;
  children: React.ReactNode;
}

const variantStyles: Record<StatusBadgeVariant, { container: string; dot: string; icon: string }> = {
  neutral: {
    container: "bg-secondary text-secondary-foreground border-border/80",
    dot: "bg-muted-foreground",
    icon: "text-muted-foreground",
  },
  success: {
    container: "bg-success/15 text-success border-success/30 dark:bg-success/20 dark:border-success/40",
    dot: "bg-success",
    icon: "text-success",
  },
  warning: {
    container: "bg-warning/15 text-warning border-warning/30 dark:bg-warning/20 dark:border-warning/40",
    dot: "bg-warning",
    icon: "text-warning",
  },
  danger: {
    container: "bg-destructive/15 text-destructive border-destructive/30 dark:bg-destructive/20 dark:border-destructive/40",
    dot: "bg-destructive",
    icon: "text-destructive",
  },
  info: {
    container: "bg-info/15 text-info border-info/30 dark:bg-info/20 dark:border-info/40",
    dot: "bg-info",
    icon: "text-info",
  },
};

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, variant = "neutral", dot = false, icon: Icon, children, ...props }, ref) => {
    const config = variantStyles[variant] || variantStyles.neutral;

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight transition-colors select-none",
          config.container,
          className
        )}
        {...props}
      >
        {dot && (
          <span
            className={cn("h-1.5 w-1.5 rounded-full shrink-0 animate-pulse", config.dot)}
            aria-hidden="true"
          />
        )}
        {Icon && (
          <Icon className={cn("h-3.5 w-3.5 shrink-0", config.icon)} aria-hidden="true" />
        )}
        <span>{children}</span>
      </span>
    );
  }
);
StatusBadge.displayName = "StatusBadge";
