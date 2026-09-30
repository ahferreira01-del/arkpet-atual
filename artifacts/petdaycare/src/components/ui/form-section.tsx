import * as React from "react";
import { cn } from "@/lib/utils";

export interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function FormSection({
  title,
  description,
  action,
  children,
  className,
  ...props
}: FormSectionProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-6 transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div className="space-y-1">
          <h3 className="font-display font-semibold text-lg tracking-tight text-foreground">
            {title}
          </h3>
          {description && (
            <p className="text-xs sm:text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className="space-y-4">{children}</div>
    </div>
  );
}
