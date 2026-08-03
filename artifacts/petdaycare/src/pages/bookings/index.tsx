import React, { useState, useRef, useEffect } from "react";
import { useListBookings, useCreateBooking, useUpdateBooking, useCheckIn, useCheckOut, useListPets, useListTasks } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { resolvePhotoUrl, formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays as Calendar, Plus, LogIn, LogOut, Navigation, Car, ChevronDown, Search, X, ClipboardList, Package, CheckCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PersonalItemsModal } from "@/components/bookings/personal-items-modal";
import { AddConsumableModal } from "@/components/bookings/add-consumable-modal";

function useTutors(crecheId: number, enabled: boolean) {
  const token = localStorage.getItem("auth_token");
  return useQuery<any[]>({
    queryKey: ["tutors-full", crecheId],
    enabled,
    queryFn: async () => {
      const r = await fetch(`/api/creches/${crecheId}/tutors/manage`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
}

type BookingStatus = "pending" | "confirmed" | "active" | "completed" | "cancelled" | "cancel_requested";
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
  cancel_requested: "destructive",
};

const statusLabel: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmada",
  active: "Ativa",
  completed: "Concluída",
  cancelled: "Cancelada",
  cancel_requested: "Cancelamento Solicitado",
  all: "Todos os status",
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
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="flex items-center justify-between gap-2 pl-4 pr-3 py-2 rounded-full bg-[#1e1e2d] border border-white/5 text-sm text-white hover:bg-white/10 transition-all w-full"
      >
        <span className="text-left truncate">
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
        <div className="absolute top-full mt-1 left-0 z-50 w-full sm:w-64 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-xl overflow-hidden">
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

function TutorCombobox({ tutors, value, onChange }: { tutors: any[]; value: number | null; onChange: (id: number | null) => void }) {
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

  const filtered = tutors?.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) || [];
  const selected = tutors?.find((t) => t.id === value);

  return (
    <div ref={ref} className="relative flex-1 min-w-[200px]">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="flex items-center justify-between gap-2 pl-4 pr-3 py-2 rounded-xl bg-[#1e1e2d] border border-white/5 text-sm text-white hover:bg-white/10 transition-all w-full"
      >
        <span className="text-left truncate">
          {selected ? `👤 ${selected.name}` : "Todos os tutores"}
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
        <div className="absolute top-full mt-1 left-0 z-50 w-full sm:w-64 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-white/10">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5">
              <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar tutor..."
                className="bg-transparent border-none text-sm text-white placeholder:text-muted-foreground focus:outline-none w-full"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-white/5 ${value === null ? "text-white font-medium" : "text-muted-foreground"}`}
            >
              Todos os tutores
            </button>
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onChange(t.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-white/5 truncate flex justify-between items-center ${value === t.id ? "text-primary font-medium" : "text-white"}`}
              >
                {t.name}
                {value === t.id && <CheckCircle className="h-3 w-3" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCombobox({ statuses, counts, value, onChange }: { statuses: string[]; counts: Record<string, number>; value: string; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 pl-4 pr-3 py-2 rounded-full bg-[#1e1e2d] border border-white/5 text-sm text-white hover:bg-white/10 transition-all w-full"
      >
        <span className="text-left truncate">
          {statusLabel[value] || value}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-full sm:w-64 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-xl overflow-hidden py-1">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/5 flex items-center gap-2 ${value === s ? "text-primary font-medium" : "text-white hover:text-white"}`}
            >
              <span className="truncate">{s === "all" ? "Todos" : (statusLabel[s] || s)}</span>
              <span className="text-xs opacity-70 ml-1">({counts[s] || 0})</span>
              {value === s && <span className="ml-auto text-xs text-primary">✓</span>}
            </button>
          ))}
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

function useCompleteService(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: number) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/complete-service`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw Object.assign(new Error("Erro"), { data });
      }
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

function useForceCheckout(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (petId: number) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/pets/${petId}/force-checkout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw Object.assign(new Error(data?.error ?? "Erro ao liberar pet"), { data });
      }
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
  const highlightBookingId = urlParams.get("b") ? parseInt(urlParams.get("b")!) : null;
  const [, setLocation] = useLocation();
  const [editBooking, setEditBooking] = useState<any | null>(null);
  // When navigating from a notification with a specific booking, show all statuses so it's visible
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    if (highlightBookingId) return "all";
    return urlParams.get("status") || "all";
  });
  const [tutorFilter, setTutorFilter] = useState<number | null>(null);
  const [petFilter, setPetFilter] = useState<number | null>(null);
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");
  const [onTheWayBooking, setOnTheWayBooking] = useState<any | null>(null);
  const [eta, setEta] = useState("15");
  const [checkoutBooking, setCheckoutBooking] = useState<any | null>(null);
  const [consumableBooking, setConsumableBooking] = useState<any | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<"confirm" | "completing">("confirm");
  const [personalItemsBooking, setPersonalItemsBooking] = useState<any | null>(null);
  const [bookingPersonalItems, setBookingPersonalItems] = useState<Record<number, { hasItems: boolean; photoUrl: string | null }>>({});
  const [selectedPetIds, setSelectedPetIds] = useState<number[]>([]);

  const { data: bookingsResponse, isLoading } = useListBookings(crecheId, {
    tutorId: tutorFilter || undefined,
    petId: petFilter || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    date: startDateFilter || undefined,
    pageSize: 1000 // Get all for the report view
  } as any, {
    query: {
      refetchInterval: 20_000,
      refetchOnWindowFocus: true,
    } as any,
  });
  const { data: petsResponse } = useListPets(crecheId);
  const { data: tutors } = useTutors(crecheId, !isTutor);
  const pets = (petsResponse as any)?.items || (Array.isArray(petsResponse) ? petsResponse : []);
  const bookings = (bookingsResponse as any)?.items || (Array.isArray(bookingsResponse) ? bookingsResponse : []);
  const { data: allTasks } = useListTasks(crecheId);
  const createMutation = useCreateBooking();
  const updateMutation = useUpdateBooking();
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();
  const onTheWayMutation = useOnTheWay(crecheId);
  const completeServiceMutation = useCompleteService(crecheId);
  const forceCheckoutMutation = useForceCheckout(crecheId);

  const isPetPresent = (petId: number) => pets?.find((p) => p.id === petId)?.isCheckedIn ?? false;

  // Pets marcados como presentes mas sem reserva ativa (estado inconsistente)
  const stuckPets = !isTutor ? (pets ?? []).filter((p) => {
    if (!p.isCheckedIn) return false;
    return !(bookings ?? []).some((b) => b.petId === p.id && b.status === "active");
  }) : [];

  const handleForceCheckout = (pet: any) => {
    forceCheckoutMutation.mutate(pet.id, {
      onSuccess: () => toast({ title: `${pet.name} liberado`, description: "Pet removido da lista de presentes." }),
      onError: (err: any) => toast({ title: "Erro", description: err.message ?? "Não foi possível liberar o pet.", variant: "destructive" }),
    });
  };

  // Scroll to and highlight a specific booking when navigating from a push notification
  useEffect(() => {
    if (!highlightBookingId || !bookings?.length) return;
    const timer = setTimeout(() => {
      document.getElementById(`booking-${highlightBookingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(timer);
  }, [highlightBookingId, bookings?.length]);

  const myBookings = isTutor ? bookings?.filter((b) => {
    const myPetIds = pets?.map((p) => p.id) || [];
    return myPetIds.includes(b.petId);
  }) : bookings;

  // We only do date filtering here if the user selected endDateFilter, 
  // since startDateFilter is already sent to the backend.
  // We also don't need petFilter/tutorFilter/statusFilter because they are sent to backend,
  // except maybe if the UI isn't perfectly synced yet. It's safer to keep local filtering as a fallback.
  const bookingsFilteredByDate = myBookings.filter((b: any) => {
    if (startDateFilter && b.startDate < startDateFilter) return false;
    if (endDateFilter && b.startDate > endDateFilter) return false;
    if (petFilter && b.petId !== petFilter) return false;
    if (tutorFilter && b.tutorId !== tutorFilter) return false;
    return true;
  });

  const baseForStatus = bookingsFilteredByDate;
  
  const statusCounts: Record<string, number> = {
    all: baseForStatus.length,
    pending: 0,
    confirmed: 0,
    active: 0,
    completed: 0,
    cancelled: 0,
    cancel_requested: 0,
  };
  
  baseForStatus.forEach((b: any) => {
    if (statusCounts[b.status] !== undefined) {
      statusCounts[b.status]++;
    } else {
      statusCounts[b.status] = 1;
    }
  });

  const filtered = statusFilter === "all" ? baseForStatus : baseForStatus.filter((b: any) => b.status === statusFilter);



  const statusSuccessMessages: Partial<Record<BookingStatus, string>> = {
    confirmed: "Reserva confirmada com sucesso!",
    cancelled: "Reserva cancelada.",
    pending: "Reserva marcada como pendente.",
    cancel_requested: "Solicitação de cancelamento enviada à creche.",
  };

  const handleStatusUpdate = (bookingId: number, newStatus: BookingStatus) => {
    updateMutation.mutate(
      { crecheId, bookingId, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({
            title: statusSuccessMessages[newStatus] ?? "Status atualizado.",
          });
        },
        onError: (err: any) => {
          toast({
            title: "Erro ao atualizar reserva",
            description: err?.data?.error ?? err?.message ?? "Tente novamente.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleCheckIn = (booking: any) => {
    checkInMutation.mutate(
      { crecheId, bookingId: booking.id } as any,
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/creches/${crecheId}/bookings`] });
          setPersonalItemsBooking({ ...booking, crecheId });
        },
        onError: (err: any) => {
          const msg = err?.data?.error ?? err?.message ?? "Tente novamente.";
          const isDouble = typeof msg === "string" && msg.includes("check-in ativo");
          toast({
            title: isDouble ? "Check-in não permitido" : "Erro no check-in",
            description: msg,
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleCompleteService = (booking: any) => {
    completeServiceMutation.mutate(booking.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/creches/${crecheId}/bookings`] });
        toast({ title: "Serviço concluído!", description: `A reserva de ${booking.petName} foi finalizada. O pet permanece na creche.` });
      },
      onError: (err: any) => {
        toast({ title: "Erro", description: err?.data?.error ?? err?.message ?? "Tente novamente.", variant: "destructive" });
      },
    });
  };

  const pendingTasksForBooking = (booking: any) =>
    (allTasks || []).filter((t) => t.petId === booking.petId && t.status === "pending");

  const doCheckOut = (bookingId: number) => {
    checkOutMutation.mutate(
      { crecheId, bookingId } as any,
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/creches/${crecheId}/bookings`] });
          setCheckoutBooking(null);
          toast({ title: "Check-out realizado!" });
        },
        onError: (err: any) => {
          toast({
            title: "Erro no check-out",
            description: err?.data?.error ?? err?.message ?? "Tente novamente.",
            variant: "destructive",
          });
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
          const desc = isTutor
            ? "A creche foi avisada que você está a caminho."
            : "O tutor foi avisado que a equipe está a caminho.";
          toast({ title: "Notificação enviada!", description: desc });
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
      />

      {/* Recovery banner: pets stuck as present without an active booking */}
      {stuckPets.length > 0 && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-4 space-y-3">
          <p className="text-sm font-medium text-red-400 flex items-center gap-2">
            <span>⚠️</span>
            {stuckPets.length === 1
              ? `${stuckPets[0].name} está marcado como presente mas não tem reserva ativa.`
              : `${stuckPets.length} pets estão marcados como presentes sem reserva ativa.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {stuckPets.map((p: any) => (
              <Button
                key={p.id}
                size="sm"
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
                onClick={() => handleForceCheckout(p)}
                isLoading={forceCheckoutMutation.isPending}
              >
                <LogOut className="mr-1 h-3 w-3" /> Liberar {p.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 w-full mb-2">
        <Button onClick={() => setLocation("/bookings/new")} className="bg-[#a3d84b] text-[#1a1a2e] hover:bg-[#92c73a] shrink-0 w-full sm:w-auto h-10 rounded-xl">
          <Plus className="h-5 w-5 mr-2" /> Nova Reserva
        </Button>
        
        <div className="flex flex-col sm:flex-row gap-2 w-full">
          <div className="flex gap-2 w-full sm:w-auto sm:flex-1">
            <DateFilterPopover
              start={startDateFilter || ""}
              end={endDateFilter || ""}
              onChangeStart={setStartDateFilter}
              onChangeEnd={setEndDateFilter}
            />
            <StatusCombobox
              statuses={["all", "pending", "confirmed", "active", "completed", "cancelled"]}
              counts={statusCounts}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:flex-[2]">
            {!isTutor && tutors && (
              <TutorCombobox tutors={tutors} value={tutorFilter} onChange={setTutorFilter} />
            )}
            <PetCombobox pets={pets || []} value={petFilter} onChange={setPetFilter} />
          </div>
        </div>
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
                  <div
                    key={booking.id}
                    id={`booking-${booking.id}`}
                    className={`p-5 space-y-4 transition-colors ${highlightBookingId === booking.id ? "bg-violet-500/8 ring-1 ring-inset ring-violet-400/30" : ""}`}
                  >
                    {/* ── CONCEPT A LAYOUT ── */}
                    {/* Row 1: Pet Name (Left) + Badges (Right) */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="text-xl font-bold text-white leading-none">{booking.petName}</h3>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <Badge variant={statusVariant[booking.status as BookingStatus] || "secondary"} className="bg-white/5 border-white/10 hover:bg-white/10 transition-colors px-2 py-0.5 text-[10px] h-6">
                          {statusLabel[booking.status] || booking.status}
                        </Badge>
                        <Badge variant="outline" className="bg-white/5 border-white/10 hover:bg-white/10 transition-colors px-2 py-0.5 text-[10px] h-6">
                          {bookingTypeLabel[booking.type] || booking.type}
                        </Badge>
                        {(booking as any).onTheWayAt && booking.status !== "completed" && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 flex items-center gap-1 flex-shrink-0 border border-blue-500/20 h-6">
                            <Car className="h-3 w-3" /> A caminho
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Tutor */}
                    {!isTutor && (
                      <p className="text-sm text-muted-foreground mb-3">{booking.tutorName || "—"}</p>
                    )}

                    {/* Row 3: Dates and Times */}
                    <div className="flex flex-col gap-1.5 mb-4">
                      <div className="text-sm text-muted-foreground font-medium">
                        {format(parseLocalDate(booking.startDate), "dd/MM/yyyy")}
                        {booking.endDate && ` → ${format(parseLocalDate(booking.endDate), "dd/MM/yyyy")}`}
                      </div>
                      {(booking.checkInTime || (booking as any).checkOutTime) && (
                        <div className="flex items-center gap-3">
                          {booking.checkInTime && (
                            <span className="text-sm text-emerald-400 font-medium flex items-center gap-1">
                              <CheckCircle className="h-3.5 w-3.5" /> In: {format(new Date(booking.checkInTime), "HH:mm")}
                            </span>
                          )}
                          {(booking as any).checkOutTime && (
                            <span className="text-sm text-amber-500 font-medium flex items-center gap-1">
                              <LogOut className="h-3.5 w-3.5" /> Out: {format(new Date((booking as any).checkOutTime), "HH:mm")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Row 4: Horizontal Action Buttons */}
                    <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/5">
                      {(booking.status === "confirmed" || booking.status === "active") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 font-medium bg-transparent"
                          onClick={() => setOnTheWayBooking(booking)}
                        >
                          <Navigation className="mr-1.5 h-3.5 w-3.5" /> A caminho
                        </Button>
                      )}
                        {isTutor && (booking.status === "pending" || booking.status === "confirmed") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-destructive/40 text-destructive/80 hover:bg-destructive/10 font-medium bg-transparent"
                            onClick={() => handleStatusUpdate(booking.id, "cancel_requested")}
                            isLoading={updateMutation.isPending}
                          >
                            Solicitar Cancelamento
                          </Button>
                        )}
                        {!isTutor && (
                          <>
                            {booking.status === "cancel_requested" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-destructive/40 text-destructive/80 hover:bg-destructive/10 font-medium bg-transparent"
                                  onClick={() => handleStatusUpdate(booking.id, "cancelled")}
                                  isLoading={updateMutation.isPending}
                                >
                                  Aprovar Cancel.
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 font-medium bg-transparent"
                                  onClick={() => handleStatusUpdate(booking.id, "confirmed")}
                                  isLoading={updateMutation.isPending}
                                >
                                  Recusar
                                </Button>
                              </>
                            )}
                            {booking.status === "confirmed" && !isPetPresent(booking.petId) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 font-medium bg-transparent"
                                onClick={() => handleCheckIn(booking)}
                                isLoading={checkInMutation.isPending}
                              >
                                <LogIn className="mr-1.5 h-3.5 w-3.5" /> Check-in
                              </Button>
                            )}
                            {booking.status === "confirmed" && isPetPresent(booking.petId) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10 font-medium bg-transparent"
                                onClick={() => handleCompleteService(booking)}
                                isLoading={completeServiceMutation.isPending}
                              >
                                <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Concluir Serviço
                              </Button>
                            )}
                            {booking.status === "active" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400 font-medium bg-transparent"
                                  onClick={() => handleCheckOut(booking)}
                                  isLoading={checkOutMutation.isPending}
                                >
                                  <LogOut className="mr-1.5 h-3.5 w-3.5" /> Check-out
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400 font-medium bg-transparent"
                                  onClick={() => setConsumableBooking(booking)}
                                >
                                  <Package className="mr-1.5 h-3.5 w-3.5" /> Consumo
                                </Button>
                              </>
                            )}
                            {booking.status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400 font-medium bg-transparent"
                                onClick={() => handleStatusUpdate(booking.id, "confirmed")}
                                isLoading={updateMutation.isPending}
                              >
                                Confirmar
                              </Button>
                            )}
                            
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              className="text-white hover:bg-white/10 font-semibold px-4 ml-auto sm:ml-0" 
                              onClick={() => setEditBooking(booking)}
                            >
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
                          {format(parseLocalDate(booking.startDate), "dd/MM/yyyy")}
                          {booking.endDate && (
                            <span> → {format(parseLocalDate(booking.endDate), "dd/MM/yyyy")}</span>
                          )}
                          {booking.checkInTime && (
                            <p className="text-xs text-emerald-400 mt-0.5">
                              Check-in: {format(new Date(booking.checkInTime), "HH:mm")}
                            </p>
                          )}
                          {(booking as any).checkOutTime && (
                            <p className="text-xs text-amber-500 mt-0.5">
                              Check-out: {format(new Date((booking as any).checkOutTime), "HH:mm")}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant={statusVariant[booking.status as BookingStatus] || "secondary"}>
                            {statusLabel[booking.status] || booking.status}
                          </Badge>
                          {(booking as any).onTheWayAt && booking.status !== "completed" && (
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
                                onClick={() => handleStatusUpdate(booking.id, "cancel_requested")}
                                isLoading={updateMutation.isPending}
                              >
                                Solicitar Cancelamento
                              </Button>
                            )}
                            {!isTutor && (
                              <>
                                {booking.status === "cancel_requested" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-destructive/40 text-destructive/80 hover:bg-destructive/10"
                                      onClick={() => handleStatusUpdate(booking.id, "cancelled")}
                                      isLoading={updateMutation.isPending}
                                    >
                                      Aprovar Cancelamento
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                      onClick={() => handleStatusUpdate(booking.id, "confirmed")}
                                      isLoading={updateMutation.isPending}
                                    >
                                      Recusar
                                    </Button>
                                  </>
                                )}
                                {booking.status === "confirmed" && !isPetPresent(booking.petId) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                    onClick={() => handleCheckIn(booking)}
                                    isLoading={checkInMutation.isPending}
                                  >
                                    <LogIn className="mr-1.5 h-3.5 w-3.5" /> Check-in
                                  </Button>
                                )}
                                {booking.status === "confirmed" && isPetPresent(booking.petId) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                                    onClick={() => handleCompleteService(booking)}
                                    isLoading={completeServiceMutation.isPending}
                                  >
                                    <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Concluir Serviço
                                  </Button>
                                )}
                                {booking.status === "active" && (
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                                      onClick={() => handleCheckOut(booking)}
                                      isLoading={checkOutMutation.isPending}
                                    >
                                      <LogOut className="mr-1.5 h-3.5 w-3.5" /> Check-out
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                      onClick={() => setConsumableBooking(booking)}
                                    >
                                      <Package className="mr-1.5 h-3.5 w-3.5" /> Consumo
                                    </Button>
                                  </div>
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
              action={statusFilter === "all" ? { label: "Nova Reserva", onClick: () => setLocation("/bookings/new") } : undefined}
            />
          )}
        </CardContent>
      </Card>

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
                <span className="font-medium text-white">{format(parseLocalDate(editBooking.startDate), "dd/MM/yyyy")}</span>
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
      {personalItemsBooking && (
        <PersonalItemsModal
          booking={personalItemsBooking}
          open={!!personalItemsBooking}
          onComplete={(result) => {
            setBookingPersonalItems((prev) => ({ ...prev, [personalItemsBooking.id]: result }));
            setPersonalItemsBooking(null);
            queryClient.invalidateQueries({ queryKey: [`/api/creches/${crecheId}/bookings`] });
            toast({ title: "Check-in realizado!" });
          }}
        />
      )}

      {consumableBooking && (
        <AddConsumableModal
          isOpen={!!consumableBooking}
          onClose={() => setConsumableBooking(null)}
          bookingId={consumableBooking.id}
          crecheId={crecheId}
          petName={consumableBooking.petName}
        />
      )}

      {checkoutBooking && (
        <Modal
          isOpen={!!checkoutBooking}
          onClose={() => !checkOutMutation.isPending && setCheckoutBooking(null)}
          title="Confirmar Check-out"
        >
          <div className="space-y-5">
            {/* Personal items warning */}
            {(() => {
              const cached = bookingPersonalItems[checkoutBooking.id];
              const hasItems = cached != null ? cached.hasItems : checkoutBooking.hasPersonalItems;
              const photoUrl = cached?.photoUrl ?? checkoutBooking.personalItemsPhotoUrl;
              if (!hasItems || !photoUrl) return null;
              return (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
                    <Package className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-white">⚠️ Pet veio com itens pessoais</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Lembre-se de devolver todos os itens ao tutor.</p>
                    </div>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-white/10 aspect-[4/3]">
                    <img
                      src={resolvePhotoUrl(photoUrl) ?? ""}
                      alt="Itens pessoais registrados no check-in"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              );
            })()}

            {pendingTasksForBooking(checkoutBooking).length > 0 && (
              <>
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
                <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                  {pendingTasksForBooking(checkoutBooking).map((t: any) => (
                    <li key={t.id} className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      {t.title}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="flex flex-col gap-2 pt-1">
              {pendingTasksForBooking(checkoutBooking).length > 0 && (
                <Button
                  onClick={handleCheckOutCompleteTasks}
                  isLoading={checkoutStep === "completing" || checkOutMutation.isPending}
                  className="w-full"
                >
                  Concluir tarefas e fazer check-out
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => doCheckOut(checkoutBooking.id)}
                disabled={checkoutStep === "completing" || checkOutMutation.isPending}
                className="w-full border-white/10 text-muted-foreground hover:text-white"
              >
                {pendingTasksForBooking(checkoutBooking).length > 0 ? "Fazer check-out sem concluir" : "Confirmar check-out"}
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

      {/* On the Way Modal */}
      {onTheWayBooking && (
        <Modal isOpen={!!onTheWayBooking} onClose={() => setOnTheWayBooking(null)} title="A Caminho">
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              {isTutor
                ? <>Avise a creche que você está a caminho para <span className="text-white font-medium">{onTheWayBooking.petName}</span>.</>
                : <>Avise o tutor que a equipe está a caminho para <span className="text-white font-medium">{onTheWayBooking.petName}</span>.</>
              }
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
