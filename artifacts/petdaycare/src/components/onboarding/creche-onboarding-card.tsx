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
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Check localStorage for dismissal
  useEffect(() => {
    if (typeof window !== "undefined" && crecheId) {
      const dismissed = localStorage.getItem(`onboarding_dismissed_${crecheId}`);
      if (dismissed === "true") {
        setIsDismissed(true);
      }
    }
  }, [crecheId]);

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

  // If dismissed or loading without data or already complete, hide non-intrusively
  if (isDismissed || isLoading || !data || !Array.isArray(data.steps) || data.isComplete) {
    return null;
  }

  const steps = data.steps;
  if (steps.length === 0) {
    return null;
  }

  const totalSteps = typeof data.totalSteps === "number" ? data.totalSteps : steps.length;
  const completedCount = typeof data.completedCount === "number" ? data.completedCount : steps.filter((s) => s.completed).length;
  const progressPercent = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  const handleDismiss = () => {
    setIsDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(`onboarding_dismissed_${crecheId}`, "true");
    }
  };

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
              {data.completedCount} de {data.totalSteps} etapas concluídas ({progressPercent}%)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            aria-label={isCollapsed ? "Expandir checklist" : "Recolher checklist"}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Fechar checklist"
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

      {/* Collapsible Steps Content */}
      {!isCollapsed && (
        <div className="mt-4 pt-3 border-t border-border/40 space-y-2.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {data.steps.map((step) => {
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

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-muted-foreground">
              Configure sua creche no seu próprio ritmo.
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={handleDismiss}
              className="text-xs text-muted-foreground hover:text-foreground h-auto p-0"
            >
              Continuar depois
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
