import * as React from "react";
import { cn } from "@/lib/utils";

export type ContentContainerWidth = "normal" | "wide" | "full";

export interface ContentContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: ContentContainerWidth;
  /** Add padding if used outside standard app layout shell */
  withPadding?: boolean;
}

const widthStyles: Record<ContentContainerWidth, string> = {
  normal: "max-w-5xl",
  wide: "max-w-7xl",
  full: "w-full max-w-none",
};

export const ContentContainer = React.forwardRef<HTMLDivElement, ContentContainerProps>(
  ({ className, width = "wide", withPadding = false, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "mx-auto w-full",
          widthStyles[width],
          withPadding && "px-4 sm:px-6 lg:px-8",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ContentContainer.displayName = "ContentContainer";
