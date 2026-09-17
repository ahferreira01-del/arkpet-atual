import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Users,
  CheckCircle2,
  DollarSign,
  Calendar,
  AlertCircle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CrmOriginCampaignsSectionProps {
  crecheId: number;
  onViewCampaign?: (campaignId: number) => void;
}

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "R$ 0,00";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function getOppTypeLabel(type: string): { label: string; variant: "default" | "secondary" | "outline" } {
  switch (type) {
    case "INACTIVE_TUTORS":
      return { label: "Tutores Inativos", variant: "secondary" };
    case "NEW_TUTORS":
      return { label: "Novos Tutores", variant: "default" };
    case "NEVER_USED_SERVICE":
      return { label: "Nunca Usou Serviço", variant: "outline" };
    default:
      return { label: "Oportunidade CRM", variant: "secondary" };
  }
}

export function CrmOriginCampaignsSection({
  crecheId,
  onViewCampaign,
}: CrmOriginCampaignsSectionProps) {
  const token = localStorage.getItem("auth_token");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["crm-origin-campaigns", crecheId],
    enabled: !!crecheId,
    queryFn: async () => {
      const res = await fetch(`/api/creches/${crecheId}/marketing/metrics/crm`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao carregar campanhas de oportunidades.");
      }
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-xs text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Carregando histórico de conversão das oportunidades...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{(error as any)?.message || "Erro ao carregar dados de CRM."}</span>
      </div>
    );
  }

  const campaigns = data?.campaigns || [];
  const byType = data?.byOpportunityType || {
    inactiveTutorsCount: 0,
    newTutorsCount: 0,
    neverUsedServiceCount: 0,
  };

  if (campaigns.length === 0) {
    return null; // Don't clutter if no opportunity campaigns have been created yet
  }

  return (
    <div className="space-y-4 pt-6 border-t border-border/40">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-sm text-foreground flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            Campanhas Geradas a Partir do CRM ({data?.totalCampaignsCreatedFromOpportunity || 0})
          </h3>
          <p className="text-xs text-muted-foreground">
            Acompanhe o retorno e os resgates de campanhas originadas em oportunidades.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Badge variant="secondary" className="text-[10px]">
            Inativos: {byType.inactiveTutorsCount}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            Novos: {byType.newTutorsCount}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            Nunca usou: {byType.neverUsedServiceCount}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {campaigns.map((c: any) => {
          const badgeInfo = getOppTypeLabel(c.opportunityType);
          return (
            <Card
              key={c.campaignId}
              className="bg-card/60 border-border/50 hover:border-border transition-all shadow-xs"
            >
              <CardContent className="p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-xs text-foreground line-clamp-1">
                      {c.campaignName}
                    </h4>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Criada em {format(new Date(c.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                  </div>
                  <Badge variant={badgeInfo.variant} className="text-[10px] shrink-0">
                    {badgeInfo.label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] p-2 rounded-lg bg-secondary/30 border border-border/30">
                  <div>
                    <span className="text-muted-foreground">Público Alvo:</span>
                    <p className="font-semibold text-foreground">
                      {c.crmAudienceAtCreation ?? c.currentSelectedAudienceSize} tutores
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Adesão:</span>
                    <p className="font-semibold text-emerald-400">
                      {c.uniqueTutorsApplied} aplicaram
                    </p>
                  </div>
                </div>

                {c.hasFinancialAccess && c.finalChargedAmountCents != null && (
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/30">
                    <span className="text-muted-foreground">Cobrado / Desconto:</span>
                    <span className="font-semibold text-foreground">
                      {formatCents(c.finalChargedAmountCents)}{" "}
                      <span className="text-primary text-[10px]">
                        (-{formatCents(c.discountGrantedCents)})
                      </span>
                    </span>
                  </div>
                )}

                {onViewCampaign && (
                  <button
                    onClick={() => onViewCampaign(c.campaignId)}
                    className="w-full text-center text-[11px] text-primary hover:underline font-medium pt-1 flex items-center justify-center gap-1"
                  >
                    Ver detalhes da campanha
                    <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
