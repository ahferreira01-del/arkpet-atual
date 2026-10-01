import React, { useState, useEffect } from "react";
import { Sparkles, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AssistantLauncherProps {
  isOpen: boolean;
  onToggle: () => void;
  userRole?: string;
  triggerButtonRef: React.RefObject<HTMLButtonElement | null>;
}

export function AssistantLauncher({
  isOpen,
  onToggle,
  userRole,
  triggerButtonRef,
}: AssistantLauncherProps) {
  const [showFirstAccessBanner, setShowFirstAccessBanner] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem("arkpet_assistant_first_access_dismissed");
      if (!dismissed && userRole === "creche_admin") {
        setShowFirstAccessBanner(true);
      }
    } catch {
      // Safe fallback
    }
  }, [userRole]);

  const handleDismissBanner = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFirstAccessBanner(false);
    try {
      localStorage.setItem("arkpet_assistant_first_access_dismissed", "true");
    } catch {}
  };

  const handleStartOnboarding = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleDismissBanner(e);
    onToggle();
  };

  if (isOpen) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 flex flex-col items-end gap-2.5">
      {/* First-access Greeting Popover Banner */}
      {showFirstAccessBanner && (
        <div
          role="region"
          aria-label="Apresentação do Assistente ArkPet"
          className="bg-card border border-border/80 shadow-xl rounded-2xl p-4 max-w-xs sm:max-w-sm animate-in fade-in slide-in-from-bottom-3 duration-300"
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-semibold text-foreground">ArkPet Assistente</h4>
            </div>
            <button
              type="button"
              onClick={handleDismissBanner}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
              aria-label="Dispensar aviso de apresentação"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Olá! Eu sou o assistente do ArkPet. Posso configurar sua creche com você e mostrar como tudo funciona.
          </p>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleStartOnboarding}
              className="text-xs h-7 px-3 rounded-lg flex items-center gap-1 cursor-pointer"
            >
              <span>Começar onboarding</span>
              <ChevronRight className="w-3 h-3" />
            </Button>
            <button
              type="button"
              onClick={handleDismissBanner}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 transition-colors cursor-pointer"
            >
              Agora não
            </button>
          </div>
        </div>
      )}

      {/* Launcher Trigger Button */}
      <button
        ref={triggerButtonRef as any}
        type="button"
        onClick={onToggle}
        aria-label="Abrir assistente ArkPet"
        aria-expanded={isOpen}
        data-testid="assistant-launcher"
        className="group relative flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        <Sparkles className="w-5 h-5 transition-transform group-hover:rotate-12" />
        <span className="sr-only">Abrir assistente ArkPet</span>

        {/* Pulse badge dot */}
        <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-amber-400 border-2 border-background animate-pulse" />
      </button>
    </div>
  );
}
