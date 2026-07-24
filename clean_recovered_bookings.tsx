Created At: 2026-07-09T02:18:14Z
Completed At: 2026-07-09T02:18:15Z
File Path: `file:///c:/Users/Andre/Downloads/Pet-Daycare-Master/artifacts/petdaycare/src/pages/bookings/index.tsx`
Total Lines: 1042
Total Bytes: 48705
Showing lines 1 to 800
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
import { useLocation } from "wouter";
import { AddConsumableModal } from "@/components/bookings/add-consumable-modal";
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
import { CalendarDays as Calendar, Plus, LogIn, LogOut, Navigation, Car, ChevronDown, Search, X, ClipboardList, Package, CheckCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PersonalItemsModal } from "@/components/bookings/personal-items-modal";

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
const [, setLocation] = useLocation();
const [consumableBooking, setConsumableBooking] = useState<any | null>(null);
const { user } = useAuth();
const crecheId = user?.crecheId || 1;
const isTutor = user?.role === "tutor";
const queryClient = useQueryClient();
const { toast } = useToast();

const searchStr = useSearch();
const urlParams = new URLSearchParams(searchStr);
const highlightBookingId = urlParams.get("b") ? parseInt(urlParams.get("b")!) : null;
const [isCreateOpen, setIsCreateOpen] = useState(false);
const [editBooking, setEditBooking] = useState<any | null>(null);
// When navigating from a notification with a specific booking, show all statuses so it's visible
const [statusFilter, setStatusFilter] = useState<string>(() => {
if (highlightBookingId) return "all";
return urlParams.get("status") || "all";
});
const [petFilter, setPetFilter] = useState<number | null>(null);
const [onTheWayBooking, setOnTheWayBooking] = useState<any | null>(null);
const [eta, setEta] = useState("15");
const [checkoutBooking, setCheckoutBooking] = useState<any | null>(null);
const [checkoutStep, setCheckoutStep] = useState<"confirm" | "completing">("confirm");
const [personalItemsBooking, setPersonalItemsBooking] = useState<any | null>(null);
const [bookingPersonalItems, setBookingPersonalItems] = useState<Record<number, { hasItems: boolean; photoUrl: string | null }>>({});
const [selectedPetIds, setSelectedPetIds] = useState<number[]>([]);

const [page, setPage] = useState(1);
const [allBookings, setAllBookings] = useState<any[]>([]);
const { data: bookingsResponse, isLoading } = useListBookings(crecheId, { page, limit: 20 }, {
query: {
refetchInterval: 20_000,
refetchOnWindowFocus: true,
} as any,
});

useEffect(() => {
if (bookingsResponse?.items) {
setAllBookings(prev => {
if (page === 1 && prev.length === 0) return bookingsResponse.items;
const map = new Map(prev.map(p => [p.id, p]));
bookingsResponse.items.forEach((item: any) => map.set(item.id, item));
return Array.from(map.values()).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
});
}
}, [bookingsResponse?.items, page]);

const hasMore = bookingsResponse ? bookingsResponse.total > allBookings.length : false;

const { loadMoreRef } = useInfiniteScroll({
onLoadMore: () => setPage(p => p + 1),
hasMore,
loading: isLoading
});
const { data: petsResponse } = useListPets(crecheId);
const pets = petsResponse?.items;
const { data: allTasks } = useListTasks(crecheId);
const createMutation = useCreateBooking();
const updateMutation = useUpdateBooking();
const checkInMutation = useCheckIn();
const checkOutMutation = useCheckOut();
const onTheWayMutation = useOnTheWay(crecheId);
const completeServiceMutation = useCompleteService(crecheId);
const forceCheckoutMutation = useForceCheckout(crecheId);

// Normaliza o array de bookings caso a API retorne paginado (com .data ou .bookings)
const safeBookings = allBookings;

const isPetPresent = (petId: number) => pets?.find((p) => p.id === petId)?.isCheckedIn ?? false;

// Pets marcados como presentes mas sem reserva ativa (estado inconsistente)
const stuckPets = !isTutor ? (pets ?? []).filter((p) => {
if (!p.isCheckedIn) return false;
return !safeBookings.some((b) => b.petId === p.id && b.status === "active");
}) : [];

const handleForceCheckout = (pet: any) => {
forceCheckoutMutation.mutate(pet.id, {
onSuccess: () => toast({ title: `${pet.name} liberado`, description: "Pet removido da lista de presentes." }),
onError: (err: any) => toast({ title: "Erro", description: err.message ?? "Não foi possível liberar o pet.", variant: "destructive" }),
});
};

