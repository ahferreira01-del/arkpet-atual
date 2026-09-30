import * as React from "react";
import { cn } from "@/lib/utils";
import { type LucideIcon, Info, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";

export type AlertVariant = "info" | "success" | "warning" | "destructive";

const variantConfig: Record<
  AlertVariant,
  { container: string; iconColor: string; defaultIcon: LucideIcon }
> = {
  info: {
    container: "bg-info/10 border-info/30 text-foreground",
    iconColor: "text-info",
    defaultIcon: Info,
  },
  success: {
    container: "bg-success/10 border-success/30 text-foreground",
    iconColor: "text-success",
    defaultIcon: CheckCircle2,
  },
  warning: {
    container: "bg-warning/10 border-warning/30 text-foreground",
    iconColor: "text-warning",
    defaultIcon: AlertTriangle,
  },
  destructive: {
    container: "bg-destructive/10 border-destructive/30 text-foreground",
    iconColor: "text-destructive",
    defaultIcon: AlertCircle,
  },
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", title, icon, action, children, ...props }, ref) => {
    const config = variantConfig[variant] || variantConfig.info;
    const IconComponent = icon || config.defaultIcon;

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          "relative flex items-start gap-3.5 rounded-xl border p-4 text-sm leading-relaxed transition-colors",
          config.container,
          className
        )}
        {...props}
      >
        <IconComponent className={cn("h-5 w-5 shrink-0 mt-0.5", config.iconColor)} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {title && (
            <h5 className="font-semibold text-foreground tracking-tight mb-1">
              {title}
            </h5>
          )}
          <div className="text-muted-foreground text-xs sm:text-sm">{children}</div>
        </div>
        {action && <div className="shrink-0 ml-2 self-center">{action}</div>}
      </div>
    );
  }
);
Alert.displayName = "Alert";
