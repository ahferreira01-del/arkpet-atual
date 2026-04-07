import React, { useState, useEffect } from "react";
import { useListPets, useCreatePet, PetSpecies, PetGender } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Dog, Plus, Search, UserPlus, Users } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient, useMutation } from "@tanstack/react-query";

const genderLabel: Record<string, string> = {
  male: "Macho",
  female: "Fêmea",
  unknown: "Desconhecido",
};

const selectClass = "flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary backdrop-blur-md text-white";

interface Tutor { id: number; name: string; email: string; }

function useTutors(crecheId: number) {
  const token = localStorage.getItem("auth_token");
  const [tutors, setTutors] = useState<Tutor[]>([]);
  useEffect(() => {
    fetch(`/api/creches/${crecheId}/tutors`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json() : []).then(setTutors).catch(() => {});
  }, [crecheId]);
  return tutors;
}

export default function PetsDirectory() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();
  const { data: pets, isLoading } = useListPets(crecheId);
  const createPetMutation = useCreatePet();
  const tutors = useTutors(crecheId);

  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyPresent, setOnlyPresent] = useState(() => urlParams.get("filter") === "present");
  const [tutorMode, setTutorMode] = useState<"existing" | "new">("existing");
  const [selectedTutorId, setSelectedTutorId] = useState<string>("");
  const [newTutorName, setNewTutorName] = useState("");
  const [newTutorEmail, setNewTutorEmail] = useState("");
  const [newTutorPhone, setNewTutorPhone] = useState("");
  const [createdTutorPassword, setCreatedTutorPassword] = useState<string | null>(null);

  const canManageTutors = user?.role === "creche_admin" || user?.role === "master_admin";

  const createUserMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; phone?: string; tempPassword: string }) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: data.name, email: data.email, password: data.tempPassword, role: "tutor", crecheId }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Erro ao criar tutor"); }
      return r.json();
    },
  });

  const filteredPets = pets?.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.breed?.toLowerCase() || "").includes(search.toLowerCase());
    const matchesPresent = onlyPresent ? p.isCheckedIn : true;
    return matchesSearch && matchesPresent;
  });

  const resetModal = () => {
    setTutorMode("existing");
    setSelectedTutorId("");
    setNewTutorName("");
    setNewTutorEmail("");
    setNewTutorPhone("");
    setCreatedTutorPassword(null);
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    let tutorId: number;

    if (user?.role === "tutor") {
      tutorId = user.id;
    } else if (tutorMode === "existing") {
      tutorId = selectedTutorId ? parseInt(selectedTutorId) : 1;
    } else {
      const tempPass = "LuxePets@" + Math.random().toString(36).slice(2, 8).toUpperCase();
      try {
        const newUser = await createUserMutation.mutateAsync({
          name: newTutorName,
          email: newTutorEmail,
          phone: newTutorPhone,
          tempPassword: tempPass,
        });
        tutorId = newUser.id;
        setCreatedTutorPassword(tempPass);
      } catch (err: any) {
        alert(err.message || "Erro ao criar tutor");
        return;
      }
    }

    createPetMutation.mutate({
      crecheId,
      data: {
        name: formData.get("name") as string,
        species: formData.get("species") as PetSpecies,
        gender: formData.get("gender") as PetGender,
        breed: formData.get("breed") as string,
        tutorId,
      }
    }, {
      onSuccess: () => {
        if (!createdTutorPassword) setIsModalOpen(false);
        queryClient.invalidateQueries();
        resetModal();
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Diretório de Pets</h1>
          <p className="text-muted-foreground mt-1">Gerencie perfis, registros médicos e rastreamento.</p>
        </div>
        {user?.role !== "tutor" && (
          <Button onClick={() => { resetModal(); setIsModalOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Cadastrar Pet
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md">
          <Input
            icon={<Search className="h-4 w-4" />}
            placeholder="Buscar pets por nome ou raça..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setOnlyPresent(!onlyPresent)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
            onlyPresent
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(52,211,153,0.15)]"
              : "text-muted-foreground hover:text-white border-white/10 hover:bg-white/5"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${onlyPresent ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
          Presentes na creche
          {onlyPresent && (
            <span className="ml-1 bg-emerald-400/20 text-emerald-400 text-xs px-1.5 py-0.5 rounded-full">
              {pets?.filter(p => p.isCheckedIn).length ?? 0}
            </span>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <Card key={i} className="h-64 animate-pulse bg-white/5" />)}
        </div>
      ) : filteredPets?.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredPets.map((pet) => (
            <Link key={pet.id} href={`/pets/${pet.id}`}>
              <Card className="hover:-translate-y-1 transition-transform duration-300 cursor-pointer group h-full flex flex-col">
                <CardContent className="p-0 flex flex-col h-full">
                  <div className="h-32 bg-gradient-to-br from-primary/20 to-accent/20 relative overflow-hidden flex-shrink-0">
                    {pet.photoUrl ? (
                      <img src={pet.photoUrl} alt={pet.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Dog className="h-12 w-12 text-white/30" />
                      </div>
                    )}
                    <div className="absolute top-3 right-3">
                      {pet.isCheckedIn ? (
                        <Badge variant="success" className="shadow-lg shadow-black/50 backdrop-blur-md">Presente</Badge>
                      ) : (
                        <Badge variant="secondary" className="shadow-lg shadow-black/50 backdrop-blur-md bg-black/60">Em casa</Badge>
                      )}
                    </div>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <h3 className="text-lg font-display font-semibold text-white group-hover:text-primary transition-colors">{pet.name}</h3>
                    <p className="text-sm text-muted-foreground capitalize mb-4">
                      {pet.breed || pet.species} • {genderLabel[pet.gender] || pet.gender}
                    </p>
                    <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground truncate">{pet.tutorName || "Sem tutor"}</span>
                      {pet.temperament && <Badge variant="outline" className="capitalize text-xs">{pet.temperament}</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="py-16">
          <EmptyState
            icon={Dog}
            title="Nenhum pet encontrado"
            description={search ? "Tente ajustar os critérios de busca." : "Nenhum pet cadastrado nesta creche ainda."}
            action={!search && user?.role !== "tutor" ? { label: "Cadastrar Primeiro Pet", onClick: () => setIsModalOpen(true) } : undefined}
          />
        </Card>
      )}

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); resetModal(); }} title="Cadastrar Pet">
        {createdTutorPassword ? (
          /* Success: show temp password */
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <p className="text-sm font-semibold text-emerald-400">Tutor criado com sucesso!</p>
              <p className="text-sm text-muted-foreground">Compartilhe as credenciais abaixo com o tutor:</p>
              <div className="p-3 rounded-lg bg-black/30 font-mono text-sm text-white space-y-1">
                <p><span className="text-muted-foreground">E-mail:</span> {newTutorEmail}</p>
                <p><span className="text-muted-foreground">Senha temp.:</span> <span className="text-primary font-bold">{createdTutorPassword}</span></p>
              </div>
              <p className="text-xs text-muted-foreground">O tutor será solicitado a alterar a senha no primeiro acesso.</p>
            </div>
            <Button className="w-full" onClick={() => { setIsModalOpen(false); resetModal(); }}>Concluir</Button>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Pet</label>
              <Input name="name" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Espécie</label>
                <select name="species" className={selectClass}>
                  <option value="dog">Cachorro</option>
                  <option value="cat">Gato</option>
                  <option value="bird">Pássaro</option>
                  <option value="other">Outro</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Sexo</label>
                <select name="gender" className={selectClass}>
                  <option value="male">Macho</option>
                  <option value="female">Fêmea</option>
                  <option value="unknown">Desconhecido</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Raça (Opcional)</label>
              <Input name="breed" />
            </div>

            {/* Tutor section — only for admin/staff */}
            {user?.role !== "tutor" && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Tutor</label>
                  {canManageTutors && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setTutorMode("existing")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${tutorMode === "existing" ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                      >
                        <Users className="h-3 w-3" /> Existente
                      </button>
                      <button
                        type="button"
                        onClick={() => setTutorMode("new")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${tutorMode === "new" ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                      >
                        <UserPlus className="h-3 w-3" /> Novo
                      </button>
                    </div>
                  )}
                </div>

                {(tutorMode === "existing" || !canManageTutors) && (
                  <select
                    value={selectedTutorId}
                    onChange={(e) => setSelectedTutorId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Sem tutor por enquanto</option>
                    {tutors.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} — {t.email}</option>
                    ))}
                  </select>
                )}

                {tutorMode === "new" && canManageTutors && (
                  <div className="space-y-3 p-3 rounded-xl bg-white/5 border border-white/10">
                    <p className="text-xs text-muted-foreground">Um acesso será criado automaticamente. A senha temporária será exibida após o cadastro.</p>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Nome completo *</label>
                      <Input
                        value={newTutorName}
                        onChange={(e) => setNewTutorName(e.target.value)}
                        required={tutorMode === "new"}
                        placeholder="Maria Silva"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">E-mail *</label>
                      <Input
                        type="email"
                        value={newTutorEmail}
                        onChange={(e) => setNewTutorEmail(e.target.value)}
                        required={tutorMode === "new"}
                        placeholder="maria@email.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Telefone (opcional)</label>
                      <Input
                        value={newTutorPhone}
                        onChange={(e) => setNewTutorPhone(e.target.value)}
                        placeholder="(11) 99999-9999"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => { setIsModalOpen(false); resetModal(); }}>Cancelar</Button>
              <Button
                type="submit"
                isLoading={createPetMutation.isPending || createUserMutation.isPending}
              >
                Cadastrar Pet
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
