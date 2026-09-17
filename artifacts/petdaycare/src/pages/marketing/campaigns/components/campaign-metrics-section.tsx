import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Users,
  CheckCircle2,
  Clock,
  DollarSign,
  AlertCircle,
  Loader2,
  PieChart,
  ShieldAlert,
} from "lucide-react";

interface CampaignMetricsSectionProps {
  crecheId: number;
  campaignId: number;
}

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "R$ 0,00";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function CampaignMetricsSection({ crecheId, campaignId }: CampaignMetricsSectionProps) {
  const token = localStorage.getItem("auth_token");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["campaign-metrics", crecheId, campaignId],
    enabled: !!crecheId && !!campaignId,
    queryFn: async () => {
      const res = await fetch(
        `/api/creches/${crecheId}/marketing/metrics/campaigns/${campaignId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao carregar métricas da campanha.");
      }
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-xs text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Carregando métricas da campanha...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{(error as any)?.message || "Erro ao carregar métricas."}</span>
      </div>
    );
  }

  if (!data) return null;

  const red = data.redemptionSummary || {};
  const fin = data.financial;
  const isAllActive = data.audienceType === "ALL_ACTIVE_TUTORS";

  return (
    <div className="space-y-4 pt-3 border-t border-border/40 text-xs">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-primary" />
          Métricas e Conversão da Campanha
        </h4>
        <span className="text-[10px] text-muted-foreground">Fonte da Verdade</span>
      </div>

      {/* Audience & Conversion Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/40 space-y-1">
          <span className="text-[11px] text-muted-foreground">Público da Campanha:</span>
          {isAllActive ? (
            <div>
              <p className="font-bold text-foreground">Todos Ativos</p>
              <p className="text-[10px] text-muted-foreground italic">
                Não disponível historicamente
              </p>
            </div>
          ) : (
            <div>
              <p className="font-bold text-foreground">
                {data.currentSelectedAudienceSize ?? 0} tutores
              </p>
              {data.crmAudienceAtCreation != null && (
                <p className="text-[10px] text-muted-foreground">
                  CRM na criação: {data.crmAudienceAtCreation}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/40 space-y-1">
          <span className="text-[11px] text-muted-foreground">Tutores que Usaram:</span>
          <p className="font-bold text-foreground">
            {red.uniqueTutorsAppliedCount ?? 0} tutores únicos
          </p>
          <p className="text-[10px] text-muted-foreground">
            {red.uniqueTutorsCount ?? 0} tutores reservaram
          </p>
        </div>

        <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/40 space-y-1">
          <span className="text-[11px] text-muted-foreground">Taxa de Adesão:</span>
          {data.utilizationRatePercentage != null ? (
            <p className="font-bold text-emerald-400 text-sm">
              {data.utilizationRatePercentage.toFixed(1)}%
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              N/D (Público Geral)
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Total de resgates: {red.totalRedemptions ?? 0}
          </p>
        </div>
      </div>

      {/* Redemptions Breakdown */}
      <div className="p-3 bg-secondary/20 rounded-lg border border-border/40 space-y-2">
        <p className="font-semibold text-foreground text-[11px]">Estado dos Resgates:</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="p-2 rounded bg-background/50 flex flex-col">
            <span className="text-muted-foreground">Reservados</span>
            <span className="font-bold text-blue-400">{red.reservedCount ?? 0}</span>
          </div>
          <div className="p-2 rounded bg-background/50 flex flex-col">
            <span className="text-muted-foreground">Parcialmente Aplicados</span>
            <span className="font-bold text-amber-400">{red.partiallyAppliedCount ?? 0}</span>
          </div>
          <div className="p-2 rounded bg-background/50 flex flex-col">
            <span className="text-muted-foreground">Totalmente Aplicados</span>
            <span className="font-bold text-emerald-400">{red.appliedCount ?? 0}</span>
          </div>
          <div className="p-2 rounded bg-background/50 flex flex-col">
            <span className="text-muted-foreground">Liberados/Expirados</span>
            <span className="font-bold text-neutral-400">{red.releasedCount ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Financial Section (Admin only) */}
      {data.hasFinancialAccess && fin ? (
        <div className="space-y-2.5 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
              Impacto Financeiro Auditado
            </p>
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
              Admin
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2 rounded bg-secondary/30 border border-border/40">
              <span className="text-muted-foreground">Valor Base Bruto</span>
              <p className="font-bold text-foreground mt-0.5">
                {formatCents(fin.grossAppliedBaseAmountCents)}
              </p>
            </div>
            <div className="p-2 rounded bg-secondary/30 border border-border/40">
              <span className="text-muted-foreground">Desconto Concedido</span>
              <p className="font-bold text-primary mt-0.5">
                {formatCents(fin.grossAppliedDiscountCents)}
              </p>
            </div>
            <div className="p-2 rounded bg-secondary/30 border border-border/40">
              <span className="text-muted-foreground">Valor Final Cobrado</span>
              <p className="font-bold text-emerald-400 mt-0.5">
                {formatCents(fin.grossAppliedFinalAmountCents)}
              </p>
            </div>
            <div className="p-2 rounded bg-secondary/30 border border-border/40">
              <span className="text-muted-foreground">Válido Líquido (s/ estorno)</span>
              <p className="font-bold text-emerald-300 mt-0.5">
                {formatCents(fin.nonVoidedNonRefundedFinalAmountCents)}
              </p>
            </div>
          </div>

          {/* Complimentary breakdown if any */}
          {fin.complimentaryApplicationsCount > 0 && (
            <div className="p-2 rounded bg-secondary/15 border border-border/30 text-[11px] flex items-center justify-between">
              <span className="text-muted-foreground">
                Itens com Diária Cortesia (Zero Valor):
              </span>
              <span className="font-medium text-foreground">
                {fin.complimentaryApplicationsCount} aplicações ({formatCents(fin.complimentaryBaseValueCents)} em benefício)
              </span>
            </div>
          )}

          {/* Invoice status breakdown */}
          {fin.invoiceStatusBreakdown && (
            <div className="space-y-1 pt-1">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground">
                Status das Faturas com a Campanha:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[10px]">
                <div className="p-1.5 rounded bg-secondary/20 border border-border/30 flex justify-between">
                  <span className="text-emerald-400">Pagas ({fin.invoiceStatusBreakdown.paid?.lineCount || 0}):</span>
                  <span className="font-semibold">{formatCents(fin.invoiceStatusBreakdown.paid?.finalChargedAmountCents)}</span>
                </div>
                <div className="p-1.5 rounded bg-secondary/20 border border-border/30 flex justify-between">
                  <span className="text-amber-400">Pendentes ({fin.invoiceStatusBreakdown.pending?.lineCount || 0}):</span>
                  <span className="font-semibold">{formatCents(fin.invoiceStatusBreakdown.pending?.finalChargedAmountCents)}</span>
                </div>
                <div className="p-1.5 rounded bg-secondary/20 border border-border/30 flex justify-between">
                  <span className="text-blue-400">Confirmação ({fin.invoiceStatusBreakdown.awaitingConfirmation?.lineCount || 0}):</span>
                  <span className="font-semibold">{formatCents(fin.invoiceStatusBreakdown.awaitingConfirmation?.finalChargedAmountCents)}</span>
                </div>
                <div className="p-1.5 rounded bg-secondary/20 border border-border/30 flex justify-between">
                  <span className="text-rose-400">Vencidas ({fin.invoiceStatusBreakdown.overdue?.lineCount || 0}):</span>
                  <span className="font-semibold">{formatCents(fin.invoiceStatusBreakdown.overdue?.finalChargedAmountCents)}</span>
                </div>
                <div className="p-1.5 rounded bg-secondary/20 border border-border/30 flex justify-between">
                  <span className="text-neutral-400">Canceladas ({fin.invoiceStatusBreakdown.voided?.lineCount || 0}):</span>
                  <span className="font-semibold">{formatCents(fin.invoiceStatusBreakdown.voided?.finalChargedAmountCents)}</span>
                </div>
                <div className="p-1.5 rounded bg-secondary/20 border border-border/30 flex justify-between">
                  <span className="text-purple-400">Reembolsadas ({fin.invoiceStatusBreakdown.refunded?.lineCount || 0}):</span>
                  <span className="font-semibold">{formatCents(fin.invoiceStatusBreakdown.refunded?.finalChargedAmountCents)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : !data.hasFinancialAccess ? (
        <div className="p-2.5 rounded bg-secondary/15 border border-border/30 text-[11px] text-muted-foreground flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>Métricas financeiras restritas ao perfil de administrador da creche.</span>
        </div>
      ) : null}
    </div>
  );
}
