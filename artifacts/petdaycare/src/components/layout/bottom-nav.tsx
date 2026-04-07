import React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { UserProfile } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
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
  QrCode,
} from "lucide-react";

interface BottomNavProps {
  user: UserProfile;
}

// Uses React Query so invalidating ["chat-unread", crecheId] in the chat page
// immediately clears the badge here too — no separate polling needed.
function useChatUnread(user: UserProfile) {
  const token = localStorage.getItem("auth_token");
  const { data } = useQuery({
    queryKey: ["chat-unread", user?.crecheId],
    queryFn: async () => {
      if (!user?.crecheId) return { total: 0 };
      const r = await fetch(`/api/creches/${user.crecheId}/chat/unread`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return r.ok ? r.json() : { total: 0 };
    },
    enabled: !!user?.crecheId,
    refetchInterval: 15000,
    staleTime: 0,
  });
  return (data?.total ?? 0) as number;
}

export function BottomNav({ user }: BottomNavProps) {
  const [location] = useLocation();
  const unreadChat = useChatUnread(user);

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
          { name: "Tutores", href: "/tutors", icon: Users },
          { name: "Chat", href: "/chat", icon: MessageSquare, badge: unreadChat },
          { name: "Config.", href: "/settings", icon: Settings },
        ];
      case "staff":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Tarefas", href: "/staff", icon: CheckSquare },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Reservas", href: "/bookings", icon: CalendarDays },
          { name: "QR", href: "/staff/qr-scanner", icon: QrCode },
          { name: "Chat", href: "/chat", icon: MessageSquare, badge: unreadChat },
          { name: "Config.", href: "/settings", icon: Settings },
        ];
      case "tutor":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Reservas", href: "/bookings", icon: CalendarDays },
          { name: "Chat", href: "/chat", icon: MessageSquare, badge: unreadChat },
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
            const badge = (link as any).badge ?? 0;
            return (
              <Link key={link.href} href={link.href} className="flex-1">
                <div
                  className={cn(
                    "flex flex-col items-center justify-center py-3 gap-1 transition-all duration-200 rounded-xl mx-0.5 mt-1",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <div
                    className={cn(
                      "relative flex items-center justify-center h-7 w-7 rounded-lg transition-all duration-200",
                      isActive && "bg-primary/20 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
                    )}
                  >
                    <link.icon
                      className={cn(
                        "h-5 w-5 transition-transform duration-200",
                        isActive && "scale-110"
                      )}
                    />
                    {badge > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none shadow-lg">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
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
