import React, { useState, useRef, useEffect } from "react";
import { useListBookings, useCreateBooking, useUpdateBooking, useCheckIn, useCheckOut, useListPets, useListTasks } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays as Calendar, Plus, LogIn, LogOut, Navigation, Car, ChevronDown, Search, X, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format } from "date-fns";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type BookingStatus = "pending" | "confirmed" | "active" | "completed" | "cancelled";
type BookingType = "day_use" | "lodging" | "banho" | "hospedagem_banho" | "visita" | "pacote_4dias" | "pacote_8dias" | "pacote_20dias" | "visita_taxi" | "creche_taxi";

const bookingTypeLabel: Record<string, string> = {
  day_use: "Day Use",
  banho: "Banho",
  hospedagem_banho: "Hospedagem + Banho",
  lodging: "Hospedagem",
  visita: "Visita",
  pacote_4dias: "Pacote 4 Dias",
  pacote_8dias: "Pacote 8 Dias",
  pacote_20dias: "Pacote 20 Dias",
  visita_taxi: "Visita + Táxi",
  creche_taxi: "Creche + Táxi",
};

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

function PetCombobox({ pets, value, onChange }: { pets: any[]; value: number | null; onChange: (id: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = pets.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const selected = pets.find((p) => p.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="flex items-center gap-2 pl-3 pr-2 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white hover:bg-white/10 transition-all min-w-[180px] max-w-[260px]"
      >
        <span className="flex-1 text-left truncate">
          {selected ? `🐾 ${selected.name}` : "Todos os pets"}
        </span>
        {selected ? (
          <X
            className="h-3.5 w-3.5 text-muted-foreground hover:text-white flex-shrink-0"
            onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }}
          />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-64 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-white/10">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5">
              <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pet..."
                className="flex-1 bg-transparent text-sm text-white placeholder:text-muted-foreground outline-none"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/5 ${!value ? "text-primary font-medium" : "text-muted-foreground hover:text-white"}`}
            >
              Todos os pets
            </button>
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">Nenhum pet encontrado</p>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/5 flex items-center gap-2 ${value === p.id ? "text-primary font-medium" : "text-white hover:text-white"}`}
              >
                🐾 <span className="truncate">{p.name}</span>
                {value === p.id && <span className="ml-auto text-xs text-primary">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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

  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editBooking, setEditBooking] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(() => urlParams.get("status") || "all");
  const [petFilter, setPetFilter] = useState<number | null>(null);
  const [onTheWayBooking, setOnTheWayBooking] = useState<any | null>(null);
  const [eta, setEta] = useState("15");
  const [checkoutBooking, setCheckoutBooking] = useState<any | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<"confirm" | "completing">("confirm");

  const { data: bookings, isLoading } = useListBookings(crecheId);
  const { data: pets } = useListPets(crecheId);
  const { data: allTasks } = useListTasks(crecheId);
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
          type: ((fd.get("type") as string) || "day_use") as any,
          startDate: fd.get("startDate") as string,
          endDate: fd.get("endDate") as string || undefined,
          notes: fd.get("notes") as string || undefined,
        } as any,
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
      { crecheId, bookingId } as any,
      { onSuccess: () => queryClient.invalidateQueries() }
    );
  };

  const pendingTasksForBooking = (booking: any) =>
    (allTasks || []).filter((t) => t.petId === booking.petId && t.status === "pending");

  const doCheckOut = (bookingId: number) => {
    checkOutMutation.mutate(
      { crecheId, bookingId } as any,
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          setCheckoutBooking(null);
        },
      }
    );
  };

  const handleCheckOut = (booking: any) => {
    const pending = pendingTasksForBooking(booking);
    if (pending.length > 0) {
      setCheckoutStep("confirm");
      setCheckoutBooking(booking);
    } else {
      doCheckOut(booking.id);
    }
  };

  const handleCheckOutCompleteTasks = async () => {
    if (!checkoutBooking) return;
    setCheckoutStep("completing");
    const token = localStorage.getItem("auth_token");
    try {
      await fetch(`/api/creches/${crecheId}/tasks/complete-by-pet/${checkoutBooking.petId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // proceed anyway
    }
    doCheckOut(checkoutBooking.id);
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
      <PageHeader
        title="Reservas"
        description={isTutor ? "Suas reservas na creche." : "Gerencie day use e hospedagens."}
        icon={Calendar}
        action={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Nova Reserva</span>
          </Button>
        }
      />

      {/* Pet filter combobox */}
      {pets && pets.length > 0 && !isTutor && (
        <PetCombobox
          pets={pets}
          value={petFilter}
          onChange={setPetFilter}
        />
      )}

      {/* Status filter tabs - horizontal scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar -mx-1 px-1">
        {["all", "pending", "confirmed", "active", "completed", "cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              statusFilter === s
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent"
            }`}
          >
            {statusLabel[s] || s}
            {s !== "all" && (
              <span className="ml-1 text-xs opacity-70">
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
            <>
              {/* ── MOBILE CARD VIEW ──────────────────────────────── */}
              <div className="md:hidden divide-y divide-white/5">
                {filtered.map((booking) => (
                  <div key={booking.id} className="p-4 space-y-3">
                    {/* Row 1: pet name + tutor */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-white">{booking.petName}</p>
                        {!isTutor && (
                          <p className="text-xs text-muted-foreground mt-0.5">{booking.tutorName || "—"}</p>
                        )}
                      </div>
                      {(booking as any).onTheWayType && (
                        <span className="text-xs text-blue-400 flex items-center gap-0.5 flex-shrink-0">
                          <Car className="h-3 w-3" /> A caminho
                        </span>
                      )}
                    </div>
                    {/* Row 2: status + type + dates */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={statusVariant[booking.status as BookingStatus] || "secondary"} className="text-xs">
                        {statusLabel[booking.status] || booking.status}
                      </Badge>
                      <Badge variant="outline" className="bg-white/5 text-xs">
                        {bookingTypeLabel[booking.type] || booking.type}
                      </Badge>
                      {booking.checkInTime && (
                        <span className="text-xs text-emerald-400">
                          ✓ {format(new Date(booking.checkInTime), "HH:mm")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(booking.startDate), "dd/MM/yyyy")}
                      {booking.endDate && ` → ${format(new Date(booking.endDate), "dd/MM/yyyy")}`}
                    </div>
                    {/* Row 3: action buttons */}
                    <div className="flex gap-2 flex-wrap">
                      {(booking.status === "confirmed" || booking.status === "active") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs"
                          onClick={() => setOnTheWayBooking(booking)}
                        >
                          <Navigation className="mr-1 h-3 w-3" /> A caminho
                        </Button>
                      )}
                      {isTutor && (booking.status === "pending" || booking.status === "confirmed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive/40 text-destructive/80 hover:bg-destructive/10 text-xs"
                          onClick={() => handleStatusUpdate(booking.id, "cancelled")}
                          isLoading={updateMutation.isPending}
                        >
                          Cancelar reserva
                        </Button>
                      )}
                      {!isTutor && (
                        <>
                          {booking.status === "confirmed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs"
                              onClick={() => handleCheckIn(booking.id)}
                              isLoading={checkInMutation.isPending}
                            >
                              <LogIn className="mr-1 h-3 w-3" /> Check-in
                            </Button>
                          )}
                          {booking.status === "active" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs"
                              onClick={() => handleCheckOut(booking)}
                              isLoading={checkOutMutation.isPending}
                            >
                              <LogOut className="mr-1 h-3 w-3" /> Check-out
                            </Button>
                          )}
                          {booking.status === "pending" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              onClick={() => handleStatusUpdate(booking.id, "confirmed")}
                              isLoading={updateMutation.isPending}
                            >
                              Confirmar
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setEditBooking(booking)}>
                            Editar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── DESKTOP TABLE VIEW ────────────────────────────── */}
              <div className="hidden md:block overflow-x-auto custom-scrollbar">
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
                            {bookingTypeLabel[booking.type] || booking.type}
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
                            {(booking.status === "confirmed" || booking.status === "active") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                                onClick={() => setOnTheWayBooking(booking)}
                              >
                                <Navigation className="mr-1.5 h-3.5 w-3.5" /> A caminho
                              </Button>
                            )}
                            {isTutor && (booking.status === "pending" || booking.status === "confirmed") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-destructive/40 text-destructive/80 hover:bg-destructive/10"
                                onClick={() => handleStatusUpdate(booking.id, "cancelled")}
                                isLoading={updateMutation.isPending}
                              >
                                Cancelar reserva
                              </Button>
                            )}
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
                                    onClick={() => handleCheckOut(booking)}
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
            </>
          ) : (
            <EmptyState
              icon={Calendar}
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
              <option value="banho">Banho</option>
              <option value="hospedagem_banho">Hospedagem + Banho</option>
              <option value="visita">Visita (avaliação ou consulta)</option>
              <option value="pacote_4dias">Pacote 4 Dias</option>
              <option value="pacote_8dias">Pacote 8 Dias</option>
              <option value="pacote_20dias">Pacote 20 Dias</option>
              <option value="visita_taxi">Visita + Táxi</option>
              <option value="creche_taxi">Creche + Táxi</option>
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <span className="font-medium text-white capitalize">{bookingTypeLabel[editBooking.type] || editBooking.type}</span>
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

      {/* Checkout — Pending Tasks Confirmation Dialog */}
      {checkoutBooking && (
        <Modal
          isOpen={!!checkoutBooking}
          onClose={() => !checkOutMutation.isPending && setCheckoutBooking(null)}
          title="Tarefas Pendentes"
        >
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <ClipboardList className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">
                  {checkoutBooking.petName} tem{" "}
                  {pendingTasksForBooking(checkoutBooking).length} tarefa
                  {pendingTasksForBooking(checkoutBooking).length !== 1 ? "s" : ""} pendente
                  {pendingTasksForBooking(checkoutBooking).length !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Deseja concluir todas as tarefas pendentes deste pet antes de fazer o check-out?
                </p>
              </div>
            </div>

            {/* List pending tasks */}
            <ul className="space-y-1.5 max-h-40 overflow-y-auto">
              {pendingTasksForBooking(checkoutBooking).map((t: any) => (
                <li key={t.id} className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  {t.title}
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 pt-1">
              <Button
                onClick={handleCheckOutCompleteTasks}
                isLoading={checkoutStep === "completing" || checkOutMutation.isPending}
                className="w-full"
              >
                Sim, concluir todas e fazer check-out
              </Button>
              <Button
                variant="outline"
                onClick={() => doCheckOut(checkoutBooking.id)}
                disabled={checkoutStep === "completing" || checkOutMutation.isPending}
                className="w-full border-white/10 text-muted-foreground hover:text-white"
              >
                Não, fazer check-out sem concluir
              </Button>
              <button
                onClick={() => setCheckoutBooking(null)}
                disabled={checkoutStep === "completing" || checkOutMutation.isPending}
                className="text-xs text-muted-foreground hover:text-white transition-colors py-1"
              >
                Cancelar
              </button>
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
