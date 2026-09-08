import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListCreches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/page-header";
import {
  FileText,
  Plus,
  Send,
  RefreshCw,
  Clock,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Wrench,
  Calendar,
  DollarSign,
  Layers,
  ArrowRight,
} from "lucide-react";

function formatBrl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  if (cents === 0) return "Grátis (Cortesia)";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminProposals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: creches } = useListCreches();

  const [activeTab, setActiveTab] = useState<string>("proposals");

  // Proposals State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [retryModalOpen, setRetryModalOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<any>(null);
  const [retryReason, setRetryReason] = useState("");

  const [newProposal, setNewProposal] = useState({
    crecheId: "",
    title: "",
    planId: "2",
    billingInterval: "month",
    pricingOverrideType: "percentage",
    pricingOverrideValue: "1500", // 15%
    entitlementPetLimit: "50",
    validUntil: "",
    notes: "",
  });

  // Services State
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<any>(null);

  const [adminNotes, setAdminNotes] = useState("");
  const [quotedPriceBrl, setQuotedPriceBrl] = useState("0");
  const [scheduledFor, setScheduledFor] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [actionReason, setActionReason] = useState("");

  // Queries
  const { data: proposalsData, isLoading: loadingProposals } = useQuery({
    queryKey: ["admin-proposals"],
    queryFn: async () => {
      const res = await fetch("/api/commercial/proposals");
      if (!res.ok) throw new Error("Falha ao carregar propostas");
      return res.json();
    },
  });

  const { data: servicesData, isLoading: loadingServices } = useQuery({
    queryKey: ["admin-platform-services"],
    queryFn: async () => {
      const res = await fetch("/api/commercial/platform-services");
      if (!res.ok) throw new Error("Falha ao carregar solicitações de implantação");
      return res.json();
    },
  });

  const proposals = proposalsData?.proposals || [];
  const services = servicesData?.requests || [];

  // Mutations
  const createProposalMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/commercial/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Erro ao criar proposta");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-proposals"] });
      setCreateModalOpen(false);
      toast({ title: "Proposta criada com sucesso", description: "Proposta salva como rascunho." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao criar proposta", description: err.message, variant: "destructive" });
    },
  });

  const sendProposalMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const res = await fetch(`/api/commercial/proposals/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Erro ao enviar proposta");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-proposals"] });
      toast({ title: "Proposta enviada", description: "O cliente agora pode visualizar e aceitar os termos." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao enviar proposta", description: err.message, variant: "destructive" });
    },
  });

  const retryActivationMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const res = await fetch(`/api/commercial/proposals/${id}/retry-activation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Erro ao reativar condição");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-proposals"] });
      setRetryModalOpen(false);
      toast({ title: "Reativação concluída", description: "Condição comercial reativada com sucesso." });
    },
    onError: (err: any) => {
      toast({ title: "Erro na reativação", description: err.message, variant: "destructive" });
    },
  });

  const serviceActionMutation = useMutation({
    mutationFn: async ({ endpoint, payload }: { endpoint: string; payload: any }) => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Erro ao processar solicitação");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-platform-services"] });
      setReviewModalOpen(false);
      setQuoteModalOpen(false);
      setScheduleModalOpen(false);
      setStartModalOpen(false);
      setCompleteModalOpen(false);
      setCancelModalOpen(false);
      toast({ title: "Sucesso", description: "Ação de implantação executada com sucesso." });
    },
    onError: (err: any) => {
      toast({ title: "Erro na operação", description: err.message, variant: "destructive" });
    },
  });

  const proposalsContent = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground font-medium">Total de Propostas</p>
            <p className="text-2xl font-bold">{proposals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground font-medium">Rascunhos</p>
            <p className="text-2xl font-bold text-amber-500">
              {proposals.filter((p: any) => p.status === "draft").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground font-medium">Enviadas (Aguardando Aceite)</p>
            <p className="text-2xl font-bold text-blue-500">
              {proposals.filter((p: any) => p.status === "sent").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground font-medium">Aceitas</p>
            <p className="text-2xl font-bold text-emerald-500">
              {proposals.filter((p: any) => p.status === "accepted").length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Propostas Comerciais Formais</CardTitle>
          <CardDescription>
            Propostas duráveis com snapshot congelado de condições e fluxo de aceite direto pelo cliente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingProposals ? (
            <div className="py-8 text-center text-muted-foreground">Carregando propostas...</div>
          ) : proposals.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Nenhuma proposta comercial cadastrada ainda.
            </div>
          ) : (
            <div className="divide-y border rounded-lg overflow-hidden">
              {proposals.map((p: any) => {
                const snap = p.snapshotJson || {};
                const isDraft = p.status === "draft";
                const isSent = p.status === "sent";
                const isAccepted = p.status === "accepted";
                const isFailedActivation = p.activationStatus === "activation_failed";
                const targetCreche = creches?.find((c: any) => c.id === p.crecheId);

                return (
                  <div key={p.id} className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">#{p.id} {p.title || "Proposta sem título"}</span>
                        <Badge variant={isDraft ? "secondary" : isSent ? "outline" : isAccepted ? "default" : "destructive"}>
                          {p.status}
                        </Badge>
                        {p.activationStatus && p.activationStatus !== "not_started" && (
                          <Badge variant={isFailedActivation ? "destructive" : "secondary"}>
                            Ativação: {p.activationStatus}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Creche: <span className="font-medium text-foreground">{targetCreche?.name || `#${p.crecheId}`}</span> •
                        Validade: <span className="font-medium">{formatDate(p.validUntil)}</span> •
                        Criado por: {p.createdBy || "master_admin"}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Preço Exibido: <strong className="text-foreground">{formatBrl(snap.displayedEffectivePriceCents)}</strong></span>
                        <span>•</span>
                        <span>Limite Pets: <strong className="text-foreground">{snap.entitlementPetLimit || "Padrão"}</strong></span>
                        <span>•</span>
                        <span>Requisito: <strong className="text-foreground">{snap.executionRequirement || "STRIPE_REQUIRED"}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isDraft && (
                        <Button
                          size="sm"
                          onClick={() => {
                            const reason = prompt("Justificativa para envio formal da proposta:");
                            if (reason && reason.trim()) {
                              sendProposalMutation.mutate({ id: p.id, reason: reason.trim() });
                            }
                          }}
                          className="flex items-center gap-1"
                        >
                          <Send className="h-3.5 w-3.5" /> Enviar
                        </Button>
                      )}
                      {isFailedActivation && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setSelectedProposal(p);
                            setRetryReason("");
                            setRetryModalOpen(true);
                          }}
                          className="flex items-center gap-1"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Retry Ativação
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const servicesContent = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground font-medium">Total de Solicitações</p>
            <p className="text-2xl font-bold">{services.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground font-medium">Solicitadas / Em Análise</p>
            <p className="text-2xl font-bold text-amber-500">
              {services.filter((s: any) => ["requested", "under_review"].includes(s.status)).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground font-medium">Pagas / Agendadas</p>
            <p className="text-2xl font-bold text-blue-500">
              {services.filter((s: any) => ["paid", "scheduled", "in_progress"].includes(s.status)).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground font-medium">Concluídas</p>
            <p className="text-2xl font-bold text-emerald-500">
              {services.filter((s: any) => s.status === "completed").length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Solicitações de Implantação Assistida</CardTitle>
          <CardDescription>
            Onboarding operacional dedicado, orçamentos avulsos e acompanhamento de ponta a ponta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingServices ? (
            <div className="py-8 text-center text-muted-foreground">Carregando solicitações...</div>
          ) : services.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Nenhuma solicitação de implantação assistida encontrada.
            </div>
          ) : (
            <div className="divide-y border rounded-lg overflow-hidden">
              {services.map((s: any) => {
                const targetCreche = creches?.find((c: any) => c.id === s.crecheId);
                return (
                  <div key={s.id} className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">Solicitação #{s.id}</span>
                        <Badge>{s.status}</Badge>
                        {s.refundStatus && s.refundStatus !== "NONE" && (
                          <Badge variant="destructive">Reembolso: {s.refundStatus}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Creche: <span className="font-medium text-foreground">{targetCreche?.name || `#${s.crecheId}`}</span> •
                        Preço: <span className="font-medium text-foreground">{formatBrl(s.quotedPriceCents)}</span> •
                        Data Solicitada: {formatDate(s.createdAt)}
                      </p>
                      {s.scheduledFor && (
                        <p className="text-xs text-blue-600 font-medium">
                          📅 Agendado para: {formatDateTime(s.scheduledFor)}
                        </p>
                      )}
                      {s.customerNotes && (
                        <p className="text-xs text-muted-foreground italic">
                          "{s.customerNotes}"
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {s.status === "requested" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedService(s);
                            setAdminNotes("");
                            setActionReason("");
                            setReviewModalOpen(true);
                          }}
                        >
                          Analisar
                        </Button>
                      )}

                      {s.status === "under_review" && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedService(s);
                            setQuotedPriceBrl("0");
                            setAdminNotes("");
                            setActionReason("");
                            setQuoteModalOpen(true);
                          }}
                        >
                          Enviar Orçamento
                        </Button>
                      )}

                      {["accepted", "paid"].includes(s.status) && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedService(s);
                            setScheduledFor("");
                            setAdminNotes("");
                            setActionReason("");
                            setScheduleModalOpen(true);
                          }}
                        >
                          Agendar
                        </Button>
                      )}

                      {s.status === "scheduled" && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedService(s);
                            setActionReason("");
                            setStartModalOpen(true);
                          }}
                        >
                          Iniciar Sessão
                        </Button>
                      )}

                      {s.status === "in_progress" && (
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => {
                            setSelectedService(s);
                            setCompletionNotes("");
                            setActionReason("");
                            setCompleteModalOpen(true);
                          }}
                        >
                          Concluir
                        </Button>
                      )}

                      {!["completed", "cancelled", "declined"].includes(s.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            setSelectedService(s);
                            setActionReason("");
                            setCancelModalOpen(true);
                          }}
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Propostas & Serviços de Implantação"
        description="Gestão de propostas comerciais formais e serviços operacionais dedicados (R36.G)."
        icon={FileText}
        action={
          activeTab === "proposals" ? (
            <Button onClick={() => setCreateModalOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nova Proposta
            </Button>
          ) : null
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={(id: string) => setActiveTab(id)}
        tabs={[
          { id: "proposals", label: "Propostas Comerciais", icon: <FileText className="h-4 w-4" />, content: proposalsContent },
          { id: "services", label: "Implantação Assistida", icon: <Wrench className="h-4 w-4" />, content: servicesContent },
        ]}
      />

      {/* MODAL: CRIAR PROPOSTA */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Nova Proposta Comercial"
        description="Crie uma proposta de condições customizadas para um cliente."
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Creche Alvo</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={newProposal.crecheId}
              onChange={(e) => setNewProposal({ ...newProposal, crecheId: e.target.value })}
            >
              <option value="">Selecione a creche...</option>
              {creches?.map((c: any) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Título da Proposta</Label>
            <Input
              placeholder="Ex: Condições Especiais Expansão Q3"
              value={newProposal.title}
              onChange={(e) => setNewProposal({ ...newProposal, title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Plano</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newProposal.planId}
                onChange={(e) => setNewProposal({ ...newProposal, planId: e.target.value })}
              >
                <option value="1">Essencial</option>
                <option value="2">Profissional</option>
                <option value="3">Enterprise</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label>Intervalo</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newProposal.billingInterval}
                onChange={(e) => setNewProposal({ ...newProposal, billingInterval: e.target.value })}
              >
                <option value="month">Mensal</option>
                <option value="quarter">Trimestral</option>
                <option value="semester">Semestral</option>
                <option value="year">Anual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipo de Ajuste</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newProposal.pricingOverrideType}
                onChange={(e) => setNewProposal({ ...newProposal, pricingOverrideType: e.target.value })}
              >
                <option value="none">Preço de Tabela</option>
                <option value="percentage">Desconto (%)</option>
                <option value="fixed_amount">Preço Fixo (R$)</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label>
                {newProposal.pricingOverrideType === "percentage" ? "Desconto (bps, 1500=15%)" : "Valor Fixo (centavos)"}
              </Label>
              <Input
                value={newProposal.pricingOverrideValue}
                onChange={(e) => setNewProposal({ ...newProposal, pricingOverrideValue: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Limite de Pets</Label>
              <Input
                type="number"
                value={newProposal.entitlementPetLimit}
                onChange={(e) => setNewProposal({ ...newProposal, entitlementPetLimit: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label>Válido Até</Label>
              <Input
                type="date"
                value={newProposal.validUntil}
                onChange={(e) => setNewProposal({ ...newProposal, validUntil: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notas Internas</Label>
            <Textarea
              placeholder="Observações sobre a negociação..."
              value={newProposal.notes}
              onChange={(e) => setNewProposal({ ...newProposal, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!newProposal.crecheId) {
                  toast({ title: "Selecione uma creche", variant: "destructive" });
                  return;
                }
                createProposalMutation.mutate({
                  crecheId: Number(newProposal.crecheId),
                  title: newProposal.title,
                  planId: Number(newProposal.planId),
                  billingInterval: newProposal.billingInterval,
                  pricingOverrideType: newProposal.pricingOverrideType,
                  pricingOverrideValue: newProposal.pricingOverrideValue ? Number(newProposal.pricingOverrideValue) : undefined,
                  entitlementPetLimit: newProposal.entitlementPetLimit ? Number(newProposal.entitlementPetLimit) : undefined,
                  validUntil: newProposal.validUntil ? new Date(newProposal.validUntil).toISOString() : undefined,
                  notes: newProposal.notes,
                });
              }}
              disabled={createProposalMutation.isPending}
            >
              Criar Rascunho
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: RETRY ATIVAÇÃO */}
      <Modal
        isOpen={retryModalOpen}
        onClose={() => setRetryModalOpen(false)}
        title="Reativar Condição Comercial"
        description="A proposta foi aceita pelo cliente, mas a ativação falhou anteriormente. Informe a justificativa operacional para nova tentativa."
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Justificativa Operacional Obrigatória</Label>
            <Textarea
              placeholder="Ex: Restauração da conexão com o gateway e sincronização de fatura."
              value={retryReason}
              onChange={(e) => setRetryReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setRetryModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!retryReason.trim()) {
                  toast({ title: "Justificativa obrigatória", variant: "destructive" });
                  return;
                }
                retryActivationMutation.mutate({
                  id: selectedProposal.id,
                  reason: retryReason.trim(),
                });
              }}
              disabled={retryActivationMutation.isPending}
            >
              Reexecutar Ativação
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: ORÇAMENTO IMPLANTAÇÃO */}
      <Modal
        isOpen={quoteModalOpen}
        onClose={() => setQuoteModalOpen(false)}
        title="Enviar Orçamento de Implantação"
        description="Defina o valor em reais (ou 0 para cortesia) e a justificativa para envio ao cliente."
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Valor do Serviço (R$)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={quotedPriceBrl}
              onChange={(e) => setQuotedPriceBrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Informe 0 para oferecer o serviço como cortesia gratuita.</p>
          </div>
          <div className="space-y-1">
            <Label>Escopo / Notas para o Cliente</Label>
            <Textarea
              placeholder="Ex: Sessão dedicada de 2 horas com configuração completa e migração..."
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Justificativa de Auditoria</Label>
            <Input
              placeholder="Ex: Orçamento padrão aprovado pela gerência"
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setQuoteModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const cents = Math.round(parseFloat(quotedPriceBrl || "0") * 100);
                serviceActionMutation.mutate({
                  endpoint: `/api/commercial/platform-services/${selectedService.id}/quote`,
                  payload: {
                    quotedPriceCents: cents,
                    adminNotes,
                    reason: actionReason.trim() || "Envio de orçamento de implantação assistida",
                  },
                });
              }}
              disabled={serviceActionMutation.isPending}
            >
              Confirmar e Enviar
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: AGENDAR IMPLANTAÇÃO */}
      <Modal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        title="Agendar Sessão de Implantação"
        description="Defina a data e horário acordados com o cliente para a sessão assistida."
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Data e Horário</Label>
            <Input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Instruções / Link da Reunião</Label>
            <Textarea
              placeholder="Ex: Link do Google Meet e preparativos..."
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Justificativa de Auditoria</Label>
            <Input
              placeholder="Ex: Alinhado com a diretoria da creche"
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setScheduleModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!scheduledFor) {
                  toast({ title: "Informe a data e horário", variant: "destructive" });
                  return;
                }
                serviceActionMutation.mutate({
                  endpoint: `/api/commercial/platform-services/${selectedService.id}/schedule`,
                  payload: {
                    scheduledFor: new Date(scheduledFor).toISOString(),
                    adminNotes,
                    reason: actionReason.trim() || "Agendamento da sessão de implantação",
                  },
                });
              }}
              disabled={serviceActionMutation.isPending}
            >
              Confirmar Agendamento
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: CONCLUIR IMPLANTAÇÃO */}
      <Modal
        isOpen={completeModalOpen}
        onClose={() => setCompleteModalOpen(false)}
        title="Concluir Implantação Assistida"
        description="Finalize o atendimento de onboarding e registre as notas finais de entrega."
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Notas de Conclusão</Label>
            <Textarea
              placeholder="Ex: Equipe treinada, 45 pets cadastrados, turmas e rotinas operando..."
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Justificativa de Auditoria</Label>
            <Input
              placeholder="Ex: Checklist de implantação concluído com sucesso"
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setCompleteModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                serviceActionMutation.mutate({
                  endpoint: `/api/commercial/platform-services/${selectedService.id}/complete`,
                  payload: {
                    completionNotes,
                    reason: actionReason.trim() || "Conclusão de implantação assistida",
                  },
                });
              }}
              disabled={serviceActionMutation.isPending}
            >
              Concluir Serviço
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: CANCELAR SERVIÇO */}
      <Modal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Cancelar Solicitação de Implantação"
        description={
          selectedService?.status === "paid" || selectedService?.status === "scheduled"
            ? "Atenção: este serviço já foi pago. O cancelamento acionará a análise de reembolso obrigatória."
            : "Informe o motivo formal do cancelamento da solicitação."
        }
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Motivo / Justificativa Obrigatória</Label>
            <Textarea
              placeholder="Ex: Solicitação cancelada a pedido do cliente..."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setCancelModalOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!actionReason.trim()) {
                  toast({ title: "Justificativa obrigatória", variant: "destructive" });
                  return;
                }
                serviceActionMutation.mutate({
                  endpoint: `/api/commercial/platform-services/${selectedService.id}/cancel`,
                  payload: {
                    reason: actionReason.trim(),
                  },
                });
              }}
              disabled={serviceActionMutation.isPending}
            >
              Confirmar Cancelamento
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
