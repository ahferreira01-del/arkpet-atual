import React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { UserProfile } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
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
  LogOut,
} from "lucide-react";

interface BottomNavProps {
  user: UserProfile;
}

function useBookingsBadge(user: UserProfile) {
  const token = localStorage.getItem("auth_token");
  const { data } = useQuery({
    queryKey: ["bookings-badge", user?.crecheId, user?.role],
    queryFn: async () => {
      if (!user?.crecheId) return 0;
      // Admins/staff: count pending + cancel_requested bookings
      const [pendingRes, cancelRes] = await Promise.all([
        fetch(`/api/creches/${user.crecheId}/bookings?status=pending`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/creches/${user.crecheId}/bookings?status=cancel_requested`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const pending = pendingRes.ok ? await pendingRes.json() : [];
      const cancelRequested = cancelRes.ok ? await cancelRes.json() : [];
      return (pending.length ?? 0) + (cancelRequested.length ?? 0);
    },
    enabled: !!user?.crecheId && (user?.role === "creche_admin" || user?.role === "staff"),
    refetchInterval: 20_000,
    staleTime: 0,
  });
  return (data ?? 0) as number;
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
  const bookingsBadge = useBookingsBadge(user);
  const { logout } = useAuth();

  const getLinks = () => {
    switch (user.role) {
      case "master_admin":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Creches", href: "/admin/creches", icon: Building2 },
          { name: "Usuários", href: "/admin/users", icon: Users },
          { name: "Sair", href: null, icon: LogOut, action: logout },
        ];
      case "creche_admin":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "QR", href: "/staff/qr-scanner", icon: QrCode },
          { name: "Reservas", href: "/bookings", icon: CalendarDays, badge: bookingsBadge },
          { name: "Tutores", href: "/tutors", icon: Users },
          { name: "Chat", href: "/chat", icon: MessageSquare, badge: unreadChat },
          { name: "Config.", href: "/settings", icon: Settings },
        ];
      case "staff":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Tarefas", href: "/staff", icon: CheckSquare },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Passeios", href: "/walks", icon: Footprints },
          { name: "QR", href: "/staff/qr-scanner", icon: QrCode },
          { name: "Reservas", href: "/bookings", icon: CalendarDays, badge: bookingsBadge },
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
    // will-change-transform forces GPU compositing on iOS so the fixed nav
    // doesn't jump or flicker when the soft keyboard opens/closes.
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden will-change-transform">
      {/* pb-safe pads the nav bar itself away from the system home indicator /
          gesture area. pl-safe/pr-safe handle landscape notches on iPhone. */}
      <div className="bg-background/80 backdrop-blur-xl border-t border-white/10 px-2 pb-safe pl-safe pr-safe">
        <div className="flex items-stretch justify-around">
          {links.map((link) => {
            const isActive =
              link.href !== null &&
              (location === link.href ||
              (link.href !== "/" && location.startsWith(link.href)));
            const badge = (link as any).badge ?? 0;
            const action = (link as any).action;

            const inner = (
              <div
                className={cn(
                  "flex flex-col items-center justify-center py-2.5 gap-1 transition-all duration-200 rounded-xl mx-0.5 mt-1",
                  isActive ? "text-primary" : action ? "text-destructive/70" : "text-muted-foreground"
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
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none shadow-lg">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[11px] font-medium leading-none transition-all duration-200 truncate max-w-full px-0.5",
                    isActive ? "text-primary" : action ? "text-destructive/70" : "text-muted-foreground"
                  )}
                >
                  {link.name}
                </span>
              </div>
            );

            if (action) {
              return (
                <button key={link.name} onClick={action} className="flex-1">
                  {inner}
                </button>
              );
            }

            return (
              <Link key={link.href!} href={link.href!} className="flex-1">
                {inner}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
