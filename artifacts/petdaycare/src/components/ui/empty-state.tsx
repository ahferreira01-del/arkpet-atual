import React from "react";
import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";
import { Button } from "./button";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: "default" | "secondary" | "outline";
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  compact?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      role="region"
      aria-label={title}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "p-4 py-6" : "p-8 py-12",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl bg-secondary/80 border border-border shadow-xs text-muted-foreground transition-transform",
          compact ? "h-12 w-12 mb-3 [&_svg]:h-6 [&_svg]:w-6" : "h-16 w-16 mb-4 [&_svg]:h-8 [&_svg]:w-8"
        )}
      >
        <Icon className="text-muted-foreground" aria-hidden="true" />
      </div>
      <h3
        className={cn(
          "font-display font-semibold text-foreground tracking-tight",
          compact ? "text-base" : "text-lg md:text-xl"
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          "text-muted-foreground max-w-sm mt-1.5 leading-relaxed",
          compact ? "text-xs max-w-xs" : "text-sm"
        )}
      >
        {description}
      </p>

      {(action || secondaryAction || children) && (
        <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
          {action && (
            <Button
              onClick={action.onClick}
              variant={action.variant || "secondary"}
              size={compact ? "sm" : "default"}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant={secondaryAction.variant || "outline"}
              size={compact ? "sm" : "default"}
            >
              {secondaryAction.label}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
