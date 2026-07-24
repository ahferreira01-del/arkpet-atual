import React from "react";
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, icon: Icon, iconColor = "text-[#84a93a]", action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <button 
          onClick={() => window.history.back()} 
          className="h-10 w-10 rounded-full border border-white/5 bg-[#16171a] flex items-center justify-center text-gray-400 hover:text-white transition-colors shrink-0"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-display font-bold text-white flex items-center gap-2 truncate">
            {title} {Icon && <Icon className={`h-5 w-5 ${iconColor}`} />}
          </h1>
          {description && (
            <p className="text-[13px] text-gray-400 mt-1 line-clamp-2">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">{action}</div>}
    </div>
  );
}
