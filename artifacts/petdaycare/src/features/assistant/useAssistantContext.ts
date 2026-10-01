import { useLocation } from "wouter";
import type { ScreenContextInfo } from "./assistant.types";

export function useAssistantContext(): ScreenContextInfo {
  const [location] = useLocation();

  const getFeatureInfo = (path: string): { feature: string; title: string } => {
    if (path === "/" || path.startsWith("/dashboard")) {
      return { feature: "dashboard", title: "Painel Principal" };
    }
    if (path.startsWith("/pets/")) {
      return { feature: "pet_detail", title: "Ficha do Pet" };
    }
    if (path.startsWith("/pets")) {
      return { feature: "pets_directory", title: "Diretório de Pets" };
    }
    if (path.startsWith("/bookings/new")) {
      return { feature: "booking_create", title: "Nova Reserva" };
    }
    if (path.startsWith("/bookings")) {
      return { feature: "bookings_calendar", title: "Agenda de Reservas" };
    }
    if (path.startsWith("/staff/manage")) {
      return { feature: "staff_management", title: "Gerenciamento de Equipe" };
    }
    if (path.startsWith("/staff/board")) {
      return { feature: "operational_board", title: "Painel Operacional" };
    }
    if (path.startsWith("/staff/qr-scanner")) {
      return { feature: "qr_scanner", title: "Leitor de QR Code" };
    }
    if (path.startsWith("/tutors")) {
      return { feature: "tutors_directory", title: "Tutores" };
    }
    if (path.startsWith("/chat")) {
      return { feature: "chat_messaging", title: "Mensagens & Chat" };
    }
    if (path.startsWith("/financial")) {
      return { feature: "financial_management", title: "Módulo Financeiro" };
    }
    if (path.startsWith("/tutor/financial")) {
      return { feature: "tutor_financial", title: "Minhas Faturas" };
    }
    if (path.startsWith("/settings")) {
      return { feature: "creche_settings", title: "Configurações da Creche" };
    }
    if (path.startsWith("/assinatura")) {
      return { feature: "billing_subscription", title: "Assinatura ArkPet" };
    }
    return { feature: "general_view", title: "ArkPet" };
  };

  const info = getFeatureInfo(location);

  return {
    route: location,
    feature: info.feature,
    title: info.title,
  };
}
