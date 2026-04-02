import React, { useState } from "react";
import { useListCrecheStaff, useAddStaffMember } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, Plus, Mail, Shield } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function ManageStaff() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const queryClient = useQueryClient();

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
          setIsModalOpen(false);
          queryClient.invalidateQueries();
        },
      }
    );
  };

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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Gestão de Equipe</h1>
          <p className="text-muted-foreground mt-1">Gerencie os membros da sua equipe.</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Adicionar Membro
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-2">
        <Card className="border-primary/20">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total da Equipe</p>
              <p className="text-2xl font-display font-bold text-white">{staff?.length || 0}</p>
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
                {staff?.filter((s) => s.role === "staff").length || 0}
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
                {staff?.filter((s) => s.role === "creche_admin").length || 0}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando equipe...</div>
          ) : staff?.length ? (
            <div className="divide-y divide-white/5">
              {staff.map((member) => (
                <div key={member.id} className="px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-white font-bold text-lg">
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
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="Nenhum membro na equipe"
              description="Adicione o primeiro membro da equipe para começar."
              action={{ label: "Adicionar Membro", onClick: () => setIsModalOpen(true) }}
            />
          )}
        </CardContent>
      </Card>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Adicionar Membro à Equipe">
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
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={addStaffMutation.isPending}>Adicionar</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
