import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Calendar,
  User,
  Dog,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AssistantSafeActionUI } from "./assistant.types";

interface AssistantActionConfirmationProps {
  action: AssistantSafeActionUI;
  onConfirm: (pendingActionId: string) => Promise<void>;
  onCancel: (pendingActionId: string) => Promise<void>;
}

export function AssistantActionConfirmation({
  action,
  onConfirm,
  onCancel,
}: AssistantActionConfirmationProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const pendingId = action.pendingActionId;

  // Countdown timer for pending confirmation
  useEffect(() => {
    if (action.state !== "confirmation_required" || !action.expiresAt) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const expTime = new Date(action.expiresAt!).getTime();
      const now = Date.now();
      const remainingSecs = Math.max(0, Math.floor((expTime - now) / 1000));
      setTimeLeft(remainingSecs);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [action.state, action.expiresAt]);

  const handleConfirmClick = async () => {
    if (!pendingId || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm(pendingId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelClick = async () => {
    if (!pendingId || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onCancel(pendingId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCountdown = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins}:${remainder.toString().padStart(2, "0")}`;
  };

  const renderFieldIcon = (key: string) => {
    const lower = key.toLowerCase();
    if (lower.includes("pet")) return <Dog className="w-3.5 h-3.5 text-muted-foreground" />;
    if (lower.includes("date") || lower.includes("data") || lower.includes("time") || lower.includes("horario"))
      return <Calendar className="w-3.5 h-3.5 text-muted-foreground" />;
    if (lower.includes("tutor") || lower.includes("user"))
      return <User className="w-3.5 h-3.5 text-muted-foreground" />;
    return <FileText className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const formatFieldLabel = (key: string): string => {
    const labels: Record<string, string> = {
      bookingId: "Reserva #",
      petId: "Pet ID",
      petName: "Pet",
      tutorName: "Tutor",
      date: "Data",
      type: "Tipo",
      notes: "Observações",
      taskId: "Tarefa #",
      title: "Título",
      medicationName: "Medicamento",
      dosage: "Dosagem",
      scheduledFor: "Horário Agendado",
      reason: "Motivo",
    };
    return labels[key] || key;
  };

  // State: Executed
  if (action.state === "executed") {
    return (
      <div className="mt-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100 flex flex-col gap-1.5 text-xs animate-in fade-in">
        <div className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Ação executada com sucesso</span>
        </div>
        {action.summary && <p className="text-muted-foreground text-[11px]">{action.summary}</p>}
      </div>
    );
  }

  // State: Cancelled
  if (action.state === "cancelled") {
    return (
      <div className="mt-3 p-3 rounded-xl border border-border/50 bg-muted/30 text-muted-foreground flex items-center gap-2 text-xs">
        <XCircle className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span>Ação cancelada pelo usuário. Nenhuma alteração foi realizada.</span>
      </div>
    );
  }

  // State: Expired
  if (action.state === "expired" || (timeLeft !== null && timeLeft <= 0)) {
    return (
      <div className="mt-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 flex items-center gap-2 text-xs">
        <Clock className="w-4 h-4 shrink-0 text-amber-500" />
        <span>Tempo para confirmação expirado (5 minutos). Solicite novamente caso deseje executar.</span>
      </div>
    );
  }

  // State: Failed
  if (action.state === "failed") {
    return (
      <div className="mt-3 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-200 flex flex-col gap-1 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-rose-600 dark:text-rose-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Falha na execução</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{action.error || "Erro ao processar a mutação no servidor."}</p>
      </div>
    );
  }

  // State: Confirmation Required / Executing
  return (
    <div
      data-testid="assistant-action-confirmation-card"
      className="mt-3 p-3.5 rounded-xl border border-primary/30 bg-card/90 shadow-sm flex flex-col gap-3 text-xs"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="font-semibold text-foreground text-xs block">
              Confirmação Necessária
            </span>
            <span className="text-[10px] text-muted-foreground block">
              Ação segura: requer aprovação explícita
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400">
            Ação Controlada
          </Badge>
          {timeLeft !== null && timeLeft > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="w-3 h-3 text-amber-500" />
              <span>{formatCountdown(timeLeft)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      {action.summary && (
        <div className="font-medium text-foreground text-xs bg-muted/40 p-2 rounded-lg border border-border/30">
          {action.summary}
        </div>
      )}

      {/* Structured Preview */}
      {action.preview && Object.keys(action.preview).length > 0 && (
        <div className="grid grid-cols-2 gap-2 bg-muted/20 p-2.5 rounded-lg border border-border/20 text-[11px]">
          {Object.entries(action.preview).map(([key, val]) => {
            if (val === null || val === undefined || typeof val === "object") return null;
            return (
              <div key={key} className="flex items-center gap-1.5 overflow-hidden">
                {renderFieldIcon(key)}
                <span className="text-muted-foreground truncate">{formatFieldLabel(key)}:</span>
                <span className="font-semibold text-foreground truncate">{String(val)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Buttons / Actions */}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/30">
        <Button
          data-testid="assistant-action-cancel-button"
          type="button"
          variant="outline"
          size="sm"
          disabled={isSubmitting}
          onClick={handleCancelClick}
          className="h-8 text-xs px-3 rounded-lg border-border hover:bg-muted text-muted-foreground cursor-pointer"
        >
          {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3.5 h-3.5 mr-1" />}
          <span>Cancelar</span>
        </Button>

        <Button
          data-testid="assistant-action-confirm-button"
          type="button"
          variant="default"
          size="sm"
          disabled={isSubmitting}
          onClick={handleConfirmClick}
          className="h-8 text-xs px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs cursor-pointer"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
              <span>Executando...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              <span>Confirmar</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
