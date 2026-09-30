import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { Button } from "./button";

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  searchSlot?: React.ReactNode;
  filterSlot?: React.ReactNode;
  actionsSlot?: React.ReactNode;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  clearLabel?: string;
  children?: React.ReactNode;
}

export function FilterBar({
  searchSlot,
  filterSlot,
  actionsSlot,
  hasActiveFilters = false,
  onClearFilters,
  clearLabel = "Limpar filtros",
  className,
  children,
  ...props
}: FilterBarProps) {
  return (
    <div
      role="search"
      aria-label="Filtros e busca"
      className={cn(
        "flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 sm:p-4 rounded-2xl border border-border/80 bg-card shadow-xs transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 min-w-0">
        {searchSlot && <div className="w-full sm:w-72 lg:w-80 shrink-0">{searchSlot}</div>}
        {filterSlot && (
          <div className="flex items-center gap-2 flex-wrap min-w-0">{filterSlot}</div>
        )}
        {hasActiveFilters && onClearFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-xs text-muted-foreground hover:text-foreground h-9 px-2 gap-1.5 shrink-0"
          >
            <X className="h-3.5 w-3.5" />
            <span>{clearLabel}</span>
          </Button>
        )}
      </div>

      {actionsSlot && (
        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
          {actionsSlot}
        </div>
      )}

      {children}
    </div>
  );
}
