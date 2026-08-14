import React, { useState } from "react";
import { useListPets } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Footprints, Play, Square, Dog, Clock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

function useCreecheWalks(crecheId: number) {
  return useQuery<any[]>({
    queryKey: ["creche-walks", crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/walks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Erro ao carregar passeios");
      return r.json();
    },
    enabled: !!crecheId,
    refetchInterval: 30000,
  });
}

function ActiveWalkCard({ walk, onEnd, isEnding }: { walk: any, onEnd: (id: number) => void, isEnding: boolean }) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    if (!walk.durationMinutes || !walk.startedAt) return;
    
    const startMs = new Date(walk.startedAt).getTime();
    const durationMs = walk.durationMinutes * 60 * 1000;
    
    const tick = () => {
      const now = Date.now();
      const remaining = startMs + durationMs - now;
      if (remaining <= 0) {
        setTimeLeft(0);
        if (!ended) {
          setEnded(true);
          toast({ title: "Tempo Esgotado!", description: `O passeio de ${walk.petName} chegou ao fim automático.`, variant: "destructive" });
          onEnd(walk.id);
        }
      } else {
        setTimeLeft(Math.floor(remaining / 1000));
      }
    };
    
    tick(); // initial tick
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [walk, ended, onEnd, toast]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <Card className="border-primary/20 shadow-sm relative overflow-hidden">
      {timeLeft !== null && timeLeft > 0 && (
        <div className="absolute top-0 left-0 h-1.5 bg-primary/80" style={{ width: `${(timeLeft / (walk.durationMinutes * 60)) * 100}%`, transition: 'width 1s linear' }} />
      )}
      <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center relative z-10">
            <Footprints className="h-6 w-6 text-primary" />
          </div>
          <div className="relative z-10">
            <p className="font-semibold text-foreground text-lg">{walk.petName}</p>
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
              <Clock className="h-3.5 w-3.5" />
              {timeLeft !== null ? (
                <span className={timeLeft < 60 ? "text-error font-medium" : "text-success font-medium"}>
                  Restam {formatTime(timeLeft)}
                </span>
              ) : (
                <>Iniciado {formatDistanceToNow(new Date(walk.startedAt), { addSuffix: true, locale: ptBR })}</>
              )}
            </p>
            {walk.staffName && (
              <p className="text-xs text-muted-foreground mt-0.5">por {walk.staffName}</p>
            )}
          </div>
        </div>
        <Button
          onClick={() => onEnd(walk.id)}
          isLoading={isEnding}
          variant="outline"
          className="w-full sm:w-auto min-h-[44px] relative z-10 shadow-sm hover:bg-primary/5 hover:text-primary hover:border-primary/30"
        >
          <Square className="mr-2 h-4 w-4" /> Finalizar Passeio
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Walks({ hideHeader }: { hideHeader?: boolean }) {
  const { user } = useAuth();
  const crecheId = user?.crecheId as number;
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPetId, setSelectedPetId] = useState<number>(0);
  const [duration, setDuration] = useState<number>(30);

  const { data: walks, isLoading } = useCreecheWalks(crecheId);
  const { data: petsResponse } = useListPets(crecheId);
  const pets = petsResponse?.items;

  const startMutation = useMutation({
    mutationFn: async ({ petId, durationMinutes }: { petId: number, durationMinutes: number }) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/walks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ petId, durationMinutes }),
      });
      if (!r.ok) throw new Error("Erro ao iniciar passeio");
      return r.json();
    },
    onSuccess: () => {
      setIsModalOpen(false);
      setSelectedPetId(0);
      setDuration(30);
      queryClient.invalidateQueries({ queryKey: ["creche-walks"] });
    },
  });

  const endMutation = useMutation({
    mutationFn: async ({ walkId }: { walkId: number }) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/walks/${walkId}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("Erro ao finalizar passeio");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creche-walks"] }),
  });

  const activeWalks = walks?.filter((w) => w.status === "in_progress") || [];
  const completedWalks = walks?.filter((w) => w.status === "completed") || [];
  const checkedInPets = pets?.filter((p) => p.isCheckedIn) || [];

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPetId) return;
    startMutation.mutate({ petId: selectedPetId, durationMinutes: duration });
  };

  return (
    <div className={hideHeader ? "space-y-6 max-w-3xl mx-auto" : "space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto"}>
      {!hideHeader && (
        <PageHeader
          title="Passeios"
          description="Registre e acompanhe os passeios dos pets."
          icon={Footprints}
          action={
            <Button onClick={() => setIsModalOpen(true)}>
              <Play className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Iniciar Passeio</span>
            </Button>
          }
        />
      )}
      {hideHeader && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setIsModalOpen(true)} className="w-full sm:w-auto">
            <Play className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Iniciar Passeio</span>
            <span className="inline sm:hidden ml-2">Iniciar Passeio</span>
          </Button>
        </div>
      )}

      {/* Active walks */}
      {activeWalks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
            Em Andamento ({activeWalks.length})
          </h2>
          {activeWalks.map((walk) => (
            <ActiveWalkCard
              key={walk.id}
              walk={walk}
              onEnd={(id) => endMutation.mutate({ walkId: id })}
              isEnding={endMutation.isPending && (endMutation.variables as any)?.walkId === walk.id}
            />
          ))}
        </div>
      )}

      {/* History */}
      <div className="space-y-4">
        <h2 className="text-xl font-display font-semibold text-foreground">Histórico de Passeios</h2>
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando passeios...</div>
            ) : completedWalks.length ? (
              <div className="divide-y divide-border">
                {completedWalks.map((walk) => (
                  <div key={walk.id} className="px-4 py-4 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                        <Dog className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{walk.petName}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {format(new Date(walk.startedAt), "dd/MM HH:mm")}
                          {walk.endedAt && ` → ${format(new Date(walk.endedAt), "HH:mm")}`}
                        </p>
                        {walk.staffName && (
                          <p className="text-xs text-muted-foreground truncate">por {walk.staffName}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {walk.durationMinutes ? (
                        <Badge variant="outline" className="bg-secondary/50">
                          <Clock className="h-3 w-3 mr-1" />
                          {walk.durationMinutes} min
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Concluído</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeWalks.length === 0 ? (
              <EmptyState
                icon={Footprints}
                title="Nenhum passeio registrado"
                description="Inicie um passeio para começar o rastreamento."
                action={{ label: "Iniciar Primeiro Passeio", onClick: () => setIsModalOpen(true) }}
              />
            ) : (
              <div className="p-6 text-center text-muted-foreground text-sm">Nenhum passeio concluído ainda.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Iniciar Passeio">
        <form onSubmit={handleStart} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Selecione o Pet</label>
            {checkedInPets.length > 0 ? (
              <select
                value={selectedPetId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSelectedPetId(id);
                  const pet = checkedInPets.find(p => p.id === id);
                  if (pet?.walkSchedule && Array.isArray(pet.walkSchedule) && pet.walkSchedule.length > 0) {
                    const plannedDuration = pet.walkSchedule[0]?.durationMinutes;
                    if (plannedDuration) setDuration(Number(plannedDuration));
                  }
                }}
                required
                className="flex h-12 w-full rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
              >
                <option value={0} disabled>Escolha um pet com check-in...</option>
                {checkedInPets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.breed || p.species})</option>
                ))}
              </select>
            ) : (
              <div className="p-4 rounded-xl bg-warning/10 border border-warning/20 text-sm text-warning font-medium">
                Nenhum pet fez check-in. Realize o check-in de um pet antes de iniciar o passeio.
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tempo estipulado (minutos)</label>
            <input
              type="number"
              min="1"
              value={duration}
              readOnly
              disabled
              className="flex h-12 w-full rounded-xl border border-border bg-muted/50 px-3 py-2 text-base text-muted-foreground focus:outline-none cursor-not-allowed"
            />
          </div>
          <div className="modal-sticky-footer flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)} className="min-h-[44px]">Cancelar</Button>
            <Button type="submit" isLoading={startMutation.isPending} disabled={!selectedPetId} className="min-h-[44px]">
              <Play className="mr-2 h-4 w-4" /> Iniciar Passeio
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
