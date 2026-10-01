import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  ArrowRight,
  Building,
  Users,
  User,
  Dog,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  route: string;
  actionLabel?: string;
}

interface OnboardingStatusResponse {
  crecheId: number;
  isComplete: boolean;
  completedCount: number;
  totalSteps: number;
  steps: OnboardingStep[];
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  creche_details: <Building className="h-4 w-4" />,
  staff: <Users className="h-4 w-4" />,
  tutors: <User className="h-4 w-4" />,
  pets: <Dog className="h-4 w-4" />,
  bookings: <Calendar className="h-4 w-4" />,
};

interface CrecheOnboardingCardProps {
  crecheId: number;
  userRole?: string;
}

export function CrecheOnboardingCard({ crecheId, userRole }: CrecheOnboardingCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== "undefined" && crecheId) {
      return localStorage.getItem(`onboarding_collapsed_${crecheId}`) === "true";
    }
    return false;
  });

  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const { data, isLoading } = useQuery<OnboardingStatusResponse>({
    queryKey: ["creche-onboarding", crecheId],
    queryFn: async () => {
      const res = await fetch(`/api/creches/${crecheId}/onboarding`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error("Erro ao carregar status do onboarding");
      }
      return res.json();
    },
    enabled: Boolean(crecheId && userRole === "creche_admin"),
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  // Role Gate: strictly for creche_admin
  if (userRole !== "creche_admin") {
    return null;
  }

  // If loading without data, steps missing, or 100% complete, hide completely
  if (isLoading || !data || !Array.isArray(data.steps) || data.isComplete) {
    return null;
  }

  const steps = data.steps;
  if (steps.length === 0) {
    return null;
  }

  const totalSteps = typeof data.totalSteps === "number" ? data.totalSteps : steps.length;
  const completedCount = typeof data.completedCount === "number" ? data.completedCount : steps.filter((s) => s.completed).length;
  const progressPercent = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  const handleSetCollapsed = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    if (typeof window !== "undefined") {
      localStorage.setItem(`onboarding_collapsed_${crecheId}`, collapsed ? "true" : "false");
    }
  };

  // ── Collapsed / Deferred State: compact bar showing progress with "Retomar" affordance ──
  if (isCollapsed) {
    return (
      <div
        role="region"
        aria-label="Primeiros passos na ArkPet"
        className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/5 via-background to-secondary/30 px-4 py-3 shadow-xs transition-all mb-6 flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <span className="font-display font-semibold text-sm text-foreground truncate">
              Primeiros passos
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              ({completedCount} de {totalSteps} concluídos)
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => handleSetCollapsed(false)}
          className="h-8 text-xs gap-1.5 shrink-0"
          aria-label="Retomar onboarding"
        >
          <span>Retomar</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // ── Expanded State ──
  return (
    <div
      role="region"
      aria-label="Primeiros passos na ArkPet"
      className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/5 via-background to-secondary/30 p-5 shadow-xs transition-all mb-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-base text-foreground truncate">
              Primeiros passos na ArkPet
            </h3>
            <p className="text-xs text-muted-foreground">
              {completedCount} de {totalSteps} etapas concluídas ({progressPercent}%)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => handleSetCollapsed(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Recolher checklist"
            aria-label="Recolher checklist"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => handleSetCollapsed(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Recolher checklist"
            aria-label="Fechar checklist"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3 w-full bg-secondary/80 rounded-full h-1.5 overflow-hidden">
        <div
          className="bg-primary h-full transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Steps Content */}
      <div className="mt-4 pt-3 border-t border-border/40 space-y-2.5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {steps.map((step) => {
            return (
              <div
                key={step.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-xl border text-sm transition-all",
                  step.completed
                    ? "bg-secondary/20 border-border/40 text-muted-foreground"
                    : "bg-background border-border hover:border-primary/40 shadow-2xs"
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0">
                    {step.completed ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "font-medium text-xs sm:text-sm truncate",
                        step.completed ? "text-muted-foreground line-through opacity-70" : "text-foreground"
                      )}
                    >
                      {step.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {step.description}
                    </p>
                  </div>
                </div>

                {!step.completed && (
                  <Link href={step.route}>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 gap-1 shrink-0 ml-2"
                    >
                      <span>{step.actionLabel || "Iniciar"}</span>
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("arkpet:open-assistant", {
                  detail: { prompt: "Qual é o próximo passo para configurar minha creche?" },
                })
              );
            }}
            className="text-xs h-8 gap-1.5 border-primary/30 text-primary hover:bg-primary/10 w-full sm:w-auto"
            data-testid="onboarding-open-assistant-btn"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Continuar com Assistente</span>
          </Button>

          <div className="flex items-center justify-between sm:justify-end gap-3">
            <span className="text-[11px] text-muted-foreground">
              Configure sua creche no seu próprio ritmo.
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={() => handleSetCollapsed(true)}
              className="text-xs text-muted-foreground hover:text-foreground h-auto p-0"
            >
              Continuar depois
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
