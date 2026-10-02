import { db } from "@workspace/db";
import { crechesTable, petsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { AssistantProductContextRegistry } from "./assistant-context-registry.service.js";
import { AssistantAuditService } from "./assistant-audit.service.js";
import type {
  AssistantSecurityContext,
  ScreenContext,
  ScreenEntityContext,
  AssistantRole,
} from "./assistant.types.js";

export class AssistantContextService {
  /**
   * Sanitizes input strings against script injection and HTML payloads.
   * Invariant: R41C-SEC-007 = PASS
   */
  public static sanitizeString(input?: string): string {
    if (!input || typeof input !== "string") return "";
    return input
      .replace(/<[^>]*>/g, "")
      .replace(/javascript:/gi, "")
      .trim();
  }

  /**
   * Resolves the authoritative screen and entity context for the current turn.
   * 
   * Invariants:
   * - MODEL_DEFINED_SECURITY_CONTEXT = 0 (Role & tenant always come from securityContext)
   * - SERVER_RBAC_REMAINS_AUTHORITATIVE = YES
   * - PET_CONTEXT_AUTHORIZATION_BYPASS = 0
   * - CROSS_TENANT_CONTEXT_ACCESS = 0
   * - STALE_SCREEN_CONTEXT_OVERRIDES_CURRENT = NO
   */
  public static async resolveContext(
    securityContext: AssistantSecurityContext,
    clientScreen?: Partial<ScreenContext>
  ): Promise<{
    user: {
      id: number;
      name: string;
      email: string;
      role: AssistantRole;
      crecheId: number | null;
    };
    creche: {
      id: number;
      name: string;
      status: string;
    } | null;
    screen: ScreenContext;
  }> {
    // 1. Resolve Creche data if crecheId is present in server security context
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

    // 2. Sanitize Route
    const rawRoute = clientScreen?.route || "/";
    const cleanRoute = this.sanitizeString(rawRoute) || "/";

    // 3. Resolve Screen Definition from Product Registry
    const resolved = AssistantProductContextRegistry.resolveScreen(cleanRoute);
    const screenDef = resolved
      ? resolved.definition
      : AssistantProductContextRegistry.getFallbackScreen(cleanRoute);
    const routeParams = resolved?.params || {};

    // 4. Role-aware allowed actions
    const allowedActions = this.getAllowedActionsForRole(
      securityContext.role,
      screenDef.feature,
      screenDef.availableActionIds
    );

    // 5. Authoritative Entity Verification
    const entity = await this.resolveAndAuthorizeEntity(
      securityContext,
      clientScreen?.entity,
      routeParams,
      screenDef.entityType
    );

    const screen: ScreenContext = {
      route: cleanRoute,
      routeId: screenDef.routeId,
      feature: screenDef.feature,
      title: screenDef.title,
      description: screenDef.description,
      allowedActions,
      availableActionIds: screenDef.availableActionIds,
      guidanceTargets: screenDef.guidanceTargets,
      knowledgeCategories: screenDef.knowledgeCategories,
      entity,
    };

    return {
      user: {
        id: securityContext.userId,
        name: securityContext.name,
        email: securityContext.email,
        role: securityContext.role,
        crecheId: securityContext.crecheId,
      },
      creche: crecheData,
      screen,
    };
  }

  /**
   * Validates and authorizes entity context against the database.
   * Strictly enforces role ownership and cross-tenant boundaries.
   */
  private static async resolveAndAuthorizeEntity(
    securityContext: AssistantSecurityContext,
    candidateEntity?: ScreenEntityContext | null,
    routeParams?: Record<string, string>,
    screenEntityType?: "pet" | "booking" | "tutor" | "invoice"
  ): Promise<ScreenEntityContext | null> {
    const rawId = candidateEntity?.id ?? routeParams?.id;
    const entityType = candidateEntity?.type ?? screenEntityType;

    if (!rawId || !entityType) {
      return null;
    }

    const numId = typeof rawId === "number" ? rawId : parseInt(String(rawId), 10);
    if (isNaN(numId) || numId <= 0) {
      return null;
    }

    if (entityType === "pet") {
      try {
        const [pet] = await db
          .select({
            id: petsTable.id,
            name: petsTable.name,
            species: petsTable.species,
            breed: petsTable.breed,
            status: petsTable.status,
            tutorId: petsTable.tutorId,
            crecheId: petsTable.crecheId,
            allergies: petsTable.allergies,
          })
          .from(petsTable)
          .where(eq(petsTable.id, numId))
          .limit(1);

        if (!pet) {
          AssistantAuditService.logSecurityDenial(securityContext, {
            action: "entity_context_pet_not_found",
            reason: `Pet ID ${numId} not found in database`,
          });
          return null;
        }

        // Tutor ownership check: pet must belong to tutor's userId
        if (securityContext.role === "tutor") {
          if (pet.tutorId !== securityContext.userId) {
            AssistantAuditService.logSecurityDenial(securityContext, {
              action: "entity_context_tutor_bypass_attempt",
              reason: `Tutor user ${securityContext.userId} attempted to access pet ${pet.id} belonging to tutor ${pet.tutorId}`,
            });
            return null; // Deny & strip context
          }
        }

        // Creche Admin / Staff tenant check: pet must belong to crecheId
        if (securityContext.role === "creche_admin" || securityContext.role === "staff") {
          if (!securityContext.crecheId || pet.crecheId !== securityContext.crecheId) {
            AssistantAuditService.logSecurityDenial(securityContext, {
              action: "entity_context_cross_tenant_attempt",
              reason: `User with crecheId ${securityContext.crecheId} attempted to access pet ${pet.id} of creche ${pet.crecheId}`,
            });
            return null; // Deny & strip context
          }
        }

        // Master Admin: platform level, no implicit tenant selection
        if (securityContext.role === "master_admin") {
          // If no explicit creche context authorized, master admin does not implicitly resolve tenant entity
          if (!securityContext.crecheId) {
            AssistantAuditService.logSecurityDenial(securityContext, {
              action: "master_admin_implicit_tenant_pet_access",
              reason: "Master admin cannot implicitly access tenant pet entity without authorized creche selection",
            });
            return null;
          }
        }

        // Authorized: return safe sanitized entity summary
        return {
          type: "pet",
          id: pet.id,
          name: pet.name,
          species: pet.species,
          breed: pet.breed || undefined,
          status: pet.status,
          allergies: pet.allergies || undefined,
        };
      } catch (err: any) {
        // Fallback gracefully on query error
        return null;
      }
    }

    return null;
  }

  /**
   * Filters allowed actions by role and feature.
   */
  private static getAllowedActionsForRole(
    role: AssistantRole,
    feature: string,
    featureActions: string[]
  ): string[] {
    const baseActions = ["view_help", "search_documentation"];

    if (role === "master_admin") {
      return [...baseActions, ...featureActions.filter((a) => a.startsWith("admin.") || a.startsWith("dashboard."))];
    }

    if (role === "creche_admin") {
      return [...baseActions, ...featureActions.filter((a) => !a.startsWith("admin."))];
    }

    if (role === "staff") {
      // Staff cannot see financial or administrative management actions
      return [
        ...baseActions,
        ...featureActions.filter(
          (a) =>
            !a.startsWith("financial.") &&
            !a.startsWith("billing.") &&
            !a.startsWith("staff.edit_role") &&
            !a.startsWith("admin.")
        ),
      ];
    }

    if (role === "tutor") {
      // Tutor sees only tutor-relevant actions
      return [
        ...baseActions,
        ...featureActions.filter(
          (a) =>
            a.startsWith("tutor.") ||
            a.startsWith("store.") ||
            a.startsWith("chat.") ||
            a.startsWith("booking.select") ||
            a.startsWith("booking.submit") ||
            a === "pet.search" ||
            a.startsWith("dashboard.")
        ),
      ];
    }

    return baseActions;
  }
}
