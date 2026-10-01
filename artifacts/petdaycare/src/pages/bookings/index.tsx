import React, { useState, useRef, useEffect } from "react";
import {
  useListBookings,
  useCreateBooking,
  useUpdateBooking,
  useCheckIn,
  useCheckOut,
  useListPets,
  useListTasks,
  getListBookingsQueryKey,
  getListPetsQueryKey,
  getListTasksQueryKey,
  getGetCrecheStatsQueryKey,
  type Pet,
  type Task,
  type ListBookingsParams,
  type ListBookingsStatus,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { resolvePhotoUrl } from "@/lib/utils";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-controls";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { CalendarDays as Calendar, Plus, LogIn, LogOut, Navigation, Car, ChevronDown, Search, X, ClipboardList, Package, CheckCircle, PawPrint, UserRound, SlidersHorizontal, Clock, MoreHorizontal, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PersonalItemsModal } from "@/components/bookings/personal-items-modal";
import { AddConsumableModal } from "@/components/bookings/add-consumable-modal";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface TutorOption {
  id: number;
  name: string;
  email: string;
}

function useTutors(crecheId: number | null, enabled: boolean) {
  const token = localStorage.getItem("auth_token");
  return useQuery<TutorOption[]>({
    queryKey: ["tutors-full", crecheId],
    enabled: enabled && !!crecheId,
    queryFn: async () => {
      if (!crecheId) return [];
      const r = await fetch(`/api/creches/${crecheId}/tutors/manage`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
}

import {
  BookingListView,
  bookingTypeLabel,
  statusVariant,
  statusLabel,
  isServiceBooking,
  SERVICE_BOOKING_TYPES,
  type BookingStatus,
  type BookingType,
  type BookingListItem,
  type BookingAdditionalService,
} from "./components/booking-list-view";

export { isServiceBooking, SERVICE_BOOKING_TYPES };

export interface RootBookingAdditionalService extends BookingAdditionalService {
  catalogueItemName?: string | null;
  catalogueItemId?: number | null;
  catalogueItem?: {
    name?: string | null;
  } | null;
  status?: string | null;
}

export type RootBookingListItem = Omit<BookingListItem, "additionalServices"> & {
  additionalServices?: RootBookingAdditionalService[] | null;
  hasPersonalItems?: boolean | null;
  personalItemsPhotoUrl?: string | null;
};

export interface BookingsListEnvelope {
  data?: RootBookingListItem[];
  items?: RootBookingListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

export interface PetsListEnvelope {
  items?: Pet[];
  total?: number;
}

type BoundedListBookingsParams = ListBookingsParams & {
  tutorId?: number;
  petId?: number;
  pageSize?: number;
};

function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const record = err as Record<string, unknown>;
    if (
      typeof record.data === "object" &&
      record.data !== null &&
      typeof (record.data as Record<string, unknown>).error === "string"
    ) {
      return (record.data as Record<string, unknown>).error as string;
    }
    if (typeof record.message === "string" && record.message) {
      return record.message;
    }
  }
  return fallback;
}

function PetCombobox({ pets, value, onChange }: { pets: Pet[]; value: number | null; onChange: (id: number | null) => void }) {
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
      <FilterSelect
        label={selected ? `🐾 ${selected.name}` : "Todos os pets"}
        icon={PawPrint}
        isActive={!!value}
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="w-full"
      />

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-full sm:w-64 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <SearchInput
              autoFocus
              value={search}
              onChange={setSearch}
              placeholder="Buscar pet..."
              className="h-9"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-secondary transition-colors ${!value ? "font-medium text-primary" : "text-foreground"}`}
            >
              Todos os pets
            </button>
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-secondary transition-colors ${value === p.id ? "font-medium text-primary" : "text-foreground"}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TutorCombobox({ tutors, value, onChange }: { tutors: TutorOption[]; value: number | null; onChange: (id: number | null) => void }) {
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

  const filtered = tutors.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.email.toLowerCase().includes(search.toLowerCase())
  );
  const selected = tutors.find((t) => t.id === value);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <FilterSelect
        label={selected ? `👤 ${selected.name.split(" ")[0]}` : "Todos os tutores"}
        icon={UserRound}
        isActive={!!value}
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="w-full"
      />

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-full sm:w-64 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <SearchInput
              autoFocus
              value={search}
              onChange={setSearch}
              placeholder="Buscar tutor por nome ou e-mail..."
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-secondary transition-colors ${!value ? "font-medium text-primary" : "text-foreground"}`}
            >
              Todos os tutores
            </button>
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onChange(t.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-secondary transition-colors ${value === t.id ? "font-medium text-primary" : "text-foreground"}`}
              >
                <p className="font-medium text-foreground">{t.name}</p>
                <p className="text-xs text-muted-foreground truncate">{t.email}</p>
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
      <FilterSelect
        label={statusLabel[value] || value}
        icon={SlidersHorizontal}
        isActive={value !== "all"}
        onClick={() => setOpen((v) => !v)}
        className="w-full"
      />

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-full sm:w-64 bg-popover border border-border rounded-xl shadow-xl overflow-hidden py-1">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-secondary flex items-center gap-2 ${value === s ? "text-primary font-medium" : "text-foreground hover:text-foreground"}`}
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey(crecheId) });
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey(crecheId) });
      queryClient.invalidateQueries({ queryKey: ["all-invoices", crecheId] });
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey(crecheId) });
      queryClient.invalidateQueries({ queryKey: getListPetsQueryKey(crecheId) });
      queryClient.invalidateQueries({ queryKey: getGetCrecheStatsQueryKey(crecheId) });
    },
  });
}

