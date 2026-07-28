import { useState, useMemo } from "react";
import { Search, X, CheckCircle2 } from "lucide-react";
import type { TaggablePet } from "../types/feed.types";

interface PetSelectorProps {
  pets: TaggablePet[];
  selectedIds: number[];
  onToggle: (petId: number) => void;
}

export function PetSelector({ pets, selectedIds, onToggle }: PetSelectorProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      pets.filter((p) =>
        p.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [pets, query],
  );

  const selectedPets = pets.filter((p) => selectedIds.includes(p.id));

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Marcar Pets Presentes
      </label>

      {/* Selected chips */}
      {selectedPets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedPets.map((pet) => (
            <span
              key={pet.id}
              className="flex items-center gap-1 pl-3 pr-2 py-1 bg-primary/20 text-primary text-xs font-medium rounded-full border border-primary/30"
            >
              {pet.name}
              <button
                type="button"
                onClick={() => onToggle(pet.id)}
                className="ml-0.5 hover:text-primary/70 transition-colors"
                title={`Remover ${pet.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      {pets.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar pet…"
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}

      {/* Pet list */}
      {pets.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Nenhum pet com check-in no momento.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Nenhum pet encontrado para "{query}".
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filtered.map((pet) => {
            const selected = selectedIds.includes(pet.id);
            return (
              <button
                key={pet.id}
                type="button"
                onClick={() => onToggle(pet.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  selected
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-105"
                    : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                }`}
              >
                {selected && <CheckCircle2 className="h-3 w-3" />}
                {pet.name}
                {(pet.breed || pet.species) && (
                  <span className="opacity-60">· {pet.breed ?? pet.species}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
