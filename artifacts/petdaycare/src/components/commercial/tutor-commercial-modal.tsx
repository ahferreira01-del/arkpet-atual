import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListCatalogue } from "@/hooks/use-financial";
import {
  Tag,
  Plus,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Ban,
  ArrowRight,
  Info,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface TutorCommercialModalProps {
  isOpen: boolean;
  onClose: () => void;
  crecheId: number;
  tutorId: number;
  tutorName: string;
}

export type TutorConditionType = "CUSTOM_PRICE" | "PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT";

export function TutorCommercialModal({
  isOpen,
  onClose,
  crecheId,
  tutorId,
  tutorName,
}: TutorCommercialModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const [activeTab, setActiveTab] = useState<"list" | "create">("list");
  const [supersedeId, setSupersedeId] = useState<number | null>(null);

  // Form State
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [conditionType, setConditionType] = useState<TutorConditionType>("PERCENTAGE_DISCOUNT");
  const [inputValue, setInputValue] = useState<string>("");
  const [validFrom, setValidFrom] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [validUntil, setValidUntil] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Revoke state
  const [revokingConditionId, setRevokingConditionId] = useState<number | null>(null);
  const [revokeReason, setRevokeReason] = useState<string>("");
  const [isRevoking, setIsRevoking] = useState<boolean>(false);

  // Query Catalogue
  const { data: catalogue = [] } = useListCatalogue(crecheId);

  // Query Conditions for this tutor
  const {
    data: conditions = [],
    isLoading,
    refetch,
  } = useQuery<any[]>({
    queryKey: ["tutor-commercial-conditions", crecheId, tutorId],
    enabled: isOpen && !!crecheId && !!tutorId,
    queryFn: async () => {
      const res = await fetch(
        `/api/creches/${crecheId}/tutors/${tutorId}/commercial-conditions`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) {
        throw new Error("Erro ao carregar condições comerciais do tutor.");
      }
      return res.json();
    },
  });

  const resetForm = () => {
    setSelectedItemId("");
    setConditionType("PERCENTAGE_DISCOUNT");
    setInputValue("");
    setValidFrom(new Date().toISOString().split("T")[0]);
    setValidUntil("");
    setReason("");
    setPreviewResult(null);
    setSupersedeId(null);
    setFormError(null);
  };

  const handleSimulatePreview = async () => {
    if (!selectedItemId) {
      setFormError("Selecione um item do catálogo para simular.");
      return;
    }
    if (!inputValue) {
      setFormError("Informe o valor da condição para simular.");
      return;
    }

    const numVal = parseFloat(inputValue.replace(",", "."));
    if (isNaN(numVal) || numVal < 0) {
      setFormError("Informe um valor numérico válido.");
      return;
    }

    setFormError(null);
    setIsPreviewLoading(true);

    try {
      const body: any = {
        catalogueItemId: parseInt(selectedItemId, 10),
        conditionType,
      };

      if (conditionType === "PERCENTAGE_DISCOUNT") {
        body.percentageBps = Math.round(numVal * 100);
      } else if (conditionType === "FIXED_DISCOUNT") {
        body.fixedDiscountCents = Math.round(numVal * 100);
      } else if (conditionType === "CUSTOM_PRICE") {
        body.customPriceCents = Math.round(numVal * 100);
      }

      const res = await fetch(
        `/api/creches/${crecheId}/tutors/${tutorId}/commercial-conditions/preview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao simular cálculo da condição.");
      }

      const sim = await res.json();
      setPreviewResult(sim);
    } catch (err: any) {
      setFormError(err.message || "Falha na simulação.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Mutation for creating / superseding
  const createMutation = useMutation({
    mutationFn: async () => {
      const numVal = parseFloat(inputValue.replace(",", "."));
      if (isNaN(numVal) || numVal < 0) {
        throw new Error("Valor da condição inválido.");
      }
      if (!reason.trim()) {
        throw new Error("O motivo da condição comercial é obrigatório.");
      }

      const idempotencyKey = crypto.randomUUID();
      const body: any = {
        catalogueItemId: parseInt(selectedItemId, 10),
        conditionType,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        reason: reason.trim(),
        idempotencyKey,
      };

      if (conditionType === "PERCENTAGE_DISCOUNT") {
        body.percentageBps = Math.round(numVal * 100);
      } else if (conditionType === "FIXED_DISCOUNT") {
        body.fixedDiscountCents = Math.round(numVal * 100);
      } else if (conditionType === "CUSTOM_PRICE") {
        body.customPriceCents = Math.round(numVal * 100);
      }

      const url = supersedeId
        ? `/api/creches/${crecheId}/tutors/${tutorId}/commercial-conditions/${supersedeId}/supersede`
        : `/api/creches/${crecheId}/tutors/${tutorId}/commercial-conditions`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao gravar condição comercial.");
      }

      return res.json();
    },
    onSuccess: () => {
      toast({
        title: supersedeId ? "Condição substituída" : "Condição comercial criada",
        description: "A condição comercial foi registrada com sucesso.",
      });
      queryClient.invalidateQueries({
        queryKey: ["tutor-commercial-conditions", crecheId, tutorId],
      });
      resetForm();
      setActiveTab("list");
    },
    onError: (err: any) => {
      setFormError(err.message || "Erro ao salvar condição.");
      toast({
        variant: "destructive",
        title: "Erro ao registrar condição",
        description: err.message || "Ocorreu um erro ao processar a requisição.",
      });
    },
  });

  const handleRevoke = async (conditionId: number) => {
    if (!revokeReason.trim()) {
      toast({
        variant: "destructive",
        title: "Motivo obrigatório",
        description: "Informe o motivo da revogação da condição comercial.",
      });
      return;
    }

    setIsRevoking(true);
    const idempotencyKey = crypto.randomUUID();

    try {
      const res = await fetch(
        `/api/creches/${crecheId}/tutors/${tutorId}/commercial-conditions/${conditionId}/revoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            reason: revokeReason.trim(),
            idempotencyKey,
          }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao revogar condição comercial.");
      }

      toast({
        title: "Condição revogada",
        description: "A condição comercial foi revogada com sucesso.",
      });

      setRevokingConditionId(null);
      setRevokeReason("");
      queryClient.invalidateQueries({
        queryKey: ["tutor-commercial-conditions", crecheId, tutorId],
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erro na revogação",
        description: err.message,
      });
    } finally {
      setIsRevoking(false);
    }
  };

  const startSupersede = (cond: any) => {
    setSupersedeId(cond.id);
    setSelectedItemId(String(cond.catalogueItemId));
    setConditionType(cond.conditionType);
    if (cond.conditionType === "PERCENTAGE_DISCOUNT" && cond.percentageBps != null) {
      setInputValue((cond.percentageBps / 100).toString());
    } else if (cond.conditionType === "FIXED_DISCOUNT" && cond.fixedDiscountCents != null) {
      setInputValue((cond.fixedDiscountCents / 100).toFixed(2));
    } else if (cond.conditionType === "CUSTOM_PRICE" && cond.customPriceCents != null) {
      setInputValue((cond.customPriceCents / 100).toFixed(2));
    }
    setValidFrom(new Date().toISOString().split("T")[0]);
    setValidUntil("");
    setReason(`Substituição da condição #${cond.id}`);
    setActiveTab("create");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-success/20 text-success border-success/30">Ativa</Badge>;
      case "SCHEDULED":
        return <Badge variant="secondary">Agendada</Badge>;
      case "SUPERSEDED":
        return <Badge variant="secondary" className="opacity-70">Substituída</Badge>;
      case "REVOKED":
        return <Badge variant="destructive">Revogada</Badge>;
      case "EXPIRED":
        return <Badge variant="outline" className="opacity-70">Expirada</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getConditionLabel = (cond: any) => {
    if (cond.conditionType === "PERCENTAGE_DISCOUNT") {
      return `${(cond.percentageBps || 0) / 100}% de desconto`;
    }
    if (cond.conditionType === "FIXED_DISCOUNT") {
      return `Desconto fixo de R$ ${((cond.fixedDiscountCents || 0) / 100).toFixed(2)}`;
    }
    if (cond.conditionType === "CUSTOM_PRICE") {
      return `Preço fixo de R$ ${((cond.customPriceCents || 0) / 100).toFixed(2)}`;
    }
    return cond.conditionType;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Condições Comerciais — ${tutorName}`}
      description="Preços diferenciados e descontos acordados individualmente com este tutor."
      className="max-w-2xl"
    >
      <div className="space-y-4 mt-2">
        {/* Contractual disclaimer */}
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-start gap-2.5 text-xs text-warning">
          <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-warning">Aviso Contratual Importante</p>
            <p className="text-muted-foreground mt-0.5">
              Esta condição não altera cobranças já emitidas. O benefício passa a valer para novas contratações no período acordado.
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 border-b border-border pb-2">
          <Button
            type="button"
            variant={activeTab === "list" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTab("list");
              setSupersedeId(null);
            }}
            className="text-xs"
          >
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            Condições ({conditions.length})
          </Button>
          <Button
            type="button"
            variant={activeTab === "create" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              resetForm();
              setActiveTab("create");
            }}
            className="text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {supersedeId ? "Substituir Condição" : "Nova Condição"}
          </Button>
        </div>

        {/* Tab: List */}
        {activeTab === "list" && (
          <div className="space-y-3">
            {isLoading ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Carregando condições comerciais...
              </div>
            ) : conditions.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="Nenhuma condição comercial cadastrada"
                description='Este tutor paga os valores padrão do catálogo. Clique em "Nova Condição" para definir um valor diferenciado.'
              />
            ) : (
              <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                {conditions.map((cond: any) => (
                  <div
                    key={cond.id}
                    className="p-3.5 rounded-xl bg-secondary/50 border border-border flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">
                            {cond.itemName || `Item #${cond.catalogueItemId}`}
                          </span>
                          {getStatusBadge(cond.status)}
                        </div>
                        <p className="text-xs font-medium text-primary mt-0.5">
                          {getConditionLabel(cond)}
                        </p>
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        <div>
                          Vigência:{" "}
                          {format(new Date(cond.validFrom), "dd/MM/yyyy", { locale: ptBR })}
                          {cond.validUntil
                            ? ` até ${format(new Date(cond.validUntil), "dd/MM/yyyy", { locale: ptBR })}`
                            : " (indeterminado)"}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground bg-background/60 rounded-lg p-2 border border-border/40">
                      <span className="font-medium text-foreground">Motivo:</span> {cond.reason}
                    </div>

                    {(cond.status === "ACTIVE" || cond.status === "SCHEDULED") && (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => startSupersede(cond)}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Substituir
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => {
                            setRevokingConditionId(cond.id);
                            setRevokeReason("");
                          }}
                        >
                          <Ban className="h-3 w-3 mr-1" />
                          Revogar
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Revoke dialog */}
            {revokingConditionId && (
              <div className="mt-4 p-4 rounded-xl bg-destructive/10 border border-destructive/30 space-y-3">
                <div className="flex items-center gap-2 text-destructive text-sm font-semibold">
                  <Ban className="h-4 w-4" />
                  Confirmar revogação da condição #{revokingConditionId}
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Motivo da revogação (obrigatório para auditoria)
                  </label>
                  <textarea
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="Ex: Acordo comercial renegociado ou cancelado pelo cliente..."
                    rows={2}
                    className="w-full text-xs p-2.5 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setRevokingConditionId(null)}
                    disabled={isRevoking}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => handleRevoke(revokingConditionId)}
                    disabled={isRevoking || !revokeReason.trim()}
                  >
                    {isRevoking ? "Revogando..." : "Confirmar Revogação"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: Create / Supersede Form */}
        {activeTab === "create" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-4"
          >
            {supersedeId && (
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 flex items-center gap-2 text-xs text-foreground">
                <RefreshCw className="h-4 w-4 text-primary shrink-0" />
                <span>
                  Você está <strong>substituindo</strong> a condição anterior #{supersedeId}. A anterior será arquivada e não haverá sobreposição de datas.
                </span>
              </div>
            )}

            {formError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-xs text-destructive flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Item selection */}
              <div>
                <label htmlFor="tutorCommercialItemId" className="block text-xs font-medium text-foreground mb-1">
                  Item do Catálogo *
                </label>
                <select
                  id="tutorCommercialItemId"
                  value={selectedItemId}
                  onChange={(e) => {
                    setSelectedItemId(e.target.value);
                    setPreviewResult(null);
                  }}
                  disabled={!!supersedeId}
                  className="w-full text-xs p-2.5 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="">Selecione o item...</option>
                  {catalogue.map((item: any) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.type === "service" ? "Serviço" : item.type === "package" ? "Pacote" : item.type === "day_use" ? "Day Use" : "Produto"}) - Base: R$ {Number(item.basePrice || 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Condition type */}
              <div>
                <label htmlFor="tutorCommercialConditionType" className="block text-xs font-medium text-foreground mb-1">
                  Tipo de Condição *
                </label>
                <select
                  id="tutorCommercialConditionType"
                  value={conditionType}
                  onChange={(e) => {
                    setConditionType(e.target.value as TutorConditionType);
                    setPreviewResult(null);
                  }}
                  className="w-full text-xs p-2.5 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="PERCENTAGE_DISCOUNT">Desconto Percentual (%)</option>
                  <option value="FIXED_DISCOUNT">Desconto Fixo (R$)</option>
                  <option value="CUSTOM_PRICE">Preço Fixo Customizado (R$)</option>
                </select>
              </div>
            </div>

            {/* Value Input */}
            <div>
              <label htmlFor="tutorCommercialValue" className="block text-xs font-medium text-foreground mb-1">
                {conditionType === "PERCENTAGE_DISCOUNT"
                  ? "Percentual de Desconto (%) *"
                  : conditionType === "FIXED_DISCOUNT"
                  ? "Valor do Desconto (R$) *"
                  : "Novo Preço Fixo (R$) *"}
              </label>
              <div className="flex gap-2">
                <Input
                  id="tutorCommercialValue"
                  type="text"
                  placeholder={
                    conditionType === "PERCENTAGE_DISCOUNT" ? "Ex: 10 (para 10%)" : "Ex: 45.00"
                  }
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setPreviewResult(null);
                  }}
                  className="text-xs h-9"
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSimulatePreview}
                  disabled={isPreviewLoading || !selectedItemId || !inputValue}
                  className="text-xs whitespace-nowrap"
                >
                  {isPreviewLoading ? "Simulando..." : "Simular Preço"}
                </Button>
              </div>
            </div>

            {/* Live simulation box */}
            {previewResult && (
              <div className="p-3 bg-secondary/80 border border-border rounded-xl space-y-1.5 text-xs">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  Simulação Autorizada pelo Servidor
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/50 text-[11px]">
                  <div>
                    <span className="text-muted-foreground block">Preço Catálogo:</span>
                    <span className="font-medium text-foreground">
                      R$ {previewResult.baseUnitPrice}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Desconto Unitário:</span>
                    <span className="font-medium text-success">
                      - R$ {previewResult.unitDiscount}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Preço Final Tutor:</span>
                    <span className="font-bold text-primary text-sm">
                      R$ {previewResult.effectiveUnitPrice}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="tutorCommercialValidFrom" className="block text-xs font-medium text-foreground mb-1">
                  Início da Vigência *
                </label>
                <Input
                  id="tutorCommercialValidFrom"
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  className="text-xs h-9"
                  required
                />
              </div>
              <div>
                <label htmlFor="tutorCommercialValidUntil" className="block text-xs font-medium text-foreground mb-1">
                  Fim da Vigência (opcional)
                </label>
                <Input
                  id="tutorCommercialValidUntil"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  placeholder="Indeterminado se vazio"
                  className="text-xs h-9"
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label htmlFor="tutorCommercialReason" className="block text-xs font-medium text-foreground mb-1">
                Motivo / Justificativa Comercial *
              </label>
              <textarea
                id="tutorCommercialReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex: Parceria corporativa, acordo de 3 pets da mesma família, condição especial de fidelidade..."
                rows={2}
                className="w-full text-xs p-2.5 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetForm();
                  setActiveTab("list");
                }}
                disabled={createMutation.isPending}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createMutation.isPending || !selectedItemId || !inputValue || !reason.trim()}
                className="text-xs"
              >
                {createMutation.isPending
                  ? "Salvando..."
                  : supersedeId
                  ? "Confirmar Substituição"
                  : "Salvar Condição Comercial"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
