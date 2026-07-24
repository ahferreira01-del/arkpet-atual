import React, { useState, useRef, useEffect } from "react";
import { UserProfile } from "@workspace/api-client-react";
import { Search, Download, Dog, LogOut, ChevronDown } from "lucide-react";
import { QuickCheckIn } from "../quick-checkin";
import { Button } from "../ui/button";
import { usePWA } from "@/hooks/use-pwa";
import { useAuth } from "@/hooks/use-auth";

interface HeaderProps {
  user: UserProfile;
}

const ROLE_LABELS: Record<string, string> = {
  master_admin: "Master Admin",
  creche_admin: "Admin de Creche",
  staff: "Funcionário",
  tutor: "Tutor",
};

export function Header({ user }: HeaderProps) {
  const { canInstall, install } = usePWA();
  const { logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <header className="h-20 bg-background z-20 flex md:hidden items-center justify-between px-4 sticky top-0">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center overflow-hidden">
          <img src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`} alt="ArkPet" className="h-8 object-contain" />
        </div>
        <div className="flex flex-col">
          <span className="font-display font-bold text-[22px] leading-none text-white tracking-tight">Ark Pet</span>
          <span className="text-[13px] text-gray-400 mt-1">Gestão que conecta.</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="text-gray-400 hover:text-white transition-colors">
          <Search className="h-6 w-6" />
        </button>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          </button>
          <span className="absolute -top-1 -right-1 h-[18px] min-w-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center leading-none">
            3
          </span>

          {/* Dropdown Logout */}
          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+15px)] z-50 w-56 bg-card rounded-2xl shadow-xl border border-white/5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-4 py-3 border-b border-white/5">
                <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                <p className="text-xs text-primary mt-0.5">{ROLE_LABELS[user.role] || user.role}</p>
              </div>
              <div className="p-2">
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:bg-white/5 hover:text-white transition-all duration-150"
                >
                  <LogOut className="h-4 w-4" />
                  Sair da conta
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
