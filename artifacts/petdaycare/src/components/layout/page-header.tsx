import React from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  action?: React.ReactNode;
  showBack?: boolean;
}

export function PageHeader({ 
  title, 
  description, 
  icon: Icon, 
  iconColor = "text-primary", 
  action,
  showBack = true
}: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        {showBack && (
          <button 
            onClick={() => window.history.back()} 
            className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/80 active:bg-secondary/90 transition-colors shrink-0"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl leading-tight font-display font-bold text-foreground flex items-center gap-2 truncate tracking-tight">
            {title} {Icon && <Icon strokeWidth={2} className={`h-5 w-5 ${iconColor}`} />}
          </h1>
          {description && (
            <p className="text-[13px] text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">{action}</div>}
    </div>
  );
}
