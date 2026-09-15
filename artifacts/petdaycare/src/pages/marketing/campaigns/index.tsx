import React, { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { PageHeader } from "@/components/layout/page-header";
import {
  Tag,
  Plus,
  Search,
  Calendar,
  Users,
  CheckCircle2,
  Clock,
  PauseCircle,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Eye,
  Play,
  RotateCcw,
  Percent,
  DollarSign,
  Info,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ─── API Hooks ────────────────────────────────────────────────────────────────

function useCampaigns(crecheId: number | null, statusFilter?: string, search?: string) {
  const token = localStorage.getItem("auth_token");
  return useQuery<{ campaigns: any[]; kpis: any }>({
    queryKey: ["creche-campaigns", crecheId, statusFilter, search],
    enabled: !!crecheId,
    queryFn: async () => {
      if (!crecheId) return { campaigns: [], kpis: { total: 0, active: 0, scheduled: 0, paused: 0, ended: 0, revoked: 0 } };
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "ALL") params.append("status", statusFilter);
      if (search) params.append("search", search);
      const res = await fetch(`/api/creches/${crecheId}/campaigns?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao carregar campanhas promocionais.");
      return res.json();
    },
  });
}

function useCatalogueItems(crecheId: number | null) {
  const token = localStorage.getItem("auth_token");
  return useQuery<any[]>({
    queryKey: ["catalogue-items-for-campaigns", crecheId],
    enabled: !!crecheId,
    queryFn: async () => {
      if (!crecheId) return [];
      const res = await fetch(`/api/creches/${crecheId}/financial/items`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      // Only services and day_use items are eligible in R37.C1
      return data.filter((item: any) => item.type === "service" || item.type === "day_use");
    },
  });
}

function useTutorsList(crecheId: number | null) {
  const token = localStorage.getItem("auth_token");
  return useQuery<any[]>({
    queryKey: ["tutors-for-campaigns", crecheId],
    enabled: !!crecheId,
    queryFn: async () => {
      if (!crecheId) return [];
      const res = await fetch(`/api/creches/${crecheId}/tutors/manage`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });
}

export default function CrecheCampaignsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const crecheId = user?.crecheId || 0;
  const isCrecheAdmin = user?.role === "creche_admin";

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Modals state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailCampaignId, setDetailCampaignId] = useState<number | null>(null);
  const [publishModal, setPublishModal] = useState<{ id: number; name: string } | null>(null);
  const [pauseModal, setPauseModal] = useState<{ id: number; name: string } | null>(null);
  const [resumeModal, setResumeModal] = useState<{ id: number; name: string } | null>(null);
  const [revokeModal, setRevokeModal] = useState<{ id: number; name: string } | null>(null);
  const [actionReason, setActionReason] = useState<string>("");
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Wizard state
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formBenefitType, setFormBenefitType] = useState<"PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT" | "FIXED_PROMOTIONAL_PRICE">("PERCENTAGE_DISCOUNT");
  const [formPercentage, setFormPercentage] = useState("10"); // in %
  const [formFixedDiscount, setFormFixedDiscount] = useState("15.00"); // in R$
  const [formFixedPrice, setFormFixedPrice] = useState("50.00"); // in R$
  const [formItemIds, setFormItemIds] = useState<number[]>([]);
  const [formAudienceType, setFormAudienceType] = useState<"ALL_ACTIVE_TUTORS" | "SELECTED_TUTORS">("ALL_ACTIVE_TUTORS");
  const [formSelectedTutorIds, setFormSelectedTutorIds] = useState<number[]>([]);
  const [formValidFrom, setFormValidFrom] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 16);
  });
  const [formValidUntil, setFormValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 16);
  });
  const [formInteractionPolicy, setFormInteractionPolicy] = useState<"EXCLUDE_IF_TUTOR_CONDITION" | "ALLOW_IF_BETTER">("EXCLUDE_IF_TUTOR_CONDITION");
  const [formUsageLimitType, setFormUsageLimitType] = useState<"UNLIMITED" | "ONCE_PER_TUTOR" | "N_PER_TUTOR">("UNLIMITED");
  const [formUsageLimitPerTutor, setFormUsageLimitPerTutor] = useState("1");
  const [formPriority, setFormPriority] = useState("100");
  const [formReason, setFormReason] = useState("");
  const [previewData, setPreviewData] = useState<any>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const { data, isLoading } = useCampaigns(crecheId, statusFilter, searchTerm);
  const { data: eligibleItems = [] } = useCatalogueItems(crecheId);
  const { data: tutors = [] } = useTutorsList(crecheId);

  const campaigns = data?.campaigns || [];
  const kpis = data?.kpis || { total: 0, active: 0, scheduled: 0, paused: 0, ended: 0, revoked: 0 };

  const resetWizard = () => {
    setWizardStep(1);
    setFormName("");
    setFormDesc("");
    setFormBenefitType("PERCENTAGE_DISCOUNT");
    setFormPercentage("10");
    setFormFixedDiscount("15.00");
    setFormFixedPrice("50.00");
    setFormItemIds([]);
    setFormAudienceType("ALL_ACTIVE_TUTORS");
    setFormSelectedTutorIds([]);
    const d = new Date();
    setFormValidFrom(d.toISOString().slice(0, 16));
    const d2 = new Date();
    d2.setDate(d2.getDate() + 30);
    setFormValidUntil(d2.toISOString().slice(0, 16));
    setFormInteractionPolicy("EXCLUDE_IF_TUTOR_CONDITION");
    setFormUsageLimitType("UNLIMITED");
    setFormUsageLimitPerTutor("1");
    setFormPriority("100");
    setFormReason("");
    setPreviewData(null);
  };

  const openNewWizard = () => {
    resetWizard();
    setWizardOpen(true);
  };

  // Run preview calculation
  const fetchPreview = async () => {
    setIsLoadingPreview(true);
    try {
      const token = localStorage.getItem("auth_token");
      const bps = formBenefitType === "PERCENTAGE_DISCOUNT" ? Math.round(parseFloat(formPercentage || "0") * 100) : null;
      const fixedCents = formBenefitType === "FIXED_DISCOUNT" ? Math.round(parseFloat(formFixedDiscount || "0") * 100) : null;
      const promoPriceCents = formBenefitType === "FIXED_PROMOTIONAL_PRICE" ? Math.round(parseFloat(formFixedPrice || "0") * 100) : null;

      const res = await fetch(`/api/creches/${crecheId}/campaigns/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: formName,
          benefitType: formBenefitType,
          percentageBps: bps,
          fixedDiscountCents: fixedCents,
          fixedPromotionalPriceCents: promoPriceCents,
          audienceType: formAudienceType,
          selectedTutorIds: formSelectedTutorIds,
          itemIds: formItemIds,
          conditionInteractionPolicy: formInteractionPolicy,
          validFrom: new Date(formValidFrom).toISOString(),
          validUntil: new Date(formValidUntil).toISOString(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao calcular preview");
      }

      const p = await res.json();
      setPreviewData(p);
    } catch (err: any) {
      toast({ title: "Erro no Preview", description: err.message, variant: "destructive" });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Submit Wizard: Draft or Publish
  const handleSaveCampaign = async (shouldPublish: boolean) => {
    if (shouldPublish && !formReason.trim()) {
      toast({ title: "Campo Obrigatório", description: "Informe o motivo administrativo para publicação.", variant: "destructive" });
      return;
    }

    setIsSubmittingAction(true);
    try {
      const token = localStorage.getItem("auth_token");
      const bps = formBenefitType === "PERCENTAGE_DISCOUNT" ? Math.round(parseFloat(formPercentage || "0") * 100) : null;
      const fixedCents = formBenefitType === "FIXED_DISCOUNT" ? Math.round(parseFloat(formFixedDiscount || "0") * 100) : null;
      const promoPriceCents = formBenefitType === "FIXED_PROMOTIONAL_PRICE" ? Math.round(parseFloat(formFixedPrice || "0") * 100) : null;

      // 1. Create Draft
      const res = await fetch(`/api/creches/${crecheId}/campaigns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-idempotency-key": `camp-create-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDesc.trim() || null,
          benefitType: formBenefitType,
          percentageBps: bps,
          fixedDiscountCents: fixedCents,
          fixedPromotionalPriceCents: promoPriceCents,
          audienceType: formAudienceType,
          selectedTutorIds: formSelectedTutorIds,
          itemIds: formItemIds,
          conditionInteractionPolicy: formInteractionPolicy,
          usageLimitType: formUsageLimitType,
          usageLimitPerTutor: formUsageLimitType === "N_PER_TUTOR" ? parseInt(formUsageLimitPerTutor, 10) : null,
          priority: parseInt(formPriority, 10) || 100,
          validFrom: new Date(formValidFrom).toISOString(),
          validUntil: new Date(formValidUntil).toISOString(),
          reason: formReason.trim() || "Criação de campanha",
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao salvar campanha");
      }

      const created = await res.json();

      // 2. If immediate publish requested
      if (shouldPublish) {
        const pubRes = await fetch(`/api/creches/${crecheId}/campaigns/${created.id}/publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-idempotency-key": `camp-pub-${created.id}-${Date.now()}`,
          },
          body: JSON.stringify({ reason: formReason.trim() }),
        });

        if (!pubRes.ok) {
          const err = await pubRes.json();
          throw new Error(err.error || "Campanha criada como rascunho, mas houve erro ao publicar.");
        }
      }

      toast({
        title: shouldPublish ? "Campanha Publicada!" : "Rascunho Salvo!",
        description: `A campanha "${formName}" foi salva com sucesso.`,
      });

      qc.invalidateQueries({ queryKey: ["creche-campaigns", crecheId] });
      setWizardOpen(false);
      resetWizard();
    } catch (err: any) {
      toast({ title: "Erro na Operação", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Generic lifecycle actions
  const executeCampaignAction = async (
    campaignId: number,
    action: "publish" | "pause" | "resume" | "revoke",
    reason: string
  ) => {
    if (!reason.trim()) {
      toast({ title: "Motivo Obrigatório", description: "Informe o motivo administrativo para esta ação.", variant: "destructive" });
      return;
    }

    setIsSubmittingAction(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/campaigns/${campaignId}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-idempotency-key": `camp-${action}-${campaignId}-${Date.now()}`,
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Erro ao executar ação ${action}.`);
      }

      toast({
        title: "Sucesso!",
        description: `Ação ${action.toUpperCase()} executada com sucesso na campanha.`,
      });

      qc.invalidateQueries({ queryKey: ["creche-campaigns", crecheId] });
      setPublishModal(null);
      setPauseModal(null);
      setResumeModal(null);
      setRevokeModal(null);
      setActionReason("");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Detail Modal query
  const { data: detailCampaign } = useQuery({
    queryKey: ["campaign-detail", crecheId, detailCampaignId],
    enabled: !!crecheId && !!detailCampaignId,
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/campaigns/${detailCampaignId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao carregar detalhes.");
      return res.json();
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Ativa</Badge>;
      case "SCHEDULED":
        return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">Agendada</Badge>;
      case "DRAFT":
        return <Badge className="bg-neutral-500/10 text-neutral-300 border-neutral-500/20">Rascunho</Badge>;
      case "PAUSED":
        return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20">Pausada</Badge>;
      case "ENDED":
        return <Badge className="bg-neutral-500/10 text-neutral-400 border-neutral-500/20">Encerrada</Badge>;
      case "REVOKED":
        return <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20">Revogada</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatBenefitText = (c: any) => {
    if (c.benefitType === "PERCENTAGE_DISCOUNT") {
      return `${(c.percentageBps / 100).toFixed(0)}% OFF`;
    }
    if (c.benefitType === "FIXED_DISCOUNT") {
      return `R$ ${(c.fixedDiscountCents / 100).toFixed(2)} OFF`;
    }
    if (c.benefitType === "FIXED_PROMOTIONAL_PRICE") {
      return `Por R$ ${(c.fixedPromotionalPriceCents / 100).toFixed(2)}`;
    }
    return "Benefício Promocional";
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Campanhas Promocionais"
        description="Gerencie ofertas e benefícios operacionais gratuitos para tutores da sua creche."
        showBack={false}
        action={
          isCrecheAdmin ? (
            <Button onClick={openNewWizard} className="gap-2 shadow-sm font-semibold">
              <Plus className="h-4 w-4" />
              Nova Campanha
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Ativas</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{kpis.active}</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-emerald-400/20" />
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Agendadas</p>
              <p className="text-2xl font-bold text-blue-400 mt-1">{kpis.scheduled}</p>
            </div>
            <Clock className="h-8 w-8 text-blue-400/20" />
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Pausadas</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{kpis.paused}</p>
            </div>
            <PauseCircle className="h-8 w-8 text-amber-400/20" />
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Encerradas</p>
              <p className="text-2xl font-bold text-neutral-400 mt-1">{kpis.ended + kpis.revoked}</p>
            </div>
            <XCircle className="h-8 w-8 text-neutral-400/20" />
          </CardContent>
        </Card>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "ALL", label: "Todas" },
            { id: "ACTIVE", label: "Ativas" },
            { id: "SCHEDULED", label: "Agendadas" },
            { id: "DRAFT", label: "Rascunhos" },
            { id: "PAUSED", label: "Pausadas" },
            { id: "ENDED", label: "Encerradas" },
            { id: "REVOKED", label: "Revogadas" },
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={statusFilter === tab.id ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(tab.id)}
              className="text-xs font-medium"
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <SearchInput
            placeholder="Buscar por nome..."
            value={searchTerm}
            onChange={(val: string) => setSearchTerm(val)}
          />
        </div>
      </div>

      {/* Campaign Cards List */}
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground text-sm">Carregando campanhas...</div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="Nenhuma campanha encontrada"
          description={
            statusFilter !== "ALL" || searchTerm
              ? "Nenhuma campanha corresponde aos filtros selecionados."
              : "Crie campanhas promocionais para oferecer descontos transparentes em serviços e diárias aos tutores."
          }
          action={
            isCrecheAdmin
              ? {
                  label: "Criar Primeira Campanha",
                  onClick: openNewWizard,
                }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((camp: any) => (
            <Card key={camp.id} className="border border-border/60 shadow-sm hover:border-primary/40 transition-colors flex flex-col justify-between">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-base text-foreground line-clamp-1">{camp.name}</h3>
                    {camp.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{camp.description}</p>
                    )}
                  </div>
                  {getStatusBadge(camp.status)}
                </div>

                <div className="p-3 bg-primary/5 rounded-lg border border-primary/10 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Benefício</span>
                  <span className="font-bold text-primary text-base">{formatBenefitText(camp)}</span>
                </div>

                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                    <span>
                      {format(new Date(camp.validFrom), "dd/MM/yyyy HH:mm", { locale: ptBR })} até{" "}
                      {format(new Date(camp.validUntil), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                    <span>
                      {camp.audienceType === "ALL_ACTIVE_TUTORS"
                        ? `Todos os tutores ativos (${camp.eligibleTutorsCount} tutores)`
                        : `Tutores selecionados (${camp.eligibleTutorsCount} tutores)`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                    <span>{camp.itemCount} {camp.itemCount === 1 ? "item participante" : "itens participantes"}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/40 flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    onClick={() => setDetailCampaignId(camp.id)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Detalhes
                  </Button>

                  {isCrecheAdmin && (
                    <>
                      {camp.status === "DRAFT" && (
                        <Button
                          variant="default"
                          size="sm"
                          className="h-8 text-xs gap-1"
                          onClick={() => {
                            setActionReason("");
                            setPublishModal({ id: camp.id, name: camp.name });
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                          Publicar
                        </Button>
                      )}

                      {(camp.status === "ACTIVE" || camp.status === "SCHEDULED") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1 text-amber-400 border-amber-500/20 hover:bg-amber-500/10"
                          onClick={() => {
                            setActionReason("");
                            setPauseModal({ id: camp.id, name: camp.name });
                          }}
                        >
                          <PauseCircle className="h-3.5 w-3.5" />
                          Pausar
                        </Button>
                      )}

                      {camp.status === "PAUSED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10"
                          onClick={() => {
                            setActionReason("");
                            setResumeModal({ id: camp.id, name: camp.name });
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                          Retomar
                        </Button>
                      )}

                      {camp.status !== "REVOKED" && camp.status !== "ENDED" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs gap-1 text-rose-400 hover:bg-rose-500/10"
                          onClick={() => {
                            setActionReason("");
                            setRevokeModal({ id: camp.id, name: camp.name });
                          }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Revogar
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ─── 7-Step "Nova Campanha" Wizard Modal ─────────────────────────────── */}
      <Modal
        isOpen={wizardOpen}
        onClose={() => {
          if (!isSubmittingAction) setWizardOpen(false);
        }}
        title={`Nova Campanha Promocional — Passo ${wizardStep} de 7`}
        className="max-w-2xl"
      >
        <div className="space-y-6 pt-2">
          {/* Step Progress Bar */}
          <div className="flex items-center gap-1 w-full bg-secondary/50 p-1 rounded-full">
            {[1, 2, 3, 4, 5, 6, 7].map((s) => (
              <div
                key={s}
                className={`flex-1 h-2 rounded-full transition-all duration-300 ${
                  s <= wizardStep ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* STEP 1: Informações Básicas */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-foreground">Passo 1: Identificação da Campanha</h4>
                <p className="text-xs text-muted-foreground">Defina o nome comercial visível aos tutores e colaboradores.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">Nome da Campanha *</label>
                <Input
                  placeholder="Ex: Semana da Estética Canina, Férias de Julho..."
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">Descrição (opcional)</label>
                <Input
                  placeholder="Ex: 20% de desconto em banhos e hidratações para todos os tutores ativos."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* STEP 2: Benefício */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-foreground">Passo 2: Benefício Promocional</h4>
                <p className="text-xs text-muted-foreground">Escolha o formato do desconto aplicável aos itens da campanha.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div
                  onClick={() => setFormBenefitType("PERCENTAGE_DISCOUNT")}
                  className={`p-3.5 rounded-xl border cursor-pointer text-center space-y-2 transition-all ${
                    formBenefitType === "PERCENTAGE_DISCOUNT"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-secondary/40"
                  }`}
                >
                  <Percent className="h-5 w-5 mx-auto" />
                  <p className="text-xs font-bold">Percentual (%)</p>
                </div>

                <div
                  onClick={() => setFormBenefitType("FIXED_DISCOUNT")}
                  className={`p-3.5 rounded-xl border cursor-pointer text-center space-y-2 transition-all ${
                    formBenefitType === "FIXED_DISCOUNT"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-secondary/40"
                  }`}
                >
                  <DollarSign className="h-5 w-5 mx-auto" />
                  <p className="text-xs font-bold">Desconto R$</p>
                </div>

                <div
                  onClick={() => setFormBenefitType("FIXED_PROMOTIONAL_PRICE")}
                  className={`p-3.5 rounded-xl border cursor-pointer text-center space-y-2 transition-all ${
                    formBenefitType === "FIXED_PROMOTIONAL_PRICE"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-secondary/40"
                  }`}
                >
                  <Sparkles className="h-5 w-5 mx-auto" />
                  <p className="text-xs font-bold">Preço Fixo (Por R$)</p>
                </div>
              </div>

              {formBenefitType === "PERCENTAGE_DISCOUNT" && (
                <div className="space-y-2 p-4 bg-secondary/30 rounded-xl border border-border/50">
                  <label className="text-xs font-semibold text-foreground">Percentual de Desconto (%)</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="100"
                      value={formPercentage}
                      onChange={(e) => setFormPercentage(e.target.value)}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">% de desconto</span>
                  </div>
                </div>
              )}

              {formBenefitType === "FIXED_DISCOUNT" && (
                <div className="space-y-2 p-4 bg-secondary/30 rounded-xl border border-border/50">
                  <label className="text-xs font-semibold text-foreground">Valor do Desconto por Unidade (R$)</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">R$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={formFixedDiscount}
                      onChange={(e) => setFormFixedDiscount(e.target.value)}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">OFF</span>
                  </div>
                </div>
              )}

              {formBenefitType === "FIXED_PROMOTIONAL_PRICE" && (
                <div className="space-y-2 p-4 bg-secondary/30 rounded-xl border border-border/50">
                  <label className="text-xs font-semibold text-foreground">Preço Promocional Final (R$)</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">R$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.00"
                      value={formFixedPrice}
                      onChange={(e) => setFormFixedPrice(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Aviso: O preço promocional fixo nunca poderá ser maior que qualquer preço de venda (inclusive portes pequenos) dos itens selecionados.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Itens Elegíveis */}
          {wizardStep === 3 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-foreground">Passo 3: Itens Participantes</h4>
                <p className="text-xs text-muted-foreground">Selecione um ou mais serviços ou diárias do catálogo participantes.</p>
              </div>

              {eligibleItems.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  Nenhum serviço ou diária cadastrado no catálogo desta creche.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {eligibleItems.map((item: any) => {
                    const isSelected = formItemIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (isSelected) {
                            setFormItemIds(formItemIds.filter((id) => id !== item.id));
                          } else {
                            setFormItemIds([...formItemIds, item.id]);
                          }
                        }}
                        className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border/60 hover:bg-secondary/40"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="rounded border-border"
                          />
                          <div>
                            <p className="text-xs font-bold text-foreground">{item.name}</p>
                            <p className="text-[10px] text-muted-foreground uppercase">{item.type === "day_use" ? "Day Use / Diária" : "Serviço"}</p>
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-primary">R$ {parseFloat(item.basePrice).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Itens selecionados: {formItemIds.length}</p>
            </div>
          )}

          {/* STEP 4: Público-Alvo */}
          {wizardStep === 4 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-foreground">Passo 4: Público-Alvo</h4>
                <p className="text-xs text-muted-foreground">Defina quem terá elegibilidade automática para usufruir da campanha.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() => setFormAudienceType("ALL_ACTIVE_TUTORS")}
                  className={`p-3.5 rounded-xl border cursor-pointer space-y-1 transition-all ${
                    formAudienceType === "ALL_ACTIVE_TUTORS"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-secondary/40"
                  }`}
                >
                  <p className="text-xs font-bold">Todos os Tutores Ativos</p>
                  <p className="text-[11px] text-muted-foreground">Aplica-se dinamicamente a todos os clientes ativos da creche.</p>
                </div>

                <div
                  onClick={() => setFormAudienceType("SELECTED_TUTORS")}
                  className={`p-3.5 rounded-xl border cursor-pointer space-y-1 transition-all ${
                    formAudienceType === "SELECTED_TUTORS"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-secondary/40"
                  }`}
                >
                  <p className="text-xs font-bold">Tutores Selecionados</p>
                  <p className="text-[11px] text-muted-foreground">Apenas para os tutores escolhidos manualmente nesta lista.</p>
                </div>
              </div>

              {formAudienceType === "SELECTED_TUTORS" && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-foreground">Selecione os tutores participantes:</p>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {tutors.map((t: any) => {
                      const isSelected = formSelectedTutorIds.includes(t.id);
                      return (
                        <div
                          key={t.id}
                          onClick={() => {
                            if (isSelected) {
                              setFormSelectedTutorIds(formSelectedTutorIds.filter((id) => id !== t.id));
                            } else {
                              setFormSelectedTutorIds([...formSelectedTutorIds, t.id]);
                            }
                          }}
                          className={`p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                            isSelected ? "border-primary bg-primary/10" : "border-border/60 hover:bg-secondary/40"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="rounded border-border"
                            />
                            <div>
                              <p className="text-xs font-bold text-foreground">{t.name}</p>
                              <p className="text-[10px] text-muted-foreground">{t.email}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Tutores selecionados: {formSelectedTutorIds.length}</p>
                </div>
              )}
            </div>
          )}

          {/* STEP 5: Período */}
          {wizardStep === 5 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-foreground">Passo 5: Janela Temporal</h4>
                <p className="text-xs text-muted-foreground">Defina as datas e horários de início e término no fuso oficial (America/Sao_Paulo).</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground">Data/Hora de Início *</label>
                  <Input
                    type="datetime-local"
                    value={formValidFrom}
                    onChange={(e) => setFormValidFrom(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground">Data/Hora de Término *</label>
                  <Input
                    type="datetime-local"
                    value={formValidUntil}
                    onChange={(e) => setFormValidUntil(e.target.value)}
                  />
                </div>
              </div>

              <div className="p-3 bg-secondary/30 rounded-xl border border-border/50 flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                <span>
                  O início é inclusivo e o término é exclusivo ([início, término)). Ao atingir a data de término, a campanha encerra sua elegibilidade automaticamente.
                </span>
              </div>
            </div>
          )}

          {/* STEP 6: Regras & Limites */}
          {wizardStep === 6 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-foreground">Passo 6: Regras de Interação e Precedência</h4>
                <p className="text-xs text-muted-foreground">Defina o comportamento contratual caso o tutor já possua condição individual negociada.</p>
              </div>

              <div className="space-y-3">
                <div
                  onClick={() => setFormInteractionPolicy("EXCLUDE_IF_TUTOR_CONDITION")}
                  className={`p-3.5 rounded-xl border cursor-pointer space-y-1 transition-all ${
                    formInteractionPolicy === "EXCLUDE_IF_TUTOR_CONDITION"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-secondary/40"
                  }`}
                >
                  <p className="text-xs font-bold">Padrão: Excluir tutor que já possui condição comercial</p>
                  <p className="text-[11px] text-muted-foreground">
                    Tutores que já possuem condição comercial individual para este item continuarão utilizando sua condição individual.
                  </p>
                </div>

                <div
                  onClick={() => setFormInteractionPolicy("ALLOW_IF_BETTER")}
                  className={`p-3.5 rounded-xl border cursor-pointer space-y-1 transition-all ${
                    formInteractionPolicy === "ALLOW_IF_BETTER"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-secondary/40"
                  }`}
                >
                  <p className="text-xs font-bold">Aplicar apenas se a campanha oferecer preço melhor</p>
                  <p className="text-[11px] text-muted-foreground">
                    O ArkPet comparará a condição individual com a campanha e aplicará somente o menor preço. Em caso de empate, a condição individual prevalece.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-400 font-medium">
                Regra de Ouro: Os descontos nunca são somados ou empilhados.
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground">Limite de Uso por Tutor</label>
                  <select
                    value={formUsageLimitType}
                    onChange={(e: any) => setFormUsageLimitType(e.target.value)}
                    className="w-full h-10 px-3 py-2 rounded-md border border-input bg-background text-xs"
                  >
                    <option value="UNLIMITED">Ilimitado</option>
                    <option value="ONCE_PER_TUTOR">1 vez por tutor</option>
                    <option value="N_PER_TUTOR">N vezes por tutor</option>
                  </select>
                </div>

                {formUsageLimitType === "N_PER_TUTOR" && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-foreground">Quantidade Máxima (N)</label>
                    <Input
                      type="number"
                      min="1"
                      value={formUsageLimitPerTutor}
                      onChange={(e) => setFormUsageLimitPerTutor(e.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground">Prioridade (Default: 100)</label>
                  <Input
                    type="number"
                    min="0"
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value)}
                  />
                  <span className="text-[10px] text-muted-foreground">Maior número = maior prioridade em caso de empate entre campanhas.</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 7: Revisão & Confirmação */}
          {wizardStep === 7 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-foreground">Passo 7: Revisão da Campanha</h4>
                <p className="text-xs text-muted-foreground">Verifique a simulação de preços e o impacto antes de salvar ou publicar.</p>
              </div>

              {!previewData && (
                <Button
                  onClick={fetchPreview}
                  disabled={isLoadingPreview}
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs"
                >
                  <Sparkles className="h-4 w-4" />
                  {isLoadingPreview ? "Calculando Simulação..." : "Carregar Simulação de Preços"}
                </Button>
              )}

              {previewData && (
                <div className="space-y-3 bg-secondary/20 p-4 rounded-xl border border-border/50">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Tutores Atuais Elegíveis:</span>
                    <span className="font-bold text-foreground">{previewData.eligibleTutorCount} tutores</span>
                  </div>

                  <div className="text-xs space-y-1">
                    <p className="font-semibold text-foreground">Simulação por Item:</p>
                    <div className="max-h-36 overflow-y-auto space-y-1 text-[11px] pr-1 custom-scrollbar">
                      {previewData.itemPreviews.map((p: any) => (
                        <div key={p.catalogueItemId} className="p-2 rounded bg-background/50 flex items-center justify-between">
                          <span className="font-medium text-foreground">{p.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground line-through">R$ {parseFloat(p.baseUnitPrice).toFixed(2)}</span>
                            <span className="font-bold text-emerald-400">R$ {parseFloat(p.effectiveUnitPrice).toFixed(2)}</span>
                            <span className="text-[10px] text-primary">(-R$ {parseFloat(p.unitDiscount).toFixed(2)})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground italic border-t border-border/30 pt-2">
                    {previewData.precedenceDisclaimer}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">
                  Motivo Administrativo (obrigatório para publicação)
                </label>
                <Input
                  placeholder="Ex: Campanha de fidelização para baixa temporada..."
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Wizard Navigation Footer */}
          <div className="pt-4 border-t border-border/40 flex items-center justify-between">
            {wizardStep > 1 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWizardStep(wizardStep - 1)}
                disabled={isSubmittingAction}
                className="gap-1 text-xs"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </Button>
            ) : <div />}

            <div className="flex items-center gap-2">
              {wizardStep < 7 ? (
                <Button
                  size="sm"
                  onClick={() => {
                    if (wizardStep === 1 && !formName.trim()) {
                      toast({ title: "Nome Obrigatório", description: "Informe o nome da campanha.", variant: "destructive" });
                      return;
                    }
                    if (wizardStep === 3 && formItemIds.length === 0) {
                      toast({ title: "Itens Obrigatórios", description: "Selecione pelo menos um item.", variant: "destructive" });
                      return;
                    }
                    if (wizardStep === 4 && formAudienceType === "SELECTED_TUTORS" && formSelectedTutorIds.length === 0) {
                      toast({ title: "Tutores Obrigatórios", description: "Selecione pelo menos um tutor.", variant: "destructive" });
                      return;
                    }
                    setWizardStep(wizardStep + 1);
                  }}
                  className="gap-1 text-xs"
                >
                  Próximo
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSaveCampaign(false)}
                    disabled={isSubmittingAction}
                    className="text-xs"
                  >
                    Salvar Rascunho
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSaveCampaign(true)}
                    disabled={isSubmittingAction}
                    className="gap-1 text-xs font-bold"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Publicar Agora
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* ─── Detail Modal ────────────────────────────────────────────────────── */}
      <Modal
        isOpen={!!detailCampaignId}
        onClose={() => setDetailCampaignId(null)}
        title="Detalhes da Campanha Promocional"
        className="max-w-2xl"
      >
        {detailCampaign ? (
          <div className="space-y-4 pt-2 text-xs">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base text-foreground">{detailCampaign.name}</h3>
                <p className="text-muted-foreground mt-0.5">{detailCampaign.description || "Sem descrição"}</p>
              </div>
              {getStatusBadge(detailCampaign.status)}
            </div>

            <div className="grid grid-cols-2 gap-3 p-3 bg-secondary/30 rounded-xl border border-border/40">
              <div>
                <span className="text-muted-foreground">Benefício:</span>
                <p className="font-bold text-primary mt-0.5">{formatBenefitText(detailCampaign)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Prioridade:</span>
                <p className="font-bold text-foreground mt-0.5">{detailCampaign.priority}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Período de Validade:</span>
                <p className="font-medium text-foreground mt-0.5">
                  {format(new Date(detailCampaign.validFrom), "dd/MM/yyyy HH:mm", { locale: ptBR })} até{" "}
                  {format(new Date(detailCampaign.validUntil), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Política de Precedência:</span>
                <p className="font-medium text-foreground mt-0.5">
                  {detailCampaign.conditionInteractionPolicy === "ALLOW_IF_BETTER"
                    ? "Permite campanha se preço for melhor"
                    : "Exclui tutores com condição individual"}
                </p>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-2">
              <p className="font-semibold text-foreground">Itens Participantes ({detailCampaign.items?.length || 0})</p>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                {detailCampaign.items?.map((it: any) => (
                  <div key={it.id} className="p-2.5 rounded bg-secondary/20 border border-border/40 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{it.name}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">{it.itemType}</p>
                    </div>
                    <span className="text-primary font-bold">R$ {parseFloat(it.basePrice).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Audits */}
            <div className="space-y-2 pt-2 border-t border-border/40">
              <p className="font-semibold text-foreground">Histórico de Auditoria</p>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                {detailCampaign.audits?.map((a: any) => (
                  <div key={a.id} className="p-2 rounded bg-secondary/10 border border-border/30 text-[11px] space-y-0.5">
                    <div className="flex items-center justify-between font-medium">
                      <span className="text-primary">{a.action}</span>
                      <span className="text-muted-foreground">
                        {format(new Date(a.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                    <p className="text-muted-foreground">Motivo: {a.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground text-xs">Carregando detalhes...</div>
        )}
      </Modal>

      {/* ─── Publish Confirmation Modal ─────────────────────────────────────── */}
      <Modal
        isOpen={!!publishModal}
        onClose={() => setPublishModal(null)}
        title="Confirmar Publicação da Campanha"
        className="max-w-md"
      >
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">
            Deseja publicar a campanha <strong className="text-foreground">"{publishModal?.name}"</strong>? Ela se tornará ativa ou agendada conforme a janela temporal.
          </p>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground">Motivo Administrativo *</label>
            <Input
              placeholder="Informe o motivo da publicação..."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setPublishModal(null)} disabled={isSubmittingAction}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => publishModal && executeCampaignAction(publishModal.id, "publish", actionReason)}
              disabled={isSubmittingAction}
            >
              Publicar Campanha
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Pause Confirmation Modal ───────────────────────────────────────── */}
      <Modal
        isOpen={!!pauseModal}
        onClose={() => setPauseModal(null)}
        title="Pausar Campanha"
        className="max-w-md"
      >
        <div className="space-y-4 pt-2">
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2 text-xs text-amber-400">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Atenção: Reservas promocionais já realizadas permanecem válidas.
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Pausar a campanha <strong className="text-foreground">"{pauseModal?.name}"</strong> suspende temporariamente qualquer nova elegibilidade ou benefício aos tutores.
          </p>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground">Motivo Administrativo *</label>
            <Input
              placeholder="Informe o motivo da pausa..."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setPauseModal(null)} disabled={isSubmittingAction}>
              Cancelar
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => pauseModal && executeCampaignAction(pauseModal.id, "pause", actionReason)}
              disabled={isSubmittingAction}
            >
              Confirmar Pausa
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Resume Confirmation Modal ──────────────────────────────────────── */}
      <Modal
        isOpen={!!resumeModal}
        onClose={() => setResumeModal(null)}
        title="Retomar Campanha"
        className="max-w-md"
      >
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">
            Deseja reativar a campanha <strong className="text-foreground">"{resumeModal?.name}"</strong>? Tutores elegíveis voltarão a ter acesso ao benefício.
          </p>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground">Motivo Administrativo *</label>
            <Input
              placeholder="Informe o motivo da retomada..."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setResumeModal(null)} disabled={isSubmittingAction}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => resumeModal && executeCampaignAction(resumeModal.id, "resume", actionReason)}
              disabled={isSubmittingAction}
            >
              Retomar Campanha
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Revoke Confirmation Modal ──────────────────────────────────────── */}
      <Modal
        isOpen={!!revokeModal}
        onClose={() => setRevokeModal(null)}
        title="Revogar Campanha Definitivamente"
        className="max-w-md"
      >
        <div className="space-y-4 pt-2">
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start gap-2 text-xs text-rose-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Atenção: A revogação é definitiva. Reservas promocionais já realizadas permanecem válidas. A campanha não poderá mais ser reativada no futuro.
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Tem certeza que deseja revogar a campanha <strong className="text-foreground">"{revokeModal?.name}"</strong>?
          </p>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground">Motivo Administrativo da Revogação *</label>
            <Input
              placeholder="Informe o motivo da revogação..."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setRevokeModal(null)} disabled={isSubmittingAction}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => revokeModal && executeCampaignAction(revokeModal.id, "revoke", actionReason)}
              disabled={isSubmittingAction}
            >
              Revogar Definitivamente
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
