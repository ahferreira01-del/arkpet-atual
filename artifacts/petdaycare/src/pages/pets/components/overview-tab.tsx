import React from "react";
import { useListWalks } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Footprints, Trash2, Receipt } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useListBookings } from "@workspace/api-client-react";
import { useBookingConsumables, useDeleteBookingConsumable } from "@/hooks/use-financial";
import { parseLocalDate } from "@/lib/date-utils";
import { ptBR } from "date-fns/locale";
import { resolvePhotoUrl } from "@/lib/utils";

const statusMap: Record<string, string> = { active: "Ativo", inactive: "Inativo", suspended: "Suspenso", archived: "Arquivado" };
export function OverviewTab({ pet, crecheId, petId }: { pet: any; crecheId: number; petId: number }) {
  const { user } = useAuth();
  const { data: walks } = useListWalks(crecheId, petId);
  const { data: bookingsResponse } = useListBookings(crecheId);
  const bookings = (bookingsResponse as any)?.items;
  const recentWalks = walks?.slice(0, 4) ?? [];

  const safeBookings = Array.isArray(bookings)
    ? bookings
    : (bookings as any)?.data ?? (bookings as any)?.bookings ?? [];
  const confirmedBooking = safeBookings.find((b: any) => b.petId === petId && b.status === "confirmed");
  
  const { data: consumables, isLoading: consumablesLoading } = useBookingConsumables(crecheId, confirmedBooking?.id);
  const deleteConsumable = useDeleteBookingConsumable(crecheId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardContent className="p-6 space-y-5">
          <h3 className="text-lg font-display font-semibold border-b border-white/10 pb-2">Informações Gerais</h3>
          <div className="grid grid-cols-2 gap-y-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Tutor</p>
              <p className="font-medium text-white">{pet.tutorName || "Sem tutor"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Data de Nascimento</p>
              <p className="font-medium text-white">{pet.birthDate ? format(parseLocalDate(pet.birthDate), "dd/MM/yyyy") : "Desconhecida"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Cor</p>
              <p className="font-medium text-white capitalize">{pet.color || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Status</p>
              <p className="font-medium text-white capitalize">{statusMap[pet.status] || pet.status}</p>
            </div>
          </div>
          {pet.allergies && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
              <p className="text-sm font-medium text-red-400 mb-1">⚠ Alergias</p>
              <p className="text-sm text-muted-foreground">{pet.allergies}</p>
            </div>
          )}
          {pet.specialNeeds && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm font-medium text-amber-400 mb-1">⚠ Necessidades Especiais</p>
              <p className="text-sm text-muted-foreground">{pet.specialNeeds}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-lg font-display font-semibold border-b border-white/10 pb-2 mb-4">Alimentação</h3>
          {Array.isArray(pet.feedingSchedule) && pet.feedingSchedule.length > 0 ? (
            <div className="space-y-2.5 text-sm">
              {pet.feedingSchedule.map((item: any, i: number) => (
                <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-white">🕐 {item.time}</span>
                    <span className="text-primary font-medium">{item.amount}</span>
                  </div>
                  {item.foodName && (
                    <p className="text-xs text-muted-foreground">🍽️ {item.foodName}</p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5">📝 {item.notes}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">Nenhum horário de alimentação configurado.</div>
          )}
        </CardContent>
      </Card>

      {/* Consumos da Estadia Atual */}
      {pet.isCheckedIn && confirmedBooking && (
        <Card className="md:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-4">
              <h3 className="text-lg font-display font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5 text-emerald-400" />
                Consumos da Estadia
              </h3>
            </div>
            {consumablesLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Carregando consumos...</div>
            ) : consumables && consumables.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {consumables.map((c: any) => (
                  <div key={c.id} className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-white text-sm">{c.catalogueItemName || "Produto Diversos"}</p>
                      <p className="text-xs text-emerald-400">
                        {c.quantity}x • {(c.chargedPrice / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </p>
                    </div>
                    {user?.role !== "tutor" && (
                      <button
                        onClick={() => deleteConsumable.mutate({ consumableId: c.id })}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remover lançamento"
                        disabled={deleteConsumable.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">Nenhum consumo adicional registrado.</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Foto dos Itens Pessoais — último check-in */}
      {pet.lastCheckinPhotoUrl && (
        <Card className="md:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-4">
              <h3 className="text-lg font-display font-semibold flex items-center gap-2">
                <Package className="h-5 w-5 text-amber-400" />
                Itens Pessoais
              </h3>
              <span className="text-xs text-muted-foreground">Foto do último check-in</span>
            </div>
            <div className="rounded-xl overflow-hidden border border-white/10 max-w-sm">
              <img
                src={resolvePhotoUrl(pet.lastCheckinPhotoUrl)!}
                alt="Itens pessoais registrados no check-in"
                className="w-full object-cover"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Últimos Passeios — full width */}
      <Card className="md:col-span-2">
        <CardContent className="p-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-4">
            <h3 className="text-lg font-display font-semibold flex items-center gap-2">
              <Footprints className="h-5 w-5 text-primary" />
              Últimos Passeios
            </h3>
            {recentWalks.length > 0 && (
              <Badge variant="secondary" className="text-xs">{walks?.length ?? 0} total</Badge>
            )}
          </div>
          {recentWalks.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recentWalks.map((walk: any) => {
                const isCompleted = walk.status === "completed" || !!walk.endTime;
                const durationMs = walk.endTime && walk.startTime
                  ? new Date(walk.endTime).getTime() - new Date(walk.startTime).getTime()
                  : walk.durationMinutes
                  ? walk.durationMinutes * 60000
                  : null;
                const durationMin = durationMs != null ? Math.round(durationMs / 60000) : null;
                return (
                  <div key={walk.id} className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Footprints className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {walk.staffName || "Funcionário"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {walk.startTime && !isNaN(new Date(walk.startTime).getTime())
                            ? format(new Date(walk.startTime), "dd/MM/yy HH:mm", { locale: ptBR })
                            : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge variant={isCompleted ? "success" : "secondary"} className="text-xs">
                        {isCompleted ? "Concluído" : "Em andamento"}
                      </Badge>
                      {durationMin != null && (
                        <p className="text-xs text-muted-foreground mt-1">{durationMin} min</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">Nenhum passeio registrado para este pet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
