import React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (val: string) => void;
  onClear?: () => void;
}

export function SearchInput({ 
  value, 
  onChange, 
  onClear, 
  className,
  placeholder = "Buscar...",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props 
}: SearchInputProps) {
  // If caller explicitly provided aria-labelledby, let that define the accessible name without aria-label interference.
  // Otherwise, use caller-supplied aria-label, fallback to placeholder, or fallback to generic "Buscar".
  const fallbackAriaLabel = ariaLabelledBy
    ? undefined
    : (ariaLabel || placeholder || "Buscar");


  return (
    <div className={cn("relative flex items-center w-full", className)}>
      <Search className="absolute left-3.5 h-5 w-5 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={fallbackAriaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          "h-11 w-full rounded-xl border border-border bg-background pl-10 text-base md:text-sm text-foreground",
          "focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all",
          "placeholder:text-muted-foreground",
          onClear ? "pr-10" : "pr-4"
        )}
        {...props}
      />
      {onClear && value.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2.5 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground active:bg-secondary/80 transition-colors"
          aria-label="Limpar busca"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
