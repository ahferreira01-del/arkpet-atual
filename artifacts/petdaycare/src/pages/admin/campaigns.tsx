import React, { useState, useEffect, useCallback, useRef } from "react";
import { useListCreches } from "@workspace/api-client-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import {
  Tag,
  Sparkles,
  Plus,
  Building2,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Percent,
  DollarSign,
  TrendingDown,
  Layers,
  PauseCircle,
  PlayCircle,
  XCircle,
  Info,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatCentsToBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
    .format(cents / 100)
    .replace(/\u00a0/g, " ");
}

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * UI Idempotency Hook (R36.F1 Section 5, 6, 7).
 * Ensures:
 * 1 logical user mutation attempt = 1 X-Idempotency-Key.
 * Retries of the same submitted payload reuse the SAME key.
 * Material payload changes before submit generate a NEW key.
 * Terminal success or cancel/close resets the key.
 */
export function useIdempotentSubmission() {
  const keyRef = useRef<string | null>(null);
  const fingerprintRef = useRef<string | null>(null);

  const getOrCreateKey = useCallback((payload: unknown): string => {
    const fingerprint = JSON.stringify(payload);
    if (keyRef.current && fingerprintRef.current === fingerprint) {
      return keyRef.current;
    }
    const newKey = generateUUID();
    keyRef.current = newKey;
    fingerprintRef.current = fingerprint;
    return newKey;
  }, []);

  const clearKey = useCallback(() => {
    keyRef.current = null;
    fingerprintRef.current = null;
  }, []);

  return {
    getOrCreateKey,
    clearKey,
    getCurrentKey: () => keyRef.current,
  };
}

interface CampaignBenefit {
  id: number;
  campaignId: number;
  benefitType: "PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT" | "FIXED_PROMOTIONAL_PRICE";
  benefitValue: number;
  billingCycles: number;
}

interface CampaignItem {
  id: number;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "closed" | "archived";
  eligibleFrom: string | null;
  eligibleUntil: string | null;
  priority: number;
  assignmentMode: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  benefit: CampaignBenefit | null;
  stats: {
    assignedCount: number;
    activeCount: number;
    completedCount: number;
  };
}

