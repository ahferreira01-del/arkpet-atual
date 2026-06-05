import React, { useState } from "react";
import { resolvePhotoUrl } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Users, Plus, Search, Mail, Dog, UserX, UserCheck, Eye, EyeOff, KeyRound, ChevronRight, PawPrint, ToggleLeft, ToggleRight,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

function useTutors(crecheId: number) {
  const token = localStorage.getItem("auth_token");
  return useQuery<any[]>({
    queryKey: ["tutors-full", crecheId],
    queryFn: async () => {
      const r = await fetch(`/api/creches/${crecheId}/tutors/manage`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Erro ao carregar tutores");
      return r.json();
    },
  });
}

function useCreateTutor(crecheId: number) {
  const token = localStorage.getItem("auth_token");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; email: string; password: string; mensalidadeDia?: number | null }) => {
      const r = await fetch(`/api/creches/${crecheId}/tutors`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...data, role: "tutor" }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "Erro ao criar tutor");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tutors-full", crecheId] });
    },
  });
}

function useToggleTutor(crecheId: number) {
  const token = localStorage.getItem("auth_token");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tutorId, isActive }: { tutorId: number; isActive: boolean }) => {
      const r = await fetch(`/api/creches/${crecheId}/tutors/${tutorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActive }),
      });
      if (!r.ok) throw new Error("Erro ao atualizar tutor");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tutors-full", crecheId] });
    },
  });
}

function useTutorPets(crecheId: number, tutorId: number | null) {
  const token = localStorage.getItem("auth_token");
  return useQuery<any[]>({
    queryKey: ["tutor-pets", crecheId, tutorId],
    queryFn: async () => {
      const r = await fetch(`/api/creches/${crecheId}/pets?tutorId=${tutorId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Erro ao carregar pets");
      return r.json();
    },
    enabled: !!tutorId,
  });
}

