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

  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Stripe Activation subviews & state
  const [isActivating, setIsActivating] = useState(false);
  const [activationProrationMode, setActivationProrationMode] = useState<"EFFECTIVE_NOW_PRORATE" | "EFFECTIVE_NOW_NO_PRORATION">("EFFECTIVE_NOW_PRORATE");
  const [activationReason, setActivationReason] = useState<string>("");
  const [activatingLoading, setActivatingLoading] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);

  const [isRetrying, setIsRetrying] = useState(false);
  const [retryReason, setRetryReason] = useState<string>("");
  const [retryingLoading, setRetryingLoading] = useState(false);

  const [isAbandoning, setIsAbandoning] = useState(false);
  const [abandonReason, setAbandonReason] = useState<string>("");
  const [abandoningLoading, setAbandoningLoading] = useState(false);

  const [isRepricing, setIsRepricing] = useState(false);
  const [repriceReason, setRepriceReason] = useState<string>("");
  const [repricingLoading, setRepricingLoading] = useState(false);

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
            billingInterval: data?.subscription?.billingInterval ?? "month",
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
            billingInterval: data?.subscription?.billingInterval ?? "month",
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

  const handleConfirmActivation = async () => {
    if (!creche || !data?.draftCondition?.condition?.id) return;
    if (!activationReason.trim()) {
      setActivationError("Justificativa obrigatória para ativação no Stripe.");
      return;
    }
    setActivatingLoading(true);
    setActivationError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/creches/${creche.id}/commercial/activate-condition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": generateUUID(),
        },
        body: JSON.stringify({
          conditionId: data.draftCondition.condition.id,
          prorationMode: activationProrationMode,
          reason: activationReason.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message || json?.error || `Erro HTTP ${res.status}`);
      }
      setSuccessNotice("Condição comercial ativada no Stripe com sucesso!");
      setIsActivating(false);
      fetchSupportData();
    } catch (err: any) {
      setActivationError(err.message || "Erro ao ativar condição no Stripe.");
    } finally {
      setActivatingLoading(false);
    }
  };

  const handleConfirmRetry = async () => {
    if (!creche || !data?.draftCondition?.condition?.id) return;
    if (!retryReason.trim()) {
      setActivationError("Justificativa obrigatória para retentativa.");
      return;
    }
    setRetryingLoading(true);
    setActivationError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/creches/${creche.id}/commercial/conditions/${data.draftCondition.condition.id}/retry-activation`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": generateUUID(),
          },
          body: JSON.stringify({
            reason: retryReason.trim(),
            prorationMode: activationProrationMode,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message || json?.error || `Erro HTTP ${res.status}`);
      }
      setSuccessNotice("Nova tentativa de ativação concluída com sucesso!");
      setIsRetrying(false);
      fetchSupportData();
    } catch (err: any) {
      setActivationError(err.message || "Erro ao tentar novamente ativação.");
    } finally {
      setRetryingLoading(false);
    }
  };

  const handleConfirmAbandon = async () => {
    if (!creche || !data?.draftCondition?.condition?.id) return;
    if (!abandonReason.trim()) {
      setActivationError("Justificativa obrigatória para abandonar proposta.");
      return;
    }
    setAbandoningLoading(true);
    setActivationError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/creches/${creche.id}/commercial/conditions/${data.draftCondition.condition.id}/abandon`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": generateUUID(),
          },
          body: JSON.stringify({
            reason: abandonReason.trim(),
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message || json?.error || `Erro HTTP ${res.status}`);
      }
      setSuccessNotice("Proposta comercial abandonada.");
      setIsAbandoning(false);
      fetchSupportData();
    } catch (err: any) {
      setActivationError(err.message || "Erro ao abandonar proposta.");
    } finally {
      setAbandoningLoading(false);
    }
  };

  const handleConfirmReprice = async () => {
    if (!creche || !data?.activeCondition?.id) return;
    if (!repriceReason.trim()) {
      setActivationError("Justificativa obrigatória para reconciliar cobrança.");
      return;
    }
    setRepricingLoading(true);
    setActivationError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/creches/${creche.id}/commercial/conditions/${data.activeCondition.id}/reprice-percentage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": generateUUID(),
          },
          body: JSON.stringify({
            reason: repriceReason.trim(),
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message || json?.error || `Erro HTTP ${res.status}`);
      }
      setSuccessNotice("Cobrança no Stripe reconciliada com sucesso!");
      setIsRepricing(false);
      fetchSupportData();
    } catch (err: any) {
      setActivationError(err.message || "Erro ao reconciliar cobrança.");
    } finally {
      setRepricingLoading(false);
    }
  };

  const intervalLabels: Record<string, string> = {
    month: "Mensal",
    quarter: "Trimestral",
    semester: "Semestral",
    year: "Anual",
  };
  const intervalSuffixMap: Record<string, string> = {
    month: "/mês",
    quarter: "/trimestre",
    semester: "/semestre",
    year: "/ano",
  };
  const currentInterval = data?.subscription?.billingInterval || "month";
  const currentIntervalSuffix = intervalSuffixMap[currentInterval] || "/mês";
  const currentIntervalLabel = intervalLabels[currentInterval] || "Mensal";
  const draftInterval = data?.draftCondition?.condition?.snapshotBillingInterval || currentInterval;
  const draftIntervalSuffix = intervalSuffixMap[draftInterval] || "/mês";
  const previewInterval = preview?.billingInterval || currentInterval;
  const previewIntervalSuffix = intervalSuffixMap[previewInterval] || "/mês";

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
              <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-success flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">Operação Concluída</p>
                  <p className="text-xs opacity-90 mt-0.5">{successNotice}</p>
                </div>
              </div>
            )}

            {/* Diagnostic Integrity Alert */}
            {data?.conditionIntegrityError && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-warning flex items-start gap-3">
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
                  <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
                    Assinatura não provisionada
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    {data?.subscription?.status ?? "Ativa"}
                  </Badge>
                )}
              </div>

              {data?.subscriptionState === "NOT_PROVISIONED" ? (
                <div className="text-xs text-muted-foreground bg-warning/5 p-3 rounded-lg border border-warning/20">
                  Esta unidade foi cadastrada sem uma assinatura vinculada. Serviços operacionais requerem provisionamento prévio.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs block">Plano Atual</span>
                    <span className="font-semibold text-foreground">{data?.plan?.name || "Padrão"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">Periodicidade</span>
                    <span className="font-semibold text-foreground">{currentIntervalLabel}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">Preço Catálogo</span>
                    <span className="font-medium text-muted-foreground">{formatCentsToBRL(data?.pricing?.catalogPriceCents)}{currentIntervalSuffix}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">Preço Efetivo Atual</span>
                    <span className="font-semibold text-success">{formatCentsToBRL(data?.pricing?.finalEffectivePriceCents)}{currentIntervalSuffix}</span>
                  </div>
                  {data?.subscription?.currentPeriodEnd && (
                    <div className="col-span-2 sm:col-span-4 text-xs text-muted-foreground pt-1 flex items-center gap-1">
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

              {/* Draft / Proposal condition card */}
              {data?.draftCondition && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5 text-xs space-y-2.5">
                  <div className="flex items-center justify-between font-semibold text-primary">
                    <span className="text-sm">
                      {data.draftCondition.condition.status === "activation_failed"
                        ? "Falha na Ativação Stripe"
                        : data.draftCondition.condition.status === "pending_activation"
                        ? "Ativação em Andamento"
                        : "Proposta em Rascunho"}
                    </span>
                    <Badge
                      variant={
                        data.draftCondition.condition.status === "activation_failed"
                          ? "destructive"
                          : data.draftCondition.condition.status === "pending_activation"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-[10px] uppercase"
                    >
                      {data.draftCondition.condition.status === "activation_failed"
                        ? "Falha"
                        : data.draftCondition.condition.status === "pending_activation"
                        ? "Processando"
                        : "Rascunho"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-foreground">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Tipo de Preço Proposto</span>
                      <span className="font-medium capitalize">
                        {data.draftCondition.condition.pricingOverrideType === "percentage"
                          ? `${(data.draftCondition.condition.pricingOverrideValue ?? 0) / 100}% de desconto`
                          : data.draftCondition.condition.pricingOverrideType === "fixed_amount"
                          ? `Valor Fixo ${formatCentsToBRL(data.draftCondition.condition.pricingOverrideValue)}`
                          : "Catálogo Padrão"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Preço Efetivo Proposto</span>
                      <span className="font-bold text-success text-sm">
                        {formatCentsToBRL(data.draftCondition.proposedPricing?.finalEffectivePriceCents)}{draftIntervalSuffix}
                      </span>
                    </div>
                  </div>

                  <p className="text-muted-foreground italic text-[11px]">{data.draftCondition.statusNotice}</p>

                  {/* Status: draft -> Activation action */}
                  {data.draftCondition.condition.status === "draft" && (
                    <div className="pt-2 border-t border-border/40 space-y-2">
                      <Button
                        size="sm"
                        disabled={!data.subscription?.hasStripeSubscription}
                        onClick={() => {
                          setActivationReason(data.draftCondition.condition.reason || "");
                          setActivationError(null);
                          setIsActivating(true);
                          setIsCustomizing(false);
                          setIsRetrying(false);
                          setIsAbandoning(false);
                        }}
                        className="w-full h-10 text-xs font-semibold"
                      >
                        Ativar no Stripe
                      </Button>
                      {!data.subscription?.hasStripeSubscription && (
                        <p className="text-[11px] text-warning/90 leading-tight">
                          Esta conta não possui uma assinatura recorrente Stripe vinculada e não pode receber ativação automática de preço neste momento.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Status: activation_failed -> Retry or Abandon */}
                  {data.draftCondition.condition.status === "activation_failed" && (
                    <div className="pt-2 border-t border-destructive/30 space-y-2">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRetryReason(data.draftCondition.condition.reason || "");
                            setActivationError(null);
                            setIsRetrying(true);
                            setIsActivating(false);
                            setIsCustomizing(false);
                            setIsAbandoning(false);
                          }}
                          className="flex-1 h-9 text-xs"
                        >
                          Tentar Novamente
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setAbandonReason(data.draftCondition.condition.reason || "");
                            setActivationError(null);
                            setIsAbandoning(true);
                            setIsActivating(false);
                            setIsCustomizing(false);
                            setIsRetrying(false);
                          }}
                          className="flex-1 h-9 text-xs"
                        >
                          Abandonar Proposta
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 5. STRIPE */}
            <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" /> Gateway Stripe (Leitura)
                </span>
                {data?.commercialStripeStatus && (
                  <Badge
                    variant={
                      data.commercialStripeStatus === "SYNCHRONIZED"
                        ? "default"
                        : data.commercialStripeStatus === "PENDING"
                        ? "secondary"
                        : "destructive"
                    }
                    className={
                      data.commercialStripeStatus === "SYNCHRONIZED"
                        ? "bg-success/20 text-success border-success/30 text-[10px]"
                        : data.commercialStripeStatus === "PENDING"
                        ? "bg-warning/20 text-warning border-warning/30 text-[10px]"
                        : "bg-destructive/20 text-destructive border-destructive/30 text-[10px]"
                    }
                  >
                    {data.commercialStripeStatus === "SYNCHRONIZED"
                      ? "Sincronizado"
                      : data.commercialStripeStatus === "PENDING"
                      ? "Pendente"
                      : data.commercialStripeStatus === "FAILED"
                      ? "Falha na Sincronização"
                      : "Divergente"}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div>
                  <span className="text-muted-foreground block">Stripe Customer:</span>
                  <span className={data?.subscription?.hasStripeCustomer ? "text-success font-medium" : "text-muted-foreground"}>
                    {data?.subscription?.hasStripeCustomer ? "Vinculado" : "Não vinculado"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Stripe Subscription:</span>
                  <span className={data?.subscription?.hasStripeSubscription ? "text-success font-medium" : "text-muted-foreground"}>
                    {data?.subscription?.hasStripeSubscription ? "Vinculado" : "Não vinculado"}
                  </span>
                </div>
              </div>

              {/* Bounded Percentage Reprice Warning & Action */}
              {data?.percentageRepriceNotice?.required && (
                <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-warning">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Valor Stripe desatualizado</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    O preço do catálogo para este plano foi alterado após a ativação. O valor cobrado no Stripe difere do percentual recalculado sobre a tabela vigente.
                  </p>
                  <div className="grid grid-cols-2 gap-2 bg-background/50 rounded p-2 text-[11px]">
                    <div>
                      <span className="text-muted-foreground block">Último valor sincronizado:</span>
                      <span className="font-semibold text-foreground">
                        {formatCentsToBRL(data.percentageRepriceNotice.lastSynchronizedAmountCents ?? 0)}{currentIntervalSuffix}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Valor Esperado (Catálogo):</span>
                      <span className="font-semibold text-success">
                        {formatCentsToBRL(data.percentageRepriceNotice.expectedEffectivePriceCents)}{currentIntervalSuffix}
                      </span>
                    </div>
                  </div>
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsRepricing(true);
                        setRepriceReason("Reconciliação de precificação percentual após alteração da tabela de catálogo.");
                        setActivationError(null);
                        setIsActivating(false);
                        setIsRetrying(false);
                        setIsAbandoning(false);
                        setIsCustomizing(false);
                      }}
                      className="h-8 text-xs font-semibold border-warning/40 text-warning hover:bg-warning/20"
                    >
                      Reconciliar cobrança
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Subviews: Repricing */}
            {isRepricing && (
              <div className="rounded-xl border border-warning/40 p-5 bg-card space-y-4 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <h4 className="font-semibold text-base text-foreground flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-warning" /> Reconciliar cobrança percentual no Stripe
                  </h4>
                  <Button size="sm" variant="ghost" onClick={() => setIsRepricing(false)} className="text-xs">
                    Cancelar
                  </Button>
                </div>

                {activationError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-destructive text-xs">
                    {activationError}
                  </div>
                )}

                <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs block">Último valor sincronizado</span>
                      <span className="font-medium text-foreground">
                        {formatCentsToBRL(data?.percentageRepriceNotice?.lastSynchronizedAmountCents || 0)}{currentIntervalSuffix}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="text-muted-foreground text-xs block">Novo Valor Reconciliado</span>
                      <span className="font-bold text-success">
                        {formatCentsToBRL(data?.percentageRepriceNotice?.expectedEffectivePriceCents || 0)}{currentIntervalSuffix}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Justificativa para Reconciliação <span className="text-destructive">*</span>
                  </label>
                  <Textarea
                    rows={2}
                    value={repriceReason}
                    onChange={(e) => setRepriceReason(e.target.value)}
                    placeholder="Descreva o motivo da reconciliação (ex: Atualização de tabela de preços do catálogo)"
                    className="text-base md:text-sm"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsRepricing(false)}
                    className="flex-1 h-11 text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConfirmReprice}
                    disabled={repricingLoading || !repriceReason.trim()}
                    isLoading={repricingLoading}
                    className="flex-1 h-11 text-xs font-semibold bg-warning text-warning-foreground hover:bg-warning/90"
                  >
                    Confirmar Reconciliação
                  </Button>
                </div>
              </div>
            )}

            {/* Subviews: Activating | Retrying | Abandoning | Customizing */}
            {isActivating ? (
              <div className="rounded-xl border border-primary/40 p-5 bg-card space-y-4 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <h4 className="font-semibold text-base text-foreground flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-primary" /> Confirmar Ativação no Stripe
                  </h4>
                  <Button size="sm" variant="ghost" onClick={() => setIsActivating(false)} className="text-xs">
                    Cancelar
                  </Button>
                </div>

                {activationError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-destructive text-xs">
                    {activationError}
                  </div>
                )}

                {/* Price Diff Card */}
                <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs block">Preço Atual</span>
                      <span className="font-medium text-foreground">
                        {formatCentsToBRL(data?.pricing?.finalEffectivePriceCents)}{currentIntervalSuffix}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <div className="text-right">
                      <span className="text-muted-foreground text-xs block">Novo Preço Recorrente</span>
                      <span className="font-bold text-success text-base">
                        {formatCentsToBRL(data?.draftCondition?.proposedPricing?.finalEffectivePriceCents)}{draftIntervalSuffix}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-1.5 flex justify-between">
                    <span>Periodicidade da Assinatura:</span>
                    <span className="font-semibold text-foreground">{intervalLabels[draftInterval] || draftInterval}</span>
                  </div>
                </div>

                {/* Proration Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Modo de Cobrança / Rateio Proporcional</label>
                  <select
                    value={activationProrationMode}
                    onChange={(e) => setActivationProrationMode(e.target.value as any)}
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="EFFECTIVE_NOW_PRORATE">
                      Aplicar agora com rateio proporcional (fatura imediata)
                    </option>
                    <option value="EFFECTIVE_NOW_NO_PRORATION">
                      Aplicar agora sem rateio (cobrança no próximo ciclo)
                    </option>
                  </select>
                </div>

                {/* Explicit Legal / Operational Notices */}
                <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-warning text-xs space-y-1">
                  <p className="font-medium text-foreground">Avisos Operacionais:</p>
                  <ul className="list-disc list-inside text-[11px] text-muted-foreground space-y-0.5">
                    <li>Esta alteração será aplicada somente a esta empresa.</li>
                    <li>A assinatura recorrente vinculada no Stripe será atualizada.</li>
                    <li>O plano padrão dos demais clientes não será alterado.</li>
                  </ul>
                </div>

                {/* Mandatory Justification */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Justificativa da Ativação <span className="text-destructive">*</span>
                  </label>
                  <Textarea
                    rows={2}
                    value={activationReason}
                    onChange={(e) => setActivationReason(e.target.value)}
                    placeholder="Descreva a justificativa comercial para a ativação deste preço no Stripe..."
                    className="text-base md:text-sm"
                  />
                </div>

                {/* Submit Action */}
                <div className="pt-2 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsActivating(false)}
                    disabled={activatingLoading}
                    className="flex-1 h-11 text-xs"
                  >
                    Voltar
                  </Button>
                  <Button
                    onClick={handleConfirmActivation}
                    disabled={activatingLoading || !activationReason.trim()}
                    isLoading={activatingLoading}
                    className="flex-1 h-11 text-xs font-semibold"
                  >
                    Confirmar Ativação no Stripe
                  </Button>
                </div>
              </div>
            ) : isRetrying ? (
              <div className="rounded-xl border border-destructive/40 p-5 bg-card space-y-4 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <h4 className="font-semibold text-base text-foreground flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-primary" /> Tentar Novamente Ativação no Stripe
                  </h4>
                  <Button size="sm" variant="ghost" onClick={() => setIsRetrying(false)} className="text-xs">
                    Cancelar
                  </Button>
                </div>

                {activationError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-destructive text-xs">
                    {activationError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Justificativa da Nova Tentativa <span className="text-destructive">*</span>
                  </label>
                  <Textarea
                    rows={2}
                    value={retryReason}
                    onChange={(e) => setRetryReason(e.target.value)}
                    placeholder="Justifique a nova tentativa de ativação..."
                    className="text-base md:text-sm"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsRetrying(false)}
                    disabled={retryingLoading}
                    className="flex-1 h-11 text-xs"
                  >
                    Voltar
                  </Button>
                  <Button
                    onClick={handleConfirmRetry}
                    disabled={retryingLoading || !retryReason.trim()}
                    isLoading={retryingLoading}
                    className="flex-1 h-11 text-xs font-semibold"
                  >
                    Confirmar Nova Tentativa
                  </Button>
                </div>
              </div>
            ) : isAbandoning ? (
              <div className="rounded-xl border border-destructive/40 p-5 bg-card space-y-4 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <h4 className="font-semibold text-base text-foreground flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-destructive" /> Abandonar Proposta Comercial
                  </h4>
                  <Button size="sm" variant="ghost" onClick={() => setIsAbandoning(false)} className="text-xs">
                    Cancelar
                  </Button>
                </div>

                {activationError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-destructive text-xs">
                    {activationError}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  A proposta com falha será arquivada e não poderá mais ser ativada. A condição comercial ativa anterior permanecerá em vigor.
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Motivo do Abandono <span className="text-destructive">*</span>
                  </label>
                  <Textarea
                    rows={2}
                    value={abandonReason}
                    onChange={(e) => setAbandonReason(e.target.value)}
                    placeholder="Justifique o motivo do abandono da proposta..."
                    className="text-base md:text-sm"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsAbandoning(false)}
                    disabled={abandoningLoading}
                    className="flex-1 h-11 text-xs"
                  >
                    Voltar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleConfirmAbandon}
                    disabled={abandoningLoading || !abandonReason.trim()}
                    isLoading={abandoningLoading}
                    className="flex-1 h-11 text-xs font-semibold"
                  >
                    Confirmar Abandono
                  </Button>
                </div>
              </div>
            ) : isCustomizing ? (
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
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3.5 text-warning space-y-2 text-xs">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
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
                      <span className="font-bold text-success">
                        {formatCentsToBRL(preview.proposedEffectivePriceCents)}{previewIntervalSuffix}
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
