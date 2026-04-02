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
  Footprints,
} from "lucide-react";

interface BottomNavProps {
  user: UserProfile;
}

export function BottomNav({ user }: BottomNavProps) {
  const [location] = useLocation();

  const getLinks = () => {
    switch (user.role) {
      case "master_admin":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Creches", href: "/admin/creches", icon: Building2 },
          { name: "Usuários", href: "/admin/users", icon: Users },
        ];
      case "creche_admin":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Reservas", href: "/bookings", icon: CalendarDays },
          { name: "Tarefas", href: "/staff", icon: CheckSquare },
          { name: "Chat", href: "/chat", icon: MessageSquare },
          { name: "Equipe", href: "/staff/manage", icon: Users },
          { name: "Config.", href: "/settings", icon: Settings },
        ];
      case "staff":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Tarefas", href: "/staff", icon: CheckSquare },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Passeios", href: "/walks", icon: Footprints },
          { name: "Chat", href: "/chat", icon: MessageSquare },
          { name: "Config.", href: "/settings", icon: Settings },
        ];
      case "tutor":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Reservas", href: "/bookings", icon: CalendarDays },
          { name: "Chat", href: "/chat", icon: MessageSquare },
          { name: "Config.", href: "/settings", icon: Settings },
        ];
      default:
        return [];
    }
  };

  const links = getLinks();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      <div className="bg-background/80 backdrop-blur-xl border-t border-white/10 px-2 pb-safe">
        <div className="flex items-stretch justify-around">
          {links.map((link) => {
            const isActive =
              location === link.href ||
              (link.href !== "/" && location.startsWith(link.href));
            return (
              <Link key={link.href} href={link.href} className="flex-1">
                <div
                  className={cn(
                    "flex flex-col items-center justify-center py-3 gap-1 transition-all duration-200 rounded-xl mx-0.5 mt-1",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-center h-7 w-7 rounded-lg transition-all duration-200",
                      isActive && "bg-primary/20 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
                    )}
                  >
                    <link.icon
                      className={cn(
                        "h-5 w-5 transition-transform duration-200",
                        isActive && "scale-110"
                      )}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-medium leading-none transition-all duration-200",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {link.name}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