function useTogglePetStatus(crecheId: number) {
  const token = localStorage.getItem("auth_token");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ petId, status }: { petId: number; status: "active" | "inactive" }) => {
      const r = await fetch(`/api/creches/${crecheId}/pets/${petId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Erro ao atualizar pet");
      return r.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tutor-pets", crecheId] });
      qc.invalidateQueries({ queryKey: ["tutors-full", crecheId] });
    },
  });
}

function TutorPetsModal({ tutor, crecheId, onClose }: { tutor: any; crecheId: number; onClose: () => void }) {
  const { data: pets, isLoading } = useTutorPets(crecheId, tutor.id);
  const togglePet = useTogglePetStatus(crecheId);
  const { toast } = useToast();

  const handleTogglePet = (pet: any) => {
    const newStatus = pet.status === "active" ? "inactive" : "active";
    togglePet.mutate(
      { petId: pet.id, status: newStatus },
      {
        onSuccess: () => {
          toast({
            title: newStatus === "inactive" ? "Pet desativado" : "Pet ativado",
            description: `${pet.name} foi ${newStatus === "inactive" ? "desativado" : "reativado"} com sucesso.`,
          });
        },
        onError: (err: any) => {
          toast({ title: "Erro", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Pets de ${tutor.name}`}
      description={`${tutor.email} · ${tutor.petCount ?? 0} pet${tutor.petCount !== 1 ? "s" : ""} cadastrado${tutor.petCount !== 1 ? "s" : ""}`}
    >
      <div className="mt-4 space-y-3">
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Carregando pets...</div>
        ) : !pets?.length ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <PawPrint className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p>Nenhum pet cadastrado para este tutor.</p>
          </div>
        ) : (
          pets.map((pet) => (
            <div
              key={pet.id}
              className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${
                pet.status === "inactive"
                  ? "bg-white/3 border-white/5 opacity-60"
                  : "bg-white/5 border-white/10"
              }`}
            >
              {/* Avatar */}
              <div className="h-10 w-10 flex-shrink-0 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center">
                {pet.photoUrl ? (
                  <img src={resolvePhotoUrl(pet.photoUrl)!} alt={pet.name} className="h-full w-full object-cover" />
                ) : (
                  <Dog className="h-5 w-5 text-primary" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm leading-tight truncate">{pet.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{pet.breed || pet.species || "—"}</p>
              </div>

              {/* Status badge */}
              <Badge
                variant={pet.status === "active" ? "success" : "secondary"}
                className="flex-shrink-0 text-[10px]"
              >
                {pet.status === "active" ? "Ativo" : "Inativo"}
              </Badge>

              {/* Toggle button */}
              <button
                onClick={() => handleTogglePet(pet)}
                disabled={togglePet.isPending}
                className={`flex-shrink-0 transition-all ${
                  pet.status === "active"
                    ? "text-red-400 hover:text-red-300"
                    : "text-emerald-400 hover:text-emerald-300"
                }`}
                title={pet.status === "active" ? "Desativar pet" : "Reativar pet"}
              >
                {pet.status === "active" ? (
                  <ToggleRight className="h-6 w-6" />
                ) : (
                  <ToggleLeft className="h-6 w-6" />
                )}
              </button>
            </div>
          ))
        )}

        <div className="pt-2">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function generateTempPassword() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return "ArkPet@" + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function TutorsPage() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: tutors, isLoading } = useTutors(crecheId);
  const createMutation = useCreateTutor(crecheId);
  const toggleMutation = useToggleTutor(crecheId);

  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const [selectedTutor, setSelectedTutor] = useState<any | null>(null);

  const [form, setForm] = useState({ name: "", email: "", password: generateTempPassword(), mensalidadeDia: "" });

  const filtered = (tutors ?? []).filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    try {
      const payload = {
        ...form,
        mensalidadeDia: form.mensalidadeDia ? parseInt(form.mensalidadeDia) : null,
      };
      const created = await createMutation.mutateAsync(payload);
      setCreatedPassword(form.password);
      setCreatedName(created.name || form.name);
      setShowModal(false);
      setForm({ name: "", email: "", password: generateTempPassword(), mensalidadeDia: "" });
      toast({ title: "Tutor criado!", description: `${form.name} foi cadastrado com sucesso.` });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleToggle = (tutor: any) => {
    toggleMutation.mutate(
      { tutorId: tutor.id, isActive: !tutor.isActive },
      {
        onSuccess: () => {
          toast({
            title: tutor.isActive ? "Tutor desativado" : "Tutor ativado",
            description: `${tutor.name} foi ${tutor.isActive ? "desativado" : "ativado"} com sucesso.`,
          });
        },
        onError: (err: any) => {
          toast({ title: "Erro", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Tutores"
        description="Gerencie os tutores cadastrados na sua creche."
        icon={Users}
        action={
          <Button onClick={() => { setShowModal(true); setCreatedPassword(null); }}>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Novo Tutor</span>
          </Button>
        }
      />

      {/* Temp password banner */}
      {createdPassword && createdName && (
        <Card className="border-emerald-500/30 bg-emerald-500/10">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-emerald-400 mb-1">
              Tutor <span className="font-bold">{createdName}</span> criado!
            </p>
            <p className="text-xs text-emerald-300/80 mb-2">
              Compartilhe a senha temporária abaixo. O tutor deverá alterá-la no primeiro acesso.
            </p>
            <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2 border border-emerald-500/20">
              <KeyRound className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              <span className="font-mono text-sm text-white flex-1">
                {showPassword ? createdPassword : "•".repeat(createdPassword.length)}
              </span>
              <button
                onClick={() => setShowPassword((v) => !v)}
                className="text-muted-foreground hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(createdPassword!); toast({ title: "Copiado!" }); }}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
              >
                Copiar
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou e-mail..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tutors list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando tutores...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum tutor encontrado"
          description='Clique em "Novo Tutor" para cadastrar o primeiro tutor da sua creche.'
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tutor) => (
            <Card key={tutor.id} className={!tutor.isActive ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-white truncate">{tutor.name}</p>
                      {!tutor.isActive && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0 bg-red-500/20 text-red-300 border-red-500/30">
                          Inativo
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{tutor.email}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                    <Users className="h-5 w-5 text-amber-400" />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Dog className="h-3.5 w-3.5" />
                    <span>{tutor.petCount ?? 0} pet{tutor.petCount !== 1 ? "s" : ""}</span>
                  </div>
                  {tutor.mensalidadeDia ? (
                    <span className="text-[10px] text-amber-400/80 font-medium">
                      Venc. dia {tutor.mensalidadeDia}
                    </span>
                  ) : tutor.createdAt ? (
                    <span className="text-[10px] text-muted-foreground/60">
                      Desde {format(new Date(tutor.createdAt), "MMM yyyy", { locale: ptBR })}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 pt-3 border-t border-white/5 flex gap-2">
                  <button
                    onClick={() => setSelectedTutor(tutor)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Dog className="h-3.5 w-3.5" /> Ver Pets
                    <ChevronRight className="h-3 w-3 opacity-60" />
                  </button>
                  <div className="w-px bg-white/5" />
                  <button
                    onClick={() => handleToggle(tutor)}
                    disabled={toggleMutation.isPending}
                    className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg transition-colors ${
                      tutor.isActive
                        ? "text-red-400 hover:bg-red-500/10"
                        : "text-emerald-400 hover:bg-emerald-500/10"
                    }`}
                  >
                    {tutor.isActive ? (
                      <><UserX className="h-3.5 w-3.5" /> Desativar</>
                    ) : (
                      <><UserCheck className="h-3.5 w-3.5" /> Reativar</>
                    )}
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pets modal */}
      {selectedTutor && (
        <TutorPetsModal
          tutor={selectedTutor}
          crecheId={crecheId}
          onClose={() => setSelectedTutor(null)}
        />
      )}

      {/* Create tutor modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Novo Tutor"
        description="Cadastre um tutor responsável por um ou mais pets."
      >
        <form onSubmit={handleCreate} className="space-y-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-white mb-1.5">Nome completo</label>
            <Input
              placeholder="Ex: Maria Oliveira"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white mb-1.5">E-mail</label>
            <Input
              type="email"
              placeholder="tutor@email.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white mb-1.5">Senha temporária</label>
            <div className="flex gap-2">
              <Input
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="font-mono text-sm flex-1"
                required
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, password: generateTempPassword() }))}
              >
                Gerar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              O tutor deverá alterar esta senha no primeiro acesso.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-white mb-1.5">
              Dia de vencimento da mensalidade
              <span className="text-muted-foreground font-normal ml-1">(opcional)</span>
            </label>
            <Input
              type="number"
              min="1"
              max="31"
              placeholder="Ex: 10 (dia 10 de cada mês)"
              value={form.mensalidadeDia}
              onChange={(e) => setForm((f) => ({ ...f, mensalidadeDia: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              O tutor receberá uma notificação 3 dias antes do vencimento.
            </p>
          </div>
          <div className="modal-sticky-footer flex gap-3">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Criando..." : "Criar Tutor"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
