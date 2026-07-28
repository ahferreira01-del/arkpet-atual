import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { UserProfile } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Modal } from "@/components/ui/modal";
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
  CreditCard,
  LogOut,
  CircleDollarSign,
  Receipt,
  UserCog,
  Menu
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
      // API returns { items, total, ... } — use .total, not .length
      const pending = pendingRes.ok ? await pendingRes.json() : { total: 0 };
      const cancelRequested = cancelRes.ok ? await cancelRes.json() : { total: 0 };
      return (pending.total ?? pending.items?.length ?? 0) +
             (cancelRequested.total ?? cancelRequested.items?.length ?? 0);
    },
    enabled: !!user?.crecheId && (user?.role === "creche_admin" || user?.role === "staff"),
    refetchInterval: 20_000,
    staleTime: 0,
  });
  return (data ?? 0) as number;
}

// Badge showing how many pending/overdue invoices the tutor has.
// Invalidated by usePayManualInvoice, useApproveReceipt, etc.
function useTutorInvoiceBadge(user: UserProfile) {
  const token = localStorage.getItem("auth_token");
  const { data } = useQuery({
    queryKey: ["tutor-invoices", user?.crecheId, user?.id],
    queryFn: async () => {
      if (!user?.crecheId || !user?.id) return [];
      const r = await fetch(
        `/api/creches/${user.crecheId}/financial/invoices?tutorId=${user.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return r.ok ? r.json() : [];
    },
    enabled: !!user?.crecheId && user?.role === "tutor",
    refetchInterval: 60_000,
    staleTime: 0,
  });
  const invoices: any[] = data?.data ?? (Array.isArray(data) ? data : []);
  return invoices.filter((inv: any) => inv.status === "pending" || inv.status === "overdue").length;
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
  const [location, setLocation] = useLocation();
  const unreadChat = useChatUnread(user);
  const bookingsBadge = useBookingsBadge(user);
  const invoiceBadge = useTutorInvoiceBadge(user);
  const { logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
          { name: "Equipe", href: "/staff/manage", icon: UserCog },
          { name: "Tarefas", href: "/staff/board", icon: CheckSquare },
          { name: "Chat", href: "/chat", icon: MessageSquare, badge: unreadChat },
          { name: "Finanças", href: "/financial", icon: CircleDollarSign },
          { name: "Plano", href: "/assinatura", icon: CreditCard },
          { name: "Config.", href: "/settings", icon: Settings },
        ];
      case "staff":
        return [
          { name: "Início", href: "/", icon: LayoutDashboard },
          { name: "Operacional", href: "/staff/board", icon: CheckSquare },
          { name: "Pets", href: "/pets", icon: Dog },
          { name: "Reservas", href: "/bookings", icon: CalendarDays, badge: bookingsBadge },
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
          { name: "Faturas", href: "/tutor/financial", icon: Receipt, badge: invoiceBadge },
          { name: "Config.", href: "/settings", icon: Settings },
        ];
      default:
        return [];
    }
  };

  const links = getLinks();
  const needsMenu = links.length > 5;
  const visibleLinks = needsMenu ? links.slice(0, 4) : links;

  const renderLink = (link: any, isInsideMenu = false) => {
    const isActive =
      link.href !== null &&
      (location === link.href || (link.href !== "/" && location.startsWith(link.href)));
    const badge = link.badge ?? 0;
    const action = link.action;

    const inner = (
      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-1 transition-all duration-200 overflow-hidden",
          isInsideMenu ? "py-4 rounded-2xl bg-white/5 hover:bg-white/10" : "py-2.5 mx-0.5 mt-1 rounded-xl",
          isActive ? "text-primary" : action ? "text-destructive/70" : "text-gray-500"
        )}
      >
        <div className={cn("relative flex items-center justify-center rounded-lg transition-all duration-200", isInsideMenu ? "h-8 w-8 mb-1" : "h-7 w-7")}>
          <link.icon className={cn("transition-transform duration-200", isInsideMenu ? "h-7 w-7" : "h-6 w-6", isActive ? "text-primary stroke-[2.5px]" : "text-gray-500")} />
          {badge > 0 && (
            <span className="absolute -top-1 -right-2 min-w-[16px] h-[16px] px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center leading-none shadow-lg">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </div>
        <span className={cn("font-semibold leading-none transition-all duration-200 truncate max-w-full z-10", isInsideMenu ? "text-[12px]" : "text-[11px]", isActive ? "text-white" : action ? "text-destructive/70" : "text-gray-500")}>
          {link.name}
        </span>
        {!isInsideMenu && isActive && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[3px] bg-primary rounded-t-full shadow-[0_0_8px_rgba(132,169,80,0.8)]" />
        )}
      </div>
    );

    const onClick = (e?: React.MouseEvent) => {
      if (e) e.preventDefault();
      if (isInsideMenu) {
        setIsMenuOpen(false);
      }
      if (action) {
        action();
      } else if (link.href) {
        setTimeout(() => {
          setLocation(link.href);
        }, 10);
      }
    };

    if (action) {
      return (
        <button key={link.name} onClick={onClick} className={cn("relative", isInsideMenu ? "w-full" : "flex-1")}>
          {inner}
        </button>
      );
    }

    return (
      <a key={link.href!} href={link.href} onClick={onClick} className={cn("relative cursor-pointer block", isInsideMenu ? "w-full" : "flex-1")}>
        {inner}
      </a>
    );
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden will-change-transform">
        <div className="bg-[#111214] border-t border-white/5 px-1 pb-safe pl-safe pr-safe relative">
          <div className="flex items-stretch justify-around">
            {visibleLinks.map((link) => renderLink(link, false))}
            
            {needsMenu && (
              <button onClick={() => setIsMenuOpen(true)} className="flex-1 relative">
                <div className="relative flex flex-col items-center justify-center gap-1 transition-all duration-200 rounded-xl mt-1 overflow-hidden py-2.5 mx-0.5 text-gray-500 hover:text-white">
                  <div className="relative flex items-center justify-center rounded-lg transition-all duration-200 h-7 w-7">
                    <Menu className="transition-transform duration-200 h-6 w-6" />
                  </div>
                  <span className="font-semibold leading-none transition-all duration-200 truncate max-w-full z-10 text-[11px]">
                    Menu
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      </nav>

      {needsMenu && (
        <Modal isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} title="Menu Principal">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pb-4">
            {links.map((link) => renderLink(link, true))}
          </div>
        </Modal>
      )}
    </>
  );
}
