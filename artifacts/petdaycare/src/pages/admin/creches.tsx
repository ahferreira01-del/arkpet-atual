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
  Pencil, ToggleLeft, ToggleRight, Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

export default function AdminCreches() {
  const queryClient = useQueryClient();
  const { data: creches, isLoading } = useListCreches();
  const createMutation = useCreateCreche();
  const updateMutation = useUpdateCreche();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editCreche, setEditCreche] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

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
          adminEmail: (fd.get("adminEmail") as string) || undefined,
          adminName: (fd.get("adminName") as string) || undefined,
          adminPassword: (fd.get("adminPassword") as string) || undefined,
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

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/creches/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      setDeleteTarget(null);
      queryClient.invalidateQueries();
    } catch (e: any) {
      alert(e?.message ?? "Erro ao excluir creche.");
    } finally {
      setDeleting(false);
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Total</p>
            <p className="text-3xl font-display font-bold text-white">{creches?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Ativas</p>
            <p className="text-3xl font-display font-bold text-emerald-400">
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
      </div>

      {/* Creche cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {isLoading ? (
          <div className="col-span-3 p-8 text-center text-muted-foreground">Carregando...</div>
        ) : creches?.length ? (
          creches.map((creche) => (
            <Card
              key={creche.id}
              className={`relative overflow-hidden transition-all hover:border-primary/30 ${creche.status === "inactive" ? "opacity-60" : ""}`}
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full" />
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <Badge variant={creche.status === "active" ? "success" : "secondary"}>
                    {creche.status === "active" ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
                <h3 className="text-xl font-display font-semibold text-white mb-3">{creche.name}</h3>
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
                <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(creche.createdAt), "dd/MM/yyyy")}
                  </p>
                  <div className="flex items-center gap-2">
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
                      variant="ghost"
                      onClick={() => handleOpenEdit(creche)}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => setDeleteTarget(creche)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-3">
            <EmptyState
              icon={Building2}
              title="Nenhuma creche cadastrada"
              description="Crie a primeira unidade da rede ArkPet."
              action={{ label: "Criar Creche", onClick: () => setIsCreateOpen(true) }}
            />
          </div>
        )}
      </div>

      {/* ── Create Creche Modal ── */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Cadastrar Nova Creche">
        <form onSubmit={handleCreate} className="space-y-4">
          <p className="text-sm text-muted-foreground pb-2 border-b border-white/10">Dados da Unidade</p>
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

          <p className="text-sm text-muted-foreground pt-2 pb-1 border-b border-white/10">Admin da Creche <span className="text-xs">(opcional)</span></p>
          <p className="text-xs text-muted-foreground">Se preenchido, cria o administrador automaticamente com senha provisória.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Admin</label>
              <Input name="adminName" placeholder="Ana Costa" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email do Admin</label>
              <Input name="adminEmail" type="email" placeholder="ana@arkpet.com.br" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Senha Provisória</label>
            <Input name="adminPassword" type="password" placeholder="Mín. 6 caracteres" />
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
                  className="w-full h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
                >
                  <option value="active">Ativa</option>
                  <option value="inactive">Inativa</option>
                </select>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3 border-t border-white/10">
              <Button variant="ghost" onClick={() => setEditCreche(null)}>Cancelar</Button>
              <Button onClick={handleSaveEdit} isLoading={updateMutation.isPending}>
                Salvar alterações
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Excluir Creche">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tem certeza que deseja excluir permanentemente a creche{" "}
              <span className="font-semibold text-white">{deleteTarget.name.trim()}</span>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="pt-2 flex justify-end gap-3 border-t border-white/10">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
              <Button
                onClick={handleDeleteConfirm}
                isLoading={deleting}
                className="bg-red-600 hover:bg-red-500 border-red-500/30 text-white"
              >
                <Trash2 className="h-4 w-4 mr-2" /> Excluir
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
