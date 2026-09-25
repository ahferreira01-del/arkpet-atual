import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Archive,
  Trash2,
  Plus,
  RefreshCw,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface PlanVersioningModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: {
    id: number;
    name: string;
    petLimit?: number;
    priceBrl?: number;
  } | null;
}

function formatCentsToBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatStorageBytes(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${val.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} ${sizes[i]}`;
}

export function PlanVersioningModal({ isOpen, onClose, plan }: PlanVersioningModalProps) {
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const isEnterprise = plan?.name?.toLowerCase() === "enterprise";

  // Form states for creating a new draft
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [petLimit, setPetLimit] = useState<number>(plan?.petLimit ?? 30);
  const [staffLimit, setStaffLimit] = useState<number>(3);
  const [isUnlimitedStaff, setIsUnlimitedStaff] = useState<boolean>(isEnterprise);
  const [storageGiB, setStorageGiB] = useState<number>(isEnterprise ? 100 : 5);
  const [monthPrice, setMonthPrice] = useState<number>(plan?.priceBrl ? plan.priceBrl / 100 : 99);
  const [quarterPrice, setQuarterPrice] = useState<number>(0);
  const [semesterPrice, setSemesterPrice] = useState<number>(0);
  const [yearPrice, setYearPrice] = useState<number>(0);
  const [versionName, setVersionName] = useState<string>("");

  // Form states for activation
  const [activatingVersionNumber, setActivatingVersionNumber] = useState<number | null>(null);
  const [changeReason, setChangeReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const fetchVersions = useCallback(async () => {
    if (!plan?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/commercial/plans/${plan.id}/versions`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Erro ao carregar versões (HTTP ${res.status})`);
      }
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Falha ao carregar versões do catálogo.");
    } finally {
      setLoading(false);
    }
  }, [plan?.id]);

  useEffect(() => {
    if (isOpen && plan?.id) {
      fetchVersions();
      setShowCreateForm(false);
      setActivatingVersionNumber(null);
      setChangeReason("");
      setActionSuccess(null);
      const isEnt = plan?.name?.toLowerCase() === "enterprise";
      setIsUnlimitedStaff(isEnt);
      setStaffLimit(isEnt ? 0 : 3);
      setStorageGiB(isEnt ? 100 : 5);
      setPetLimit(plan.petLimit ?? 30);
    }
  }, [isOpen, plan?.id, plan?.name, plan?.petLimit, fetchVersions]);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      const prices = [
        { interval: "month", priceBrl: Math.round(monthPrice * 100) },
      ];
      if (quarterPrice > 0) {
        prices.push({ interval: "quarter", priceBrl: Math.round(quarterPrice * 100) });
      }
      if (semesterPrice > 0) {
        prices.push({ interval: "semester", priceBrl: Math.round(semesterPrice * 100) });
      }
      if (yearPrice > 0) {
        prices.push({ interval: "year", priceBrl: Math.round(yearPrice * 100) });
      }

      const resolvedStaffLimit = isUnlimitedStaff ? null : Number(staffLimit);
      const resolvedStorageBytesLimit = Math.round(Number(storageGiB) * 1024 * 1024 * 1024);

      const res = await fetch(`/api/commercial/plans/${plan.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          petLimit: Number(petLimit),
          staffLimit: resolvedStaffLimit,
          storageBytesLimit: resolvedStorageBytesLimit,
          priceBrl: Math.round(monthPrice * 100),
          versionName: versionName.trim() || undefined,
          prices,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Erro ${res.status}`);
      }

      setActionSuccess("Novo rascunho de versão criado com sucesso!");
      setShowCreateForm(false);
      await fetchVersions();
    } catch (err: any) {
      setError(err?.message ?? "Falha ao criar rascunho de versão.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (versionNumber: number) => {
    if (!plan?.id || !changeReason.trim()) {
      setError("Informe o motivo da alteração para ativar a versão.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/commercial/plans/${plan.id}/versions/${versionNumber}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ changeReason: changeReason.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Erro ${res.status}`);
      }

      setActionSuccess(`Versão v${versionNumber} ativada com sucesso! Catálogo atualizado.`);
      setActivatingVersionNumber(null);
      setChangeReason("");
      await fetchVersions();
    } catch (err: any) {
      setError(err?.message ?? "Falha ao ativar versão.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (versionNumber: number) => {
    if (!plan?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/commercial/plans/${plan.id}/versions/${versionNumber}/archive`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Erro ${res.status}`);
      }

      setActionSuccess(`Versão v${versionNumber} arquivada.`);
      await fetchVersions();
    } catch (err: any) {
      setError(err?.message ?? "Falha ao arquivar versão.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDraft = async (versionNumber: number) => {
    if (!plan?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/commercial/plans/${plan.id}/versions/${versionNumber}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Erro ${res.status}`);
      }

      setActionSuccess(`Rascunho v${versionNumber} excluído.`);
      await fetchVersions();
    } catch (err: any) {
      setError(err?.message ?? "Falha ao excluir rascunho.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Gestão de Versões do Plano: ${plan?.name ?? ""}`}
    >
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        {error && (
          <div className="p-3 bg-destructive/15 border border-destructive/30 rounded-md text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {actionSuccess && (
          <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-md text-sm text-emerald-600 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Top actions bar */}
        <div className="flex items-center justify-between pt-1">
          <div className="text-sm text-muted-foreground">
            {versions.length} versão(ões) catalogada(s)
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={fetchVersions}
              disabled={loading || submitting}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            {!showCreateForm && (
              <Button
                size="sm"
                onClick={() => {
                  setShowCreateForm(true);
                  setActivatingVersionNumber(null);
                  setActionSuccess(null);
                }}
                disabled={submitting}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Criar Rascunho
              </Button>
            )}
          </div>
        </div>

        {/* Create Draft Form */}
        {showCreateForm && (
          <Card className="border-primary/30 bg-muted/40">
            <CardContent className="pt-4 space-y-3">
              <div className="font-semibold text-sm flex items-center gap-1.5 text-primary">
                <Layers className="h-4 w-4" />
                Novo Rascunho de Versão (DRAFT)
              </div>
              <form onSubmit={handleCreateDraft} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Nome da Versão (opcional)</label>
                    <Input
                      placeholder="Ex: Atualização 2026"
                      value={versionName}
                      onChange={(e) => setVersionName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Limite de Pets</label>
                    <Input
                      type="number"
                      min={1}
                      value={petLimit}
                      onChange={(e) => setPetLimit(Number(e.target.value))}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">Limite de Equipe (Staff)</label>
                      {isEnterprise && (
                        <label className="text-xs flex items-center gap-1 cursor-pointer text-primary">
                          <input
                            type="checkbox"
                            checked={isUnlimitedStaff}
                            onChange={(e) => setIsUnlimitedStaff(e.target.checked)}
                            className="rounded"
                          />
                          <span>Ilimitado</span>
                        </label>
                      )}
                    </div>
                    {isUnlimitedStaff ? (
                      <Input
                        disabled
                        value="Ilimitado (NULL)"
                        className="bg-muted text-muted-foreground mt-1"
                      />
                    ) : (
                      <Input
                        type="number"
                        min={0}
                        value={staffLimit}
                        onChange={(e) => setStaffLimit(Number(e.target.value))}
                        required={!isUnlimitedStaff}
                        className="mt-1"
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Limite Armazenamento (GiB)</label>
                    <Input
                      type="number"
                      min={1}
                      value={storageGiB}
                      onChange={(e) => setStorageGiB(Number(e.target.value))}
                      required
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Mensal (R$)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={monthPrice}
                      onChange={(e) => setMonthPrice(Number(e.target.value))}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Trimestral (R$)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={quarterPrice}
                      onChange={(e) => setQuarterPrice(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Semestral (R$)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={semesterPrice}
                      onChange={(e) => setSemesterPrice(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Anual (R$)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={yearPrice}
                      onChange={(e) => setYearPrice(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCreateForm(false)}
                    disabled={submitting}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" disabled={submitting}>
                    Salvar Rascunho
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Activation confirmation card */}
        {activatingVersionNumber !== null && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="pt-4 space-y-3">
              <div className="font-semibold text-sm flex items-center gap-1.5 text-amber-600">
                <Zap className="h-4 w-4" />
                Ativar Versão v{activatingVersionNumber} no Catálogo
              </div>
              <p className="text-xs text-muted-foreground">
                A ativação tornará esta versão o preço vigente para novas assinaturas e migrações.
                Assinaturas existentes permanecerão no preço contratado (grandfathered).
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Motivo da Alteração (obrigatório para auditoria)
                </label>
                <Textarea
                  placeholder="Descreva o motivo comercial da publicação desta versão..."
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActivatingVersionNumber(null)}
                  disabled={submitting}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={() => handleActivate(activatingVersionNumber)}
                  disabled={submitting || !changeReason.trim()}
                >
                  Confirmar e Publicar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Versions List */}
        <div className="space-y-2 pt-2">
          {versions.map((ver) => {
            const isDraft = ver.status === "DRAFT";
            const isActive = ver.status === "ACTIVE";
            const isSuperseded = ver.status === "SUPERSEDED";
            const isArchived = ver.status === "ARCHIVED";

            let statusBadge = (
              <Badge variant="outline" className="bg-muted text-muted-foreground">
                {ver.status}
              </Badge>
            );
            if (isActive) {
              statusBadge = (
                <Badge className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Ativa (Catálogo Vigente)
                </Badge>
              );
            } else if (isDraft) {
              statusBadge = (
                <Badge className="bg-blue-500/20 text-blue-600 border-blue-500/30">
                  <Clock className="h-3 w-3 mr-1" />
                  Rascunho (DRAFT)
                </Badge>
              );
            } else if (isSuperseded) {
              statusBadge = (
                <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30">
                  Substituída (SUPERSEDED)
                </Badge>
              );
            } else if (isArchived) {
              statusBadge = (
                <Badge className="bg-zinc-500/20 text-zinc-600 border-zinc-500/30">
                  <Archive className="h-3 w-3 mr-1" />
                  Arquivada
                </Badge>
              );
            }

            return (
              <Card key={ver.id} className="border shadow-none">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                          v{ver.versionNumber} {ver.versionName ? `(${ver.versionName})` : ""}
                        </span>
                        {statusBadge}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Limite Pets: <strong className="text-foreground">{ver.petLimit} pets</strong>
                        {" • "}
                        Equipe: <strong className="text-foreground">{ver.staffLimit === null ? "Ilimitado" : `${ver.staffLimit} membros`}</strong>
                        {" • "}
                        Armazenamento: <strong className="text-foreground">{formatStorageBytes(ver.storageBytesLimit)}</strong>
                        {" • "}
                        Preço Base: <strong className="text-foreground">{formatCentsToBRL(ver.priceBrl)}</strong>
                      </div>

                      {/* Interval prices breakdown */}
                      {ver.prices && ver.prices.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-xs pt-1">
                          {ver.prices.map((p: any) => (
                            <span key={p.id} className="bg-muted px-2 py-0.5 rounded text-muted-foreground">
                              {p.interval}: <span className="font-medium text-foreground">{formatCentsToBRL(p.priceBrl)}</span>
                              {p.stripePriceId && (
                                <span className="text-[10px] text-muted-foreground ml-1">({p.stripePriceId})</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Effective dates */}
                      <div className="text-[11px] text-muted-foreground pt-1">
                        {ver.effectiveFrom && (
                          <span>
                            Vigência: {format(new Date(ver.effectiveFrom), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </span>
                        )}
                        {ver.effectiveUntil && (
                          <span>
                            {" "}até {format(new Date(ver.effectiveUntil), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </span>
                        )}
                        {ver.changeReason && (
                          <div className="italic text-muted-foreground">
                            Motivo: &quot;{ver.changeReason}&quot;
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions on this version */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {isDraft && (
                        <>
                          <Button
                            size="sm"
                            className="bg-amber-600 hover:bg-amber-700 text-white h-7 text-xs"
                            onClick={() => {
                              setActivatingVersionNumber(ver.versionNumber);
                              setChangeReason("");
                              setShowCreateForm(false);
                            }}
                            disabled={submitting}
                          >
                            <Zap className="h-3 w-3 mr-1" />
                            Ativar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 text-xs"
                            onClick={() => handleDeleteDraft(ver.versionNumber)}
                            disabled={submitting}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Excluir
                          </Button>
                        </>
                      )}

                      {isSuperseded && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleArchive(ver.versionNumber)}
                          disabled={submitting}
                        >
                          <Archive className="h-3 w-3 mr-1" />
                          Arquivar
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