// Scroll to and highlight a specific booking when navigating from a push notification
useEffect(() => {
if (!highlightBookingId || !safeBookings.length) return;
const timer = setTimeout(() => {
document.getElementById(`booking-${highlightBookingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}, 400);
return () => clearTimeout(timer);
}, [highlightBookingId, safeBookings.length]);

const myBookings = isTutor ? safeBookings.filter((b: any) => {
const myPetIds = pets?.map((p) => p.id) || [];
return myPetIds.includes(b.petId);
}) : safeBookings;

const filteredByStatus = statusFilter === "all" ? myBookings : myBookings?.filter((b) => b.status === statusFilter);
const filtered = petFilter ? filteredByStatus?.filter((b) => b.petId === petFilter) : filteredByStatus;

const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
e.preventDefault();
if (!selectedPetIds.length) {
toast({ title: "Selecione pelo menos um pet", variant: "destructive" });
return;
}
const fd = new FormData(e.currentTarget);
const type = ((fd.get("type") as string) || "day_use") as any;
const startDate = fd.get("startDate") as string;
const endDate = (fd.get("endDate") as string) || undefined;
const notes = (fd.get("notes") as string) || undefined;
try {
await Promise.all(
selectedPetIds.map((petId) =>
createMutation.mutateAsync({
crecheId,
data: { petId, type, startDate, endDate, notes } as any,
})
)
);
setIsCreateOpen(false);
setSelectedPetIds([]);
queryClient.invalidateQueries();
const count = selectedPetIds.length;
toast({
title: count === 1 ? "Reserva criada!" : `${count} reservas criadas!`,
description: "Aguardando confirmação da creche.",
});
} catch (err: any) {
toast({
title: "Não foi possível criar a reserva",
description: err?.data?.message ?? "Tente novamente em instantes.",
variant: "destructive",
});
}
};

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
queryClient.invalidateQueries({ queryKey: [`/api/creches/${crecheId}/bookings`] });
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

const handleCheckIn = (booking) => {
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

const handleCompleteService = (booking) => {
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

const pendingTasksForBooking = (booking) =>
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

const handleCheckOut = (booking) => {
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
action={
<Button onClick={() => setLocation("/bookings/new")}>
<Plus className="h-4 w-4 sm:mr-2" />
<span className="hidden sm:inline">Nova Reserva</span>
</Button>
}
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
<div
key={booking.id}
id={`booking-${booking.id}`}
className={`p-4 space-y-3 transition-colors ${highlightBookingId === booking.id ? "bg-violet-500/8 ring-1 ring-inset ring-violet-400/30" : ""}`}
>
{/* Row 1: pet name + tutor */}
<div className="flex items-start justify-between gap-2">
<div>
<p className="font-semibold text-white">{booking.petName}</p>
{!isTutor && (
<p className="text-xs text-muted-foreground mt-0.5">{booking.tutorName || "—"}</p>
)}
</div>
{(booking as any).onTheWayAt && booking.status !== "completed" && (
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
{format(parseLocalDate(booking.startDate), "dd/MM/yyyy")}
{booking.endDate && ` → ${format(parseLocalDate(booking.endDate), "dd/MM/yyyy")}`}
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
className="border-destructive/40 text-destructive/80 hover:bg-destructive/10 text-xs"
onClick={() => handleStatusUpdate(booking.id, "cancelled")}
isLoading={updateMutation.isPending}
>
Aprovar Cancel.
</Button>
<Button
size="sm"
variant="outline"
className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs"
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
className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs"
onClick={() => handleCheckIn(booking)}
isLoading={checkInMutation.isPending}
>
<LogIn className="mr-1 h-3 w-3" /> Check-in
</Button>
)}
{booking.status === "confirmed" && isPetPresent(booking.petId) && (
<Button
size="sm"
variant="outline"
className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10 text-xs"
onClick={() => handleCompleteService(booking)}
isLoading={completeServiceMutation.isPending}
>
<CheckCircle className="mr-1 h-3 w-3" /> Concluir Serviço
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
{format(parseLocalDate(booking.startDate), "dd/MM/yyyy")}
{booking.endDate && (
<span> → {format(parseLocalDate(booking.endDate), "dd/MM/yyyy")}</span>
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
<Button
size="sm"
variant="outline"
className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
onClick={() => handleCheckOut(booking)}
isLoading={checkOutMutation.isPending}
>
<LogOut className="mr-1.5 h-3.5 w-3.5" /> Check-out
</Button>
The above content does NOT show the entire file contents. If you need to view any lines of the file which were not shown to complete your task, call this tool again to view those lines.
