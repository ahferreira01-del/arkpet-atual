import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, ArrowRight } from "lucide-react";

export function StatCard({
  title,
  value,
  subValue,
  trend,
  icon,
  iconColor = "text-primary",
  iconBg = "bg-primary/20",
  alert,
  clickable,
}: {
  title: string;
  value: string;
  subValue?: string;
  trend?: string;
  icon: React.ReactNode;
  iconColor?: string;
  iconBg?: string;
  alert?: boolean;
  clickable?: boolean;
}) {
  return (
    <Card className={`relative overflow-hidden transition-all duration-200 shadow-sm bg-card border-border ${
      alert ? "border-warning/40 bg-warning/10" : ""
    } ${clickable ? "hover:bg-secondary cursor-pointer min-h-[44px]" : ""}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 min-w-0 break-words">{title}</p>
            <h3 className="text-2xl lg:text-3xl font-display font-bold text-foreground leading-none min-w-0 break-words">{value}</h3>
            {trend && (
              <p className="text-xs text-success mt-2 flex items-center gap-1 truncate">
                <TrendingUp className="h-3 w-3 shrink-0" /> {trend}
              </p>
            )}
            {subValue && !trend && (
              <p className="text-xs text-muted-foreground mt-2 truncate">{subValue}</p>
            )}
          </div>
          <div className={`h-10 w-10 sm:h-11 sm:w-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
            {icon}
          </div>
        </div>
        {clickable && (
          <div className="mt-3 flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground/60">
            <ArrowRight className="h-3 w-3 shrink-0" /> <span className="truncate">Ver detalhes</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
