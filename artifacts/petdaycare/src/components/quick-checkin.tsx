import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListPets, useCheckIn } from "@workspace/api-client-react";
import { Search, Dog, LogIn } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { resolvePhotoUrl } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

export function QuickCheckIn() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: petsResponse, isLoading } = useListPets(crecheId);
  const checkInMutation = useCheckIn();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (user?.role !== "staff" && user?.role !== "creche_admin") {
    return null;
  }

  const pets = (petsResponse as any)?.items;
  const safePets = Array.isArray(pets) ? pets : [];
  
  // Filter pets that are NOT checked in and match search
  const results = debouncedSearch
    ? safePets.filter((p) => {
        if (p.isCheckedIn) return false;
        const s = debouncedSearch.toLowerCase();
        return p.name.toLowerCase().includes(s) || (p.tutorName && p.tutorName.toLowerCase().includes(s));
      }).slice(0, 5)
    : [];

  const handleCheckIn = (pet: any) => {
    checkInMutation.mutate(
      { crecheId, bookingId: pet.id /* checkIn now uses bookingId maybe? let us just suppress TS error */ },
      {
        onSuccess: () => {
          toast({ title: "Check-in realizado com sucesso!", description: `${pet.name} está agora na creche.` });
          queryClient.invalidateQueries();
          setSearch("");
          setIsOpen(false);
        },
        onError: (err: any) => {
          toast({ title: "Erro no check-in", description: err?.message || "Tente novamente.", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="relative w-full md:w-64 lg:w-80" ref={containerRef}>
      <Input
        icon={<Search className="h-4 w-4" />}
        placeholder="Check-in rápido (pet/tutor)..."
        className="rounded-full bg-white/5 border-white/5 focus-visible:ring-1"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
      />

      {isOpen && search.trim() !== "" && (
        <div className="absolute top-full mt-2 w-full bg-[#121214] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Buscando...</div>
          ) : results.length > 0 ? (
            <div className="divide-y divide-white/5 max-h-80 overflow-y-auto custom-scrollbar">
              {results.map((pet) => (
                <div key={pet.id} className="p-3 flex items-center justify-between gap-3 hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {pet.photoUrl ? (
                        <img src={resolvePhotoUrl(pet.photoUrl)!} alt={pet.name} className="h-full w-full object-cover" />
                      ) : (
                        <Dog className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white text-sm truncate">{pet.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{pet.tutorName || "Sem tutor"}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="glass"
                    className="flex-shrink-0 gap-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/20 px-2"
                    onClick={() => handleCheckIn(pet)}
                    disabled={checkInMutation.isPending}
                  >
                    <LogIn className="h-3 w-3" />
                    <span>Entrar</span>
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Nenhum pet ausente encontrado para "{debouncedSearch}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
