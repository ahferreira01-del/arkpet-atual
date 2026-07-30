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

    </header>
  );
}
