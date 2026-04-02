import React, { useState } from "react";
import { useListUsers, useUpdateUser } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, Mail, Building2, Search, UserCheck, UserX, AlertCircle, Plus } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

const roleColors: Record<string, string> = {
  master_admin: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  creche_admin: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  staff: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  tutor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

type UserRole = "master_admin" | "creche_admin" | "staff" | "tutor";

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateUser();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [editUser, setEditUser] = useState<any | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const filtered = users?.filter((u) => {
    const matchSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const handleToggleActive = (u: any) => {
    updateMutation.mutate(
      { userId: u.id, data: { isActive: !u.isActive } as any },
      { onSuccess: () => queryClient.invalidateQueries() }
    );
  };

  const handleRoleChange = (u: any, role: UserRole) => {
    updateMutation.mutate(
      { userId: u.id, data: { role } as any },
      { onSuccess: () => { queryClient.invalidateQueries(); setEditUser(null); } }
    );
  };

  const roleCount = (role: string) => users?.filter((u) => u.role === role).length || 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Usuários</h1>
          <p className="text-muted-foreground mt-1">Todos os usuários registrados na plataforma.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { role: "master_admin", label: "Master Admin", color: "text-violet-300" },
          { role: "creche_admin", label: "Admin", color: "text-blue-300" },
          { role: "staff", label: "Staff", color: "text-emerald-300" },
          { role: "tutor", label: "Tutores", color: "text-amber-300" },
        ].map(({ role, label, color }) => (
          <Card key={role} className="cursor-pointer hover:border-white/20 transition-all" onClick={() => setRoleFilter(roleFilter === role ? "all" : role)}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground mb-1">{label}</p>
              <p className={`text-3xl font-display font-bold ${color}`}>{roleCount(role)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="w-full h-11 pl-9 pr-4 rounded-xl border border-white/10 bg-black/20 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
        >
          <option value="all">Todos os papéis</option>
          <option value="master_admin">Master Admin</option>
          <option value="creche_admin">Admin de Creche</option>
          <option value="staff">Staff</option>
          <option value="tutor">Tutor</option>
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando usuários...</div>
          ) : filtered?.length ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-white/5">
                  <tr>
                    <th className="px-6 py-4 font-medium">Usuário</th>
                    <th className="px-6 py-4 font-medium">Papel</th>
                    <th className="px-6 py-4 font-medium">Creche</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium">Cadastro</th>
                    <th className="px-6 py-4 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((u) => (
                    <tr key={u.id} className={`hover:bg-white/5 transition-colors ${!u.isActive ? "opacity-50" : ""}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-white font-bold flex-shrink-0">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-white">{u.name}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Mail className="h-3 w-3" />{u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border capitalize ${roleColors[u.role] || ""}`}>
                          {u.role.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {u.crecheId ? (
                          <span className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5" /> #{u.crecheId}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Badge variant={u.isActive ? "success" : "secondary"}>
                            {u.isActive ? "Ativo" : "Inativo"}
                          </Badge>
                          {(u as any).mustChangePassword && (
                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                              <AlertCircle className="h-3 w-3 mr-1" /> Senha provisória
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs">
                        {format(new Date(u.createdAt), "dd/MM/yyyy")}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setEditUser(u)}>
                            Editar
                          </Button>
                          {currentUser?.id !== u.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={u.isActive
                                ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                                : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                              }
                              onClick={() => handleToggleActive(u)}
                              isLoading={updateMutation.isPending}
                            >
                              {u.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="Nenhum usuário encontrado" description="Nenhum resultado para este filtro." />
          )}
        </CardContent>
      </Card>

      {/* Edit User Modal */}
      {editUser && (
        <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title="Editar Usuário">
          <div className="space-y-5">
            <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-white font-bold text-xl">
                {editUser.name.charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-white">{editUser.name}</p>
                <p className="text-sm text-muted-foreground">{editUser.email}</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Papel / Função</label>
              <div className="grid grid-cols-2 gap-2">
                {(["creche_admin", "staff", "tutor"] as UserRole[]).map((role) => (
                  <button
                    key={role}
                    onClick={() => handleRoleChange(editUser, role)}
                    className={`px-3 py-2 rounded-xl text-sm font-medium capitalize border transition-all ${
                      editUser.role === role
                        ? "bg-primary/20 border-primary/30 text-primary"
                        : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {role.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            {(editUser as any).mustChangePassword && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                Este usuário ainda não trocou a senha provisória.
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <Button
                variant="outline"
                className={editUser.isActive
                  ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                  : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                }
                onClick={() => { handleToggleActive(editUser); setEditUser(null); }}
              >
                {editUser.isActive ? <><UserX className="mr-2 h-4 w-4" /> Desativar</> : <><UserCheck className="mr-2 h-4 w-4" /> Reativar</>}
              </Button>
              <Button variant="ghost" onClick={() => setEditUser(null)}>Fechar</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