export default function Bookings() {
  const { user } = useAuth();
  const crecheId = user?.role === "master_admin" ? null : (user?.crecheId ?? null);
  const isTutor = user?.role === "tutor";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const highlightBookingId = urlParams.get("b") ? parseInt(urlParams.get("b")!) : null;
  const [, setLocation] = useLocation();
  const [editBooking, setEditBooking] = useState<RootBookingListItem | null>(null);
  const [cancellationState, setCancellationState] = useState<{
    booking: RootBookingListItem;
    intent: "tutor_request" | "staff_approve" | "staff_direct";
  } | null>(null);
  // When navigating from a notification with a specific booking, show all statuses so it's visible
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    if (highlightBookingId) return "all";
    return urlParams.get("status") || "all";
  });
  const [tutorFilter, setTutorFilter] = useState<number | null>(null);
  const [petFilter, setPetFilter] = useState<number | null>(null);
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");
  const [onTheWayBooking, setOnTheWayBooking] = useState<RootBookingListItem | null>(null);
  const [eta, setEta] = useState("15");
  const [checkoutBooking, setCheckoutBooking] = useState<RootBookingListItem | null>(null);
  const [consumableBooking, setConsumableBooking] = useState<RootBookingListItem | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<"confirm" | "completing">("confirm");
  const [personalItemsBooking, setPersonalItemsBooking] = useState<RootBookingListItem | null>(null);
  const [bookingPersonalItems, setBookingPersonalItems] = useState<Record<number, { hasItems: boolean; photoUrl: string | null }>>({});
  const [selectedPetIds, setSelectedPetIds] = useState<number[]>([]);

  const listParams: BoundedListBookingsParams | undefined = !isTutor
    ? {
        tutorId: tutorFilter || undefined,
        petId: petFilter || undefined,
        status: statusFilter === "all" ? undefined : (statusFilter as ListBookingsStatus),
        date: startDateFilter || undefined,
        pageSize: 1000, // Get all for the report view
      }
    : undefined;

  const { data: bookingsResponse, isLoading } = useListBookings(
    crecheId ?? 0,
    listParams
  );
  const { data: petsResponse } = useListPets(crecheId ?? 0);
  const { data: tutors } = useTutors(crecheId, !isTutor);
  const petsPayload = petsResponse as Pet[] | PetsListEnvelope | undefined;
  const pets: Pet[] = Array.isArray(petsPayload)
    ? petsPayload
    : petsPayload?.items ?? [];

  const bookingsPayload = bookingsResponse as
    | RootBookingListItem[]
    | BookingsListEnvelope
    | undefined;
  const bookings: RootBookingListItem[] = Array.isArray(bookingsPayload)
    ? bookingsPayload
    : bookingsPayload?.items ?? [];

  const { data: allTasks } = useListTasks(crecheId ?? 0);
  const createMutation = useCreateBooking();
  const updateMutation = useUpdateBooking();
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();
  const onTheWayMutation = useOnTheWay(crecheId ?? 0);
  const completeServiceMutation = useCompleteService(crecheId ?? 0);
  const forceCheckoutMutation = useForceCheckout(crecheId ?? 0);

  const isPetPresent = (petId: number) => pets?.find((p) => p.id === petId)?.isCheckedIn ?? false;

  // Pets marcados como presentes mas sem reserva ativa (estado inconsistente)
  const stuckPets = !isTutor ? (pets ?? []).filter((p) => {
    if (!p.isCheckedIn) return false;
    return !(bookings ?? []).some((b) => b.petId === p.id && b.status === "active");
  }) : [];

  const handleForceCheckout = (pet: Pet) => {
    if (!crecheId) return;
    forceCheckoutMutation.mutate(pet.id, {
      onSuccess: () => toast({ title: `${pet.name} liberado`, description: "Pet removido da lista de presentes." }),
      onError: (err: unknown) => toast({ title: "Erro", description: getErrorMessage(err, "Não foi possível liberar o pet."), variant: "destructive" }),
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
  const bookingsFilteredByDate = myBookings.filter((b) => {
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
  
  baseForStatus.forEach((b) => {
    if (statusCounts[b.status] !== undefined) {
      statusCounts[b.status]++;
    } else {
      statusCounts[b.status] = 1;
    }
  });

  const filtered = statusFilter === "all" ? baseForStatus : baseForStatus.filter((b) => b.status === statusFilter);

  const statusSuccessMessages: Partial<Record<BookingStatus, string>> = {
    confirmed: "Reserva confirmada com sucesso!",
    cancelled: "Reserva cancelada.",
    pending: "Reserva marcada como pendente.",
    cancel_requested: "Solicitação de cancelamento enviada à creche.",
  };

  const handleStatusUpdate = (bookingId: number, newStatus: BookingStatus) => {
    if (!crecheId) return;
    updateMutation.mutate(
      { crecheId, bookingId, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: getGetCrecheStatsQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
          toast({
            title: statusSuccessMessages[newStatus] ?? "Status atualizado.",
          });
        },
        onError: (err: unknown) => {
          toast({
            title: "Erro ao atualizar reserva",
            description: getErrorMessage(err, "Tente novamente."),
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleConfirmCancellation = () => {
    if (!cancellationState || !crecheId) return;
    const { booking, intent } = cancellationState;
    const targetStatus: BookingStatus = intent === "tutor_request" ? "cancel_requested" : "cancelled";

    updateMutation.mutate(
      { crecheId, bookingId: booking.id, data: { status: targetStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: getGetCrecheStatsQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
          toast({
            title: intent === "tutor_request"
              ? "Solicitação de cancelamento enviada à creche."
              : "Reserva cancelada com sucesso.",
          });
          setCancellationState(null);
          if (intent === "staff_direct") {
            setEditBooking(null);
          }
        },
        onError: (err: unknown) => {
          toast({
            title: "Erro ao processar cancelamento",
            description: getErrorMessage(err, "Tente novamente."),
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleCheckIn = (booking: RootBookingListItem) => {
    if (!crecheId) return;
    checkInMutation.mutate(
      { crecheId, bookingId: booking.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/creches/${crecheId}/bookings`] });
          setPersonalItemsBooking({ ...booking, crecheId });
        },
        onError: (err: unknown) => {
          const msg = getErrorMessage(err, "Tente novamente.");
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

  const handleCompleteService = (booking: RootBookingListItem) => {
    if (!crecheId) return;
    completeServiceMutation.mutate(booking.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/creches/${crecheId}/bookings`] });
        toast({ title: "Serviço concluído!", description: `A reserva de ${booking.petName} foi finalizada. O pet permanece na creche.` });
      },
      onError: (err: unknown) => {
        toast({ title: "Erro", description: getErrorMessage(err, "Tente novamente."), variant: "destructive" });
      },
    });
  };

  const pendingTasksForBooking = (booking: RootBookingListItem | null | undefined): Task[] =>
    !booking ? [] : (allTasks || []).filter((t) => t.petId === booking.petId && t.status === "pending");

  const doCheckOut = (bookingId: number) => {
    if (!crecheId) return;
    checkOutMutation.mutate(
      { crecheId, bookingId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/creches/${crecheId}/bookings`] });
          setCheckoutBooking(null);
          toast({ title: "Check-out realizado!" });
        },
        onError: (err: unknown) => {
          toast({
            title: "Erro no check-out",
            description: getErrorMessage(err, "Tente novamente."),
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleCheckOut = (booking: RootBookingListItem) => {
    if (!crecheId) return;
    const pending = pendingTasksForBooking(booking);
    if (pending.length > 0) {
      setCheckoutStep("confirm");
      setCheckoutBooking(booking);
    } else {
      doCheckOut(booking.id);
    }
  };

  const handleCheckOutCompleteTasks = async () => {
    if (!checkoutBooking || !crecheId) return;
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
        <div className="rounded-xl border border-warning/20 bg-warning/10 p-4 space-y-3">
          <p className="text-sm font-medium text-warning-foreground flex items-center gap-2">
            <span>⚠️</span>
            {stuckPets.length === 1
              ? `${stuckPets[0].name} está marcado como presente mas não tem reserva ativa.`
              : `${stuckPets.length} pets estão marcados como presentes sem reserva ativa.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {stuckPets.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant="outline"
                className="border-warning/30 text-warning-foreground hover:bg-warning/10 text-xs"
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
        <Button
          id="booking-create-button"
          data-guidance-target="booking-create-button"
          onClick={() => setLocation("/bookings/new")}
          className="w-full sm:w-auto h-10 rounded-xl"
        >
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
            <BookingListView
              bookings={filtered}
              pets={pets ?? []}
              isTutor={isTutor}
              highlightBookingId={highlightBookingId}
              isPetPresent={isPetPresent}
              bookingPersonalItems={bookingPersonalItems}
              handleStatusUpdate={handleStatusUpdate}
              onRequestCancel={(booking) => setCancellationState({ booking, intent: "tutor_request" })}
              onApproveCancel={(booking) => setCancellationState({ booking, intent: "staff_approve" })}
              handleCheckIn={handleCheckIn}
              handleCompleteService={handleCompleteService}
              handleCheckOut={handleCheckOut}
              onOpenOnTheWay={(booking) => setOnTheWayBooking(booking)}
              onOpenConsumable={(booking) => setConsumableBooking(booking)}
              onOpenEdit={(booking) => setEditBooking(booking)}
              isUpdatePending={updateMutation.isPending}
              isCheckInPending={checkInMutation.isPending}
              isCompleteServicePending={completeServiceMutation.isPending}
              isCheckOutPending={checkOutMutation.isPending}
            />
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
            <div className="p-4 rounded-xl bg-secondary border border-border space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pet</span>
                <span className="font-medium text-foreground">{editBooking.petName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tipo</span>
                <span className="font-medium text-foreground capitalize">{bookingTypeLabel[editBooking.type] || editBooking.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Início</span>
                <span className="font-medium text-foreground">{format(parseLocalDate(editBooking.startDate), "dd/MM/yyyy")}</span>
              </div>
              {/* Add-on services */}
              {editBooking.additionalServices && editBooking.additionalServices.length > 0 && (
                <div className="pt-1 space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Serviços adicionais</span>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {editBooking.additionalServices.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 border border-primary/20 text-primary"
                      >
                        {s.catalogueItemName ?? s.catalogueItem?.name ?? `#${s.catalogueItemId}`}
                        {s.status && s.status !== "pending" && (
                          <span className="opacity-60">
                            {s.status === "confirmed" ? "✓" : s.status === "cancelled" ? "✗" : ""}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alterar Status</label>
              <div className="grid grid-cols-2 gap-2">
                {(["pending", "confirmed", "active", "completed", "cancelled"] as BookingStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      if (s === "cancelled") {
                        setCancellationState({ booking: editBooking, intent: "staff_direct" });
                      } else {
                        handleStatusUpdate(editBooking.id, s);
                        setEditBooking(null);
                      }
                    }}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                      editBooking.status === s
                        ? "bg-primary/20 border-primary/30 text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
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
          crecheId={crecheId ?? 0}
          petName={consumableBooking.petName ?? ""}
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
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-warning/15 border border-warning/30">
                    <Package className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">⚠️ Pet veio com itens pessoais</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Lembre-se de devolver todos os itens ao tutor.</p>
                    </div>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-border aspect-[4/3]">
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
                <div className="flex items-start gap-3 p-4 rounded-xl bg-warning/15 border border-warning/30">
                  <ClipboardList className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">
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
                  {pendingTasksForBooking(checkoutBooking).map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning flex-shrink-0" />
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
                className="w-full border-border text-muted-foreground hover:text-foreground"
              >
                {pendingTasksForBooking(checkoutBooking).length > 0 ? "Fazer check-out sem concluir" : "Confirmar check-out"}
              </Button>
              <button
                onClick={() => setCheckoutBooking(null)}
                disabled={checkoutStep === "completing" || checkOutMutation.isPending}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
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
                ? <>Avise a creche que você está a caminho para <span className="text-foreground font-medium">{onTheWayBooking.petName}</span>.</>
                : <>Avise o tutor que a equipe está a caminho para <span className="text-foreground font-medium">{onTheWayBooking.petName}</span>.</>
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
                className="bg-primary/90 hover:bg-primary border-primary/30"
              >
                <Car className="mr-2 h-4 w-4" /> Levar o pet
              </Button>
              <Button
                onClick={() => handleOnTheWay("pickup")}
                isLoading={onTheWayMutation.isPending}
                variant="outline"
                className="border-primary/30 text-primary hover:bg-primary/10"
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

      {/* Cancellation Confirmation Dialog */}
      <AlertDialog
        open={!!cancellationState}
        onOpenChange={(open) => {
          if (!open && !updateMutation.isPending) {
            setCancellationState(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cancellationState?.intent === "tutor_request"
                ? "Solicitar Cancelamento"
                : cancellationState?.intent === "staff_approve"
                  ? "Aprovar Cancelamento"
                  : "Cancelar Reserva"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancellationState?.intent === "tutor_request"
                ? "Tem certeza de que deseja solicitar o cancelamento desta reserva? A creche analisará o pedido."
                : cancellationState?.intent === "staff_approve"
                  ? "Deseja aprovar a solicitação de cancelamento desta reserva?"
                  : "Deseja cancelar esta reserva?"}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {cancellationState && (
            <div className="p-3.5 rounded-xl bg-secondary/60 border border-border text-xs space-y-1.5 text-muted-foreground my-1">
              <div className="flex justify-between">
                <span>Pet:</span>
                <span className="font-semibold text-foreground">{cancellationState.booking.petName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Serviço:</span>
                <span className="font-medium text-foreground capitalize">
                  {bookingTypeLabel[cancellationState.booking.type] || cancellationState.booking.type}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Data:</span>
                <span className="font-medium text-foreground">
                  {format(parseLocalDate(cancellationState.booking.startDate), "dd/MM/yyyy")}
                  {cancellationState.booking.endDate && cancellationState.booking.endDate !== cancellationState.booking.startDate && (
                    ` → ${format(parseLocalDate(cancellationState.booking.endDate), "dd/MM/yyyy")}`
                  )}
                </span>
              </div>
            </div>
          )}

          <AlertDialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:space-x-2 pt-2">
            <AlertDialogCancel
              disabled={updateMutation.isPending}
              onClick={() => setCancellationState(null)}
              className="h-11 min-h-[44px] w-full sm:w-auto"
            >
              Voltar
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={updateMutation.isPending}
              className="h-11 min-h-[44px] w-full sm:w-auto"
              onClick={handleConfirmCancellation}
              isLoading={updateMutation.isPending}
            >
              {updateMutation.isPending
                ? (cancellationState?.intent === "tutor_request" ? "Solicitando..." : "Cancelando...")
                : (cancellationState?.intent === "tutor_request"
                    ? "Solicitar Cancelamento"
                    : cancellationState?.intent === "staff_approve"
                      ? "Aprovar Cancelamento"
                      : "Cancelar Reserva")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
