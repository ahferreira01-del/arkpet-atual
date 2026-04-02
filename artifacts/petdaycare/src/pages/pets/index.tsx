import React, { useState } from "react";
import { useListPets, useCreatePet, PetSpecies, PetGender } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Dog, Plus, Search, Filter } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

const genderLabel: Record<string, string> = {
  male: "Macho",
  female: "Fêmea",
  unknown: "Desconhecido",
};

export default function PetsDirectory() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();
  const { data: pets, isLoading } = useListPets(crecheId);
  const createPetMutation = useCreatePet();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredPets = pets?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.breed?.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createPetMutation.mutate({
      crecheId,
      data: {
        name: formData.get("name") as string,
        species: formData.get("species") as PetSpecies,
        gender: formData.get("gender") as PetGender,
        breed: formData.get("breed") as string,
        tutorId: user?.role === 'tutor' ? user.id : 1,
      }
    }, {
      onSuccess: () => {
        setIsModalOpen(false);
        queryClient.invalidateQueries();
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
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Cadastrar Pet
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-full max-w-md">
          <Input
            icon={<Search className="h-4 w-4" />}
            placeholder="Buscar pets por nome ou raça..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="icon"><Filter className="h-4 w-4" /></Button>
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
            action={!search ? { label: "Cadastrar Primeiro Pet", onClick: () => setIsModalOpen(true) } : undefined}
          />
        </Card>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Cadastrar Pet">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do Pet</label>
            <Input name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Espécie</label>
              <select name="species" className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary backdrop-blur-md text-white">
                <option value="dog">Cachorro</option>
                <option value="cat">Gato</option>
                <option value="bird">Pássaro</option>
                <option value="other">Outro</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Sexo</label>
              <select name="gender" className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary backdrop-blur-md text-white">
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
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={createPetMutation.isPending}>Cadastrar Pet</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
