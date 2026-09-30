import * as React from "react";
import { cn } from "@/lib/utils";
import { type LucideIcon, ArrowUpRight, TrendingUp, TrendingDown } from "lucide-react";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-card text-card-foreground rounded-2xl border border-border/80 shadow-xs transition-colors",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("font-display text-xl font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

/* ── Canonical Composite: MetricCard ────────────────────────────────────────── */
export interface MetricCardTrend {
  value: string | number;
  isPositive?: boolean;
  label?: string;
}

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  supportingText?: string;
  trend?: MetricCardTrend;
  icon?: LucideIcon;
  badge?: React.ReactNode;
}

export const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  ({ className, label, value, supportingText, trend, icon: Icon, badge, ...props }, ref) => {
    return (
      <Card
        ref={ref}
        className={cn(
          "relative overflow-hidden p-6 hover:border-border transition-all",
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {Icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground border border-border/60">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          {badge}
        </div>

        <div className="mt-4">
          <div className="text-2xl sm:text-3xl font-bold font-display tracking-tight text-foreground">
            {value}
          </div>

          {(trend || supportingText) && (
            <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
              {trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-semibold",
                    trend.isPositive
                      ? "text-success"
                      : trend.isPositive === false
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {trend.isPositive === true && <TrendingUp className="h-3.5 w-3.5" />}
                  {trend.isPositive === false && <TrendingDown className="h-3.5 w-3.5" />}
                  {trend.value}
                  {trend.label && (
                    <span className="font-normal text-muted-foreground ml-0.5">
                      {trend.label}
                    </span>
                  )}
                </span>
              )}
              {supportingText && (
                <span className="text-muted-foreground">{supportingText}</span>
              )}
            </div>
          )}
        </div>
      </Card>
    );
  }
);
MetricCard.displayName = "MetricCard";

/* ── Canonical Composite: InteractiveCard ──────────────────────────────────── */
export interface InteractiveCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  showIndicator?: boolean;
}

export const InteractiveCard = React.forwardRef<HTMLButtonElement, InteractiveCardProps>(
  ({ className, children, showIndicator = true, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "group relative flex w-full flex-col text-left rounded-2xl border border-border/80 bg-card p-6 shadow-xs transition-all duration-200",
          "hover:border-primary/50 hover:bg-surface-hover hover:shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          "active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
        {showIndicator && (
          <div className="absolute right-5 top-5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity text-primary">
            <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
      </button>
    );
  }
);
InteractiveCard.displayName = "InteractiveCard";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
