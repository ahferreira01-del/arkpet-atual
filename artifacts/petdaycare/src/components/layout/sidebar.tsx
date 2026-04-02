import React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { UserProfile } from "@workspace/api-client-react";
import { 
  LayoutDashboard, 
  Users, 
  Building2, 
  Dog, 
  CalendarDays, 
  CheckSquare, 
  MessageSquare,
  Settings,
  LogOut,
  Footprints
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface SidebarProps {
  user: UserProfile;
}

export function Sidebar({ user }: SidebarProps) {
  const [location] = useLocation();
  const { logout } = useAuth();

  const getLinks = () => {
    switch (user.role) {
      case "master_admin":
        return [
          { name: "Dashboard", href: "/", icon: LayoutDashboard },
          { name: "Creches", href: "/admin/creches", icon: Building2 },
          { name: "Usuários", href: "/admin/users", icon: Users },
        ];
      case "creche_admin":
        return [
          { name: "Dashboard", href: "/", icon: LayoutDashboard },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Reservas", href: "/bookings", icon: CalendarDays },
          { name: "Tarefas", href: "/staff", icon: CheckSquare },
          { name: "Mensagens", href: "/chat", icon: MessageSquare },
          { name: "Equipe", href: "/staff/manage", icon: Users },
          { name: "Configurações", href: "/settings", icon: Settings },
        ];
      case "staff":
        return [
          { name: "Dashboard", href: "/", icon: LayoutDashboard },
          { name: "Tarefas", href: "/staff", icon: CheckSquare },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Passeios", href: "/walks", icon: Footprints },
          { name: "Mensagens", href: "/chat", icon: MessageSquare },
        ];
      case "tutor":
        return [
          { name: "Dashboard", href: "/", icon: LayoutDashboard },
          { name: "Meus Pets", href: "/pets", icon: Dog },
          { name: "Reservas", href: "/bookings", icon: CalendarDays },
          { name: "Mensagens", href: "/chat", icon: MessageSquare },
        ];
      default:
        return [];
    }
  };

  const links = getLinks();

  return (
    <div className="w-64 glass-panel border-y-0 border-l-0 border-r-white/10 hidden md:flex flex-col h-full z-10 relative">
      <div className="p-6 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.3)]">
          <Dog className="h-6 w-6 text-white" />
        </div>
        <span className="font-display font-bold text-xl tracking-tight text-white">LuxePets</span>
      </div>

      <div className="px-4 py-2 mb-4">
        <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/5 backdrop-blur-md">
          <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider mb-1">Signed in as</p>
          <p className="text-sm font-medium text-white truncate">{user.name}</p>
          <p className="text-xs text-primary capitalize">{user.role.replace('_', ' ')}</p>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">
        {links.map((link) => {
          const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
          return (
            <Link key={link.href} href={link.href} className="block">
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group cursor-pointer",
                  isActive 
                    ? "bg-primary/20 text-primary border border-primary/20 shadow-[0_0_15px_rgba(139,92,246,0.1)]" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-white"
                )}
              >
                <link.icon className={cn("h-5 w-5 transition-transform group-hover:scale-110", isActive && "text-primary")} />
                <span className="font-medium text-sm">{link.name}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 mt-auto">
        <button 
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200 w-full"
        >
          <LogOut className="h-5 w-5" />
          <span className="font-medium text-sm">Sign Out</span>
        </button>
      </div>
    </div>
  );
}
