import React, { useState } from "react";
import { useListUsers, useUpdateUser, useListCreches } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Users, Mail, Building2, Search, UserCheck, UserX,
  AlertCircle, Plus, Eye, EyeOff, KeyRound, Pencil,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format } from "date-fns";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

const ROLE_LABELS: Record<string, string> = {
  master_admin: "Master Admin",
  creche_admin: "Admin de Creche",
  staff: "Funcionário",
  tutor: "Tutor",
};

const roleColors: Record<string, string> = {
  master_admin: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  creche_admin: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  staff: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  tutor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

type UserRole = "master_admin" | "creche_admin" | "staff" | "tutor";

function useByCrecheUsers(crecheId: number) {
  return useQuery<any[]>({
    queryKey: ["users-by-creche", crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/users/by-creche/${crecheId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Erro ao carregar usuários");
      return r.json();
    },
    enabled: !!crecheId,
  });
}

function useCreateUser() {
  return useMutation({
    mutationFn: async (data: {
      name: string;
      email: string;
      password: string;
      role: string;
      crecheId?: number | null;
    }) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao criar usuário");
      }
      return r.json();
    },
  });
}

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const isMaster = currentUser?.role === "master_admin";
  const crecheId = currentUser?.crecheId || 0;

  const allUsersQuery = useListUsers();
  const crecheUsersQuery = useByCrecheUsers(crecheId);
  const { data: creches } = useListCreches();

  const usersData = isMaster ? allUsersQuery.data : crecheUsersQuery.data;
  const isLoading = isMaster ? allUsersQuery.isLoading : crecheUsersQuery.isLoading;
  const queryClient = useQueryClient();
  const updateMutation = useUpdateUser();
  const createMutation = useCreateUser();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [editUser, setEditUser] = useState<any | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: "", email: "", password: "", role: isMaster ? "creche_admin" : "tutor",
    crecheId: isMaster ? "" : String(crecheId),
  });
  const [showPassword, setShowPassword] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("tutor");
  const [editPassword, setEditPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);

  const filtered = usersData?.filter((u) => {
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

  const handleOpenEdit = (u: any) => {
    setEditUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditPassword("");
    setShowEditPassword(false);
  };

  const handleSaveEdit = () => {
    if (!editUser) return;
    const data: any = { name: editName, role: editRole };
    if (editPassword.trim()) data.newPassword = editPassword;
    updateMutation.mutate(
      { userId: editUser.id, data },
      { onSuccess: () => { queryClient.invalidateQueries(); setEditUser(null); } }
    );
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    const payload: any = {
      name: createForm.name,
      email: createForm.email,
      password: createForm.password,
      role: createForm.role,
    };
    if (isMaster && createForm.crecheId) {
      payload.crecheId = Number(createForm.crecheId);
    } else if (!isMaster) {
      payload.crecheId = crecheId;
    }
    createMutation.mutate(payload, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        setIsCreateOpen(false);
        setCreateForm({ name: "", email: "", password: "", role: isMaster ? "creche_admin" : "tutor", crecheId: isMaster ? "" : String(crecheId) });
        setCreateError("");
      },
      onError: (err: any) => setCreateError(err.message || "Erro ao criar usuário"),
    });
  };

  const roleCount = (role: string) => usersData?.filter((u) => u.role === role).length || 0;

  const availableRoles: UserRole[] = isMaster
    ? ["master_admin", "creche_admin", "staff", "tutor"]
    : ["staff", "tutor"];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Usuários"
        description={isMaster ? "Todos os usuários registrados na plataforma." : "Usuários da sua creche."}
        icon={Users}
        action={
          <Button onClick={() => { setCreateError(""); setIsCreateOpen(true); }}>
            <Plus className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Novo Usuário</span>
          </Button>
        }
      />

      {/* Role summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { role: "master_admin", label: "Master Admin", color: "text-violet-300" },
          { role: "creche_admin", label: "Admin", color: "text-blue-300" },
          { role: "staff", label: "Funcionários", color: "text-emerald-300" },
          { role: "tutor", label: "Tutores", color: "text-amber-300" },
        ].map(({ role, label, color }) => (
          <Card
            key={role}
            className="cursor-pointer hover:border-white/20 transition-all"
            onClick={() => setRoleFilter(roleFilter === role ? "all" : role)}
          >
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
            className="w-full h-11 pl-9 pr-4 rounded-xl border border-white/10 bg-black/20 text-base text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
        >
          <option value="all">Todos os papéis</option>
          <option value="master_admin">Master Admin</option>
          <option value="creche_admin">Admin de Creche</option>
          <option value="staff">Funcionário</option>
          <option value="tutor">Tutor</option>
        </select>
      </div>

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando usuários...</div>
          ) : filtered?.length ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-white/5">
                  <tr>
                    <th className="px-4 md:px-6 py-4 font-medium">Usuário</th>
                    <th className="px-4 md:px-6 py-4 font-medium">Papel</th>
                    {isMaster && <th className="hidden lg:table-cell px-6 py-4 font-medium">Creche</th>}
                    <th className="hidden sm:table-cell px-4 md:px-6 py-4 font-medium">Status</th>
                    <th className="hidden md:table-cell px-6 py-4 font-medium">Cadastro</th>
                    <th className="px-4 md:px-6 py-4 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((u) => (
                    <tr key={u.id} className={`hover:bg-white/5 transition-colors ${!u.isActive ? "opacity-50" : ""}`}>
                      <td className="px-4 md:px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 md:h-9 md:w-9 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-white font-bold flex-shrink-0 text-sm">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-white truncate max-w-[120px] md:max-w-none">{u.name}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[120px] md:max-w-none hidden sm:flex items-center gap-1">
                              <Mail className="h-3 w-3 flex-shrink-0" />{u.email}
                            </p>
                            {/* Mobile: show role + status inline */}
                            <div className="flex items-center gap-1.5 sm:hidden mt-0.5">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${roleColors[u.role] || ""}`}>
                                {ROLE_LABELS[u.role] || u.role}
                              </span>
                              <Badge variant={u.isActive ? "success" : "secondary"} className="text-[10px] py-0 px-1.5">
                                {u.isActive ? "Ativo" : "Inativo"}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 md:px-6 py-4">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${roleColors[u.role] || ""}`}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </td>
                      {isMaster && (
                        <td className="hidden lg:table-cell px-6 py-4 text-muted-foreground">
                          {u.crecheId ? (
                            <span className="flex items-center gap-1.5 text-sm">
                              <Building2 className="h-3.5 w-3.5" />
                              {creches?.find((c) => c.id === u.crecheId)?.name || `#${u.crecheId}`}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      )}
                      <td className="hidden sm:table-cell px-4 md:px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <Badge variant={u.isActive ? "success" : "secondary"}>
                            {u.isActive ? "Ativo" : "Inativo"}
                          </Badge>
                          {(u as any).mustChangePassword && (
                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                              <AlertCircle className="h-3 w-3 mr-1" /> Provisória
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="hidden md:table-cell px-6 py-4 text-muted-foreground text-xs">
                        {format(new Date(u.createdAt), "dd/MM/yyyy")}
                      </td>
                      <td className="px-4 md:px-6 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="ghost" className="px-2 md:px-3" onClick={() => handleOpenEdit(u)}>
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="hidden md:inline ml-1">Editar</span>
                          </Button>
                          {currentUser?.id !== u.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={u.isActive
                                ? "border-red-500/30 text-red-400 hover:bg-red-500/10 px-2 md:px-3"
                                : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 px-2 md:px-3"
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

      {/* ── Create User Modal ── */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Novo Usuário">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome completo</label>
              <Input
                required
                placeholder="Maria Silva"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">E-mail</label>
              <Input
                required
                type="email"
                placeholder="maria@creche.com.br"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Senha provisória</label>
            <div className="relative">
              <Input
                required
                type={showPassword ? "text" : "password"}
                placeholder="Mín. 6 caracteres"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">O usuário deverá trocar a senha no primeiro acesso.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Perfil</label>
            <div className="grid grid-cols-2 gap-2">
              {availableRoles.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setCreateForm((f) => ({ ...f, role }))}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    createForm.role === role
                      ? "bg-primary/20 border-primary/30 text-primary"
                      : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {ROLE_LABELS[role]}
                </button>
              ))}
            </div>
          </div>

          {isMaster && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Creche <span className="text-muted-foreground">(opcional)</span></label>
              <select
                value={createForm.crecheId}
                onChange={(e) => setCreateForm((f) => ({ ...f, crecheId: e.target.value }))}
                className="w-full h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
              >
                <option value="">Sem creche vinculada</option>
                {creches?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {createError && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {createError}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              <Plus className="mr-2 h-4 w-4" /> Criar Usuário
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit User Modal ── */}
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
              <label className="text-sm font-medium">Nome</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nome completo"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Perfil / Função</label>
              <div className="grid grid-cols-2 gap-2">
                {availableRoles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setEditRole(role)}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                      editRole === role
                        ? "bg-primary/20 border-primary/30 text-primary"
                        : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Nova senha <span className="text-muted-foreground font-normal">(deixe em branco para não alterar)</span>
              </label>
              <div className="relative">
                <Input
                  type={showEditPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
                  onClick={() => setShowEditPassword((v) => !v)}
                >
                  {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {(editUser as any).mustChangePassword && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                Este usuário ainda não trocou a senha provisória.
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-white/10">
              {currentUser?.id !== editUser.id && (
                <Button
                  variant="outline"
                  className={editUser.isActive
                    ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                    : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  }
                  onClick={() => { handleToggleActive(editUser); setEditUser(null); }}
                >
                  {editUser.isActive
                    ? <><UserX className="mr-2 h-4 w-4" /> Desativar</>
                    : <><UserCheck className="mr-2 h-4 w-4" /> Reativar</>}
                </Button>
              )}
              <div className="flex gap-3 ml-auto">
                <Button variant="ghost" onClick={() => setEditUser(null)}>Cancelar</Button>
                <Button onClick={handleSaveEdit} isLoading={updateMutation.isPending}>
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
