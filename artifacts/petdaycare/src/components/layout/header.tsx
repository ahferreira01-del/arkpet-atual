import React from "react";
import { useLocation } from "wouter";
import { UserProfile } from "@workspace/api-client-react";
import { Sun, Moon, LogOut, ChevronDown, User, Download, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-provider";
import { usePWA } from "@/hooks/use-pwa";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { NAVIGATION_CONFIG } from "@/config/navigation-config";
import { GlobalSearchModal } from "@/components/search/global-search-modal";

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
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { canInstall, install } = usePWA();
  const [location] = useLocation();

  // Find page title from canonical navigation config or fallback
  const currentNav = NAVIGATION_CONFIG.find(
    (item) => item.path === location || (item.path !== "/" && location.startsWith(item.path))
  );
  const pageTitle = currentNav?.label || "ArkPet";

  // Initials for avatar
  const initials = (user?.name || "U")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const roleLabel = ROLE_LABELS[user?.role] || user?.role || "Usuário";
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);

  // Global Ctrl+K / Cmd+K shortcut
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <header className="h-14 sm:h-16 bg-background/95 backdrop-blur-md border-b border-border z-20 flex items-center justify-between px-4 sm:px-6 sticky top-0 shrink-0">
        {/* ── Left Context ── */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile brand (hidden on desktop where sidebar is visible) */}
          <div className="flex md:hidden items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <img
                src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
                alt="ArkPet"
                className="h-5 w-5 object-contain"
              />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-display font-bold text-sm leading-none text-foreground tracking-tight truncate">
                ArkPet
              </span>
              <span className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                {pageTitle}
              </span>
            </div>
          </div>

          {/* Desktop breadcrumb / location title */}
          <div className="hidden md:flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground tracking-tight">
              {pageTitle}
            </span>
          </div>
        </div>

        {/* ── Center: Search Trigger (Desktop) ── */}
        <div className="hidden md:flex items-center flex-1 max-w-xs mx-4">
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border border-border bg-card/60 hover:bg-secondary text-muted-foreground hover:text-foreground text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
            aria-label="Buscar (Ctrl+K)"
          >
            <div className="flex items-center gap-2 min-w-0 truncate">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Buscar pets, tutores, reservas...</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono shrink-0">
              Ctrl+K
            </kbd>
          </button>
        </div>

        {/* ── Right Actions ── */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Mobile Search Button */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            aria-label="Abrir busca global"
            className="flex md:hidden h-10 w-10 rounded-xl border border-border bg-card items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* PWA Install Button (if available) */}
        {canInstall && (
          <button
            type="button"
            onClick={install}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Instalar aplicativo"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Instalar App</span>
          </button>
        )}

        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Alternar para tema claro" : "Alternar para tema escuro"}
          className="h-10 w-10 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-warning" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {/* User Account Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 p-1 sm:pr-2.5 rounded-xl border border-border bg-card hover:bg-secondary transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[40px]"
              aria-label="Menu do usuário"
            >
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                {initials}
              </div>
              <span className="text-xs font-medium text-foreground max-w-[120px] truncate hidden sm:inline-block">
                {user?.name?.split(" ")[0]}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground hidden sm:block shrink-0" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56 p-1.5">
            <DropdownMenuLabel className="font-normal px-2 py-1.5">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-semibold text-foreground truncate leading-tight">
                  {user?.name}
                </p>
                {user?.email && (
                  <p className="text-xs text-muted-foreground truncate leading-tight">
                    {user.email}
                  </p>
                )}
                <div className="pt-1">
                  <StatusBadge variant="neutral" className="text-[10px] px-2 py-0.2">
                    {roleLabel}
                  </StatusBadge>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer gap-2 text-xs">
              {theme === "dark" ? (
                <>
                  <Sun className="h-4 w-4 text-warning" />
                  <span>Modo Claro</span>
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-muted-foreground" />
                  <span>Modo Escuro</span>
                </>
              )}
            </DropdownMenuItem>

            {canInstall && (
              <DropdownMenuItem onClick={install} className="cursor-pointer gap-2 text-xs sm:hidden">
                <Download className="h-4 w-4" />
                <span>Instalar Aplicativo</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={logout}
              className="cursor-pointer gap-2 text-xs text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              <span>Sair da conta</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    <GlobalSearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
  </>
  );
}
