import React, { useState } from "react";
import { useListCrecheStaff, useAddStaffMember } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, Plus, Mail, Shield, Pencil, UserX, UserCheck, AlertTriangle } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const roleColors: Record<string, string> = {
  creche_admin: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  staff: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  tutor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

const roleLabel: Record<string, string> = {
  creche_admin: "Admin",
  staff: "Funcionário",
  tutor: "Tutor",
};

type StaffMember = {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive?: boolean;
};

function EditMemberModal({
  member,
  onClose,
  crecheId,
}: {
  member: StaffMember;
  onClose: () => void;
  crecheId: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (data: { name?: string; role?: string; isActive?: boolean }) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/users/${member.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Erro ao atualizar usuário");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Membro atualizado com sucesso!" });
      onClose();
    },
    onError: () => {
      toast({ title: "Erro", description: "Não foi possível atualizar o membro.", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    updateMutation.mutate({
      name: fd.get("name") as string,
      role: fd.get("role") as string,
    });
  };

  const handleToggleActive = () => {
    if (member.isActive) {
      setConfirmDeactivate(true);
    } else {
      updateMutation.mutate({ isActive: true });
    }
  };

  const confirmDeactivateAction = () => {
    updateMutation.mutate({ isActive: false });
    setConfirmDeactivate(false);
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Editar Membro"
      description={`Atualize os dados de ${member.name}`}
    >
      {confirmDeactivate ? (
        <div className="space-y-4 mt-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-white">Desativar {member.name}?</p>
              <p className="text-sm text-muted-foreground mt-1">
                Esse membro não conseguirá mais acessar o sistema. Você pode reativá-lo a qualquer momento.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setConfirmDeactivate(false)} className="flex-1">Cancelar</Button>
            <Button
              variant="destructive"
              onClick={confirmDeactivateAction}
              isLoading={updateMutation.isPending}
              className="flex-1"
            >
              Desativar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {/* Avatar + status */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
              {member.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white truncate">{member.name}</p>
              <p className="text-sm text-muted-foreground truncate">{member.email}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full border ${member.isActive !== false ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"}`}>
              {member.isActive !== false ? "Ativo" : "Inativo"}
            </span>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Nome</label>
            <Input name="name" defaultValue={member.name} required />
          </div>

          {/* Role */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Função</label>
            <select
              name="role"
              defaultValue={member.role}
              className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
            >
              <option value="staff">Funcionário</option>
              <option value="creche_admin">Admin de Creche</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex gap-3">
              <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" isLoading={updateMutation.isPending} className="flex-1">
                Salvar Alterações
              </Button>
            </div>

            {/* Deactivate / Reactivate */}
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={updateMutation.isPending}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                member.isActive !== false
                  ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                  : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              }`}
            >
              {member.isActive !== false ? (
                <><UserX className="h-4 w-4" /> Desativar membro</>
              ) : (
                <><UserCheck className="h-4 w-4" /> Reativar membro</>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function ManageStaff() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<StaffMember | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: staff, isLoading } = useListCrecheStaff(crecheId);
  const addStaffMutation = useAddStaffMember();

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    addStaffMutation.mutate(
      {
        crecheId,
        data: {
          name: formData.get("name") as string,
          email: formData.get("email") as string,
          password: formData.get("password") as string,
          role: formData.get("role") as "staff" | "creche_admin",
        },
      },
      {
        onSuccess: () => {
          setIsAddModalOpen(false);
          queryClient.invalidateQueries();
          toast({ title: "Membro adicionado!", description: "Um e-mail com a senha provisória foi enviado." });
        },
        onError: () => {
          toast({ title: "Erro", description: "Não foi possível adicionar o membro.", variant: "destructive" });
        },
      }
    );
  };

  const activeStaff = staff?.filter((s) => s.isActive !== false) || [];
  const inactiveStaff = staff?.filter((s) => s.isActive === false) || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Gestão de Equipe</h1>
          <p className="text-muted-foreground mt-1">Gerencie os membros da sua equipe.</p>
        </div>
        <Button onClick={() => setIsAddModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Adicionar Membro
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="border-primary/20">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Ativo</p>
              <p className="text-2xl font-display font-bold text-white">{activeStaff.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Shield className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Funcionários</p>
              <p className="text-2xl font-display font-bold text-white">
                {activeStaff.filter((s) => s.role === "staff").length}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Shield className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Administradores</p>
              <p className="text-2xl font-display font-bold text-white">
                {activeStaff.filter((s) => s.role === "creche_admin").length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active members */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando equipe...</div>
          ) : activeStaff.length ? (
            <div className="divide-y divide-white/5">
              {activeStaff.map((member) => (
                <div
                  key={member.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-white">{member.name}</p>
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <Mail className="h-3.5 w-3.5" />
                        {member.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${roleColors[member.role] || ""}`}>
                      {roleLabel[member.role] || member.role}
                    </span>
                    <Button
                      variant="glass"
                      size="sm"
                      onClick={() => setEditingMember(member as StaffMember)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="Nenhum membro ativo"
              description="Adicione o primeiro membro da equipe para começar."
              action={{ label: "Adicionar Membro", onClick: () => setIsAddModalOpen(true) }}
            />
          )}
        </CardContent>
      </Card>

      {/* Inactive members */}
      {inactiveStaff.length > 0 && (
        <div className="opacity-50 hover:opacity-80 transition-opacity">
          <h2 className="text-base font-semibold text-muted-foreground mb-3 px-1">Membros Inativos ({inactiveStaff.length})</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-white/5">
                {inactiveStaff.map((member) => (
                  <div
                    key={member.id}
                    className="px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center text-white/40 font-bold text-lg flex-shrink-0">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-white/50 line-through">{member.name}</p>
                        <p className="text-sm text-muted-foreground/50 flex items-center gap-1.5 mt-0.5">
                          <Mail className="h-3.5 w-3.5" />
                          {member.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium px-2.5 py-1 rounded-lg border bg-white/5 text-white/30 border-white/10">
                        Inativo
                      </span>
                      <Button
                        variant="glass"
                        size="sm"
                        onClick={() => setEditingMember(member as StaffMember)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity gap-1.5"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Reativar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Adicionar Membro à Equipe">
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome Completo</label>
            <Input name="name" required placeholder="Ana Costa" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">E-mail</label>
            <Input name="email" type="email" required placeholder="ana@petparadise.com.br" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Senha Provisória</label>
            <Input name="password" type="password" required placeholder="Mín. 6 caracteres" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Função</label>
            <select
              name="role"
              className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
            >
              <option value="staff">Funcionário</option>
              <option value="creche_admin">Admin de Creche</option>
            </select>
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsAddModalOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={addStaffMutation.isPending}>Adicionar</Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      {editingMember && (
        <EditMemberModal
          member={editingMember}
          crecheId={crecheId}
          onClose={() => setEditingMember(null)}
        />
      )}
    </div>
  );
}
