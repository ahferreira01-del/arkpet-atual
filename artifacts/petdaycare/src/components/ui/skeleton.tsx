import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-xl bg-muted/60 dark:bg-muted/40",
        className
      )}
      {...props}
    />
  );
}

export interface InlineLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function InlineLoader({
  className,
  label = "Carregando...",
  size = "md",
  ...props
}: InlineLoaderProps) {
  const iconSizes = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-2 text-muted-foreground text-sm", className)}
      {...props}
    >
      <Loader2 className={cn("animate-spin text-primary", iconSizes[size])} aria-hidden="true" />
      {label && <span>{label}</span>}
      <span className="sr-only">{label}</span>
    </div>
  );
}
