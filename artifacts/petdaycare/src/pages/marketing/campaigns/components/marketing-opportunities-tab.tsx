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

interface MarketingOpportunitiesTabProps {
  crecheId: number;
  isCrecheAdmin: boolean;
  eligibleItems: any[];
  onDraftCreated: () => void;
}

export function MarketingOpportunitiesTab({
  crecheId,
  isCrecheAdmin,
  eligibleItems,
  onDraftCreated,
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

  // Mutation: Create Draft from Opportunity
  const createDraftMutation = useMutation({
    mutationFn: async (payload: {
      opportunityType: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE";
      days?: number;
      catalogueItemId?: number;
    }) => {
      const res = await fetch(
        `/api/creches/${crecheId}/marketing/opportunities/create-draft`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-idempotency-key": `crm-draft-${payload.opportunityType}-${Date.now()}`,
          },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao criar rascunho de campanha.");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Rascunho de Campanha Criado!",
        description: `Campanha "${data.campaign.name}" criada com público selecionado (${data.campaign.audienceType}). Configure descontos e publique quando desejar.`,
      });
      qc.invalidateQueries({ queryKey: ["creche-campaigns", crecheId] });
      setInspectModal(null);
      onDraftCreated();
    },
    onError: (err: any) => {
      toast({
        title: "Não foi possível criar a campanha",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateDraft = (
    type: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE",
    daysVal?: number,
    itemIdVal?: number
  ) => {
    createDraftMutation.mutate({
      opportunityType: type,
      days: daysVal,
      catalogueItemId: itemIdVal,
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
              <Badge variant="outline" className="text-[11px] font-medium text-amber-500 bg-amber-500/10 border-amber-500/20">
                Reativação
              </Badge>
              <select
                value={inactiveDays}
                onChange={(e) => setInactiveDays(Number(e.target.value))}
                className="text-xs bg-secondary border border-border rounded-lg px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Filtrar dias de inatividade"
              >
                <option value={30}>30+ dias</option>
                <option value={60}>60+ dias</option>
                <option value={90}>90+ dias</option>
              </select>
            </div>
            <CardTitle className="text-lg font-semibold mt-2 flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-400" />
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
                className="w-full sm:flex-1 text-xs h-10 gap-1.5"
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
                  className="w-full sm:flex-1 text-xs h-10 gap-1.5 font-medium"
                  disabled={createDraftMutation.isPending || (inactiveData?.count ?? 0) === 0}
                  onClick={() => handleCreateDraft("INACTIVE_TUTORS", inactiveDays)}
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
              <Badge variant="outline" className="text-[11px] font-medium text-blue-500 bg-blue-500/10 border-blue-500/20">
                Boas-vindas
              </Badge>
              <select
                value={newDays}
                onChange={(e) => setNewDays(Number(e.target.value))}
                className="text-xs bg-secondary border border-border rounded-lg px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Filtrar dias de cadastro"
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={15}>Últimos 15 dias</option>
                <option value={30}>Últimos 30 dias</option>
              </select>
            </div>
            <CardTitle className="text-lg font-semibold mt-2 flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-400" />
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
                className="w-full sm:flex-1 text-xs h-10 gap-1.5"
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
                  className="w-full sm:flex-1 text-xs h-10 gap-1.5 font-medium"
                  disabled={createDraftMutation.isPending || (newData?.count ?? 0) === 0}
                  onClick={() => handleCreateDraft("NEW_TUTORS", newDays)}
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
              <Badge variant="outline" className="text-[11px] font-medium text-emerald-500 bg-emerald-500/10 border-emerald-500/20">
                Cross-Sell
              </Badge>
              <select
                value={activeItemId || ""}
                onChange={(e) => setCatalogueItemId(Number(e.target.value))}
                className="text-xs bg-secondary border border-border rounded-lg px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary max-w-[140px] truncate"
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
              <Sparkles className="h-5 w-5 text-emerald-400" />
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
                className="w-full sm:flex-1 text-xs h-10 gap-1.5"
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
                  className="w-full sm:flex-1 text-xs h-10 gap-1.5 font-medium"
                  disabled={createDraftMutation.isPending || !activeItemId || (neverUsedData?.count ?? 0) === 0}
                  onClick={() => handleCreateDraft("NEVER_USED_SERVICE", undefined, activeItemId)}
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
                  className="h-8 gap-1"
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
                  className="h-8 gap-1"
                >
                  Próxima <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div className="pt-4 flex flex-col sm:flex-row justify-end gap-2 border-t border-border">
              <Button
                variant="outline"
                className="h-11"
                onClick={() => setInspectModal(null)}
              >
                Fechar
              </Button>
              {isCrecheAdmin && (inspectData?.count ?? 0) > 0 && (
                <Button
                  className="h-11 gap-1.5 font-semibold"
                  disabled={createDraftMutation.isPending}
                  onClick={() =>
                    handleCreateDraft(
                      inspectModal.opportunityType,
                      inspectModal.days,
                      inspectModal.catalogueItemId
                    )
                  }
                >
                  {createDraftMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlusCircle className="h-4 w-4" />
                  )}
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
