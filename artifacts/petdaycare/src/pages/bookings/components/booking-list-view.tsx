import React from "react";
import type { BadgeProps } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolvePhotoUrl } from "@/lib/utils";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import {
  CalendarDays as Calendar,
  LogIn,
  LogOut,
  Navigation,
  Car,
  Package,
  CheckCircle,
  PawPrint,
  Clock,
} from "lucide-react";
import { isServiceBooking, SERVICE_BOOKING_TYPES } from "@/lib/booking-utils";
import type {
  Booking,
  BookingStatus as GeneratedBookingStatus,
  Pet,
} from "@workspace/api-client-react";

export { isServiceBooking, SERVICE_BOOKING_TYPES };

export type BookingStatus = GeneratedBookingStatus;
export type BookingType =
  | "day_use"
  | "lodging"
  | "banho"
  | "hospedagem_banho"
  | "visita"
  | "pacote_4dias"
  | "pacote_8dias"
  | "pacote_20dias"
  | "visita_taxi"
  | "creche_taxi";

export interface BookingAdditionalService {
  id: number;
  itemName: string;
}

export type BookingListItem = Omit<Booking, "type"> & {
  type: string;
  additionalServices?: BookingAdditionalService[] | null;
  onTheWayAt?: string | null;
};

export const bookingTypeLabel: Record<string, string> = {
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

export const statusVariant: Record<BookingStatus, NonNullable<BadgeProps["variant"]>> = {
  pending: "warning",
  confirmed: "default",
  active: "success",
  completed: "secondary",
  cancelled: "destructive",
  cancel_requested: "destructive",
};

export const statusLabel: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmada",
  active: "Ativa",
  completed: "Concluída",
  cancelled: "Cancelada",
  cancel_requested: "Cancelamento Solicitado",
  all: "Todos os status",
};

export interface BookingListViewProps {
  bookings: BookingListItem[];
  pets: Pet[];
  isTutor: boolean;
  highlightBookingId: number | null;
  isPetPresent: (petId: number) => boolean;
  bookingPersonalItems: Record<number, { hasItems: boolean; photoUrl: string | null }>;
  handleStatusUpdate: (bookingId: number, newStatus: BookingStatus) => void;
  handleCheckIn: (booking: BookingListItem) => void;
  handleCompleteService: (booking: BookingListItem) => void;
  handleCheckOut: (booking: BookingListItem) => void;
  onOpenOnTheWay: (booking: BookingListItem) => void;
  onOpenConsumable: (booking: BookingListItem) => void;
  onOpenEdit: (booking: BookingListItem) => void;
  isUpdatePending: boolean;
  isCheckInPending: boolean;
  isCompleteServicePending: boolean;
  isCheckOutPending: boolean;
}

