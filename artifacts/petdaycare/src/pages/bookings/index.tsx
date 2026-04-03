import React, { useState } from "react";
import { useListBookings, useCreateBooking, useUpdateBooking, useCheckIn, useCheckOut, useListPets } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays, Plus, LogIn, LogOut, Navigation, Car } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type BookingStatus = "pending" | "confirmed" | "active" | "completed" | "cancelled";
type BookingType = "day_use" | "lodging";

const statusVariant: Record<BookingStatus, any> = {
  pending: "warning",
  confirmed: "success",
  active: "success",
  completed: "secondary",
  cancelled: "destructive",
};

const statusLabel: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmada",
  active: "Ativa",
  completed: "Concluída",
  cancelled: "Cancelada",
  all: "Todas",
};

function useOnTheWay(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, type, eta }: { bookingId: number; type: string; eta?: number }) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/on-the-way`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, etaMinutes: eta }),
      });
      if (!r.ok) throw new Error("Erro ao notificar chegada");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export default function Bookings() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const isTutor = user?.role === "tutor";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editBooking, setEditBooking] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [petFilter, setPetFilter] = useState<number | null>(null);
  const [onTheWayBooking, setOnTheWayBooking] = useState<any | null>(null);
  const [eta, setEta] = useState("15");

  const { data: bookings, isLoading } = useListBookings(crecheId);
  const { data: pets } = useListPets(crecheId);
  const createMutation = useCreateBooking();
  const updateMutation = useUpdateBooking();
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();
  const onTheWayMutation = useOnTheWay(crecheId);

  const myBookings = isTutor ? bookings?.filter((b) => {
    const myPetIds = pets?.map((p) => p.id) || [];
    return myPetIds.includes(b.petId);
  }) : bookings;

  const filteredByStatus = statusFilter === "all" ? myBookings : myBookings?.filter((b) => b.status === statusFilter);
  const filtered = petFilter ? filteredByStatus?.filter((b) => b.petId === petFilter) : filteredByStatus;

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate(
      {
        crecheId,
        data: {
          petId: Number(fd.get("petId")),
          type: (fd.get("type") as BookingType) || "day_use",
          startDate: fd.get("startDate") as string,
          endDate: fd.get("endDate") as string || undefined,
          notes: fd.get("notes") as string || undefined,
        },
      },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          queryClient.invalidateQueries();
          toast({ title: "Reserva criada!", description: "Aguardando confirmação da creche." });
        },
        onError: (err: any) => {
          toast({ title: "Erro", description: err?.data?.error || "Não foi possível criar a reserva.", variant: "destructive" });
        },
      }
    );
  };

  const handleStatusUpdate = (bookingId: number, newStatus: BookingStatus) => {
    updateMutation.mutate(
      { crecheId, bookingId, data: { status: newStatus } },
      { onSuccess: () => queryClient.invalidateQueries() }
    );
  };

  const handleCheckIn = (bookingId: number) => {
    checkInMutation.mutate(
      { crecheId, bookingId, data: {} },
      { onSuccess: () => queryClient.invalidateQueries() }
    );
  };

  const handleCheckOut = (bookingId: number) => {
    checkOutMutation.mutate(
      { crecheId, bookingId, data: {} },
      { onSuccess: () => queryClient.invalidateQueries() }
    );
  };

  const handleOnTheWay = (type: string) => {
    if (!onTheWayBooking) return;
    onTheWayMutation.mutate(
      { bookingId: onTheWayBooking.id, type, eta: Number(eta) || undefined },
      {
        onSuccess: () => {
          setOnTheWayBooking(null);
          toast({ title: "Notificação enviada!", description: "A creche foi avisada que você está a caminho." });
        },
        onError: () => {
          toast({ title: "Erro", description: "Não foi possível enviar a notificação.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Reservas</h1>
          <p className="text-muted-foreground mt-1">
            {isTutor ? "Suas reservas na creche." : "Gerencie day use e hospedagens."}
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova Reserva
        </Button>
      </div>

      {/* Pet filter (show when multiple pets) */}
      {pets && pets.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
          <button
            onClick={() => setPetFilter(null)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              !petFilter ? "bg-primary text-white" : "bg-white/10 text-muted-foreground hover:text-white"
            }`}
          >
            Todos os pets
          </button>
          {pets.map((p) => (
            <button
              key={p.id}
              onClick={() => setPetFilter(petFilter === p.id ? null : p.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                petFilter === p.id ? "bg-primary text-white" : "bg-white/10 text-muted-foreground hover:text-white"
              }`}
            >
              🐾 {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {["all", "pending", "confirmed", "active", "completed", "cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              statusFilter === s
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent"
            }`}
          >
            {statusLabel[s] || s}
            {s !== "all" && (
              <span className="ml-1.5 text-xs opacity-70">
                ({myBookings?.filter((b) => b.status === s).length || 0})
              </span>
            )}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando reservas...</div>
          ) : filtered?.length ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-white/5">
                  <tr>
                    <th className="px-6 py-4 font-medium">Pet {!isTutor && "/ Tutor"}</th>
                    <th className="px-6 py-4 font-medium">Tipo</th>
                    <th className="px-6 py-4 font-medium">Datas</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((booking) => (
                    <tr key={booking.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-medium text-white">{booking.petName}</p>
                        {!isTutor && (
                          <p className="text-xs text-muted-foreground mt-0.5">{booking.tutorName || "—"}</p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className="bg-white/5 capitalize">
                          {booking.type === "day_use" ? "Day Use" : "Hospedagem"}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {format(new Date(booking.startDate), "dd/MM/yyyy")}
                        {booking.endDate && (
                          <span> → {format(new Date(booking.endDate), "dd/MM/yyyy")}</span>
                        )}
                        {booking.checkInTime && (
                          <p className="text-xs text-emerald-400 mt-0.5">
                            Check-in: {format(new Date(booking.checkInTime), "HH:mm")}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={statusVariant[booking.status as BookingStatus] || "secondary"}>
                          {statusLabel[booking.status] || booking.status}
                        </Badge>
                        {(booking as any).onTheWayType && (
                          <p className="text-xs text-blue-400 mt-0.5 flex items-center gap-1">
                            <Car className="h-3 w-3" /> A caminho
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {/* Tutor: "on the way" button for drop-off/pickup */}
                          {isTutor && (booking.status === "confirmed" || booking.status === "active") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                              onClick={() => setOnTheWayBooking(booking)}
                            >
                              <Navigation className="mr-1.5 h-3.5 w-3.5" /> Estou a caminho
                            </Button>
                          )}
                          {/* Staff/Admin actions only */}
                          {!isTutor && (
                            <>
                              {booking.status === "confirmed" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                  onClick={() => handleCheckIn(booking.id)}
                                  isLoading={checkInMutation.isPending}
                                >
                                  <LogIn className="mr-1.5 h-3.5 w-3.5" /> Check-in
                                </Button>
                              )}
                              {booking.status === "active" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                                  onClick={() => handleCheckOut(booking.id)}
                                  isLoading={checkOutMutation.isPending}
                                >
                                  <LogOut className="mr-1.5 h-3.5 w-3.5" /> Check-out
                                </Button>
                              )}
                              {booking.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleStatusUpdate(booking.id, "confirmed")}
                                  isLoading={updateMutation.isPending}
                                >
                                  Confirmar
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setEditBooking(booking)}>
                                Editar
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Nenhuma reserva encontrada"
              description={statusFilter !== "all" ? `Nenhuma reserva com status "${statusLabel[statusFilter] || statusFilter}".` : isTutor ? "Agende uma visita para seu pet." : "Crie a primeira reserva."}
              action={statusFilter === "all" ? { label: "Nova Reserva", onClick: () => setIsCreateOpen(true) } : undefined}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Nova Reserva">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Pet</label>
            <select
              name="petId"
              required
              className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
            >
              <option value="">Selecione um pet...</option>
              {pets?.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.breed || p.species})</option>
              ))}
            </select>
          </div>
            <div className="space-y-2">
            <label className="text-sm font-medium">Tipo de Estadia</label>
            <select
              name="type"
              className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
            >
              <option value="day_use">Day Use (volta no mesmo dia)</option>
              <option value="lodging">Hospedagem (pernoite)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Data de Entrada</label>
              <Input name="startDate" type="date" required defaultValue={format(new Date(), "yyyy-MM-dd")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Data de Saída</label>
              <Input name="endDate" type="date" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Observações</label>
            <Input name="notes" placeholder="Ex: meu pet precisa de atenção especial..." />
          </div>
          {isTutor && (
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
              Sua reserva ficará pendente até ser confirmada pela creche.
            </div>
          )}
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={createMutation.isPending}>Solicitar Reserva</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal — Staff/Admin only */}
      {editBooking && !isTutor && (
        <Modal isOpen={!!editBooking} onClose={() => setEditBooking(null)} title="Editar Reserva">
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pet</span>
                <span className="font-medium text-white">{editBooking.petName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tipo</span>
                <span className="font-medium text-white capitalize">{editBooking.type === "day_use" ? "Day Use" : "Hospedagem"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Início</span>
                <span className="font-medium text-white">{format(new Date(editBooking.startDate), "dd/MM/yyyy")}</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alterar Status</label>
              <div className="grid grid-cols-2 gap-2">
                {(["pending", "confirmed", "active", "completed", "cancelled"] as BookingStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      handleStatusUpdate(editBooking.id, s);
                      setEditBooking(null);
                    }}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                      editBooking.status === s
                        ? "bg-primary/20 border-primary/30 text-primary"
                        : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {statusLabel[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <Button variant="ghost" onClick={() => setEditBooking(null)}>Fechar</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* On the Way Modal — Tutor only */}
      {onTheWayBooking && (
        <Modal isOpen={!!onTheWayBooking} onClose={() => setOnTheWayBooking(null)} title="Estou a Caminho">
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Avise a creche que você está a caminho para{" "}
              <span className="text-white font-medium">{onTheWayBooking.petName}</span>.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium">Previsão de chegada (minutos)</label>
              <Input
                type="number"
                min={1}
                max={120}
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                placeholder="Ex: 15"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => handleOnTheWay("drop_off")}
                isLoading={onTheWayMutation.isPending}
                className="bg-blue-600/80 hover:bg-blue-600 border-blue-500/30"
              >
                <Car className="mr-2 h-4 w-4" /> Levar o pet
              </Button>
              <Button
                onClick={() => handleOnTheWay("pickup")}
                isLoading={onTheWayMutation.isPending}
                variant="outline"
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              >
                <Navigation className="mr-2 h-4 w-4" /> Buscar o pet
              </Button>
            </div>

            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setOnTheWayBooking(null)}>Cancelar</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
