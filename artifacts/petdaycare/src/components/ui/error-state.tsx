import React from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, FileQuestion, ShieldAlert, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "./button";

export type ErrorStateType = "generic" | "not-found" | "access-denied" | "offline";

interface ErrorTypeConfig {
  icon: LucideIcon;
  defaultTitle: string;
  defaultDescription: string;
  defaultActionLabel: string;
}

const typeConfigs: Record<ErrorStateType, ErrorTypeConfig> = {
  generic: {
    icon: AlertTriangle,
    defaultTitle: "Ocorreu um erro inesperado",
    defaultDescription: "Não foi possível carregar as informações. Tente novamente mais tarde.",
    defaultActionLabel: "Tentar novamente",
  },
  "not-found": {
    icon: FileQuestion,
    defaultTitle: "Registro não encontrado",
    defaultDescription: "O item solicitado não existe ou pode ter sido removido.",
    defaultActionLabel: "Voltar",
  },
  "access-denied": {
    icon: ShieldAlert,
    defaultTitle: "Acesso não autorizado",
    defaultDescription: "Você não possui permissão para acessar este recurso.",
    defaultActionLabel: "Voltar para o início",
  },
  offline: {
    icon: WifiOff,
    defaultTitle: "Sem conexão com a internet",
    defaultDescription: "Verifique sua conexão de rede para continuar utilizando o sistema.",
    defaultActionLabel: "Reconectar",
  },
};

export interface ErrorStateProps {
  type?: ErrorStateType;
  title?: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  type = "generic",
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className,
}: ErrorStateProps) {
  const config = typeConfigs[type] || typeConfigs.generic;
  const Icon = config.icon;
  const resolvedTitle = title || config.defaultTitle;
  const resolvedDescription = description || config.defaultDescription;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "p-4 py-6" : "p-8 py-12",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive shadow-xs mb-4",
          compact ? "h-12 w-12 [&_svg]:h-6 [&_svg]:w-6" : "h-16 w-16 [&_svg]:h-8 [&_svg]:w-8"
        )}
      >
        <Icon aria-hidden="true" />
      </div>

      <h3
        className={cn(
          "font-display font-semibold text-foreground tracking-tight",
          compact ? "text-base" : "text-lg md:text-xl"
        )}
      >
        {resolvedTitle}
      </h3>

      <p
        className={cn(
          "text-muted-foreground max-w-sm mt-1.5 leading-relaxed",
          compact ? "text-xs max-w-xs" : "text-sm"
        )}
      >
        {resolvedDescription}
      </p>

      {(action || secondaryAction) && (
        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          {action && (
            <Button
              onClick={action.onClick}
              variant="default"
              size={compact ? "sm" : "default"}
            >
              {action.label || config.defaultActionLabel}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant="outline"
              size={compact ? "sm" : "default"}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
