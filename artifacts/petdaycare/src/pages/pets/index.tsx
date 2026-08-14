import React, { useState, useEffect } from "react";
import { resolvePhotoUrl } from "@/lib/utils";
import { PetAvatar } from "@/components/pet-avatar";
import { useListPets, useCreatePet, useGetBillingSubscription, useGetCrecheStats, PetSpecies, PetGender } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Dog, Plus, UserPlus, Users, AlertTriangle, Filter, LayoutGrid, List as ListIcon, ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { Link } from "wouter";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const genderLabel: Record<string, string> = {
  male: "Macho",
  female: "Fêmea",
  unknown: "Desconhecido",
};

const selectClass = "flex h-12 w-full rounded-xl border border-border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary backdrop-blur-md text-foreground";

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
  const { toast } = useToast();
  
  const [page, setPage] = useState(1);
  const [allPets, setAllPets] = useState<any[]>([]);
  const { data: petsResponse, isLoading } = useListPets(crecheId);
  const { data: stats } = useGetCrecheStats(crecheId);
  
  useEffect(() => {
    if (petsResponse?.items) {
      setAllPets(prev => {
        if (page === 1 && prev.length === 0) return petsResponse.items;
        const map = new Map(prev.map((p: any) => [p.id, p]));
        petsResponse.items.forEach((item: any) => map.set(item.id, item));
        return Array.from(map.values()).sort((a: any, b: any) => a.name.localeCompare(b.name));
      });
    }
  }, [petsResponse?.items, page]);
  
  const pets = allPets;
  const hasMore = petsResponse ? petsResponse.total > allPets.length : false;
  
  const { loadMoreRef } = useInfiniteScroll({
    onLoadMore: () => setPage((p: any) => p + 1),
    hasMore,
    loading: isLoading
  });
  
  const createPetMutation = useCreatePet();
  const tutors = useTutors(crecheId);
  const [, navigate] = useLocation();
  const { data: subscription } = useGetBillingSubscription();
  const activePetCount = stats?.totalPets ?? 0;
  const petLimit = subscription?.plan?.petLimit;
  const isLimitReached = typeof petLimit === "number" && activePetCount >= petLimit;
  const subStatus = subscription?.status;
  const isSubBlocked = subStatus === "suspended" || subStatus === "cancelled";
  const isBlocked = isLimitReached || isSubBlocked;

  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyPresent, setOnlyPresent] = useState(() => urlParams.get("filter") === "present");
  const [tutorMode, setTutorMode] = useState<"existing" | "new">("existing");
  const [viewMode, setViewModeState] = useState<"grid" | "list">(() => {
    return (localStorage.getItem("petsViewMode") as "grid" | "list") || "grid";
  });
  const setViewMode = (mode: "grid" | "list") => {
    setViewModeState(mode);
    localStorage.setItem("petsViewMode", mode);
  };
  const [sortBy, setSortBy] = useState<"name_asc" | "name_desc">("name_asc");
  // Local client pagination replaced by infinite scroll
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
    onSuccess: () => {
      // Refresh the tutor/pet list so the new tutor appears immediately.
      queryClient.invalidateQueries();
    },
  });

  const filteredPets = pets?.filter((p: any) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.breed?.toLowerCase() || "").includes(search.toLowerCase());
    const matchesPresent = onlyPresent ? p.isCheckedIn : true;
    return matchesSearch && matchesPresent;
  })?.sort((a, b) => {
    if (sortBy === "name_asc") return a.name.localeCompare(b.name);
    if (sortBy === "name_desc") return b.name.localeCompare(a.name);
    return 0;
  });

  const totalFiltered = filteredPets?.length || 0;
  const paginatedPets = filteredPets;

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
      const tempPass = "ArkPet@" + Math.random().toString(36).slice(2, 8).toUpperCase();
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
        toast({
          title: "Não foi possível criar o tutor",
          description: err?.data?.message ?? err?.message ?? "Verifique os dados e tente novamente.",
          variant: "destructive",
        });
        return;
      }
    }

    createPetMutation.mutate({
      crecheId,
      data: {
        name: formData.get("name") as string,
        species: formData.get("species") as PetSpecies,
        gender: formData.get("gender") as PetGender,
        breed: (formData.get("breed") as string) || null,
        tutorId,
        weight: formData.get("weight") ? Number(formData.get("weight")) : null,
        color: (formData.get("color") as string) || null,
        allergies: (formData.get("allergies") as string) || null,
        specialNeeds: (formData.get("specialNeeds") as string) || null,
        temperament: (formData.get("temperament") as any) || null,
        isCastrated: formData.get("isCastrated") === "on",
        birthDate: (formData.get("birthDate") as string) || null,
      } as any
    }, {
      onSuccess: () => {
        if (!createdTutorPassword) setIsModalOpen(false);
        queryClient.invalidateQueries();
        resetModal();
      },
      onError: (err: any) => {
        toast({
          title: "Não foi possível cadastrar o pet",
          description: err?.data?.message ?? "Tente novamente em instantes.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Pets"
        description="Gerencie perfis, registros médicos e rastreamento."
        icon={Dog}
        action={
          <Button onClick={() => { resetModal(); setIsModalOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Cadastrar Pet</span><span className="sm:hidden">Novo</span>
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          {/* Top Row: Search and View Mode */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 sm:max-w-md">
              <SearchInput
                value={search}
                onChange={(val) => { setSearch(val); setPage(1); }}
                placeholder="Buscar pets..."
                onClear={() => { setSearch(""); setPage(1); }}
              />
            </div>
            
            <div className="flex shrink-0 items-center justify-center p-1 rounded-lg border border-border bg-background backdrop-blur-md">
              <button 
                onClick={() => setViewMode("grid")}
                className={`flex justify-center p-1.5 rounded-md transition-all ${viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button 
                onClick={() => setViewMode("list")}
                className={`flex justify-center p-1.5 rounded-md transition-all ${viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ListIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Bottom Row: Filter and Sort */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setOnlyPresent(!onlyPresent); setPage(1); }}
              className={`flex-1 flex items-center justify-center gap-2 h-10 px-3 rounded-lg text-[13px] font-medium border transition-all whitespace-nowrap ${
                onlyPresent
                  ? "bg-success/20 text-success border-success/40"
                  : "bg-background text-muted-foreground hover:text-foreground border-border hover:bg-secondary backdrop-blur-md"
              }`}
            >
              <Filter className={`h-3.5 w-3.5 ${onlyPresent ? "text-success" : "text-muted-foreground"}`} />
              Presentes
            </button>
            
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value as any)}
              className="flex-1 h-10 px-3 py-2 rounded-lg border border-border bg-background text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary backdrop-blur-md"
            >
              <option value="name_asc">A-Z (Nome)</option>
              <option value="name_desc">Z-A (Nome)</option>
            </select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{totalFiltered} {totalFiltered === 1 ? "pet encontrado" : "pets encontrados"}</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <Card key={i} className="h-64 animate-pulse bg-muted" />)}
        </div>
      ) : paginatedPets?.length ? (
        <>
        <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" : "flex flex-col gap-4"}>
          {paginatedPets.map((pet) => (
            <Card key={pet.id} className={`group ${viewMode === "grid" ? "h-full flex flex-col" : "flex flex-row items-center py-2 px-4"} overflow-hidden bg-background border-border transition-all hover:bg-secondary/40`}>
              <div className={`${viewMode === "grid" ? "h-32 w-full border-b" : "h-14 w-14 rounded-full border shadow-inner"} bg-secondary relative flex-shrink-0 border-border overflow-hidden`}>
                <PetAvatar
                  photoUrl={pet.photoUrl}
                  name={pet.name}
                  species={(pet as any).species}
                  className="w-full h-full object-cover"
                  iconClassName={`${viewMode === "grid" ? "h-10 w-10" : "h-6 w-6"} text-muted-foreground/30`}
                />
                {viewMode === "grid" && (
                  <div className="absolute top-3 right-3">
                    {pet.isCheckedIn ? (
                      <Badge variant="success" className="shadow-sm backdrop-blur-md">Presente</Badge>
                    ) : (
                      <Badge variant="secondary" className="shadow-sm backdrop-blur-md">Em casa</Badge>
                    )}
                  </div>
                )}
              </div>
              
              {viewMode === "grid" ? (
                <div className="flex-1 flex flex-col p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-display font-semibold text-foreground group-hover:text-primary transition-colors">{pet.name}</h3>
                      <p className="text-sm text-muted-foreground capitalize mt-1">
                        {pet.breed || pet.species} • {genderLabel[pet.gender] || pet.gender}
                      </p>
                    </div>
                    <Link href={`/pets/${pet.id}`}>
                      <button className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors">
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </Link>
                  </div>
                  <div className="border-t border-border my-4" />
                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-muted-foreground/70 mb-1">TUTOR</p>
                    <p className="text-sm text-foreground/80 truncate">{pet.tutorName || "Sem tutor"}</p>
                  </div>
                  <div className="border-t border-border my-4" />
                  <div className="flex items-center justify-between mt-auto">
                    <Link href={`/pets/${pet.id}`}>
                      <Button variant="outline" size="sm" className="rounded-full bg-transparent border-border text-foreground hover:bg-secondary">
                        Ver perfil
                      </Button>
                    </Link>
                    {pet.temperament && <Badge variant="outline" className="capitalize text-xs bg-secondary border-border text-foreground/80">{pet.temperament}</Badge>}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-row items-center gap-4 sm:gap-6 ml-4 min-w-0">
                  <div className="min-w-[120px] sm:min-w-[160px] truncate">
                    <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors truncate">{pet.name}</h3>
                    <p className="text-xs text-muted-foreground capitalize mt-0.5 truncate">{pet.breed || pet.species} • {genderLabel[pet.gender] || pet.gender}</p>
                  </div>
                  <div className="min-w-[120px] hidden md:block truncate">
                    <p className="text-[10px] font-bold tracking-wider text-muted-foreground/70 mb-0.5">TUTOR</p>
                    <p className="text-sm text-foreground/80 truncate">{pet.tutorName || "Sem tutor"}</p>
                  </div>
                  <div className="flex-1 flex items-center justify-end gap-3 min-w-0">
                    {pet.temperament && <Badge variant="outline" className="hidden lg:inline-flex capitalize text-xs bg-secondary border-border text-foreground/80">{pet.temperament}</Badge>}
                    {pet.isCheckedIn ? (
                      <Badge variant="success" className="shadow-sm backdrop-blur-md">Presente</Badge>
                    ) : (
                      <Badge variant="secondary" className="shadow-sm backdrop-blur-md">Em casa</Badge>
                    )}
                    <Link href={`/pets/${pet.id}`}>
                      <Button variant="ghost" size="sm" className="hidden sm:flex text-primary hover:bg-primary/20">
                        Ver perfil
                      </Button>
                    </Link>
                    <Link href={`/pets/${pet.id}`}>
                      <button className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors cursor-pointer">
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </Link>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>

        {/* Paginação */}
        
        </>
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

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); resetModal(); }} title="Cadastrar Pet" className="max-w-2xl">
        {createdTutorPassword ? (
          /* Success: show temp password */
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-success/10 border border-success/30 space-y-2">
              <p className="text-sm font-semibold text-success">Tutor criado com sucesso!</p>
              <p className="text-sm text-muted-foreground">Compartilhe as credenciais abaixo com o tutor:</p>
              <div className="p-3 rounded-lg bg-background font-mono text-sm text-foreground space-y-1 border border-border">
                <p><span className="text-muted-foreground">E-mail:</span> {newTutorEmail}</p>
                <p><span className="text-muted-foreground">Senha temp.:</span> <span className="text-primary font-bold">{createdTutorPassword}</span></p>
              </div>
              <p className="text-xs text-muted-foreground">O tutor será solicitado a alterar a senha no primeiro acesso.</p>
            </div>
            <Button className="w-full" onClick={() => { setIsModalOpen(false); resetModal(); }}>Concluir</Button>
          </div>
        ) : isBlocked ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-destructive">
                    {isSubBlocked ? "Assinatura inativa" : "Limite de pets atingido"}
                  </p>
                  <p className="text-sm text-destructive/90">
                    {isSubBlocked
                      ? "A assinatura da creche está inativa. Regularize o pagamento para cadastrar novos pets."
                      : `Você atingiu o limite de ${petLimit} ${petLimit === 1 ? "pet" : "pets"} do plano ${subscription?.plan?.name ?? ""}. Faça upgrade para cadastrar mais.`}
                  </p>
                </div>
              </div>
              {user?.role === "creche_admin" ? (
                <Button type="button" onClick={() => navigate("/assinatura")} className="self-start">
                  Fazer upgrade
                </Button>
              ) : (
                <p className="text-xs text-destructive/80">
                  Fale com o administrador da creche para liberar mais vagas.
                </p>
              )}
            </div>
            <Button type="button" variant="ghost" className="w-full" onClick={() => { setIsModalOpen(false); resetModal(); }}>
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-primary uppercase tracking-wider border-b border-border pb-1">Dados Básicos</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nome do Pet</label>
                  <Input name="name" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Data de Nasc.</label>
                  <Input name="birthDate" type="date" className="h-12 w-full rounded-xl border border-border bg-background px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">Raça</label>
                  <Input name="breed" placeholder="Ex: Poodle" />
                </div>
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
                    <option value="unknown">Desc.</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-primary uppercase tracking-wider border-b border-border pb-1">Perfil e Saúde</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Peso (kg)</label>
                  <Input name="weight" type="number" step="0.1" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cor</label>
                  <Input name="color" placeholder="Ex: Preto" />
                </div>
                <div className="space-y-2 col-span-2 md:col-span-1">
                  <label className="text-sm font-medium">Temperamento</label>
                  <select name="temperament" className={selectClass}>
                    <option value="">Selecione...</option>
                    <option value="calm">Calmo</option>
                    <option value="playful">Brincalhão</option>
                    <option value="aggressive">Agressivo</option>
                    <option value="shy">Tímido</option>
                    <option value="sociable">Sociável</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Alergias</label>
                  <Input name="allergies" placeholder="Ex: Frango..." />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Necessidades Esp.</label>
                  <Input name="specialNeeds" placeholder="Ex: Ração sênior..." />
                </div>
              </div>
              <label className="flex items-center gap-3 p-3 rounded-xl bg-secondary border border-border cursor-pointer hover:bg-secondary/80 transition-colors">
                <input type="checkbox" name="isCastrated" className="h-4 w-4 rounded accent-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">Castrado(a)</p>
                </div>
              </label>
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
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${tutorMode === "existing" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground hover:bg-secondary/80"}`}
                      >
                        <Users className="h-3 w-3" /> Existente
                      </button>
                      <button
                        type="button"
                        onClick={() => setTutorMode("new")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${tutorMode === "new" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground hover:bg-secondary/80"}`}
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
                  <div className="space-y-3 p-3 rounded-xl bg-secondary border border-border">
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

            <div className="modal-sticky-footer flex justify-end gap-3 pt-4 border-t border-border mt-4">
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
