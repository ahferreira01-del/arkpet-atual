import * as React from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface TabsProps {
  tabs: { id: string; label: string; icon?: React.ReactNode; content: React.ReactNode }[];
  defaultTab?: string;
  className?: string;
  onValueChange?: (id: string) => void;
}

export function Tabs({ tabs, defaultTab, className, onValueChange }: TabsProps) {
  const [activeTab, setActiveTab] = React.useState(defaultTab || tabs[0]?.id);

  // Allow controlled or side-effect when tab changes
  const handleTabClick = (id: string) => {
    setActiveTab(id);
    if (onValueChange) {
      onValueChange(id);
    }
  };

  return (
    <div className={cn("w-full flex flex-col", className)}>
      {/* Mobile Select */}
      <div className="sm:hidden mb-4">
        <div className="relative">
          <select
            value={activeTab}
            onChange={(e) => handleTabClick(e.target.value)}
            className="w-full h-12 appearance-none bg-black/20 border border-white/10 rounded-xl pl-4 pr-10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary backdrop-blur-md"
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted-foreground">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>
      </div>

      {/* Desktop Tabs */}
      <div className="hidden sm:flex flex-nowrap space-x-2 border-b border-border/50 pb-px overflow-x-auto scrollbar-sleek items-center">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "relative flex-shrink-0 flex items-center px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.icon && <span className="mr-2">{tab.icon}</span>}
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="active-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full shadow-[0_-2px_10px_rgba(139,92,246,0.5)]"
                  initial={false}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="pt-6 relative flex-1">
        {tabs.find((t) => t.id === activeTab)?.content}
      </div>
    </div>
  );
}
