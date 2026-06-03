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

export default function Walks() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPetId, setSelectedPetId] = useState<number>(0);

  const { data: walks, isLoading } = useCreecheWalks(crecheId);
  const { data: pets } = useListPets(crecheId);

  const startMutation = useMutation({
    mutationFn: async (petId: number) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/walks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ petId }),
      });
      if (!r.ok) throw new Error("Erro ao iniciar passeio");
      return r.json();
    },
    onSuccess: () => {
      setIsModalOpen(false);
      setSelectedPetId(0);
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
    startMutation.mutate(selectedPetId);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto">
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

      {/* Active walks */}
      {activeWalks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold text-white flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            Em Andamento ({activeWalks.length})
          </h2>
          {activeWalks.map((walk) => (
            <Card key={walk.id} className="border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.1)]">
              <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 flex-shrink-0 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Footprints className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-white text-lg">{walk.petName}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3.5 w-3.5" />
                      Iniciado {formatDistanceToNow(new Date(walk.startedAt), { addSuffix: true, locale: ptBR })}
                    </p>
                    {walk.staffName && (
                      <p className="text-xs text-muted-foreground mt-0.5">por {walk.staffName}</p>
                    )}
                  </div>
                </div>
                <Button
                  onClick={() => endMutation.mutate({ walkId: walk.id })}
                  isLoading={endMutation.isPending}
                  variant="outline"
                  className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 w-full sm:w-auto"
                >
                  <Square className="mr-2 h-4 w-4" /> Finalizar Passeio
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* History */}
      <div className="space-y-4">
        <h2 className="text-xl font-display font-semibold text-white">Histórico de Passeios</h2>
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando passeios...</div>
            ) : completedWalks.length ? (
              <div className="divide-y divide-white/5">
                {completedWalks.map((walk) => (
                  <div key={walk.id} className="px-4 py-4 flex items-center justify-between gap-3 hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                        <Dog className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate">{walk.petName}</p>
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
                        <Badge variant="outline" className="bg-white/5">
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
                onChange={(e) => setSelectedPetId(Number(e.target.value))}
                required
                className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-base text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
              >
                <option value={0} disabled>Escolha um pet com check-in...</option>
                {checkedInPets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.breed || p.species})</option>
                ))}
              </select>
            ) : (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
                Nenhum pet fez check-in. Realize o check-in de um pet antes de iniciar o passeio.
              </div>
            )}
          </div>
          <div className="modal-sticky-footer flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={startMutation.isPending} disabled={!selectedPetId}>
              <Play className="mr-2 h-4 w-4" /> Iniciar Passeio
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
