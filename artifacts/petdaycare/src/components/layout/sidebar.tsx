import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { UserProfile, useGetCreche, getGetCrecheQueryKey } from "@workspace/api-client-react";
import { LogOut, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getDesktopNavigationItems, UserRole, NavigationItem } from "@/config/navigation-config";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface SidebarProps {
  user: UserProfile;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "arkpet-sidebar-collapsed";

import {
  usePendingBookingsBadge as useBookingsBadge,
  useFinancialBadge,
  useTutorInvoiceBadge,
  useChatUnread,
} from "@/hooks/use-badges";

const ROLE_LABELS: Record<string, string> = {
  master_admin: "Master Admin",
  creche_admin: "Admin de Creche",
  staff: "Funcionário",
  tutor: "Tutor",
};

export function Sidebar({ user }: SidebarProps) {
  const [location] = useLocation();
  const { logout } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Safe fallback
      }
      return next;
    });
  };

  const { data: creche } = useGetCreche(user?.crecheId as number, {
    query: {
      queryKey: getGetCrecheQueryKey(user?.crecheId as number),
      enabled: Boolean(user?.crecheId),
    },
  });

  const financialBadge = useFinancialBadge(user);
  const bookingsBadge = useBookingsBadge(user);
  const tutorInvoiceBadge = useTutorInvoiceBadge(user);
  const chatUnread = useChatUnread(user);

  const desktopItems = getDesktopNavigationItems(user?.role as UserRole);

  const getBadgeValue = (badgeKey?: string) => {
    switch (badgeKey) {
      case "financialBadge":
        return financialBadge;
      case "bookingsBadge":
        return bookingsBadge;
      case "invoiceBadge":
        return tutorInvoiceBadge;
      case "unreadChat":
        return chatUnread;
      default:
        return 0;
    }
  };

  // Group items by their group property
  const groupedItems = desktopItems.reduce<Record<string, NavigationItem[]>>((acc, item) => {
    const groupName = item.group || "Principal";
    if (!acc[groupName]) {
      acc[groupName] = [];
    }
    acc[groupName].push(item);
    return acc;
  }, {});

  const isMasterAdmin = user?.role === "master_admin";
  const roleName = ROLE_LABELS[user?.role] || user?.role || "Usuário";

  return (
    <aside
      aria-label="Navegação Principal"
      className={cn(
        "hidden md:flex flex-col h-full z-20 relative bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out shrink-0 select-none",
        isCollapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* ── Header / Brand Context ── */}
      <div
        className={cn(
          "flex items-center border-b border-sidebar-border/60 transition-all duration-200",
          isCollapsed ? "p-3 justify-center h-16" : "p-4 gap-3 h-16"
        )}
      >
        {isMasterAdmin ? (
          isCollapsed ? (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center cursor-pointer">
                  <img
                    src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
                    alt="ArkPet"
                    className="h-6 w-6 object-contain"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">ArkPet Master Admin</TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <img
                  src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
                  alt="ArkPet"
                  className="h-6 w-6 object-contain"
                />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-display font-bold text-base tracking-tight text-sidebar-foreground truncate">
                  ArkPet
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate">
                  Painel Master
                </span>
              </div>
            </div>
          )
        ) : creche?.logoUrl ? (
          isCollapsed ? (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <div className="h-10 w-10 rounded-xl bg-secondary border border-border flex items-center justify-center overflow-hidden shrink-0 cursor-pointer">
                  <img src={creche.logoUrl} alt={creche.name} className="h-full w-full object-cover" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">{creche.name}</TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-secondary border border-border flex items-center justify-center overflow-hidden shrink-0">
                <img src={creche.logoUrl} alt={creche.name} className="h-full w-full object-cover" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-display font-bold text-sm tracking-tight text-sidebar-foreground truncate">
                  {creche.name}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium truncate">
                  Powered by ArkPet
                </span>
              </div>
            </div>
          )
        ) : isCollapsed ? (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center cursor-pointer">
                <img
                  src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
                  alt="ArkPet"
                  className="h-6 w-6 object-contain"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">ArkPet</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <img
                src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
                alt="ArkPet"
                className="h-6 w-6 object-contain"
              />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-display font-bold text-base tracking-tight text-sidebar-foreground truncate">
                ArkPet
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
                Gestão que conecta
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── User Context (Expanded mode) ── */}
      {!isCollapsed && user && (
        <div className="px-3 pt-3 pb-1">
          <div className="px-3 py-2 rounded-xl bg-sidebar-accent/50 border border-sidebar-border/80">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
              Conectado como
            </p>
            <p className="text-xs font-semibold text-sidebar-foreground truncate mt-0.5">{user.name}</p>
            <p className="text-[11px] text-primary font-medium">{roleName}</p>
          </div>
        </div>
      )}

      {/* ── Navigation Links ── */}
      <nav className="flex-1 px-2.5 py-3 space-y-4 overflow-y-auto custom-scrollbar">
        {Object.entries(groupedItems).map(([groupName, items]) => {
          return (
            <div key={groupName} className="space-y-1">
              {!isCollapsed ? (
                <div className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  {groupName}
                </div>
              ) : (
                <div className="my-1.5 border-t border-sidebar-border/40 mx-1" />
              )}

              {items.map((item) => {
                const isActive =
                  location === item.path ||
                  (item.path !== "/" && location.startsWith(item.path));
                const badge = getBadgeValue(item.badgeKey);

                if (isCollapsed) {
                  return (
                    <Tooltip key={item.id} delayDuration={150}>
                      <TooltipTrigger asChild>
                        <Link href={item.path} className="block" aria-label={item.label} aria-current={isActive ? "page" : undefined}>
                          <div
                            className={cn(
                              "relative flex items-center justify-center w-11 h-11 mx-auto rounded-xl transition-all duration-200 group cursor-pointer",
                              isActive
                                ? "bg-primary/10 text-primary border border-primary/25 shadow-xs"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                            )}
                          >
                            {isActive && (
                              <span
                                className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-primary"
                                aria-hidden="true"
                              />
                            )}
                            <item.icon
                              className={cn(
                                "h-5 w-5 shrink-0 transition-transform group-hover:scale-105",
                                isActive && "text-primary"
                              )}
                            />
                            {badge > 0 && (
                              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center leading-none shadow-xs">
                                {badge > 99 ? "99+" : badge}
                              </span>
                            )}
                          </div>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={12}>
                        <div className="flex items-center gap-2">
                          <span>{item.label}</span>
                          {badge > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
                              {badge}
                            </span>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <Link key={item.id} href={item.path} className="block" aria-current={isActive ? "page" : undefined}>
                    <div
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 group cursor-pointer text-sm font-medium",
                        isActive
                          ? "bg-primary/10 text-primary font-semibold border border-primary/25 shadow-xs"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      {isActive && (
                        <span
                          className="absolute left-1 top-2 bottom-2 w-1 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                      )}
                      <item.icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform group-hover:scale-105",
                          isActive ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground"
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                      {badge > 0 && (
                        <span className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center leading-none shadow-xs">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* ── Footer Actions (Collapse Toggle + Logout) ── */}
      <div className="p-3 border-t border-sidebar-border/60 space-y-1 mt-auto">
        {/* Collapse toggle button */}
        {isCollapsed ? (
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleCollapse}
                aria-expanded={!isCollapsed}
                aria-label="Expandir barra lateral"
                className="flex items-center justify-center w-11 h-10 mx-auto rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-200"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expandir barra lateral</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={toggleCollapse}
            aria-expanded={!isCollapsed}
            aria-label="Recolher barra lateral"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-200 w-full text-xs font-medium"
          >
            <ChevronLeft className="h-4 w-4 shrink-0" />
            <span>Recolher menu</span>
          </button>
        )}

        {/* Logout button */}
        {isCollapsed ? (
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={logout}
                aria-label="Sair da conta"
                className="flex items-center justify-center w-11 h-10 mx-auto rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sair da conta</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200 w-full text-xs font-medium"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Sair da conta</span>
          </button>
        )}
      </div>
    </aside>
  );
}
