import React, { useState, useRef, useEffect } from "react";
import { Calendar } from "lucide-react";

interface DateFilterPopoverProps {
  start: string;
  end: string;
  onChangeStart: (s: string) => void;
  onChangeEnd: (s: string) => void;
}

export function DateFilterPopover({ start, end, onChangeStart, onChangeEnd }: DateFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const isActive = start || end;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center justify-center h-10 w-10 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
          isActive 
            ? "bg-primary/10 border-primary text-primary" 
            : "bg-card border-border text-foreground hover:bg-secondary active:bg-secondary/80"
        }`}
      >
        <Calendar className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 sm:left-0 z-50 w-64 bg-card border border-border rounded-2xl shadow-xl overflow-hidden p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Filtrar por Período</span>
            {isActive && (
              <button
                onClick={() => {
                  onChangeStart("");
                  onChangeEnd("");
                  setOpen(false);
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Limpar
              </button>
            )}
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Data Inicial</label>
              <input
                type="date"
                value={start}
                onChange={(e) => onChangeStart(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-base md:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Data Final</label>
              <input
                type="date"
                value={end}
                onChange={(e) => onChangeEnd(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-base md:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
