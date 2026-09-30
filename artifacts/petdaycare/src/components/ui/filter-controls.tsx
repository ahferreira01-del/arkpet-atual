import React from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilterSelectProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  label: string;
  isActive?: boolean;
}

export const FilterSelect = React.forwardRef<HTMLButtonElement, FilterSelectProps>(
  ({ icon: Icon, label, isActive, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex items-center gap-2 h-10 px-3 py-2 rounded-full border transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background",
          isActive
            ? "bg-primary/10 border-primary text-primary"
            : "bg-card border-border text-foreground hover:bg-secondary active:bg-secondary/80",
          className
        )}
        {...props}
      >
        {Icon && (
          <div className="flex items-center justify-center h-6 w-6 rounded-full bg-secondary/50 shrink-0">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        )}
        <span className="text-[13px] font-medium leading-none truncate">{label}</span>
        <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground shrink-0" />
      </button>
    );
  }
);
FilterSelect.displayName = "FilterSelect";

interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  isActive?: boolean;
  count?: number;
}

export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ label, isActive, count, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex items-center justify-center h-8 px-4 rounded-full text-[13px] font-medium transition-colors shrink-0",
          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground active:bg-secondary/60",
          className
        )}
        {...props}
      >
        {label}
        {count !== undefined && (
          <span
            className={cn(
              "ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] leading-none",
              isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-muted-foreground"
            )}
          >
            {count}
          </span>
        )}
      </button>
    );
  }
);
FilterChip.displayName = "FilterChip";
