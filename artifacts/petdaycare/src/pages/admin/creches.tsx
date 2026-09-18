import React, { useState } from "react";
import { useListCreches, useCreateCreche, useUpdateCreche } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Building2, Plus, MapPin, Phone, Users, Mail,
  Pencil, ToggleLeft, ToggleRight, Trash2, CreditCard,
  RotateCcw, Archive, AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { CommercialSupportModal } from "./commercial-support-modal";

export default function AdminCreches() {
  const queryClient = useQueryClient();
  const { data: creches, isLoading } = useListCreches();
  const createMutation = useCreateCreche();
  const updateMutation = useUpdateCreche();

  const [selectedTab, setSelectedTab] = useState<"all" | "active" | "inactive" | "archived">("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editCreche, setEditCreche] = useState<any | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<any | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState<{ code?: string; message?: string } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [supportCreche, setSupportCreche] = useState<any | null>(null);

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: "", address: "", phone: "", email: "", maxCapacity: 20, status: "active",
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate(
      {
        data: {
          name: fd.get("name") as string,
          address: fd.get("address") as string,
          phone: fd.get("phone") as string,
          email: fd.get("email") as string,
          maxCapacity: Number(fd.get("maxCapacity")) || 20,
          adminEmail: fd.get("adminEmail") as string,
          adminName: fd.get("adminName") as string,
          adminPassword: fd.get("adminPassword") as string,
        } as any,
      },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  const handleOpenEdit = (creche: any) => {
    setEditCreche(creche);
    setEditForm({
      name: creche.name || "",
      address: creche.address || "",
      phone: creche.phone || "",
      email: creche.email || "",
      maxCapacity: creche.maxCapacity || 20,
      status: creche.status || "active",
    });
  };

  const handleSaveEdit = () => {
    if (!editCreche) return;
    updateMutation.mutate(
      { crecheId: editCreche.id, data: editForm as any },
      {
        onSuccess: () => {
          setEditCreche(null);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  const handleOpenArchive = (creche: any) => {
    setArchiveTarget(creche);
    setArchiveReason("");
    setArchiveError(null);
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    if (!archiveReason.trim() || archiveReason.trim().length < 5) {
      setArchiveError({ message: "Informe um motivo de pelo menos 5 caracteres para o arquivamento." });
      return;
    }
    setArchiving(true);
    setArchiveError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/creches/${archiveTarget.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: archiveReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setArchiveError({
          code: data.code,
          message: data.error || data.message || `Erro HTTP ${res.status}`,
        });
        return;
      }
      setArchiveTarget(null);
      queryClient.invalidateQueries();
    } catch (e: any) {
      setArchiveError({ message: e?.message ?? "Erro de conexão ao arquivar creche." });
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async (creche: any) => {
    setRestoringId(creche.id);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/creches/${creche.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || data.message || "Erro ao restaurar creche.");
        return;
      }
      queryClient.invalidateQueries();
    } catch (e: any) {
      alert(e?.message ?? "Erro de conexão ao restaurar creche.");
    } finally {
      setRestoringId(null);
    }
  };

  const handleToggleStatus = (creche: any) => {
    updateMutation.mutate(
      {
        crecheId: creche.id,
        data: { status: creche.status === "active" ? "inactive" : "active" } as any,
      },
      { onSuccess: () => queryClient.invalidateQueries() }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Creches"
        description="Gerencie todas as unidades da rede ArkPet."
        icon={Building2}
        action={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Nova Creche</span>
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Total</p>
            <p className="text-3xl font-display font-bold text-foreground">{creches?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Ativas</p>
            <p className="text-3xl font-display font-bold text-success">
              {creches?.filter((c) => c.status === "active").length || 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Inativas</p>
            <p className="text-3xl font-display font-bold text-muted-foreground">
              {creches?.filter((c) => c.status === "inactive").length || 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Arquivadas</p>
            <p className="text-3xl font-display font-bold text-amber-500">
              {creches?.filter((c) => (c.status as string) === "archived").length || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2 overflow-x-auto">
        <Button
          variant={selectedTab === "all" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSelectedTab("all")}
        >
          Todas ({creches?.length || 0})
        </Button>
        <Button
          variant={selectedTab === "active" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSelectedTab("active")}
        >
          Ativas ({creches?.filter((c) => c.status === "active").length || 0})
        </Button>
        <Button
          variant={selectedTab === "inactive" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSelectedTab("inactive")}
        >
          Inativas ({creches?.filter((c) => c.status === "inactive").length || 0})
        </Button>
        <Button
          variant={selectedTab === "archived" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSelectedTab("archived")}
        >
          Arquivadas ({creches?.filter((c) => (c.status as string) === "archived").length || 0})
        </Button>
      </div>

      {/* Creche cards */}
      {(() => {
        const filteredCreches = creches?.filter((c) => {
          if (selectedTab === "all") return true;
          return (c.status as string) === selectedTab;
        });

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {isLoading ? (
              <div className="col-span-3 p-8 text-center text-muted-foreground">Carregando...</div>
            ) : filteredCreches?.length ? (
              filteredCreches.map((creche) => {
                const isArchived = (creche.status as string) === "archived";
                return (
                  <Card
                    key={creche.id}
                    className={`relative overflow-hidden transition-all hover:border-primary/30 ${
                      creche.status === "inactive" ? "opacity-60" : ""
                    } ${isArchived ? "opacity-75 border-dashed border-amber-500/40 bg-amber-500/5" : ""}`}
                  >
                    <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full" />
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
                          <Building2 className="h-6 w-6 text-primary" />
                        </div>
                        {isArchived ? (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10">
                            Arquivada
                          </Badge>
                        ) : (
                          <Badge variant={creche.status === "active" ? "success" : "secondary"}>
                            {creche.status === "active" ? "Ativa" : "Inativa"}
                          </Badge>
                        )}
                      </div>
                      <h3 className="text-xl font-display font-semibold text-foreground mb-3">{creche.name}</h3>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        {creche.address && (
                          <p className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 flex-shrink-0" /> {creche.address}
                          </p>
                        )}
                        {creche.phone && (
                          <p className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5 flex-shrink-0" /> {creche.phone}
                          </p>
                        )}
                        {creche.email && (
                          <p className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5 flex-shrink-0" /> {creche.email}
                          </p>
                        )}
                        <p className="flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 flex-shrink-0" />
                          Ocupação: {creche.currentOccupancy}/{creche.maxCapacity}
                        </p>
                      </div>

                      {/* Action bar */}
                      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(creche.createdAt), "dd/MM/yyyy")}
                        </p>
                        <div className="flex items-center gap-2">
                          {isArchived ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs px-2.5"
                              onClick={() => handleRestore(creche)}
                              isLoading={restoringId === creche.id}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restaurar
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className={
                                  creche.status === "active"
                                    ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs px-2.5"
                                    : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs px-2.5"
                                }
                                onClick={() => handleToggleStatus(creche)}
                                isLoading={updateMutation.isPending}
                              >
                                {creche.status === "active"
                                  ? <><ToggleRight className="h-3.5 w-3.5 mr-1" /> Desativar</>
                                  : <><ToggleLeft className="h-3.5 w-3.5 mr-1" /> Ativar</>}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-primary/40 text-primary hover:bg-primary/10 text-xs px-2.5"
                                onClick={() => setSupportCreche(creche)}
                                aria-label={`Gerenciar suporte para ${creche.name}`}
                              >
                                <CreditCard className="h-3.5 w-3.5 mr-1" /> Suporte
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleOpenEdit(creche)}
                              >
                                <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
                                onClick={() => handleOpenArchive(creche)}
                                title="Arquivar Creche"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            ) : (
              <div className="col-span-3">
                <EmptyState
                  icon={Building2}
                  title="Nenhuma creche encontrada"
                  description={
                    selectedTab === "archived"
                      ? "Nenhuma creche arquivada no momento."
                      : "Crie uma nova creche na rede ArkPet."
                  }
                  action={selectedTab !== "archived" ? { label: "Criar Creche", onClick: () => setIsCreateOpen(true) } : undefined}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Create Creche Modal ── */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Cadastrar Nova Creche">
        <form onSubmit={handleCreate} className="space-y-4">
          <p className="text-sm text-muted-foreground pb-2 border-b border-border">Dados da Unidade</p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome da Creche</label>
            <Input name="name" required placeholder="Pet Paradise São Paulo" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Endereço
            </label>
            <Input name="address" required placeholder="Rua das Flores, 123 — São Paulo/SP" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> Telefone
              </label>
              <Input name="phone" required placeholder="(11) 99999-9999" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Email
              </label>
              <Input name="email" type="email" required placeholder="creche@arkpet.com.br" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Capacidade Máxima
            </label>
            <Input name="maxCapacity" type="number" min={1} max={500} defaultValue={20} />
          </div>

          <p className="text-sm text-muted-foreground pt-2 pb-1 border-b border-border">
            Administrador Inicial (Proprietário Principal) <span className="text-destructive font-medium">*</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Obrigatório para provisionamento atômico e governança multi-tenant (GAP-01).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Admin *</label>
              <Input name="adminName" required placeholder="Ana Costa" minLength={2} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email do Admin *</label>
              <Input name="adminEmail" type="email" required placeholder="ana@arkpet.com.br" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Senha Provisória *</label>
            <Input name="adminPassword" type="password" required minLength={6} placeholder="Mín. 6 caracteres" />
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              <Building2 className="mr-2 h-4 w-4" /> Criar Creche
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit Creche Modal ── */}
      {editCreche && (
        <Modal isOpen={!!editCreche} onClose={() => setEditCreche(null)} title={`Editar: ${editCreche.name}`}>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da Creche</label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nome da creche"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Endereço
              </label>
              <Input
                value={editForm.address}
                onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Endereço completo"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" /> Telefone
                </label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="(11) 99999-9999"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email
                </label>
                <Input
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="creche@arkpet.com.br"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Capacidade Máxima
                </label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={editForm.maxCapacity}
                  onChange={(e) => setEditForm((f) => ({ ...f, maxCapacity: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
                >
                  <option value="active">Ativa</option>
                  <option value="inactive">Inativa</option>
                </select>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3 border-t border-border">
              <Button variant="ghost" onClick={() => setEditCreche(null)}>Cancelar</Button>
              <Button onClick={handleSaveEdit} isLoading={updateMutation.isPending}>
                Salvar alterações
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Archive Confirmation Modal ── */}
      {archiveTarget && (
        <Modal isOpen={!!archiveTarget} onClose={() => setArchiveTarget(null)} title="Arquivar Creche">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A creche{" "}
              <span className="font-semibold text-foreground">{archiveTarget.name.trim()}</span>{" "}
              será arquivada. Esta ação desabilita operações cotidianas e bloqueia o acesso dos usuários vinculados.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Motivo do Arquivamento (Obrigatório) *
              </label>
              <Input
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="Ex.: Encerramento de atividades pelo proprietário"
                minLength={5}
              />
              <p className="text-xs text-muted-foreground">
                Registrado de forma auditável e indelével no log comercial da plataforma.
              </p>
            </div>

            {archiveError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 flex items-start gap-2.5">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium">Arquivamento Bloqueado (SAAS-BR-003):</p>
                  <p className="text-xs text-red-300">
                    {archiveError.code === "stripe_subscription_active" &&
                      "A creche possui assinatura Stripe ativa ou em atraso. Cancele no gateway antes de arquivar."}
                    {archiveError.code === "tenant_archive_open_invoice" &&
                      "Existem faturas de tutores pendentes ou vencidas. Regularize ou cancele as faturas."}
                    {archiveError.code === "tenant_archive_future_booking" &&
                      "Existem reservas futuras ou ativas. Cancele ou conclua as reservas antes de arquivar."}
                    {archiveError.code === "tenant_archive_active_checkin" &&
                      "Existem pets com check-in ativo na creche. Conclua o check-out antes de arquivar."}
                    {archiveError.code === "tenant_archive_positive_credit" &&
                      "Existem tutores com saldo positivo de diárias/créditos não consumidos."}
                    {!["stripe_subscription_active", "tenant_archive_open_invoice", "tenant_archive_future_booking", "tenant_archive_active_checkin", "tenant_archive_positive_credit"].includes(archiveError.code || "") &&
                      (archiveError.message || "Condições impeditivas detectadas.")}
                  </p>
                </div>
              </div>
            )}

            <div className="pt-3 flex justify-end gap-3 border-t border-border">
              <Button variant="ghost" onClick={() => setArchiveTarget(null)}>Cancelar</Button>
              <Button
                onClick={handleArchiveConfirm}
                isLoading={archiving}
                disabled={archiveReason.trim().length < 5}
                className="bg-amber-600 hover:bg-amber-500 border-amber-500/30 text-white"
              >
                <Archive className="h-4 w-4 mr-2" /> Confirmar Arquivamento
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Commercial Support & Overrides Console Modal (R36.D) ── */}
      {supportCreche && (
        <CommercialSupportModal
          isOpen={Boolean(supportCreche)}
          onClose={() => setSupportCreche(null)}
          creche={supportCreche}
        />
      )}
    </div>
  );
}
