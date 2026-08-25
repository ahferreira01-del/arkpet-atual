// Service bookings (grooming, etc.) follow a different operational flow:
// confirmed → "Iniciar Serviço" (checkin) → active → "Concluir Serviço" (complete-service)
// They don't have check-out or consumables — the pet leaves after the service.
export const SERVICE_BOOKING_TYPES = new Set(["banho", "visita_taxi", "creche_taxi"]);

export function isServiceBooking(
  bookingOrType: { type: string; catalogueItemType?: string | null } | string,
  catalogueItemType?: string | null
): boolean {
  if (typeof bookingOrType === "object" && bookingOrType !== null) {
    if (bookingOrType.catalogueItemType === null) {
      return SERVICE_BOOKING_TYPES.has(bookingOrType.type);
    }
    return bookingOrType.catalogueItemType === "service";
  }
  if (catalogueItemType === null) {
    return SERVICE_BOOKING_TYPES.has(bookingOrType);
  }
  return catalogueItemType === "service";
}
