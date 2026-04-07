import React, { useState, useRef, useEffect } from "react";
import { UserProfile } from "@workspace/api-client-react";
import { Bell, Search, Download, Dog, LogOut, ChevronDown } from "lucide-react";
import { Input } from "../ui/input";
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
    <header className="h-16 md:h-20 border-b border-white/5 bg-background/50 backdrop-blur-xl z-20 flex items-center justify-between px-4 md:px-6 lg:px-8 sticky top-0">
      {/* Mobile: LuxePets logo | Desktop: greeting */}
      <div className="flex items-center gap-3">
        <div className="flex md:hidden items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-[0_0_14px_rgba(139,92,246,0.4)]">
            <Dog className="h-4.5 w-4.5 text-white" style={{ height: 18, width: 18 }} />
          </div>
          <span className="font-display font-bold text-lg text-white">LuxePets</span>
        </div>

        <div className="hidden md:block">
          <h1 className="text-2xl font-display font-semibold text-white tracking-tight">
            {getGreeting()}, {user.name.split(" ")[0]}!
          </h1>
          {user.crecheId && user.role !== "tutor" && (
            <p className="text-sm text-primary font-medium flex items-center gap-2 mt-0.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Unidade Ativa
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <div className="hidden md:block w-56">
          <Input
            icon={<Search className="h-4 w-4" />}
            placeholder="Buscar pets, reservas..."
            className="rounded-full bg-white/5 border-white/5 focus-visible:ring-1"
          />
        </div>

        {canInstall && (
          <Button
            onClick={install}
            variant="outline"
            size="sm"
            className="hidden sm:flex items-center gap-2 border-primary/30 text-primary hover:bg-primary/10 rounded-full px-4"
          >
            <Download className="h-4 w-4" />
            Instalar App
          </Button>
        )}

        <Button variant="glass" size="icon" className="rounded-full relative h-9 w-9 md:h-10 md:w-10">
          <Bell className="h-4 w-4 md:h-5 md:w-5" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive border border-background"></span>
        </Button>

        {/* Avatar + dropdown menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-full focus:outline-none group"
            aria-label="Menu do perfil"
          >
            <div className="relative">
              <div className="h-9 w-9 md:h-10 md:w-10 rounded-full border border-white/10 overflow-hidden shadow-[0_0_10px_rgba(255,255,255,0.05)] transition-all group-hover:border-primary/40">
                <img
                  src={`${import.meta.env.BASE_URL}images/avatar-placeholder.png`}
                  alt={user.name}
                  className="h-full w-full object-cover"
                />
              </div>
              {/* Small chevron indicator — visible on all screen sizes */}
              <span className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-background border border-white/10 flex items-center justify-center transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}>
                <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
              </span>
            </div>
            <ChevronDown
              className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 hidden md:block ${menuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-56 glass-panel rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/10 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
              {/* User info */}
              <div className="px-4 py-3 border-b border-white/10">
                <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                <p className="text-xs text-primary mt-0.5">{ROLE_LABELS[user.role] || user.role}</p>
                {user.email && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.email}</p>
                )}
              </div>

              {/* Logout */}
              <div className="p-2">
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-150"
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
