import React, { useState } from "react";
import { useListWalks, useStartWalk, useEndWalk, useListPets } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Footprints, Play, Square, Dog, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

export default function Walks() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPetId, setSelectedPetId] = useState<number>(0);
  const queryClient = useQueryClient();

  const { data: pets } = useListPets(crecheId);
  const { data: walks, isLoading } = useListWalks(crecheId);
  const startMutation = useStartWalk();
  const endMutation = useEndWalk();

  const activeWalks = walks?.filter((w) => !w.endedAt) || [];
  const completedWalks = walks?.filter((w) => w.endedAt) || [];

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPetId) return;
    startMutation.mutate(
      { crecheId, petId: selectedPetId, data: {} },
      {
        onSuccess: () => {
          setIsModalOpen(false);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  const handleEnd = (petId: number, walkId: number) => {
    endMutation.mutate(
      { crecheId, petId, walkId, data: {} },
      { onSuccess: () => queryClient.invalidateQueries() }
    );
  };

  const checkedInPets = pets?.filter((p) => p.isCheckedIn) || [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Walks</h1>
          <p className="text-muted-foreground mt-1">Track and log pet walks.</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Play className="mr-2 h-4 w-4" /> Start Walk
        </Button>
      </div>

      {/* Active walks */}
      {activeWalks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold text-white flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            Active Walks ({activeWalks.length})
          </h2>
          {activeWalks.map((walk) => (
            <Card key={walk.id} className="border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.1)]">
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Footprints className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-white text-lg">{walk.petName}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3.5 w-3.5" />
                      Started {formatDistanceToNow(new Date(walk.startedAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => handleEnd(walk.petId, walk.id)}
                  isLoading={endMutation.isPending}
                  variant="outline"
                  className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                >
                  <Square className="mr-2 h-4 w-4" /> End Walk
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Completed walks */}
      <div className="space-y-4">
        <h2 className="text-xl font-display font-semibold text-white">Walk History</h2>
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading walks...</div>
            ) : completedWalks.length ? (
              <div className="divide-y divide-white/5">
                {completedWalks.map((walk) => (
                  <div key={walk.id} className="px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center">
                        <Dog className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{walk.petName}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(walk.startedAt), "MMM d, h:mm a")}
                          {walk.endedAt && ` → ${format(new Date(walk.endedAt), "h:mm a")}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      {walk.durationMinutes ? (
                        <Badge variant="outline" className="bg-white/5">
                          <Clock className="h-3 w-3 mr-1" />
                          {walk.durationMinutes} min
                        </Badge>
                      ) : (
                        <Badge variant="secondary">In Progress</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeWalks.length === 0 ? (
              <EmptyState
                icon={Footprints}
                title="No walks recorded"
                description="Start a walk to begin tracking."
                action={{ label: "Start First Walk", onClick: () => setIsModalOpen(true) }}
              />
            ) : (
              <div className="p-6 text-center text-muted-foreground text-sm">No completed walks yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Start a Walk">
        <form onSubmit={handleStart} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Pet</label>
            {checkedInPets.length > 0 ? (
              <select
                value={selectedPetId}
                onChange={(e) => setSelectedPetId(Number(e.target.value))}
                required
                className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
              >
                <option value={0} disabled>Choose a pet...</option>
                {checkedInPets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.breed || p.species})</option>
                ))}
              </select>
            ) : (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
                No pets are currently checked in. Check a pet in first to start a walk.
              </div>
            )}
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button type="submit" isLoading={startMutation.isPending} disabled={!selectedPetId}>
              <Play className="mr-2 h-4 w-4" /> Start Walk
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
