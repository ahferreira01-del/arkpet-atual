import React from "react";
import { UserProfile } from "@workspace/api-client-react";
import { Bell, Search, Download, Dog } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { usePWA } from "@/hooks/use-pwa";

interface HeaderProps {
  user: UserProfile;
}

export function Header({ user }: HeaderProps) {
  const { canInstall, install } = usePWA();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  };

  return (
    <header className="h-16 md:h-20 border-b border-white/5 bg-background/50 backdrop-blur-xl z-20 flex items-center justify-between px-4 md:px-6 lg:px-8 sticky top-0">
      {/* Mobile: LuxePets logo | Desktop: greeting */}
      <div className="flex items-center gap-3">
        {/* Logo — shown only on mobile */}
        <div className="flex md:hidden items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-[0_0_14px_rgba(139,92,246,0.4)]">
            <Dog className="h-4.5 w-4.5 text-white" style={{ height: 18, width: 18 }} />
          </div>
          <span className="font-display font-bold text-lg text-white">LuxePets</span>
        </div>

        {/* Greeting — shown only on desktop */}
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

        <div className="h-9 w-9 md:h-10 md:w-10 rounded-full border border-white/10 overflow-hidden shadow-[0_0_10px_rgba(255,255,255,0.05)]">
          <img
            src={`${import.meta.env.BASE_URL}images/avatar-placeholder.png`}
            alt={user.name}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    </header>
  );
}
