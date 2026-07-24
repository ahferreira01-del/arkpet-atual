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
        className={`flex items-center justify-center h-[38px] w-[38px] rounded-full border transition-all ${
          isActive 
            ? "bg-primary/20 border-primary/50 text-primary" 
            : "bg-[#1e1e2d] border-white/5 text-white hover:bg-white/10"
        }`}
      >
        <Calendar className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 sm:left-0 z-50 w-64 bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl overflow-hidden p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Filtrar por Período</span>
            {isActive && (
              <button
                onClick={() => {
                  onChangeStart("");
                  onChangeEnd("");
                  setOpen(false);
                }}
                className="text-xs text-muted-foreground hover:text-white transition-colors"
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
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Data Final</label>
              <input
                type="date"
                value={end}
                onChange={(e) => onChangeEnd(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary [color-scheme:dark]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
