import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdatePet, getGetPetQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UtensilsCrossed, Plus, Footprints, X } from "lucide-react";

export function PlanTab({ pet, crecheId, petId }: { pet: any; crecheId: number; petId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const updatePetMutation = useUpdatePet();
  const canEdit = user?.role !== "tutor";

  const [saved, setSaved] = useState(false);

  const defaultFeedingSchedule = [
    { time: "08:00", amount: "1 xícara", notes: "" },
    { time: "18:00", amount: "1 xícara", notes: "" },
  ];
  const defaultWalkSchedule = [
    { time: "07:00", durationMinutes: 30, notes: "" },
    { time: "17:00", durationMinutes: 30, notes: "" },
  ];

  const feedingSchedule: Array<{ time: string; amount: string; notes?: string }> =
    pet?.feedingSchedule && Array.isArray(pet.feedingSchedule) ? pet.feedingSchedule : defaultFeedingSchedule;
  const walkSchedule: Array<{ time: string; durationMinutes: number; notes?: string }> =
    pet?.walkSchedule && Array.isArray(pet.walkSchedule) ? pet.walkSchedule : defaultWalkSchedule;

  const [editFeeding, setEditFeeding] = useState<Array<{ time: string; amount: string; foodName: string; notes: string }>>(
    feedingSchedule.map((f) => ({ ...f, foodName: (f as any).foodName || "", notes: f.notes || "" }))
  );
  const [editWalk, setEditWalk] = useState<Array<{ time: string; durationMinutes: number; notes: string }>>(
    walkSchedule.map((w) => ({ ...w, notes: w.notes || "" }))
  );

  const handleSave = () => {
    updatePetMutation.mutate(
      {
        crecheId,
        petId,
        data: {
          feedingSchedule: editFeeding,
          walkSchedule: editWalk,
        } as any,
      },
      {
        onSuccess: () => {
          setSaved(true);
          queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(crecheId, petId) });
          setTimeout(() => setSaved(false), 3000);
        },
      }
    );
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Feeding Schedule */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <UtensilsCrossed className="h-4 w-4 text-orange-400" />
              </div>
              <h3 className="text-lg font-display font-semibold text-foreground">Alimentação</h3>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditFeeding([...editFeeding, { time: "12:00", amount: "", foodName: "", notes: "" }])}
              >
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {editFeeding.map((item, i) => (
              <div key={i} className="flex gap-3 p-4 rounded-xl bg-secondary border border-border items-start">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Horário</label>
                    <Input
                      type="time"
                      value={item.time}
                      onChange={(e) => {
                        const copy = [...editFeeding];
                        copy[i] = { ...copy[i], time: e.target.value };
                        setEditFeeding(copy);
                      }}
                      disabled={!canEdit}
                      className="h-9 text-base"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Quantidade</label>
                    <Input
                      value={item.amount}
                      onChange={(e) => {
                        const copy = [...editFeeding];
                        copy[i] = { ...copy[i], amount: e.target.value };
                        setEditFeeding(copy);
                      }}
                      disabled={!canEdit}
                      placeholder="Ex: 1 xícara"
                      className="h-9 text-base"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs text-muted-foreground">Nome da ração</label>
                    <Input
                      value={(item as any).foodName || ""}
                      onChange={(e) => {
                        const copy = [...editFeeding];
                        copy[i] = { ...copy[i], foodName: e.target.value };
                        setEditFeeding(copy);
                      }}
                      disabled={!canEdit}
                      placeholder="Ex: Royal Canin Medium Adult"
                      className="h-9 text-base"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs text-muted-foreground">Observações</label>
                    <Input
                      value={item.notes}
                      onChange={(e) => {
                        const copy = [...editFeeding];
                        copy[i] = { ...copy[i], notes: e.target.value };
                        setEditFeeding(copy);
                      }}
                      disabled={!canEdit}
                      placeholder="Ex: evitar ração com frango"
                      className="h-9 text-base"
                    />
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditFeeding(editFeeding.filter((_, j) => j !== i))}
                    className="h-7 w-7 rounded-full bg-destructive/10 flex items-center justify-center hover:bg-destructive/20 text-destructive transition-colors mt-6"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {editFeeding.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm">Nenhum horário de alimentação configurado.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Walk Schedule */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center">
                <Footprints className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-lg font-display font-semibold text-foreground">Passeios</h3>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditWalk([...editWalk, { time: "12:00", durationMinutes: 30, notes: "" }])}
              >
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {editWalk.map((item, i) => (
              <div key={i} className="flex gap-3 p-4 rounded-xl bg-secondary border border-border items-start">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Horário</label>
                    <Input
                      type="time"
                      value={item.time}
                      onChange={(e) => {
                        const copy = [...editWalk];
                        copy[i] = { ...copy[i], time: e.target.value };
                        setEditWalk(copy);
                      }}
                      disabled={!canEdit}
                      className="h-9 text-base"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Duração (min)</label>
                    <Input
                      type="number"
                      min={5}
                      max={180}
                      value={item.durationMinutes}
                      onChange={(e) => {
                        const copy = [...editWalk];
                        copy[i] = { ...copy[i], durationMinutes: Number(e.target.value) };
                        setEditWalk(copy);
                      }}
                      disabled={!canEdit}
                      className="h-9 text-base"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs text-muted-foreground">Notas</label>
                    <Input
                      value={item.notes}
                      onChange={(e) => {
                        const copy = [...editWalk];
                        copy[i] = { ...copy[i], notes: e.target.value };
                        setEditWalk(copy);
                      }}
                      disabled={!canEdit}
                      placeholder="Ex: evitar sol forte"
                      className="h-9 text-base"
                    />
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditWalk(editWalk.filter((_, j) => j !== i))}
                    className="h-7 w-7 rounded-full bg-destructive/10 flex items-center justify-center hover:bg-destructive/20 text-destructive transition-colors mt-6"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {editWalk.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm">Nenhum horário de passeio configurado.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex items-center gap-4">
          <Button onClick={handleSave} isLoading={updatePetMutation.isPending}>
            Salvar Plano
          </Button>
          {saved && (
            <p className="text-sm text-success">✓ Plano salvo com sucesso</p>
          )}
        </div>
      )}
    </div>
  );
}
