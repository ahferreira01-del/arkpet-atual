import React, { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { usePush } from "@/hooks/use-push";
import { useAuth } from "@/hooks/use-auth";

const SNOOZE_KEY = "arkpet_push_prompt_snoozed_until";
const SNOOZE_DAYS = 3;

function isSnoozed(): boolean {
  try {
    const until = localStorage.getItem(SNOOZE_KEY);
    if (!until) return false;
    return Date.now() < Number(until);
  } catch {
    return false;
  }
}

function snooze() {
  try {
    const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(SNOOZE_KEY, String(until));
  } catch {}
}

export function PushPrompt() {
  const { user } = useAuth();
  const { isSupported, isIosWithoutPwa, permission, isSubscribed, isLoading, subscribe } = usePush();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Delay slightly so the app feels settled before showing the prompt
    const t = setTimeout(() => {
      if (
        isSupported &&
        !isIosWithoutPwa &&
        permission === "default" &&
        !isSubscribed &&
        !isSnoozed()
      ) {
        setVisible(true);
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [user, isSupported, isIosWithoutPwa, permission, isSubscribed]);

  const handleActivate = async () => {
    await subscribe();
    setVisible(false);
  };

  const handleDismiss = () => {
    snooze();
    setVisible(false);
  };

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
          <p className="text-sm font-semibold text-white leading-tight">Ativar notificações</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
            Fique por dentro de tudo sobre seus pets.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleActivate}
            disabled={isLoading}
            className="text-xs font-semibold text-white bg-primary hover:bg-primary/90 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {isLoading ? "..." : "Ativar"}
          </button>
          <button
            onClick={handleDismiss}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
