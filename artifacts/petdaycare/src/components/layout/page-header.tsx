import React from "react";
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, icon: Icon, iconColor = "text-primary", action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className={`h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center ${iconColor}`}>
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white truncate">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">{action}</div>}
    </div>
  );
}
