import React, { useEffect, useState } from "react";
import { Bell, X, Smartphone } from "lucide-react";
import { usePush } from "@/hooks/use-push";
import { useAuth } from "@/hooks/use-auth";

const SNOOZE_KEY = "arkpet_push_prompt_snoozed_until";
const IOS_SNOOZE_KEY = "arkpet_ios_prompt_snoozed_until";
const SNOOZE_DAYS = 3;

function isSnoozed(key = SNOOZE_KEY): boolean {
  try {
    const until = localStorage.getItem(key);
    if (!until) return false;
    return Date.now() < Number(until);
  } catch {
    return false;
  }
}

function snooze(key = SNOOZE_KEY) {
  try {
    const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(key, String(until));
  } catch {}
}

// Role-aware description
function getBannerDescription(role?: string) {
  if (role === "tutor") return "Acompanhe tudo sobre seus pets em tempo real.";
  return "Receba alertas de reservas, comprovantes e tarefas.";
}

export function PushPrompt() {
  const { user } = useAuth();
  const { isSupported, isIosWithoutPwa, permission, isSubscribed, isLoading, subscribe } = usePush();
  const [visible, setVisible] = useState(false);
  const [iosVisible, setIosVisible] = useState(false);

  // Regular push prompt (non-iOS or iOS in standalone mode)
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      if (
        isSupported &&
        !isIosWithoutPwa &&
        permission === "default" &&
        !isSubscribed &&
        !isSnoozed(SNOOZE_KEY)
      ) {
        setVisible(true);
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [user, isSupported, isIosWithoutPwa, permission, isSubscribed]);

  // iOS "add to home screen" prompt
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      if (isIosWithoutPwa && !isSnoozed(IOS_SNOOZE_KEY)) {
        setIosVisible(true);
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [user, isIosWithoutPwa]);

  const handleActivate = async () => {
    await subscribe();
    setVisible(false);
  };

  const handleDismiss = () => {
    snooze(SNOOZE_KEY);
    setVisible(false);
  };

  const handleIosDismiss = () => {
    snooze(IOS_SNOOZE_KEY);
    setIosVisible(false);
  };

  // iOS install guide banner
  if (iosVisible) {
    return (
      <div
        className="fixed inset-x-0 z-50 flex justify-center px-4"
        style={{ bottom: "calc(72px + env(safe-area-inset-bottom, 0px) + 8px)" }}
      >
        <div className="w-full max-w-sm glass-panel rounded-2xl border border-primary/20 shadow-[0_8px_32px_rgba(139,92,246,0.25)] px-4 py-3 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Smartphone className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">Ative notificações no iPhone</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                Toque em <span className="text-foreground font-medium">Compartilhar</span> (□↑) no Safari →{" "}
                <span className="text-foreground font-medium">Adicionar à Tela de Início</span> → depois ative aqui.
              </p>
            </div>
            <button
              onClick={handleIosDismiss}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0 min-h-[32px] min-w-[32px]"
              aria-label="Fechar aviso de notificações iOS"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Standard push permission banner
  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: "calc(72px + env(safe-area-inset-bottom, 0px) + 8px)" }}
    >
      <div className="w-full max-w-sm glass-panel rounded-2xl border border-primary/20 shadow-[0_8px_32px_rgba(139,92,246,0.25)] px-4 py-3 flex items-center gap-3 animate-in slide-in-from-bottom-4 fade-in duration-300">
        {/* Icon */}
        <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Bell className="h-4 w-4 text-primary" />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">Ativar notificações</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
            {getBannerDescription(user?.role)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleActivate}
            disabled={isLoading}
            className="text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 px-3.5 py-2 rounded-xl transition-colors disabled:opacity-60 min-h-[36px]"
          >
            {isLoading ? "..." : "Ativar"}
          </button>
          <button
            onClick={handleDismiss}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors min-h-[32px] min-w-[32px]"
            aria-label="Fechar aviso de notificações"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
