import React, { useState } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { UserProfile } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Modal } from "@/components/ui/modal";
import { LogOut, Menu } from "lucide-react";
import { getMobileNavigationItems, UserRole } from "@/config/navigation-config";

interface BottomNavProps {
  user: UserProfile;
}

function useBookingsBadge(user: UserProfile) {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  const { data } = useQuery({
    queryKey: ["bookings-badge", user?.crecheId, user?.role],
    queryFn: async () => {
      if (!user?.crecheId) return 0;
      const [pendingRes, cancelRes] = await Promise.all([
        fetch(`/api/creches/${user.crecheId}/bookings?status=pending`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/creches/${user.crecheId}/bookings?status=cancel_requested`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const pending = pendingRes.ok ? await pendingRes.json() : { total: 0 };
      const cancelRequested = cancelRes.ok ? await cancelRes.json() : { total: 0 };
      return (
        (pending.total ?? pending.items?.length ?? 0) +
        (cancelRequested.total ?? cancelRequested.items?.length ?? 0)
      );
    },
    enabled: !!user?.crecheId && (user?.role === "creche_admin" || user?.role === "staff"),
    refetchInterval: 20_000,
    staleTime: 0,
  });
  return (data ?? 0) as number;
}

function useFinancialBadge(user: UserProfile) {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  const { data } = useQuery({
    queryKey: ["financial-awaiting-count", user?.crecheId],
    queryFn: async () => {
      if (!user?.crecheId) return { count: 0 };
      const r = await fetch(
        `/api/creches/${user.crecheId}/financial/invoices/awaiting-count`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return r.ok ? r.json() : { count: 0 };
    },
    enabled: !!user?.crecheId && (user?.role === "creche_admin" || user?.role === "staff"),
    refetchInterval: 30_000,
    staleTime: 0,
  });
  return (data?.count ?? 0) as number;
}

function useTutorInvoiceBadge(user: UserProfile) {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
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

function useChatUnread(user: UserProfile) {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
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
    refetchInterval: 15_000,
    staleTime: 0,
  });
  return (data?.total ?? 0) as number;
}

export function BottomNav({ user }: BottomNavProps) {
  const [location, setLocation] = useLocation();
  const unreadChat = useChatUnread(user);
  const bookingsBadge = useBookingsBadge(user);
  const invoiceBadge = useTutorInvoiceBadge(user);
  const financialBadge = useFinancialBadge(user);
  const { logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const mobileItems = getMobileNavigationItems(user.role as UserRole);

  const getBadgeValue = (key?: string) => {
    switch (key) {
      case "unreadChat":
        return unreadChat;
      case "bookingsBadge":
        return bookingsBadge;
      case "invoiceBadge":
        return invoiceBadge;
      case "financialBadge":
        return financialBadge;
      default:
        return 0;
    }
  };

  const navLinks = mobileItems.map((item) => ({
    name: item.shortLabel || item.label,
    modalLabel: item.label,
    href: item.path,
    icon: item.icon,
    badge: getBadgeValue(item.badgeKey),
    action: undefined as (() => void) | undefined,
  }));

  const logoutLink = {
    name: "Sair",
    modalLabel: "Sair da conta",
    href: null,
    icon: LogOut,
    badge: 0,
    action: logout,
  };

  const needsMenu = navLinks.length > 4;
  const visibleLinks = needsMenu ? navLinks.slice(0, 4) : navLinks;
  const modalLinks = [...navLinks, logoutLink];

  const renderLink = (link: any, isInsideMenu = false) => {
    const isActive =
      link.href !== null &&
      (location === link.href || (link.href !== "/" && location.startsWith(link.href)));
    const badge = link.badge ?? 0;
    const action = link.action;
    const displayName = isInsideMenu ? link.modalLabel : link.name;

    const inner = (
      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-1 transition-colors duration-200 overflow-hidden select-none",
          isInsideMenu
            ? "p-4 rounded-2xl bg-card border border-border hover:bg-secondary active:scale-[0.98] min-h-[80px]"
            : "py-2 px-1 min-h-[48px] rounded-xl active:bg-secondary/40",
          isActive ? "text-primary" : action ? "text-destructive/80" : "text-muted-foreground"
        )}
      >
        {!isInsideMenu && isActive && (
          <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-primary rounded-full" />
        )}
        <div className={cn("relative flex items-center justify-center rounded-lg", isInsideMenu ? "h-7 w-7 mb-1" : "h-6 w-6")}>
          <link.icon
            className={cn(
              "shrink-0",
              isInsideMenu ? "h-6 w-6" : "h-5 w-5",
              isActive ? "text-primary stroke-[2.2px]" : "text-muted-foreground"
            )}
          />
          {badge > 0 && (
            <span
              className={cn(
                "absolute px-1 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center leading-none shadow-xs",
                isInsideMenu
                  ? "-top-1.5 -right-2 min-w-[18px] h-[18px] text-[10px]"
                  : "-top-1 -right-2 min-w-[15px] h-[15px] text-[9px]"
              )}
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </div>
        <span
          className={cn(
            "leading-none truncate max-w-full z-10",
            isInsideMenu ? "text-xs font-medium text-foreground" : "text-[11px] font-medium tracking-tight",
            isActive ? "text-primary font-semibold" : action ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {displayName}
        </span>
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
        <button
          key={link.name}
          type="button"
          onClick={onClick}
          className={cn("relative cursor-pointer text-left", isInsideMenu ? "w-full" : "flex-1")}
        >
          {inner}
        </button>
      );
    }

    return (
      <a
        key={link.href!}
        href={link.href}
        onClick={onClick}
        aria-current={isActive ? "page" : undefined}
        className={cn("relative cursor-pointer block", isInsideMenu ? "w-full" : "flex-1")}
      >
        {inner}
      </a>
    );
  };

  return (
    <>
      <nav
        aria-label="Navegação Inferior Mobile"
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden will-change-transform bg-background/95 backdrop-blur-md border-t border-border pb-safe pl-safe pr-safe"
      >
        <div className="flex items-center justify-around px-1 py-1">
          {visibleLinks.map((link) => renderLink(link, false))}

          {needsMenu && (
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              aria-label="Abrir menu de opções"
              className="flex-1 relative cursor-pointer"
            >
              <div className="relative flex flex-col items-center justify-center gap-1 transition-colors duration-200 rounded-xl py-2 px-1 min-h-[48px] text-muted-foreground active:bg-secondary/40">
                <div className="relative flex items-center justify-center rounded-lg h-6 w-6">
                  <Menu className="h-5 w-5" />
                </div>
                <span className="font-medium leading-none truncate max-w-full z-10 text-[11px] tracking-tight">
                  Menu
                </span>
              </div>
            </button>
          )}
        </div>
      </nav>

      {needsMenu && (
        <Modal isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} title="Menu Principal">
          <div className="grid grid-cols-2 min-[360px]:grid-cols-3 gap-2.5 pb-2">
            {modalLinks.map((link) => renderLink(link, true))}
          </div>
        </Modal>
      )}
    </>
  );
}
