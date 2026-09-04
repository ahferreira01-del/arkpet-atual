import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ShieldAlert,
  CreditCard,
  Building2,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  ArrowRight,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CommercialSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  creche: {
    id: number;
    name: string;
    email?: string;
    status?: string;
  } | null;
}

function formatCentsToBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
    .format(cents / 100)
    .replace(/\u00a0/g, " ");
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function CommercialSupportModal({ isOpen, onClose, creche }: CommercialSupportModalProps) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Customize condition subview
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [petLimitInput, setPetLimitInput] = useState<string>("");
  const [pricingTypeInput, setPricingTypeInput] = useState<"none" | "fixed_amount" | "percentage">("none");
  const [pricingValueInput, setPricingValueInput] = useState<string>("");
  const [reasonInput, setReasonInput] = useState<string>("");
  const [confirmLowering, setConfirmLowering] = useState<boolean>(false);

  // Preview state
  const [preview, setPreview] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Mutation state
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const fetchSupportData = useCallback(async () => {
    if (!creche) return;
    setLoading(true);
    setFetchError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/creches/${creche.id}/commercial/support`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error || `Erro HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);

      // Initialize form defaults
      const currentPetLimit = json?.limits?.effectivePetLimit ?? json?.plan?.petLimit ?? "";
      setPetLimitInput(String(currentPetLimit));
      const currentType = json?.activeCondition?.pricingOverrideType ?? "none";
      setPricingTypeInput(currentType);
      const currentValue = json?.activeCondition?.pricingOverrideValue;
      if (currentType === "percentage" && currentValue) {
        setPricingValueInput(String(currentValue / 100)); // display as % (e.g. 15 for 1500 bps)
      } else if (currentType === "fixed_amount" && currentValue) {
        setPricingValueInput(String(currentValue / 100)); // display as R$
      } else {
        setPricingValueInput("");
      }
    } catch (err: any) {
      setFetchError(err.message || "Erro ao carregar suporte comercial.");
    } finally {
      setLoading(false);
    }
  }, [creche]);

  useEffect(() => {
    if (isOpen && creche) {
      fetchSupportData();
      setIsCustomizing(false);
      setSuccessNotice(null);
      setMutationError(null);
      setConfirmLowering(false);
      setReasonInput("");
    }
  }, [isOpen, creche, fetchSupportData]);

  // Live preview simulation
  useEffect(() => {
    if (!isCustomizing || !creche || !data?.plan) return;

    let parsedOverrideValue: number | null = null;
    if (pricingTypeInput === "percentage") {
      const pct = parseFloat(pricingValueInput.replace(",", "."));
      if (!isNaN(pct) && pct >= 0 && pct <= 100) {
        parsedOverrideValue = Math.round(pct * 100); // convert to basis points
      }
    } else if (pricingTypeInput === "fixed_amount") {
      const fixed = parseFloat(pricingValueInput.replace(",", "."));
      if (!isNaN(fixed) && fixed >= 0) {
        parsedOverrideValue = Math.round(fixed * 100); // convert to centavos
      }
    }

    const parsedPetLimit = parseInt(petLimitInput, 10);

    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const token = localStorage.getItem("auth_token");
        const res = await fetch(`${import.meta.env.BASE_URL}api/creches/${creche.id}/commercial/preview-price`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            planId: data.plan.id,
            pricingOverrideType: pricingTypeInput,
            pricingOverrideValue: parsedOverrideValue,
            entitlementPetLimit: !isNaN(parsedPetLimit) && parsedPetLimit > 0 ? parsedPetLimit : undefined,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setPreview(json);
        }
      } catch {
        // Ignore preview simulation errors in background
      } finally {
        setPreviewLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [isCustomizing, creche, data?.plan, pricingTypeInput, pricingValueInput, petLimitInput]);

  if (!creche) return null;

  // Determine if pricing is modified vs only petLimit modified
  const isPricingModified =
    pricingTypeInput !== "none" ||
    (data?.activeCondition?.pricingOverrideType && data.activeCondition.pricingOverrideType !== "none");

  const activePetCount = data?.limits?.activePetCount ?? 0;
  const requestedPetLimitNum = parseInt(petLimitInput, 10);
  const isLoweringLimit =
    !isNaN(requestedPetLimitNum) && requestedPetLimitNum > 0 && requestedPetLimitNum < activePetCount;

  const handleSubmitMutation = async () => {
    setSubmitting(true);
    setMutationError(null);
    setSuccessNotice(null);

    const idempotencyKey = generateUUID();
    const token = localStorage.getItem("auth_token");

    try {
      if (!reasonInput || reasonInput.trim().length === 0) {
        throw new Error("A justificativa é obrigatória para registrar alterações comerciais.");
      }

      if (isPricingModified) {
        // Recurring price modified -> Save Draft (Section 23)
        let parsedValue: number | null = null;
        if (pricingTypeInput === "percentage") {
          const pct = parseFloat(pricingValueInput.replace(",", "."));
          if (isNaN(pct) || pct < 0 || pct > 100) {
            throw new Error("Porcentagem de desconto inválida (0% a 100%).");
          }
          parsedValue = Math.round(pct * 100);
        } else if (pricingTypeInput === "fixed_amount") {
          const val = parseFloat(pricingValueInput.replace(",", "."));
          if (isNaN(val) || val < 0) {
            throw new Error("Valor fixo em reais inválido.");
          }
          parsedValue = Math.round(val * 100);
        }

        const res = await fetch(`${import.meta.env.BASE_URL}api/creches/${creche.id}/commercial/draft-condition`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            planId: data?.plan?.id,
            pricingOverrideType: pricingTypeInput,
            pricingOverrideValue: parsedValue,
            entitlementPetLimit: !isNaN(requestedPetLimitNum) && requestedPetLimitNum > 0 ? requestedPetLimitNum : undefined,
            reason: reasonInput.trim(),
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.message || json?.error || `Erro HTTP ${res.status}`);
        }

        setSuccessNotice(
          json?.message ||
            "Rascunho comercial salvo com sucesso. A alteração de cobrança será aplicada após a etapa de sincronização com o Stripe.",
        );
        setIsCustomizing(false);
        fetchSupportData();
      } else {
        // Only petLimit modified -> Apply Alteration (ARKPET_ONLY)
        if (isNaN(requestedPetLimitNum) || requestedPetLimitNum <= 0) {
          throw new Error("O limite de pets deve ser um número inteiro positivo.");
        }

        if (isLoweringLimit && !confirmLowering) {
          throw new Error("Confirmação explícita obrigatória para reduzir o limite abaixo dos pets ativos.");
        }

        const res = await fetch(`${import.meta.env.BASE_URL}api/creches/${creche.id}/commercial/pet-limit-override`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            entitlementPetLimit: requestedPetLimitNum,
            reason: reasonInput.trim(),
            confirmLowering: confirmLowering,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.message || json?.error || `Erro HTTP ${res.status}`);
        }

        setSuccessNotice("Limite de pets personalizado aplicado com sucesso!");
        setIsCustomizing(false);
        fetchSupportData();
      }
    } catch (err: any) {
      setMutationError(err.message || "Erro ao executar operação comercial.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Suporte Comercial & Faturamento"
      description={`Console de suporte operacional Master Admin para ${creche.name}`}
      className="max-w-2xl"
    >
      <div className="space-y-6 text-foreground">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm">Carregando dados comerciais e contratuais...</p>
          </div>
        ) : fetchError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <ShieldAlert className="h-4 w-4" /> Erro ao carregar dados
            </div>
            <p className="text-xs">{fetchError}</p>
            <Button size="sm" variant="outline" onClick={fetchSupportData} className="mt-2 text-xs">
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            {/* Success Notice */}
            {successNotice && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-400 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">Operação Concluída</p>
                  <p className="text-xs opacity-90 mt-0.5">{successNotice}</p>
                </div>
              </div>
            )}

            {/* Diagnostic Integrity Alert */}
            {data?.conditionIntegrityError && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-400 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">Erro de Integridade Contratual</p>
                  <p className="text-xs opacity-90 mt-0.5">{data.conditionIntegrityError}</p>
                </div>
              </div>
            )}

            {/* 1. EMPRESA */}
            <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> Empresa / Creche
                </span>
                <Badge variant={creche.status === "active" ? "default" : "secondary"}>
                  {creche.status === "active" ? "Ativa" : "Inativa"}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm pt-1">
                <div>
                  <span className="text-muted-foreground text-xs">Nome: </span>
                  <span className="font-medium">{creche.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Email: </span>
                  <span className="font-medium">{creche.email || "Não informado"}</span>
                </div>
              </div>
            </div>

            {/* 2. PLANO & ASSINATURA */}
            <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5" /> Plano & Assinatura
                </span>
                {data?.subscriptionState === "NOT_PROVISIONED" ? (
                  <Badge variant="destructive" className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                    Assinatura não provisionada
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    {data?.subscription?.status ?? "Ativa"}
                  </Badge>
                )}
              </div>

              {data?.subscriptionState === "NOT_PROVISIONED" ? (
                <div className="text-xs text-muted-foreground bg-amber-500/5 p-3 rounded-lg border border-amber-500/20">
                  Esta unidade foi cadastrada sem uma assinatura vinculada. Serviços operacionais requerem provisionamento prévio.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs block">Plano Atual</span>
                    <span className="font-semibold text-foreground">{data?.plan?.name || "Padrão"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">Preço Catálogo</span>
                    <span className="font-medium text-muted-foreground">{formatCentsToBRL(data?.pricing?.catalogPriceCents)}/mês</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">Preço Efetivo Atual</span>
                    <span className="font-semibold text-emerald-400">{formatCentsToBRL(data?.pricing?.finalEffectivePriceCents)}/mês</span>
                  </div>
                  {data?.subscription?.currentPeriodEnd && (
                    <div className="col-span-2 sm:col-span-3 text-xs text-muted-foreground pt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Fim do período atual:{" "}
                      {format(new Date(data.subscription.currentPeriodEnd), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. LIMITES & USO */}
            <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Limites & Uso
                </span>
                {data?.limits?.isCustomLimit && (
                  <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                    Limite Personalizado
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="text-sm">
                  <span className="text-muted-foreground text-xs block">Pets Cadastrados / Limite</span>
                  <span className="text-lg font-bold text-foreground">
                    {data?.limits?.activePetCount ?? 0}
                    <span className="text-muted-foreground font-normal text-sm"> / {data?.limits?.effectivePetLimit ?? "Ilimitado"}</span>
                  </span>
                </div>
                {data?.limits?.catalogPetLimit && data.limits.effectivePetLimit !== data.limits.catalogPetLimit && (
                  <div className="text-right text-xs text-muted-foreground">
                    Catálogo original: {data.limits.catalogPetLimit} pets
                  </div>
                )}
              </div>
            </div>

            {/* 4. CONDIÇÃO COMERCIAL ATIVA & RASCUNHO */}
            <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Condição Comercial
                </span>
                <Badge variant={data?.activeCondition ? "default" : "outline"}>
                  {data?.activeCondition ? "Condição Personalizada" : "Padrão"}
                </Badge>
              </div>

              {data?.activeCondition ? (
                <div className="text-sm space-y-1 bg-background/50 p-3 rounded-lg border border-border/50">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-xs">Tipo de Desconto:</span>
                    <span className="font-medium text-xs capitalize">
                      {data.activeCondition.pricingOverrideType === "percentage"
                        ? `${(data.activeCondition.pricingOverrideValue ?? 0) / 100}% Desconto`
                        : data.activeCondition.pricingOverrideType === "fixed_amount"
                        ? `Valor Fixo ${formatCentsToBRL(data.activeCondition.pricingOverrideValue)}`
                        : "Nenhum"}
                    </span>
                  </div>
                  {data.activeCondition.reason && (
                    <div className="text-xs text-muted-foreground pt-1 italic">
                      &quot;{data.activeCondition.reason}&quot;
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Esta unidade utiliza os termos comerciais padrão do catálogo ArkPet.
                </p>
              )}

              {/* Draft condition notice (Correction 8) */}
              {data?.draftCondition && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between font-semibold text-primary">
                    <span>Proposta em Rascunho</span>
                    <Badge variant="outline" className="text-[10px] uppercase border-primary/40">
                      Rascunho
                    </Badge>
                  </div>
                  <p className="text-foreground">
                    Preço proposto:{" "}
                    <span className="font-bold">
                      {formatCentsToBRL(data.draftCondition.proposedPricing?.finalEffectivePriceCents)}/mês
                    </span>
                  </p>
                  <p className="text-muted-foreground italic">{data.draftCondition.statusNotice}</p>
                </div>
              )}
            </div>

            {/* 5. STRIPE (Section 11: read-only connection indicators) */}
            <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-2">
              <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> Gateway Stripe (Leitura)
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div>
                  <span className="text-muted-foreground block">Stripe Customer:</span>
                  <span className={data?.subscription?.hasStripeCustomer ? "text-emerald-400 font-medium" : "text-muted-foreground"}>
                    {data?.subscription?.hasStripeCustomer ? "Vinculado" : "Não vinculado"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Stripe Subscription:</span>
                  <span className={data?.subscription?.hasStripeSubscription ? "text-emerald-400 font-medium" : "text-muted-foreground"}>
                    {data?.subscription?.hasStripeSubscription ? "Vinculado" : "Não vinculado"}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                Identificadores de infraestrutura Stripe. Preços recorrentes personalizados permanecem como rascunho até a ativação comercial do gateway (Slice 3).
              </p>
            </div>

            {/* Customization Subview */}
            {isCustomizing ? (
              <div className="rounded-xl border border-primary/40 p-5 bg-card space-y-4 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <h4 className="font-semibold text-base text-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" /> Personalizar Condição Comercial
                  </h4>
                  <Button size="sm" variant="ghost" onClick={() => setIsCustomizing(false)} className="text-xs">
                    Cancelar
                  </Button>
                </div>

                {mutationError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-destructive text-xs">
                    {mutationError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Pet Limit Input */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Limite de Pets</label>
                    <Input
                      type="number"
                      min={1}
                      value={petLimitInput}
                      onChange={(e) => setPetLimitInput(e.target.value)}
                      placeholder="Ex: 50"
                      className="h-11 text-base md:text-sm"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Atuais ativos: {activePetCount} pets.
                    </span>
                  </div>

                  {/* Pricing Override Type */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Tipo de Desconto</label>
                    <select
                      value={pricingTypeInput}
                      onChange={(e) => setPricingTypeInput(e.target.value as any)}
                      className="h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="none">Padrão (Sem desconto)</option>
                      <option value="percentage">Porcentagem (%)</option>
                      <option value="fixed_amount">Valor Fixo Mensal (R$)</option>
                    </select>
                  </div>

                  {/* Pricing Override Value */}
                  {pricingTypeInput !== "none" && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-xs font-semibold text-foreground">
                        {pricingTypeInput === "percentage" ? "Porcentagem de Desconto (ex: 15 para 15%)" : "Novo Valor Mensal em R$ (ex: 279,90)"}
                      </label>
                      <Input
                        type="text"
                        value={pricingValueInput}
                        onChange={(e) => setPricingValueInput(e.target.value)}
                        placeholder={pricingTypeInput === "percentage" ? "15" : "279,90"}
                        className="h-11 text-base md:text-sm"
                      />
                    </div>
                  )}

                  {/* Justification Reason */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold text-foreground">
                      Justificativa Comercial <span className="text-destructive">*</span>
                    </label>
                    <Textarea
                      rows={2}
                      value={reasonInput}
                      onChange={(e) => setReasonInput(e.target.value)}
                      placeholder="Descreva o motivo comercial (ex: Acordo de rede, expansão de baias, retenção)"
                      className="text-base md:text-sm"
                    />
                  </div>
                </div>

                {/* Lowering limit warning & confirmation */}
                {isLoweringLimit && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-amber-300 space-y-2 text-xs">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                      Atenção: Redução de Limite de Pets
                    </div>
                    <p>
                      O novo limite ({requestedPetLimitNum}) é inferior ao total de pets ativos ({activePetCount}).
                      Os pets existentes não serão excluídos, mas novos cadastros serão bloqueados até que o número de pets caia abaixo do limite.
                    </p>
                    <label className="flex items-center gap-2 pt-1 cursor-pointer font-medium text-foreground">
                      <input
                        type="checkbox"
                        checked={confirmLowering}
                        onChange={(e) => setConfirmLowering(e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      Confirmo a redução do limite abaixo dos pets ativos.
                    </label>
                  </div>
                )}

                {/* Simulation Preview Card */}
                {preview && (
                  <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-1">
                    <div className="font-semibold text-foreground flex items-center justify-between">
                      <span>Simulação de Preço</span>
                      {previewLoading && <RefreshCw className="h-3 w-3 animate-spin" />}
                    </div>
                    <div className="flex items-center gap-2 pt-1 text-sm">
                      <span className="text-muted-foreground line-through">
                        {formatCentsToBRL(preview.catalogPriceCents)}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-bold text-emerald-400">
                        {formatCentsToBRL(preview.proposedEffectivePriceCents)}/mês
                      </span>
                      {preview.discountPercentage > 0 && (
                        <Badge variant="secondary" className="text-[10px] ml-1">
                          -{preview.discountPercentage}%
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* Dynamic Submit Button */}
                <div className="pt-2 space-y-2">
                  <Button
                    onClick={handleSubmitMutation}
                    disabled={submitting || (isLoweringLimit && !confirmLowering)}
                    isLoading={submitting}
                    className="w-full h-11 min-h-[44px] text-sm font-semibold"
                  >
                    {isPricingModified ? "Salvar Rascunho Comercial" : "Aplicar Alteração"}
                  </Button>

                  {isPricingModified && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      A alteração de cobrança será aplicada após a etapa de sincronização com o Stripe.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full h-11 min-h-[44px] text-sm border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => setIsCustomizing(true)}
              >
                <Sparkles className="h-4 w-4 mr-2" /> Personalizar Condição Comercial
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
