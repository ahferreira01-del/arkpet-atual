import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Users,
  CheckCircle2,
  Clock,
  PauseCircle,
  XCircle,
  DollarSign,
  Calendar,
  Sparkles,
  ShieldAlert,
} from "lucide-react";

interface CampaignOverviewMetricsCardProps {
  crecheId: number;
  isCrecheAdmin: boolean;
}

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "R$ 0,00";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function CampaignOverviewMetricsCard({
  crecheId,
  isCrecheAdmin,
}: CampaignOverviewMetricsCardProps) {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const token = localStorage.getItem("auth_token");

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns-overview-metrics", crecheId, period],
    enabled: !!crecheId,
    queryFn: async () => {
      const res = await fetch(
        `/api/creches/${crecheId}/marketing/metrics/overview?period=${period}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) throw new Error("Erro ao carregar métricas consolidadas.");
      return res.json();
    },
  });

  const fin = data?.financial;
  const cohort = data?.redemptionCohort;
  const apps = data?.applicationsInPeriod;

  return (
    <div className="space-y-3">
      {/* Header with Period Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="font-bold text-sm text-foreground">
            Desempenho Comercial das Campanhas
          </h3>
          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/60">
            Auditado
          </Badge>
        </div>

        {/* Period Selector Toggle */}
        <div className="flex items-center gap-1 bg-secondary/40 p-1 rounded-lg border border-border/40 text-xs">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground ml-1 mr-0.5" />
          {(
            [
              { id: "7d", label: "7 dias" },
              { id: "30d", label: "30 dias" },
              { id: "90d", label: "90 dias" },
              { id: "all", label: "Todo o período" },
            ] as const
          ).map((t) => (
            <Button
              key={t.id}
              variant={period === t.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setPeriod(t.id)}
              className={`h-7 px-2.5 text-[11px] rounded-md transition-all ${
                period === t.id
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Resgates criados no período */}
        <Card className="bg-card/60 border-border/50 shadow-xs">
          <CardContent className="p-3.5 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
                Resgates no Período
              </p>
              <p className="text-xl font-bold text-foreground mt-0.5">
                {isLoading ? "..." : cohort?.totalReservedInPeriod ?? 0}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {cohort?.uniqueTutorsInCohort ?? 0} tutores únicos
              </p>
            </div>
            <Users className="h-7 w-7 text-primary/20" />
          </CardContent>
        </Card>

        {/* Resgates efetivamente aplicados */}
        <Card className="bg-card/60 border-border/50 shadow-xs">
          <CardContent className="p-3.5 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
                Aplicações Efetivas
              </p>
              <p className="text-xl font-bold text-emerald-400 mt-0.5">
                {isLoading ? "..." : apps?.redemptionsFirstAppliedCount ?? 0}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {apps?.uniqueTutorsAppliedCount ?? 0} tutores aplicaram
              </p>
            </div>
            <CheckCircle2 className="h-7 w-7 text-emerald-400/20" />
          </CardContent>
        </Card>

        {/* Desconto concedido (Admin) ou Status Ativo (Staff) */}
        {isCrecheAdmin && data?.hasFinancialAccess ? (
          <Card className="bg-card/60 border-border/50 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
                  Descontos Concedidos
                </p>
                <p className="text-xl font-bold text-primary mt-0.5">
                  {isLoading ? "..." : formatCents(fin?.grossAppliedDiscountCents)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {fin?.monetaryApplicationsCount ?? 0} itens faturados
                </p>
              </div>
              <DollarSign className="h-7 w-7 text-primary/20" />
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-card/60 border-border/50 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
                  Campanhas Ativas
                </p>
                <p className="text-xl font-bold text-emerald-400 mt-0.5">
                  {isLoading ? "..." : data?.campaignsByStatus?.active ?? 0}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  de {data?.campaignsByStatus?.total ?? 0} cadastradas
                </p>
              </div>
              <Sparkles className="h-7 w-7 text-emerald-400/20" />
            </CardContent>
          </Card>
        )}

        {/* Faturamento Válido (Admin) ou Em Andamento (Staff) */}
        {isCrecheAdmin && data?.hasFinancialAccess ? (
          <Card className="bg-card/60 border-border/50 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
                  Cobrado Líquido
                </p>
                <p className="text-xl font-bold text-emerald-400 mt-0.5">
                  {isLoading ? "..." : formatCents(fin?.nonVoidedNonRefundedFinalAmountCents)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Exclui canceladas e estornos
                </p>
              </div>
              <CheckCircle2 className="h-7 w-7 text-emerald-400/20" />
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-card/60 border-border/50 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
                  Agendadas/Pausadas
                </p>
                <p className="text-xl font-bold text-blue-400 mt-0.5">
                  {isLoading
                    ? "..."
                    : (data?.campaignsByStatus?.scheduled ?? 0) +
                      (data?.campaignsByStatus?.paused ?? 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {data?.campaignsByStatus?.scheduled ?? 0} agendadas, {data?.campaignsByStatus?.paused ?? 0} pausadas
                </p>
              </div>
              <Clock className="h-7 w-7 text-blue-400/20" />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Invoice Breakdown Banner for Admin */}
      {isCrecheAdmin && data?.hasFinancialAccess && fin?.invoiceStatusBreakdown && (
        <div className="p-2.5 rounded-lg bg-secondary/25 border border-border/40 text-[11px] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-semibold text-foreground">Faturas no Período:</span>
            <span>
              Pagas: <strong className="text-emerald-400">{formatCents(fin.invoiceStatusBreakdown.paid?.finalChargedAmountCents)}</strong> ({fin.invoiceStatusBreakdown.paid?.lineCount || 0})
            </span>
            <span>•</span>
            <span>
              Pendentes: <strong className="text-amber-400">{formatCents(fin.invoiceStatusBreakdown.pending?.finalChargedAmountCents)}</strong> ({fin.invoiceStatusBreakdown.pending?.lineCount || 0})
            </span>
            <span>•</span>
            <span>
              Confirmação: <strong className="text-blue-400">{formatCents(fin.invoiceStatusBreakdown.awaitingConfirmation?.finalChargedAmountCents)}</strong> ({fin.invoiceStatusBreakdown.awaitingConfirmation?.lineCount || 0})
            </span>
            <span>•</span>
            <span>
              Vencidas: <strong className="text-rose-400">{formatCents(fin.invoiceStatusBreakdown.overdue?.finalChargedAmountCents)}</strong> ({fin.invoiceStatusBreakdown.overdue?.lineCount || 0})
            </span>
          </div>
          {fin.complimentaryApplicationsCount > 0 && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {fin.complimentaryApplicationsCount} diárias cortesia ({formatCents(fin.complimentaryBaseValueCents)})
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
