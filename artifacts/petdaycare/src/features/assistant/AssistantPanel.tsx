import React, { useState, useEffect, useRef } from "react";
import { X, Minimize2, Maximize2, Sparkles, WifiOff } from "lucide-react";
import { useLocation } from "wouter";
import { AssistantConversation } from "./AssistantConversation";
import { useAssistantContext } from "./useAssistantContext";
import type { AssistantUIMessage, AssistantVisualState, AssistantUIAction } from "./assistant.types";

const ALLOWED_GUIDANCE_ROUTES = [
  "/",
  "/settings",
  "/staff/manage",
  "/tutors",
  "/pets",
  "/bookings",
  "/financial",
  "/chat",
];

const ALLOWED_GUIDANCE_TARGETS = [
  "creche-profile-form",
  "staff-create-button",
  "tutor-create-button",
  "pet-create-button",
  "booking-create-button",
];

interface AssistantPanelProps {
  isOpen: boolean;
  isMinimized: boolean;
  onClose: () => void;
  onToggleMinimize: () => void;
  userRole?: string;
  triggerButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export function AssistantPanel({
  isOpen,
  isMinimized,
  onClose,
  onToggleMinimize,
  userRole,
  triggerButtonRef,
}: AssistantPanelProps) {
  const [messages, setMessages] = useState<AssistantUIMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem("arkpet_assistant_messages");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [sessionId, setSessionId] = useState<string | undefined>(() => {
    try {
      return sessionStorage.getItem("arkpet_assistant_session_id") || undefined;
    } catch {
      return undefined;
    }
  });

  const [status, setStatus] = useState<AssistantVisualState>("idle");
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const panelRef = useRef<HTMLDivElement>(null);
  const screenContext = useAssistantContext();

  // Save conversation state to session storage
  useEffect(() => {
    try {
      sessionStorage.setItem("arkpet_assistant_messages", JSON.stringify(messages));
      if (sessionId) {
        sessionStorage.setItem("arkpet_assistant_session_id", sessionId);
      }
    } catch {
      // Safe fallback
    }
  }, [messages, sessionId]);

  // Online / Offline tracking
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Keyboard navigation & Focus management (AI-UX-003, AI-UX-004)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        triggerButtonRef?.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, triggerButtonRef]);

  const [, setLocation] = useLocation();

  const executeHighlight = (targetId: string) => {
    if (!ALLOWED_GUIDANCE_TARGETS.includes(targetId)) return;
    try {
      const el =
        document.getElementById(targetId) ||
        document.querySelector(`[data-guidance-target="${targetId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-4", "ring-primary", "ring-offset-2", "transition-all");
        setTimeout(() => {
          el.classList.remove("ring-4", "ring-primary", "ring-offset-2");
        }, 4000);
      }
    } catch {
      // MISSING_GUIDANCE_TARGET_BREAKS_APP = NO
    }
  };

  const executeUIAction = (action: AssistantUIAction) => {
    if (action.type === "navigate") {
      const cleanRoute = action.route.split("?")[0].split("#")[0];
      if (ALLOWED_GUIDANCE_ROUTES.includes(cleanRoute)) {
        setLocation(cleanRoute);
      }
    } else if (action.type === "highlight") {
      executeHighlight(action.targetId);
    }
  };

  // Restore focus to launcher on unmount/close
  useEffect(() => {
    if (!isOpen && triggerButtonRef?.current) {
      triggerButtonRef.current.focus();
    }
  }, [isOpen, triggerButtonRef]);

  useEffect(() => {
    const handleOpenWithPrompt = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt?: string }>;
      if (customEvent.detail?.prompt) {
        handleSendMessage(customEvent.detail.prompt);
      }
    };
    window.addEventListener("arkpet:open-assistant", handleOpenWithPrompt);
    return () => window.removeEventListener("arkpet:open-assistant", handleOpenWithPrompt);
  }, []);

  const handleSendMessage = async (text: string) => {
    if (!isOnline) {
      setStatus("offline");
      return;
    }

    const userMessage: AssistantUIMessage = {
      id: `msg_${Date.now()}_u`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setStatus("thinking");

    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/assistant/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          sessionId,
          screen: {
            route: screenContext.route,
            feature: screenContext.feature,
          },
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Assistente temporariamente indisponível.");
      }

      const data = await res.json();
      if (data.session?.id) {
        setSessionId(data.session.id);
      }

      const assistantMessage: AssistantUIMessage = {
        id: data.message.id || `msg_${Date.now()}_a`,
        role: "assistant",
        content: data.message.content,
        createdAt: data.message.createdAt || new Date().toISOString(),
        citations: data.message.citations,
        uiActions: data.message.uiActions,
        onboarding: data.message.onboarding,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setStatus("idle");

      // Auto-trigger navigation and highlighting safely (AI-GUIDE-001..002)
      if (Array.isArray(data.message.uiActions)) {
        for (const act of data.message.uiActions) {
          if (act.type === "navigate") {
            const cleanRoute = act.route.split("?")[0].split("#")[0];
            if (ALLOWED_GUIDANCE_ROUTES.includes(cleanRoute)) {
              setLocation(cleanRoute);
            }
          }
          if (act.type === "highlight") {
            setTimeout(() => {
              executeHighlight(act.targetId);
            }, 350);
          }
        }
      }
    } catch (err: any) {
      const errorMessage: AssistantUIMessage = {
        id: `msg_${Date.now()}_err`,
        role: "assistant",
        content: err.message || "Assistente temporariamente indisponível. O ArkPet continua funcionando normalmente.",
        createdAt: new Date().toISOString(),
        error: "true",
      };
      setMessages((prev) => [...prev, errorMessage]);
      setStatus("error");
    }
  };

  const handleClearSession = () => {
    setMessages([]);
    setSessionId(undefined);
    try {
      sessionStorage.removeItem("arkpet_assistant_messages");
      sessionStorage.removeItem("arkpet_assistant_session_id");
    } catch {}
  };

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-title"
      data-testid="assistant-panel"
      className={`fixed z-50 bg-background shadow-2xl transition-all duration-300 border-border flex flex-col ${
        // Desktop Drawer vs Mobile Bottom Sheet
        isMinimized
          ? "bottom-4 right-4 w-72 h-14 rounded-2xl border"
          : "bottom-0 right-0 w-full sm:w-[420px] md:right-4 md:bottom-4 h-full sm:h-[640px] max-h-dvh sm:rounded-2xl border-t sm:border"
      }`}
    >
      {/* Header */}
      <div className="h-14 px-4 border-b border-border/60 flex items-center justify-between shrink-0 bg-card/80 backdrop-blur-sm rounded-t-2xl">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 id="assistant-title" className="text-sm font-semibold text-foreground flex items-center gap-2">
              ArkPet Assistente
            </h2>
            {!isMinimized && (
              <span className="text-[11px] text-muted-foreground block -mt-0.5">
                {screenContext.title}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleMinimize}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label={isMinimized ? "Maximizar assistente" : "Minimizar assistente"}
            title={isMinimized ? "Maximizar" : "Minimizar"}
          >
            {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label="Fechar assistente"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body when not minimized */}
      {!isMinimized && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {!isOnline ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <WifiOff className="w-10 h-10 text-muted-foreground mb-3" />
              <h3 className="text-sm font-semibold text-foreground">Assistente Offline</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                O assistente inteligente requer conexão com a internet. O restante do ArkPet continua funcionando.
              </p>
            </div>
          ) : (
            <AssistantConversation
              messages={messages}
              status={status}
              screenContext={screenContext}
              userRole={userRole}
              onSendMessage={handleSendMessage}
              onClearSession={handleClearSession}
              onExecuteAction={executeUIAction}
            />
          )}
        </div>
      )}
    </div>
  );
}