export default function AdminCampaigns() {
  const [activeTab, setActiveTab] = useState<"list" | "create">("list");
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Assignment Modal
  const [selectedCampaignForAssign, setSelectedCampaignForAssign] = useState<CampaignItem | null>(null);
  // Edit Modal
  const [selectedCampaignForEdit, setSelectedCampaignForEdit] = useState<CampaignItem | null>(null);
  // Details Modal
  const [selectedCampaignForDetails, setSelectedCampaignForDetails] = useState<CampaignItem | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/commercial/campaigns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.message || `Erro HTTP ${res.status}`);
      }
      const json = await res.json();
      setCampaigns(json.campaigns || []);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar campanhas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);

  const handleStatusChange = async (campaignId: number, nextStatus: string) => {
    if (updatingStatusId === campaignId) return;
    setUpdatingStatusId(campaignId);
    try {
      const token = localStorage.getItem("auth_token");
      const idempotencyKey = generateUUID();
      const res = await fetch(`${import.meta.env.BASE_URL}api/commercial/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.message || `Erro ao atualizar status: ${res.status}`);
      }
      await fetchCampaigns();
    } catch (err: any) {
      alert(err.message || "Erro ao atualizar status da campanha.");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Campanhas & Benefícios Temporais"
        description="Gestão de campanhas comerciais recorrentes com cadência de faturamento estrita e restauração garantida."
        icon={Tag}
        action={
          <div className="flex gap-2">
            <Button
              variant={activeTab === "list" ? "default" : "outline"}
              onClick={() => setActiveTab("list")}
              className="gap-2"
            >
              <Layers className="h-4 w-4" /> Campanhas
            </Button>
            <Button
              variant={activeTab === "create" ? "default" : "outline"}
              onClick={() => setActiveTab("create")}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Nova Campanha
            </Button>
          </div>
        }
      />

      {activeTab === "create" && (
        <CreateCampaignForm
          onSuccess={() => {
            setActiveTab("list");
            fetchCampaigns();
          }}
          onCancel={() => setActiveTab("list")}
        />
      )}

      {activeTab === "list" && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2">
              <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              <p>Carregando campanhas comerciais...</p>
            </div>
          ) : error ? (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-6 text-center text-destructive">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
                <p className="font-semibold">{error}</p>
                <Button variant="outline" size="sm" onClick={fetchCampaigns} className="mt-4">
                  Tentar novamente
                </Button>
              </CardContent>
            </Card>
          ) : campaigns.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground space-y-4">
                <Tag className="h-12 w-12 mx-auto text-muted-foreground/40" />
                <div>
                  <p className="text-base font-semibold text-foreground">Nenhuma campanha cadastrada</p>
                  <p className="text-sm">Crie sua primeira campanha de benefícios recorrentes para começar.</p>
                </div>
                <Button onClick={() => setActiveTab("create")} className="gap-2">
                  <Plus className="h-4 w-4" /> Criar Primeira Campanha
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {campaigns.map((camp) => (
                <CampaignCard
                  key={camp.id}
                  campaign={camp}
                  onAssign={() => setSelectedCampaignForAssign(camp)}
                  onEdit={() => setSelectedCampaignForEdit(camp)}
                  onViewDetails={() => setSelectedCampaignForDetails(camp)}
                  onStatusChange={(status) => handleStatusChange(camp.id, status)}
                  isUpdatingStatus={updatingStatusId === camp.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {selectedCampaignForAssign && (
        <AssignCampaignModal
          isOpen={!!selectedCampaignForAssign}
          campaign={selectedCampaignForAssign}
          onClose={() => setSelectedCampaignForAssign(null)}
          onSuccess={() => {
            setSelectedCampaignForAssign(null);
            fetchCampaigns();
          }}
        />
      )}

      {selectedCampaignForEdit && (
        <EditCampaignModal
          isOpen={!!selectedCampaignForEdit}
          campaign={selectedCampaignForEdit}
          onClose={() => setSelectedCampaignForEdit(null)}
          onSuccess={() => {
            setSelectedCampaignForEdit(null);
            fetchCampaigns();
          }}
        />
      )}

      {selectedCampaignForDetails && (
        <CampaignDetailsModal
          isOpen={!!selectedCampaignForDetails}
          campaign={selectedCampaignForDetails}
          onClose={() => setSelectedCampaignForDetails(null)}
        />
      )}
    </div>
  );
}

function CampaignCard({
  campaign,
  onAssign,
  onEdit,
  onViewDetails,
  onStatusChange,
  isUpdatingStatus = false,
}: {
  campaign: CampaignItem;
  onAssign: () => void;
  onEdit: () => void;
  onViewDetails: () => void;
  onStatusChange: (status: string) => void;
  isUpdatingStatus?: boolean;
}) {
  const benefit = campaign.benefit;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Ativa</Badge>;
      case "draft":
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Rascunho</Badge>;
      case "paused":
        return <Badge variant="warning" className="gap-1"><PauseCircle className="h-3 w-3" /> Pausada</Badge>;
      case "closed":
        return <Badge variant="outline" className="gap-1"><XCircle className="h-3 w-3" /> Encerrada</Badge>;
      case "archived":
        return <Badge variant="outline" className="text-muted-foreground gap-1">Arquivada</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatBenefitText = (b: CampaignBenefit | null) => {
    if (!b) return "Sem benefício configurado";
    if (b.benefitType === "PERCENTAGE_DISCOUNT") {
      const pct = (b.benefitValue / 100).toFixed(0);
      return `${pct}% de Desconto (${b.benefitValue} bps)`;
    }
    if (b.benefitType === "FIXED_DISCOUNT") {
      return `${formatCentsToBRL(b.benefitValue)} de Desconto Recorrente`;
    }
    if (b.benefitType === "FIXED_PROMOTIONAL_PRICE") {
      return `${formatCentsToBRL(b.benefitValue)} Preço Promocional Fixo`;
    }
    return "";
  };

  return (
    <Card className="hover:border-primary/40 transition-all shadow-sm">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-foreground truncate">{campaign.name}</h3>
              {getStatusBadge(campaign.status)}
              <Badge variant="outline" className="text-xs">
                Prioridade: {campaign.priority}
              </Badge>
            </div>
            {campaign.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">{campaign.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {campaign.status === "active" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onStatusChange("paused")}
                disabled={isUpdatingStatus}
                className="gap-1 text-xs"
              >
                <PauseCircle className="h-3.5 w-3.5" /> Pausar
              </Button>
            ) : campaign.status === "paused" || campaign.status === "draft" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onStatusChange("active")}
                disabled={isUpdatingStatus}
                className="gap-1 text-xs text-success border-success/30 hover:bg-success/10"
              >
                <PlayCircle className="h-3.5 w-3.5" /> Ativar
              </Button>
            ) : null}

            <Button variant="outline" size="sm" onClick={onEdit} className="gap-1 text-xs">
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>

            <Button variant="outline" size="sm" onClick={onViewDetails} className="gap-1 text-xs">
              <Info className="h-3.5 w-3.5" /> Detalhes ({campaign.stats.assignedCount})
            </Button>

            <Button
              size="sm"
              onClick={onAssign}
              disabled={campaign.status !== "active"}
              className="gap-1 text-xs"
            >
              <ArrowRight className="h-3.5 w-3.5" /> Atribuir Creche
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-border/60 text-sm">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Benefício Recorrente
            </span>
            <p className="font-semibold text-foreground">{formatBenefitText(benefit)}</p>
            <p className="text-xs text-muted-foreground">
              Vigência exata de <span className="font-semibold text-foreground">{benefit?.billingCycles ?? 1} ciclo(s)</span> contratuais
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Janela de Elegibilidade
            </span>
            <p className="text-foreground">
              {campaign.eligibleFrom
                ? format(new Date(campaign.eligibleFrom), "dd/MM/yyyy", { locale: ptBR })
                : "Sem início restrito"}{" "}
              até{" "}
              {campaign.eligibleUntil
                ? format(new Date(campaign.eligibleUntil), "dd/MM/yyyy", { locale: ptBR })
                : "Indeterminado"}
            </p>
            <p className="text-xs text-muted-foreground">Novas adesões restritas a esta janela</p>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-success" /> Histórico de Execução
            </span>
            <div className="flex gap-2 items-center flex-wrap pt-0.5">
              <Badge variant="outline" className="text-xs font-normal">
                {campaign.stats.assignedCount} atribuídas
              </Badge>
              <Badge variant="success" className="text-xs font-normal">
                {campaign.stats.activeCount} ativas
              </Badge>
              <Badge variant="secondary" className="text-xs font-normal">
                {campaign.stats.completedCount} concluídas
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateCampaignForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { getOrCreateKey, clearKey } = useIdempotentSubmission();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "active">("active");
  const [priority, setPriority] = useState<number>(10);
  const [eligibleFrom, setEligibleFrom] = useState("");
  const [eligibleUntil, setEligibleUntil] = useState("");
  const [benefitType, setBenefitType] = useState<"PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT" | "FIXED_PROMOTIONAL_PRICE">(
    "PERCENTAGE_DISCOUNT",
  );
  const [benefitValueInput, setBenefitValueInput] = useState("20");
  const [billingCycles, setBillingCycles] = useState<number>(3);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleCancel = () => {
    clearKey();
    onCancel();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    if (!name.trim()) {
      setFormError("Nome da campanha é obrigatório.");
      return;
    }

    let rawValue = 0;
    const parsedNum = parseFloat(benefitValueInput.replace(",", "."));
    if (isNaN(parsedNum) || parsedNum <= 0) {
      setFormError("Valor do benefício inválido.");
      return;
    }

    if (benefitType === "PERCENTAGE_DISCOUNT") {
      rawValue = Math.round(parsedNum * 100); // 20% -> 2000 bps
      if (rawValue < 1 || rawValue > 10000) {
        setFormError("Desconto percentual deve estar entre 0.01% e 100%.");
        return;
      }
    } else {
      rawValue = Math.round(parsedNum * 100); // R$ 50 -> 5000 centavos
    }

    if (!billingCycles || billingCycles < 1 || billingCycles > 36) {
      setFormError("Quantidade de ciclos contratuais deve estar entre 1 e 36.");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      status,
      priority: Number(priority),
      eligibleFrom: eligibleFrom ? new Date(eligibleFrom).toISOString() : null,
      eligibleUntil: eligibleUntil ? new Date(eligibleUntil).toISOString() : null,
      benefitType,
      benefitValue: rawValue,
      billingCycles: Number(billingCycles),
    };

    const idempotencyKey = getOrCreateKey(payload);

    setSubmitting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/commercial/campaigns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.message || `Erro ao criar campanha: ${res.status}`);
      }

      clearKey();
      onSuccess();
    } catch (err: any) {
      setFormError(err.message || "Erro ao salvar campanha.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-primary/20 shadow-md">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" /> Cadastrar Nova Campanha Comercial
        </CardTitle>
        <CardDescription>
          Defina as regras do benefício recorrente e o número exato de ciclos contratuais de duração.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {formError && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Nome da Campanha *
              </label>
              <Input
                placeholder="Ex: Incentivo de Expansão Q3"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Status Inicial
              </label>
              <select
                className="w-full h-10 px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
              >
                <option value="active">Ativa (pronta para atribuições)</option>
                <option value="draft">Rascunho (em revisão)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Descrição / Justificativa Comercial
            </label>
            <Textarea
              placeholder="Descreva o propósito da campanha, regras comerciais ou restrições..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="p-4 rounded-xl bg-secondary/30 border border-border/80 space-y-4">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" /> Configuração do Benefício Recorrente
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Tipo de Benefício</label>
                <select
                  className="w-full h-10 px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background"
                  value={benefitType}
                  onChange={(e) => setBenefitType(e.target.value as any)}
                >
                  <option value="PERCENTAGE_DISCOUNT">Desconto Percentual (%)</option>
                  <option value="FIXED_DISCOUNT">Desconto Fixo (R$ OFF)</option>
                  <option value="FIXED_PROMOTIONAL_PRICE">Preço Promocional Fixo (R$ Fixo)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {benefitType === "PERCENTAGE_DISCOUNT"
                    ? "Percentual de Desconto (%)"
                    : benefitType === "FIXED_DISCOUNT"
                    ? "Valor do Desconto (R$)"
                    : "Preço Fixo da Mensalidade (R$)"}
                </label>
                <Input
                  type="number"
                  step={benefitType === "PERCENTAGE_DISCOUNT" ? "1" : "0.01"}
                  placeholder={benefitType === "PERCENTAGE_DISCOUNT" ? "20" : "50.00"}
                  value={benefitValueInput}
                  onChange={(e) => setBenefitValueInput(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Duração Contratual (Ciclos) *
                </label>
                <select
                  className="w-full h-10 px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background"
                  value={billingCycles}
                  onChange={(e) => setBillingCycles(Number(e.target.value))}
                >
                  <option value="1">1 ciclo de faturamento</option>
                  <option value="2">2 ciclos de faturamento</option>
                  <option value="3">3 ciclos de faturamento</option>
                  <option value="6">6 ciclos de faturamento</option>
                  <option value="12">12 ciclos de faturamento</option>
                </select>
              </div>
            </div>

            <div className="p-3 bg-background/80 rounded-lg text-xs text-muted-foreground border border-border/50 flex items-start gap-2">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">Regra Contratual de Não-Prorrogação:</p>
                <p>
                  O benefício aplica-se estritamente por {billingCycles} ciclos completos a partir do próximo ciclo de
                  faturamento do cliente. O preço prévio é garantido como valor protegido de restauração.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Elegível A Partir De (Opcional)</label>
              <Input
                type="date"
                value={eligibleFrom}
                onChange={(e) => setEligibleFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Elegível Até (Opcional)</label>
              <Input
                type="date"
                value={eligibleUntil}
                onChange={(e) => setEligibleUntil(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Prioridade da Campanha</label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {submitting ? "Criando Campanha..." : "Criar Campanha"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AssignCampaignModal({
  isOpen,
  campaign,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  campaign: CampaignItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { getOrCreateKey, clearKey } = useIdempotentSubmission();
  const { data: creches, isLoading: crechesLoading } = useListCreches();
  const [selectedCrecheId, setSelectedCrecheId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleClose = () => {
    clearKey();
    onClose();
  };

  const fetchPreview = async (crecheIdNum: number) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/commercial/campaigns/${campaign.id}/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ crecheIds: [crecheIdNum] }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.message || `Erro ao carregar preview: ${res.status}`);
      }
      const data = await res.json();
      const targetItem = data.items?.find((i: any) => i.crecheId === crecheIdNum) || data.items?.[0];
      setPreviewData(targetItem || null);
    } catch (err: any) {
      setPreviewError(err.message || "Falha ao calcular preview de elegibilidade.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCrecheChange = (idStr: string) => {
    setSelectedCrecheId(idStr);
    if (!idStr) {
      setPreviewData(null);
      return;
    }
    const idNum = Number(idStr);
    if (idNum > 0) {
      fetchPreview(idNum);
    }
  };

  const handleConfirmAssignment = async () => {
    if (submitting) return;
    if (!selectedCrecheId) return;
    if (!reason.trim()) {
      setSubmitError("Justificativa obrigatória para atribuição de campanha.");
      return;
    }

    const payload = {
      campaignId: campaign.id,
      crecheId: Number(selectedCrecheId),
      reason: reason.trim(),
    };

    const idempotencyKey = getOrCreateKey(payload);

    setSubmitting(true);
    setSubmitError(null);

    try {
      const token = localStorage.getItem("auth_token");

      const res = await fetch(
        `${import.meta.env.BASE_URL}api/commercial/campaigns/${campaign.id}/assign/${selectedCrecheId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.message || `Erro ao atribuir campanha: ${res.status}`);
      }

      clearKey();
      onSuccess();
    } catch (err: any) {
      setSubmitError(err.message || "Falha na atribuição da campanha.");
    } finally {
      setSubmitting(false);
    }
  };

  const isEligible = previewData?.eligible === true;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Atribuir Campanha: ${campaign.name}`}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        <div className="p-3 bg-secondary/30 rounded-xl text-xs space-y-1">
          <p className="font-semibold text-foreground">Campanha Selecionada:</p>
          <p className="text-muted-foreground">{campaign.name}</p>
          <p className="text-muted-foreground">
            Benefício: {campaign.benefit?.billingCycles} ciclos contratuais
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Selecione a Creche Alvo *
          </label>
          <select
            className="w-full h-10 px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background"
            value={selectedCrecheId}
            onChange={(e) => handleCrecheChange(e.target.value)}
            disabled={crechesLoading || submitting}
          >
            <option value="">Selecione uma creche...</option>
            {creches?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (ID: {c.id})
              </option>
            ))}
          </select>
        </div>

        {previewLoading && (
          <div className="p-6 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" /> Simulando elegibilidade e valores no Stripe...
          </div>
        )}

        {previewError && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{previewError}</span>
          </div>
        )}

        {previewData && (
          <div className="space-y-4">
            {!previewData.eligible ? (
              <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 space-y-2">
                <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
                  <XCircle className="h-5 w-5" /> Creche Não Elegível para Esta Campanha
                </div>
                <p className="text-xs text-destructive">{previewData.ineligibilityReason}</p>
              </div>
            ) : (
              <div className="space-y-4 p-4 rounded-xl bg-secondary/30 border border-border">
                <div className="flex items-center gap-2 text-success font-semibold text-sm">
                  <CheckCircle2 className="h-5 w-5" /> Creche Elegível com Sucesso
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-background border border-border/60">
                    <p className="text-muted-foreground">Preço Efetivo Atual</p>
                    <p className="text-sm font-bold text-foreground">
                      {formatCentsToBRL(previewData.currentEffectivePriceCents)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Intervalo: {previewData.billingInterval}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-background border border-primary/40">
                    <p className="text-primary font-medium">Novo Preço Promocional</p>
                    <p className="text-sm font-bold text-primary">
                      {formatCentsToBRL(previewData.promotionalPriceCents)}
                    </p>
                    <p className="text-[10px] text-success">
                      Economia: {formatCentsToBRL(previewData.absoluteSavingsCents)} / ciclo
                    </p>
                  </div>
                </div>

                {/* Exact Contractual Disclaimers */}
                <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 space-y-2 text-xs">
                  <p className="font-semibold text-primary flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4" /> Compromissos Contratuais & Temporais
                  </p>
                  <ul className="space-y-1.5 text-muted-foreground">
                    <li className="flex items-start gap-1.5">
                      <span className="text-primary font-bold">•</span>
                      <span>A campanha começará no próximo ciclo completo de cobrança.</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-primary font-bold">•</span>
                      <span>
                        O benefício será aplicado por{" "}
                        <strong className="text-foreground">{previewData.billingCycles} ciclos</strong> de cobrança.
                      </span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-primary font-bold">•</span>
                      <span>
                        Após o benefício, o valor protegido de restauração será{" "}
                        <strong className="text-foreground">
                          {formatCentsToBRL(previewData.restorationCommittedPriceCents)}
                        </strong>
                        .
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {isEligible && (
          <div className="space-y-2 pt-2">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Justificativa da Atribuição *
            </label>
            <Textarea
              placeholder="Ex: Acordo comercial de renovação negociado pelo Master Admin..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              required
            />
          </div>
        )}

        {submitError && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmAssignment}
            disabled={!isEligible || submitting || !reason.trim()}
            className="gap-2"
          >
            {submitting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {submitting ? "Executando no Stripe..." : "Confirmar Atribuição Segura"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditCampaignModal({
  isOpen,
  campaign,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  campaign: CampaignItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { getOrCreateKey, clearKey } = useIdempotentSubmission();
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description || "");
  const [priority, setPriority] = useState(String(campaign.priority ?? 0));
  const [eligibleUntil, setEligibleUntil] = useState(
    campaign.eligibleUntil ? campaign.eligibleUntil.slice(0, 10) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleClose = () => {
    clearKey();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    if (!name.trim()) {
      setFormError("Nome da campanha é obrigatório.");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      priority: Number(priority),
      eligibleUntil: eligibleUntil ? new Date(eligibleUntil).toISOString() : null,
    };

    const idempotencyKey = getOrCreateKey(payload);

    setSubmitting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/commercial/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.message || `Erro ao atualizar campanha: ${res.status}`);
      }

      clearKey();
      onSuccess();
    } catch (err: any) {
      setFormError(err.message || "Falha ao atualizar dados da campanha.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Editar Campanha: ${campaign.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        {formError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-xs">
            {formError}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Nome da Campanha *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Descrição Comercial</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Prioridade</label>
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Fim da Elegibilidade</label>
            <Input
              type="date"
              value={eligibleUntil}
              onChange={(e) => setEligibleUntil(e.target.value)}
              className="text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting} className="gap-2">
            {submitting && <RefreshCw className="h-4 w-4 animate-spin" />}
            Salvar Alterações
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CampaignDetailsModal({
  isOpen,
  campaign,
  onClose,
}: {
  isOpen: boolean;
  campaign: CampaignItem;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem("auth_token");
        const res = await fetch(`${import.meta.env.BASE_URL}api/commercial/campaigns/${campaign.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setDetails(json);
        }
      } catch {
        // Handled silently
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [campaign.id]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Detalhes da Campanha: ${campaign.name}`}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1 text-sm">
        <div className="p-3 bg-secondary/30 rounded-xl space-y-1">
          <p className="text-xs text-muted-foreground">Descrição:</p>
          <p className="text-foreground">{campaign.description || "Sem descrição informada."}</p>
        </div>

        <div className="space-y-2">
          <h4 className="font-semibold text-foreground flex items-center gap-1.5 text-xs uppercase tracking-wider">
            <Building2 className="h-4 w-4 text-primary" /> Creches Inscritas (
            {details?.assignments?.length || 0})
          </h4>

          {loading ? (
            <div className="py-6 text-center text-muted-foreground text-xs">Carregando atribuições...</div>
          ) : !details?.assignments?.length ? (
            <div className="py-6 text-center text-muted-foreground text-xs border border-dashed rounded-lg">
              Nenhuma creche foi atribuída a esta campanha ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {details.assignments.map((item: any) => (
                <div
                  key={item.id}
                  className="p-3 rounded-lg bg-card border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{item.crecheName}</p>
                    <p className="text-muted-foreground">
                      Preço Promo: {formatCentsToBRL(item.promotionalPriceCents)} | Restauração:{" "}
                      {formatCentsToBRL(item.restorationPriceCents)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {item.consumedCyclesCount} / {item.billingCycles} ciclos
                    </Badge>
                    <Badge
                      variant={
                        item.status === "active"
                          ? "success"
                          : item.status === "completed"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {item.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
