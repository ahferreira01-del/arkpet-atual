import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UserPlus,
  Sparkles,
  Eye,
  PlusCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Info,
  CheckCircle2,
} from "lucide-react";

export interface OpportunityContextParams {
  opportunityType: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE";
  criteria: Record<string, any>;
  suggestedName: string;
  defaultItemId?: number;
  previewCount: number;
}

interface MarketingOpportunitiesTabProps {
  crecheId: number;
  isCrecheAdmin: boolean;
  eligibleItems: any[];
  onDraftCreated?: () => void;
  onStartCampaignFromOpportunity: (params: OpportunityContextParams) => void;
}

export function MarketingOpportunitiesTab({
  crecheId,
  isCrecheAdmin,
  eligibleItems,
  onDraftCreated,
  onStartCampaignFromOpportunity,
}: MarketingOpportunitiesTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const token = localStorage.getItem("auth_token");

  // Filter states
  const [inactiveDays, setInactiveDays] = useState<number>(60);
  const [newDays, setNewDays] = useState<number>(30);
  const [catalogueItemId, setCatalogueItemId] = useState<number | null>(
    eligibleItems.length > 0 ? eligibleItems[0].id : null
  );

  // Inspection modal state
  const [inspectModal, setInspectModal] = useState<{
    title: string;
    opportunityType: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE";
    days?: number;
    catalogueItemId?: number;
  } | null>(null);
  const [inspectPage, setInspectPage] = useState<number>(1);

  // 1. Inactive Tutors Query
  const { data: inactiveData, isLoading: loadingInactive } = useQuery({
    queryKey: ["crm-inactive", crecheId, inactiveDays],
    enabled: !!crecheId,
    queryFn: async () => {
      const res = await fetch(
        `/api/creches/${crecheId}/marketing/opportunities/inactive?days=${inactiveDays}&page=1&pageSize=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Erro ao carregar tutores inativos.");
      return res.json();
    },
  });

  // 2. New Tutors Query
  const { data: newData, isLoading: loadingNew } = useQuery({
    queryKey: ["crm-new", crecheId, newDays],
    enabled: !!crecheId,
    queryFn: async () => {
      const res = await fetch(
        `/api/creches/${crecheId}/marketing/opportunities/new?days=${newDays}&page=1&pageSize=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Erro ao carregar novos tutores.");
      return res.json();
    },
  });

  // 3. Never Used Service Query
  const activeItemId = catalogueItemId ?? (eligibleItems[0]?.id || null);
  const { data: neverUsedData, isLoading: loadingNeverUsed } = useQuery({
    queryKey: ["crm-never-used", crecheId, activeItemId],
    enabled: !!crecheId && !!activeItemId,
    queryFn: async () => {
      const res = await fetch(
        `/api/creches/${crecheId}/marketing/opportunities/never-used?catalogueItemId=${activeItemId}&page=1&pageSize=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Erro ao carregar oportunidade de serviço.");
      return res.json();
    },
  });

  // 4. Detailed Modal Query
  const { data: inspectData, isLoading: loadingInspect } = useQuery({
    queryKey: [
      "crm-inspect",
      crecheId,
      inspectModal?.opportunityType,
      inspectModal?.days,
      inspectModal?.catalogueItemId,
      inspectPage,
    ],
    enabled: !!crecheId && !!inspectModal,
    queryFn: async () => {
      if (!inspectModal) return null;
      let url = "";
      if (inspectModal.opportunityType === "INACTIVE_TUTORS") {
        url = `/api/creches/${crecheId}/marketing/opportunities/inactive?days=${inspectModal.days || 60}&page=${inspectPage}&pageSize=10`;
      } else if (inspectModal.opportunityType === "NEW_TUTORS") {
        url = `/api/creches/${crecheId}/marketing/opportunities/new?days=${inspectModal.days || 30}&page=${inspectPage}&pageSize=10`;
      } else {
        url = `/api/creches/${crecheId}/marketing/opportunities/never-used?catalogueItemId=${inspectModal.catalogueItemId}&page=${inspectPage}&pageSize=10`;
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao carregar detalhes da oportunidade.");
      }
      return res.json();
    },
  });

  const handleStartCampaign = (
    type: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE",
    daysVal?: number,
    itemIdVal?: number,
    countVal?: number
  ) => {
    let suggestedName = "";
    let criteria: Record<string, any> = {};
    let defaultItemId: number | undefined = undefined;

    if (type === "INACTIVE_TUTORS") {
      suggestedName = `Reativação — Inativos ${daysVal ?? inactiveDays} dias`;
      criteria = { days: daysVal ?? inactiveDays };
    } else if (type === "NEW_TUTORS") {
      suggestedName = `Boas-vindas — Novos Tutores (${daysVal ?? newDays} dias)`;
      criteria = { days: daysVal ?? newDays };
    } else {
      const itemName = eligibleItems.find((i) => i.id === (itemIdVal || activeItemId))?.name || "Serviço";
      suggestedName = `Experimente ${itemName}`;
      defaultItemId = itemIdVal || activeItemId || undefined;
      criteria = { catalogueItemId: defaultItemId };
    }

    setInspectModal(null);
    onStartCampaignFromOpportunity({
      opportunityType: type,
      criteria,
      suggestedName,
      defaultItemId,
      previewCount: countVal ?? 0,
    });
  };

  const selectedItemName = eligibleItems.find((i) => i.id === activeItemId)?.name || "Serviço";

  return (
    <div className="space-y-6">
      <div className="bg-card/40 border border-border/60 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Oportunidades de Marketing (CRM Leve)
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Identifique grupos de tutores com potencial comercial baseando-se no histórico real de
              agendamentos da creche. Nenhum dado financeiro ou preço é alterado sem ação explícita.
            </p>
          </div>
        </div>
      </div>

      {/* Grid of Opportunity Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Inactive Tutors */}
        <Card className="border-border/60 bg-card flex flex-col justify-between shadow-sm hover:border-border transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/60">
                Reativação
              </Badge>
              <select
                value={inactiveDays}
                onChange={(e) => setInactiveDays(Number(e.target.value))}
                className="text-xs bg-secondary border border-border rounded-lg px-2 h-11 sm:h-8 min-h-[44px] sm:min-h-0 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Filtrar dias de inatividade"
              >
                <option value={30}>30+ dias</option>
                <option value={60}>60+ dias</option>
                <option value={90}>90+ dias</option>
              </select>
            </div>
            <CardTitle className="text-lg font-semibold mt-2 flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Tutores Inativos
            </CardTitle>
            <CardDescription className="text-xs">
              Tutores cadastrados sem reservas concluídas nos últimos {inactiveDays} dias.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="bg-secondary/40 rounded-xl p-4 border border-border/40">
              <p className="text-xs text-muted-foreground uppercase font-medium">Público Elegível</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {loadingInactive ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  inactiveData?.count ?? 0
                )}
                <span className="text-xs font-normal text-muted-foreground ml-2">tutores</span>
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:flex-1 text-xs h-11 min-h-[44px] gap-1.5"
                onClick={() => {
                  setInspectPage(1);
                  setInspectModal({
                    title: `Tutores Inativos (${inactiveDays}+ dias)`,
                    opportunityType: "INACTIVE_TUTORS",
                    days: inactiveDays,
                  });
                }}
              >
                <Eye className="h-3.5 w-3.5" />
                Ver tutores
              </Button>
              {isCrecheAdmin && (
                <Button
                  size="sm"
                  className="w-full sm:flex-1 text-xs h-11 min-h-[44px] gap-1.5 font-medium"
                  disabled={(inactiveData?.count ?? 0) === 0}
                  onClick={() => handleStartCampaign("INACTIVE_TUTORS", inactiveDays, undefined, inactiveData?.count ?? 0)}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Criar campanha
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card 2: New Tutors */}
        <Card className="border-border/60 bg-card flex flex-col justify-between shadow-sm hover:border-border transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="text-[11px] font-semibold text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800/60">
                Boas-vindas
              </Badge>
              <select
                value={newDays}
                onChange={(e) => setNewDays(Number(e.target.value))}
                className="text-xs bg-secondary border border-border rounded-lg px-2 h-11 sm:h-8 min-h-[44px] sm:min-h-0 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Filtrar dias de cadastro"
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={15}>Últimos 15 dias</option>
                <option value={30}>Últimos 30 dias</option>
              </select>
            </div>
            <CardTitle className="text-lg font-semibold mt-2 flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              Novos Tutores
            </CardTitle>
            <CardDescription className="text-xs">
              Tutores recém-cadastrados na creche nos últimos {newDays} dias.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="bg-secondary/40 rounded-xl p-4 border border-border/40">
              <p className="text-xs text-muted-foreground uppercase font-medium">Novos Clientes</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {loadingNew ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  newData?.count ?? 0
                )}
                <span className="text-xs font-normal text-muted-foreground ml-2">tutores</span>
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:flex-1 text-xs h-11 min-h-[44px] gap-1.5"
                onClick={() => {
                  setInspectPage(1);
                  setInspectModal({
                    title: `Novos Tutores (Últimos ${newDays} dias)`,
                    opportunityType: "NEW_TUTORS",
                    days: newDays,
                  });
                }}
              >
                <Eye className="h-3.5 w-3.5" />
                Ver tutores
              </Button>
              {isCrecheAdmin && (
                <Button
                  size="sm"
                  className="w-full sm:flex-1 text-xs h-11 min-h-[44px] gap-1.5 font-medium"
                  disabled={(newData?.count ?? 0) === 0}
                  onClick={() => handleStartCampaign("NEW_TUTORS", newDays, undefined, newData?.count ?? 0)}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Criar campanha
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Never Used Service */}
        <Card className="border-border/60 bg-card flex flex-col justify-between shadow-sm hover:border-border transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800/60">
                Cross-Sell
              </Badge>
              <select
                value={activeItemId || ""}
                onChange={(e) => setCatalogueItemId(Number(e.target.value))}
                className="text-xs bg-secondary border border-border rounded-lg px-2 h-11 sm:h-8 min-h-[44px] sm:min-h-0 text-foreground focus:outline-none focus:ring-1 focus:ring-primary max-w-[140px] truncate"
                aria-label="Selecionar serviço do catálogo"
              >
                {eligibleItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <CardTitle className="text-lg font-semibold mt-2 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              Experimentação
            </CardTitle>
            <CardDescription className="text-xs truncate">
              Tutores que nunca usaram "{selectedItemName}".
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="bg-secondary/40 rounded-xl p-4 border border-border/40">
              <p className="text-xs text-muted-foreground uppercase font-medium">Potencial de Adoção</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {loadingNeverUsed ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  neverUsedData?.count ?? 0
                )}
                <span className="text-xs font-normal text-muted-foreground ml-2">tutores</span>
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:flex-1 text-xs h-11 min-h-[44px] gap-1.5"
                disabled={!activeItemId}
                onClick={() => {
                  setInspectPage(1);
                  setInspectModal({
                    title: `Nunca usaram "${selectedItemName}"`,
                    opportunityType: "NEVER_USED_SERVICE",
                    catalogueItemId: activeItemId,
                  });
                }}
              >
                <Eye className="h-3.5 w-3.5" />
                Ver tutores
              </Button>
              {isCrecheAdmin && (
                <Button
                  size="sm"
                  className="w-full sm:flex-1 text-xs h-11 min-h-[44px] gap-1.5 font-medium"
                  disabled={!activeItemId || (neverUsedData?.count ?? 0) === 0}
                  onClick={() => handleStartCampaign("NEVER_USED_SERVICE", undefined, activeItemId, neverUsedData?.count ?? 0)}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Criar campanha
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Inspect Modal */}
      {inspectModal && (
        <Modal
          isOpen={true}
          onClose={() => setInspectModal(null)}
          title={inspectModal.title}
        >
          <div className="space-y-4 mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground bg-secondary/30 p-2.5 rounded-lg border border-border/50">
              <span className="flex items-center gap-1.5">
                <Info className="h-4 w-4 text-primary" />
                Lista explicável e auditável de tutores elegíveis para esta oportunidade.
              </span>
              <span className="font-semibold text-foreground">
                Total: {inspectData?.count ?? 0}
              </span>
            </div>

            {loadingInspect ? (
              <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Carregando tutores...
              </div>
            ) : !inspectData?.items || inspectData.items.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground bg-secondary/20 rounded-xl border border-border">
                Nenhum tutor encontrado com estes critérios.
              </div>
            ) : (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {inspectData.items.map((tutor: any) => (
                  <div
                    key={tutor.tutorId}
                    className="p-3 bg-secondary/30 hover:bg-secondary/50 rounded-xl border border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-foreground text-sm">{tutor.tutorName}</p>
                      <p className="text-muted-foreground">{tutor.email}</p>
                      {Array.isArray(tutor.petNames) && tutor.petNames.length > 0 && (
                        <p className="text-muted-foreground/80 mt-0.5">
                          Pets: {tutor.petNames.join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="sm:text-right">
                      <Badge variant="secondary" className="font-medium bg-secondary text-foreground text-[11px]">
                        {tutor.reason}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination Controls */}
            {inspectData && inspectData.totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={inspectPage <= 1}
                  onClick={() => setInspectPage((p) => Math.max(1, p - 1))}
                  className="h-11 sm:h-9 min-h-[44px] sm:min-h-0 px-3 gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                </Button>
                <span className="text-muted-foreground">
                  Página {inspectPage} de {inspectData.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={inspectPage >= inspectData.totalPages}
                  onClick={() => setInspectPage((p) => Math.min(inspectData.totalPages, p + 1))}
                  className="h-11 sm:h-9 min-h-[44px] sm:min-h-0 px-3 gap-1"
                >
                  Próxima <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div className="pt-4 flex flex-col sm:flex-row justify-end gap-2 border-t border-border">
              <Button
                variant="outline"
                className="h-11 min-h-[44px]"
                onClick={() => setInspectModal(null)}
              >
                Fechar
              </Button>
              {isCrecheAdmin && (inspectData?.count ?? 0) > 0 && (
                <Button
                  className="h-11 min-h-[44px] gap-1.5 font-semibold"
                  onClick={() =>
                    handleStartCampaign(
                      inspectModal.opportunityType,
                      inspectModal.days,
                      inspectModal.catalogueItemId,
                      inspectData.count
                    )
                  }
                >
                  <PlusCircle className="h-4 w-4" />
                  Criar campanha ({inspectData.count} tutores)
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
