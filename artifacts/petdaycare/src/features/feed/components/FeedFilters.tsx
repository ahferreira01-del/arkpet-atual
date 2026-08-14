import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

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
      {/* Type Filters */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-between w-full sm:w-[240px] min-h-[44px] px-4 py-2 rounded-2xl bg-secondary border border-border text-foreground text-sm font-medium transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate min-w-0 break-words">
              {EVENT_OPTIONS.find((opt) => opt.value === typeFilter)?.label || "Todos os tipos"}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50 ml-2 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] sm:w-[240px] rounded-xl">
          {EVENT_OPTIONS.map((opt) => {
            const isActive = typeFilter === opt.value;
            return (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => onTypeChange(opt.value)}
                className={`flex items-center justify-between cursor-pointer rounded-lg px-3 py-2.5 text-sm ${
                  isActive ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                }`}
              >
                {opt.label}
                {isActive && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Pet Filters */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-between w-full sm:w-[240px] min-h-[44px] px-4 py-2 rounded-2xl bg-secondary border border-border text-foreground text-sm font-medium transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate min-w-0 break-words">
              {petFilter === "all"
                ? "Todos os pets"
                : pets.find((p) => String(p.id) === petFilter)?.name || "Todos os pets"}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50 ml-2 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] sm:w-[240px] rounded-xl">
          <DropdownMenuItem
            onClick={() => onPetChange("all")}
            className={`flex items-center justify-between cursor-pointer rounded-lg px-3 py-2.5 text-sm ${
              petFilter === "all" ? "bg-primary/10 text-primary font-medium" : "text-foreground"
            }`}
          >
            Todos os pets
            {petFilter === "all" && <Check className="h-4 w-4 shrink-0 ml-2" />}
          </DropdownMenuItem>
          {pets.map((pet) => {
            const isActive = petFilter === String(pet.id);
            return (
              <DropdownMenuItem
                key={pet.id}
                onClick={() => onPetChange(String(pet.id))}
                className={`flex items-center justify-between cursor-pointer rounded-lg px-3 py-2.5 text-sm ${
                  isActive ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                }`}
              >
                <span className="truncate min-w-0 break-words">
                  {pet.name} {pet.breed || pet.species ? `(${pet.breed ?? pet.species})` : ""}
                </span>
                {isActive && <Check className="h-4 w-4 shrink-0 ml-2" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
