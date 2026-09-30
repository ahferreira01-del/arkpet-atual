import React from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: React.ReactNode;
  status?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  action?: React.ReactNode; // Backward compatibility
  icon?: LucideIcon;
  iconColor?: string;
  showBack?: boolean;
  onBack?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  status,
  primaryAction,
  secondaryActions,
  action,
  icon: Icon,
  iconColor = "text-primary",
  showBack = true,
  onBack,
  className,
  children,
}: PageHeaderProps) {
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  const hasActions = primaryAction || secondaryActions || action;

  return (
    <header className={cn("flex flex-col gap-3 pb-2", className)}>
      {breadcrumbs && <div className="mb-0.5">{breadcrumbs}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          {showBack && (
            <button
              type="button"
              onClick={handleBack}
              className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/80 active:scale-95 transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Voltar para tela anterior"
            >
              <ArrowLeft className="h-5 w-5" strokeWidth={2} />
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl lg:text-3xl leading-tight font-display font-bold text-foreground flex items-center gap-2 truncate tracking-tight">
                {title}
                {Icon && <Icon strokeWidth={2} className={cn("h-5 w-5 shrink-0", iconColor)} />}
              </h1>
              {status && <div className="shrink-0">{status}</div>}
            </div>

            {description && (
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2 max-w-3xl leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>

        {hasActions && (
          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0 self-start sm:self-center">
            {secondaryActions}
            {action}
            {primaryAction}
          </div>
        )}
      </div>

      {children}
    </header>
  );
}
