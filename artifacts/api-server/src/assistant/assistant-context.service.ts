import { db } from "@workspace/db";
import { crechesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { AssistantSecurityContext, ScreenContext } from "./assistant.types.js";

export class AssistantContextService {
  public static async resolveContext(
    securityContext: AssistantSecurityContext,
    clientScreen?: Partial<ScreenContext>
  ): Promise<{
    user: {
      id: number;
      name: string;
      email: string;
      role: string;
      crecheId: number | null;
    };
    creche: {
      id: number;
      name: string;
      status: string;
    } | null;
    screen: {
      route: string;
      feature: string;
      allowedActions: string[];
    };
  }> {
    let crecheData: { id: number; name: string; status: string } | null = null;

    if (securityContext.crecheId) {
      try {
        const [creche] = await db
          .select({
            id: crechesTable.id,
            name: crechesTable.name,
            status: crechesTable.status,
          })
          .from(crechesTable)
          .where(eq(crechesTable.id, securityContext.crecheId))
          .limit(1);

        if (creche) {
          crecheData = creche;
        }
      } catch {
        // Safe fallback if database is transiently unreachable
      }
    }

    const route = clientScreen?.route || "/";
    const feature = this.mapRouteToFeature(route);
    const allowedActions = this.getAllowedActionsForRole(securityContext.role, feature);

    return {
      user: {
        id: securityContext.userId,
        name: securityContext.name,
        email: securityContext.email,
        role: securityContext.role,
        crecheId: securityContext.crecheId,
      },
      creche: crecheData,
      screen: {
        route,
        feature,
        allowedActions,
      },
    };
  }

  private static mapRouteToFeature(route: string): string {
    if (route === "/" || route.startsWith("/dashboard")) return "dashboard";
    if (route.startsWith("/pets/")) return "pet_detail";
    if (route.startsWith("/pets")) return "pets_directory";
    if (route.startsWith("/bookings/new")) return "booking_create";
    if (route.startsWith("/bookings")) return "bookings_calendar";
    if (route.startsWith("/staff/manage")) return "staff_management";
    if (route.startsWith("/staff/board")) return "operational_board";
    if (route.startsWith("/tutors")) return "tutors_directory";
    if (route.startsWith("/chat")) return "chat_messaging";
    if (route.startsWith("/financial")) return "financial_management";
    if (route.startsWith("/settings")) return "creche_settings";
    if (route.startsWith("/admin/creches")) return "master_admin_creches";
    if (route.startsWith("/admin/campaigns")) return "master_admin_campaigns";
    return "general_view";
  }

  private static getAllowedActionsForRole(role: string, feature: string): string[] {
    const baseActions = ["view_help", "search_documentation"];

    if (role === "master_admin") {
      return [...baseActions, "manage_creches", "view_global_metrics", "configure_plans"];
    }

    if (role === "creche_admin") {
      const adminActions = [...baseActions, "view_onboarding", "manage_staff", "view_financials"];
      if (feature === "pets_directory") adminActions.push("create_pet", "edit_pet");
      if (feature === "bookings_calendar") adminActions.push("create_booking", "cancel_booking");
      return adminActions;
    }

    if (role === "staff") {
      const staffActions = [...baseActions, "operational_checkin", "operational_checkout", "register_task"];
      if (feature === "bookings_calendar") staffActions.push("view_bookings");
      if (feature === "pets_directory") staffActions.push("view_pet_care_notes");
      return staffActions;
    }

    if (role === "tutor") {
      const tutorActions = [...baseActions, "view_own_pets", "request_booking", "open_chat"];
      return tutorActions;
    }

    return baseActions;
  }
}