export function BookingListView({
  bookings,
  pets,
  isTutor,
  highlightBookingId,
  isPetPresent,
  bookingPersonalItems,
  handleStatusUpdate,
  handleCheckIn,
  handleCompleteService,
  handleCheckOut,
  onOpenOnTheWay,
  onOpenConsumable,
  onOpenEdit,
  isUpdatePending,
  isCheckInPending,
  isCompleteServicePending,
  isCheckOutPending,
}: BookingListViewProps) {
  return (
    <>
      {/* ── MOBILE CARD VIEW ──────────────────────────────── */}
      <div className="md:hidden divide-y divide-border">
        {bookings.map((booking) => (
          <div
            key={booking.id}
            id={`booking-${booking.id}`}
            className={`p-4 flex flex-col gap-3 transition-colors ${highlightBookingId === booking.id ? "bg-primary/5 ring-1 ring-inset ring-primary/20" : ""}`}
          >
            {/* Row 1 & 2: Pet Name, Photo, Tutor & Badges */}
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-secondary overflow-hidden flex items-center justify-center">
                {pets?.find((p) => p.id === booking.petId)?.photoUrl ? (
                  <img src={resolvePhotoUrl(pets.find((p) => p.id === booking.petId)?.photoUrl) || undefined} alt={booking.petName || undefined} className="h-full w-full object-cover" />
                ) : (
                  <PawPrint className="h-5 w-5 text-muted-foreground opacity-50" />
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
                  <h3 className="text-base font-semibold text-foreground truncate leading-tight">{booking.petName}</h3>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant={statusVariant[booking.status] || "secondary"} className="h-5 px-1.5 text-[10px]">
                      {statusLabel[booking.status] || booking.status}
                    </Badge>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground bg-secondary border-border">
                      {bookingTypeLabel[booking.type] || booking.type}
                    </Badge>
                  </div>
                </div>
                {!isTutor && (
                  <p className="text-sm text-muted-foreground truncate leading-tight">{booking.tutorName || "—"}</p>
                )}
              </div>
            </div>

            {/* Row 3: Dates, Times, Services, Observations */}
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    {format(parseLocalDate(booking.startDate), "dd/MM/yyyy")}
                    {booking.endDate && ` → ${format(parseLocalDate(booking.endDate), "dd/MM/yyyy")}`}
                  </span>
                </div>
                {(booking.checkInTime || booking.checkOutTime) && (
                  <div className="flex items-center gap-3">
                    {booking.checkInTime && (
                      <span className="text-emerald-500 font-medium flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> In: {format(new Date(booking.checkInTime), "HH:mm")}
                      </span>
                    )}
                    {booking.checkOutTime && (
                      <span className="text-amber-500 font-medium flex items-center gap-1">
                        <LogOut className="h-3.5 w-3.5" /> Out: {format(new Date(booking.checkOutTime), "HH:mm")}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {Array.isArray(booking.additionalServices) && booking.additionalServices.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {booking.additionalServices.map((addon) => (
                    <Badge key={addon.id} variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 font-medium h-5">
                      + {addon.itemName}
                    </Badge>
                  ))}
                </div>
              )}

              {booking.onTheWayAt && booking.status !== "completed" && (
                <div className="mt-0.5">
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 font-medium h-5 flex items-center gap-1 w-fit">
                    <Car className="h-3 w-3" /> A caminho
                  </Badge>
                </div>
              )}

              {booking.notes && (
                <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-2.5 py-2 italic border border-border/50">
                  💬 {booking.notes}
                </p>
              )}
            </div>

            {/* Row 4: Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 pt-3 border-t border-border mt-1">
              {(booking.status === "confirmed" || booking.status === "active") && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full sm:w-auto h-10 text-sm px-4"
                  onClick={() => onOpenOnTheWay(booking)}
                >
                  <Navigation className="mr-1.5 h-3.5 w-3.5" /> A caminho
                </Button>
              )}
              {isTutor && (booking.status === "pending" || booking.status === "confirmed") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto h-10 text-sm px-4 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                  onClick={() => handleStatusUpdate(booking.id, "cancel_requested")}
                  isLoading={isUpdatePending}
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
                        className="w-full sm:w-auto h-10 text-sm px-4 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                        onClick={() => handleStatusUpdate(booking.id, "cancelled")}
                        isLoading={isUpdatePending}
                      >
                        Aprovar Cancelamento
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full sm:w-auto h-10 text-sm px-4"
                        onClick={() => handleStatusUpdate(booking.id, "confirmed")}
                        isLoading={isUpdatePending}
                      >
                        Recusar
                      </Button>
                    </>
                  )}
                  {booking.status === "confirmed" && (
                    isServiceBooking(booking) ? (
                      isPetPresent(booking.petId) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full sm:w-auto h-10 text-sm px-4"
                          onClick={() => handleCompleteService(booking)}
                          isLoading={isCompleteServicePending}
                        >
                          <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Concluir Serviço
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full sm:w-auto h-10 text-sm px-4"
                          onClick={() => handleCheckIn(booking)}
                          isLoading={isCheckInPending}
                        >
                          <LogIn className="mr-1.5 h-3.5 w-3.5" /> Iniciar Serviço
                        </Button>
                      )
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full sm:w-auto h-10 text-sm px-4"
                        onClick={() => handleCheckIn(booking)}
                        isLoading={isCheckInPending}
                      >
                        <LogIn className="mr-1.5 h-3.5 w-3.5" /> Check-in
                      </Button>
                    )
                  )}
                  {booking.status === "active" && isServiceBooking(booking) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto h-10 text-sm px-4"
                      onClick={() => handleCompleteService(booking)}
                      isLoading={isCompleteServicePending}
                    >
                      <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Concluir Serviço
                    </Button>
                  )}
                  {booking.status === "active" && !isServiceBooking(booking) && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full sm:w-auto h-10 text-sm px-4"
                        onClick={() => handleCheckOut(booking)}
                        isLoading={isCheckOutPending}
                      >
                        <LogOut className="mr-1.5 h-3.5 w-3.5" /> Check-out
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full sm:w-auto h-10 text-sm px-4 bg-secondary/50"
                        onClick={() => onOpenConsumable(booking)}
                      >
                        <Package className="mr-1.5 h-3.5 w-3.5" /> Consumo
                      </Button>
                    </>
                  )}
                  {booking.status === "pending" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto h-10 text-sm px-4"
                      onClick={() => handleStatusUpdate(booking.id, "confirmed")}
                      isLoading={isUpdatePending}
                    >
                      Confirmar
                    </Button>
                  )}
                  
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="w-full sm:w-auto sm:ml-auto h-10 text-sm px-4 text-muted-foreground hover:text-foreground" 
                    onClick={() => onOpenEdit(booking)}
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
          <thead className="text-xs text-muted-foreground uppercase bg-secondary">
            <tr>
              <th className="px-6 py-4 font-medium">Pet {!isTutor && "/ Tutor"}</th>
              <th className="px-6 py-4 font-medium">Tipo</th>
              <th className="px-6 py-4 font-medium">Datas</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {bookings.map((booking) => (
              <tr key={booking.id} className="hover:bg-secondary transition-colors">
                <td className="px-6 py-4">
                  <p className="font-medium text-foreground">{booking.petName}</p>
                  {!isTutor && (
                    <p className="text-xs text-muted-foreground mt-0.5">{booking.tutorName || "—"}</p>
                  )}
                </td>
                <td className="px-6 py-4">
                  <Badge variant="outline" className="bg-secondary capitalize">
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
                  {booking.checkOutTime && (
                    <p className="text-xs text-amber-500 mt-0.5">
                      Check-out: {format(new Date(booking.checkOutTime), "HH:mm")}
                    </p>
                  )}
                  {booking.notes && (
                    <p className="text-xs text-muted-foreground mt-1 italic">💬 {booking.notes}</p>
                  )}
                </td>
                <td className="px-6 py-4">
                  <Badge variant={statusVariant[booking.status] || "secondary"}>
                    {statusLabel[booking.status] || booking.status}
                  </Badge>
                  {booking.onTheWayAt && booking.status !== "completed" && (
                    <p className="text-xs text-primary mt-0.5 flex items-center gap-1">
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
                        className="border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => onOpenOnTheWay(booking)}
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
                        isLoading={isUpdatePending}
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
                              isLoading={isUpdatePending}
                            >
                              Aprovar Cancelamento
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-success/30 text-success hover:bg-success/10"
                              onClick={() => handleStatusUpdate(booking.id, "confirmed")}
                              isLoading={isUpdatePending}
                            >
                              Recusar
                            </Button>
                          </>
                        )}
                        {booking.status === "confirmed" && (
                          isServiceBooking(booking) ? (
                            isPetPresent(booking.petId) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                                onClick={() => handleCompleteService(booking)}
                                isLoading={isCompleteServicePending}
                              >
                                <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Concluir Serviço
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-success/30 text-success hover:bg-success/10"
                                onClick={() => handleCheckIn(booking)}
                                isLoading={isCheckInPending}
                              >
                                <LogIn className="mr-1.5 h-3.5 w-3.5" /> Iniciar Serviço
                              </Button>
                            )
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-success/30 text-success hover:bg-success/10"
                              onClick={() => handleCheckIn(booking)}
                              isLoading={isCheckInPending}
                            >
                              <LogIn className="mr-1.5 h-3.5 w-3.5" /> Check-in
                            </Button>
                          )
                        )}
                        {booking.status === "active" && isServiceBooking(booking) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-success/30 text-success hover:bg-success/10"
                            onClick={() => handleCompleteService(booking)}
                            isLoading={isCompleteServicePending}
                          >
                            <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Concluir Serviço
                          </Button>
                        )}
                        {booking.status === "active" && !isServiceBooking(booking) && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                              onClick={() => handleCheckOut(booking)}
                              isLoading={isCheckOutPending}
                            >
                              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Check-out
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-success/30 text-success hover:bg-success/10"
                              onClick={() => onOpenConsumable(booking)}
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
                            isLoading={isUpdatePending}
                          >
                            Confirmar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => onOpenEdit(booking)}>
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
  );
}
