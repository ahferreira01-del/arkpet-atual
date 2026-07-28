interface FeedFiltersProps {
  typeFilter: string;
  petFilter: string;
  pets: Array<{ id: number; name: string; breed?: string | null; species?: string | null }>;
  onTypeChange: (v: string) => void;
  onPetChange: (v: string) => void;
}

const EVENT_OPTIONS = [
  { value: "all", label: "Todos os tipos" },
  { value: "photo",      label: "📸 Foto" },
  { value: "video",      label: "🎥 Vídeo" },
  { value: "note",       label: "📝 Nota" },
  { value: "play",       label: "🎾 Brincadeira" },
  { value: "walk",       label: "🦮 Passeio" },
  { value: "feeding",    label: "🍽️ Alimentação" },
  { value: "medication", label: "💊 Medicação" },
  { value: "health",     label: "🏥 Saúde" },
  { value: "check_in",   label: "✅ Check-in" },
  { value: "check_out",  label: "🏠 Check-out" },
];

export function FeedFilters({ typeFilter, petFilter, pets, onTypeChange, onPetChange }: FeedFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <select
        value={typeFilter}
        onChange={(e) => onTypeChange(e.target.value)}
        className="flex-1 h-10 px-3 rounded-xl bg-card border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary transition-colors hover:border-white/20"
      >
        {EVENT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        value={petFilter}
        onChange={(e) => onPetChange(e.target.value)}
        className="flex-1 h-10 px-3 rounded-xl bg-card border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary transition-colors hover:border-white/20"
      >
        <option value="all">Todos os pets</option>
        {pets.map((pet) => (
          <option key={pet.id} value={String(pet.id)}>
            {pet.name} {pet.breed || pet.species ? `(${pet.breed ?? pet.species})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
