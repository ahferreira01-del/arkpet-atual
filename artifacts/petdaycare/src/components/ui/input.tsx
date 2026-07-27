import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, icon, inputMode, ...props }, ref) => {
    // Default inputMode for number fields so iOS/Android show the numeric
    // keypad instead of the full keyboard.  Caller can override by passing
    // inputMode explicitly.
    const resolvedInputMode =
      inputMode ?? (type === "number" ? "decimal" : undefined);

    return (
      <div className="relative w-full">
        <input
          type={type}
          inputMode={resolvedInputMode}
          className={cn(
            /* text-base on mobile keeps iOS Safari from auto-zooming (needs ≥16px).
               md:text-sm restores the design on larger screens. */
            "flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-base md:text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 transition-all backdrop-blur-md",
            icon && "pl-11",
            className
          )}
          ref={ref}
          {...props}
        />
        {icon && (
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10">
            {icon}
          </div>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
