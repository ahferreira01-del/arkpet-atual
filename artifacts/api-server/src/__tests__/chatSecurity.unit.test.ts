import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

// Fixture state with realistic multi-tenant data
const { mockState } = vi.hoisted(() => ({
  mockState: {
    users: [
      { id: 10, name: "Tutor Creche 1", role: "tutor", crecheId: 1 },
      { id: 25, name: "Mariana Silva", role: "tutor", crecheId: 1 },
      { id: 99, name: "Tutor Creche 2", role: "tutor", crecheId: 2 }, // Belongs to Creche 2
      { id: 5, name: "Staff Lucas", role: "staff", crecheId: 1 },
    ] as any[],
    pets: [
      { id: 101, name: "Pipoca", crecheId: 1, tutorId: 25 }, // Belongs to Tutor 25 in Creche 1
      { id: 102, name: "Thor", crecheId: 1, tutorId: 10 },   // Belongs to Tutor 10 in Creche 1
      { id: 103, name: "Rex", crecheId: 2, tutorId: 99 },    // Belongs to Tutor 99 in Creche 2
    ] as any[],
  },
}));

import {
  validateTargetTutor,
  validateChatPet,
  validateChatMedia,
  sendMessageSchema,
} from "../routes/chat.js";
import { canUserAccessPrivateResource } from "../lib/objectAuthorization.js";

// Helper to evaluate SQL where conditions against fixture rows
function evaluateWhere(sqlStr: string, params: any[], row: any): boolean {
  const re = /"([^"]+)"\."([^"]+)"\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlStr)) !== null) {
    const col = m[2];
    const paramVal = params[parseInt(m[3], 10) - 1];
    let rowVal: any;
    if (col === "creche_id") {
      rowVal = row.crecheId ?? row.creche_id;
    } else if (col === "tutor_id") {
      rowVal = row.tutorId ?? row.tutor_id;
    } else {
      rowVal = row[col];
    }
    if (rowVal !== paramVal) {
      return false;
    }
  }
  return true;
}

vi.mock("@workspace/db", () => {
  const makePredicateAwareChain = (getTableRows: () => any[]) => {
    let currentRows: any[] = [];
    const chain: any = {
      select: () => chain,
      from: () => {
        currentRows = [...getTableRows()];
        return chain;
      },
      where: (condition: any) => {
        if (condition) {
          const { sql: sqlStr, params } = dialect.sqlToQuery(condition);
          currentRows = currentRows.filter((row) => evaluateWhere(sqlStr, params, row));
        }
        return chain;
      },
      limit: (n: number) => Promise.resolve(currentRows.slice(0, n)),
      orderBy: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve(currentRows).then(resolve, reject),
    };
    return chain;
  };

  return {
    db: {
      ...makePredicateAwareChain(() => mockState.users),
      transaction: vi.fn(async (cb: any) => {
        const tx = {
          ...makePredicateAwareChain(() => mockState.pets),
          insert: vi.fn(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: 1, content: "test" }]),
            })),
          })),
        };
        return cb(tx);
      }),
    },
  };
});

vi.mock("../services/tenantLifecycleLock.js", () => ({
  acquireTenantOperationalLock: vi.fn(async () => {}),
  TenantArchivedError: class extends Error {},
}));

vi.mock("../lib/push.js", () => ({
  sendPushToUsers: vi.fn(async () => {}),
}));

describe("ARKPET — R40.D-FINAL.2 BACKEND CHAT SECURITY TEST SUITE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-01: Tutor requests another tutor's conversation -> 403
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-01 — Tutor cannot access another tutor's conversation thread", () => {
    it("strictly returns 403 Forbidden when a tutor attempts to access a conversation for another tutorId", async () => {
      const tutorUser = { id: 25, role: "tutor" };
      const foreignTutorId = 10;

      const result = await validateTargetTutor(1, foreignTutorId, tutorUser);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(403);
        expect(result.error).toMatch(/acesso não autorizado/i);
      }
    });

    it("allows tutor to access their own conversation thread", async () => {
      const tutorUser = { id: 25, role: "tutor" };
      const result = await validateTargetTutor(1, 25, tutorUser);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tutorId).toBe(25);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-02: Real Query Behavior & Tenant Filter Proof
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-02 — Staff from Tenant A cannot target tutor from Tenant B (TENANT_FILTER_REMOVAL_WOULD_FAIL_TEST = YES)", () => {
    it("returns 404 Not Found when staff attempts to message a tutor that belongs to a different creche, proved via predicate evaluation", async () => {
      const staffUser = { id: 5, role: "staff" };
      // Tutor 99 exists in database, but belongs to Creche 2!
      const targetTutorId = 99;

      const result = await validateTargetTutor(1, targetTutorId, staffUser);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.error).toMatch(/não encontrado nesta creche/i);
      }
    });

    it("allows staff to target a tutor that belongs to their creche", async () => {
      const staffUser = { id: 5, role: "staff" };
      // Tutor 25 exists in Creche 1
      const targetTutorId = 25;

      const result = await validateTargetTutor(1, targetTutorId, staffUser);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tutorId).toBe(25);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-03: Real Pet Ownership & Cross-Tenant Rejection
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-03 — Foreign Pet Ownership & Cross-Tenant Link Validation", () => {
    it("rejects non-positive petId at the schema level", () => {
      const invalidPet = sendMessageSchema.safeParse({
        tutorId: 25,
        petId: -1,
        content: "Olá",
      });
      expect(invalidPet.success).toBe(false);
    });

    it("rejects message when petId belongs to a different tutor within the same creche (FOREIGN_TUTOR_PET_CHAT_REFERENCE = 0)", async () => {
      // Tutor 25 targeting Thor (petId: 102), who belongs to Tutor 10
      const txMock = {
        select: () => ({
          from: () => ({
            where: (condition: any) => {
              const { sql: sqlStr, params } = dialect.sqlToQuery(condition);
              const filtered = mockState.pets.filter((p) => evaluateWhere(sqlStr, params, p));
              return {
                limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
              };
            },
          }),
        }),
      };

      const result = await validateChatPet(1, 25, 102, txMock);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.error).toMatch(/pet inválido ou não pertence a este tutor nesta creche/i);
      }
    });

    it("rejects message when petId belongs to a different creche (CROSS_TENANT_PET_CHAT_REFERENCE = 0)", async () => {
      // Creche 1 targeting Rex (petId: 103), who belongs to Creche 2
      const txMock = {
        select: () => ({
          from: () => ({
            where: (condition: any) => {
              const { sql: sqlStr, params } = dialect.sqlToQuery(condition);
              const filtered = mockState.pets.filter((p) => evaluateWhere(sqlStr, params, p));
              return {
                limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
              };
            },
          }),
        }),
      };

      const result = await validateChatPet(1, 25, 103, txMock);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.error).toMatch(/pet inválido ou não pertence a este tutor nesta creche/i);
      }
    });

    it("accepts valid pet belonging to the target tutor in the conversation creche", async () => {
      // Tutor 25 with Pipoca (petId: 101) in Creche 1
      const txMock = {
        select: () => ({
          from: () => ({
            where: (condition: any) => {
              const { sql: sqlStr, params } = dialect.sqlToQuery(condition);
              const filtered = mockState.pets.filter((p) => evaluateWhere(sqlStr, params, p));
              return {
                limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
              };
            },
          }),
        }),
      };

      const result = await validateChatPet(1, 25, 101, txMock);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.petName).toBe("Pipoca");
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-MEDIA-01: Foreign Tenant Media Reference Rejection
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-MEDIA-01 — Foreign Tenant Media Rejection (FOREIGN_TENANT_MEDIA_INSERT = 0)", () => {
    it("rejects media belonging to a different creche before database insert", async () => {
      // Creche 1 conversation attempting to link Creche 2's media path
      const foreignMedia = "/objects/uploads/c2/e0a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c.webp";
      const result = await validateChatMedia(1, foreignMedia);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe("CROSS_TENANT_MEDIA_FORBIDDEN");
        expect(result.error).toMatch(/não pertence a esta creche/i);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-MEDIA-02: Canonical Media Acceptance
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-MEDIA-02 — Canonical Media Acceptance", () => {
    it("accepts canonical private storage path matching the conversation crecheId", async () => {
      const validMedia = "/objects/uploads/c1/e0a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c.webp";
      const result = await validateChatMedia(1, validMedia);

      expect(result.ok).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-MEDIA-03: Malformed Media Paths & Schema Protection
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-MEDIA-03 — Malformed Media Paths Rejected by Canonical Parser", () => {
    it("rejects path missing tenant segment (uploads/photo.webp)", () => {
      const res = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "/objects/uploads/photo.webp",
      });
      expect(res.success).toBe(false);
    });

    it("rejects arbitrary non-canonical path (/objects/foo.webp)", () => {
      const res = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "/objects/foo.webp",
      });
      expect(res.success).toBe(false);
    });

    it("rejects non-UUID filename in uploads path", () => {
      const res = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "/objects/uploads/c1/photo.webp",
      });
      expect(res.success).toBe(false);
    });

    it("rejects path traversal attempts (ARBITRARY_OBJECT_PATH_ACCEPTED = 0)", () => {
      const res = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "/objects/uploads/c1/../secrets.env",
      });
      expect(res.success).toBe(false);
    });

    it("rejects arbitrary external URLs (ARBITRARY_EXTERNAL_CHAT_MEDIA_URL = 0)", () => {
      const res = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "https://evil-attacker.com/malicious.jpg",
      });
      expect(res.success).toBe(false);
    });

    it("rejects arbitrary internal API paths (ARBITRARY_INTERNAL_API_AS_MEDIA = 0)", () => {
      const res = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "/api/creches/1/users",
      });
      expect(res.success).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-05: Storage Read Authorization
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-05 — Storage Authorization for Attachments (UNAUTHORIZED_ATTACHMENT_READ_ACCESS = 0)", () => {
    it("denies tutor from accessing an object if user.crecheId !== pathCrecheId", async () => {
      const tutorForeignTenant = {
        id: 10,
        role: "tutor",
        crecheId: 2, // Creche 2
      };

      const hasAccess = await canUserAccessPrivateResource({
        canonicalObjectPath: "/objects/uploads/c1/e0a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c.webp",
        pathCrecheId: 1, // Creche 1
        user: tutorForeignTenant,
      });

      expect(hasAccess).toBe(false);
    });

    it("denies tutor from accessing an object if no business resource matches tutor.id", async () => {
      const tutorSameTenant = {
        id: 10,
        role: "tutor",
        crecheId: 1,
      };

      const hasAccess = await canUserAccessPrivateResource({
        canonicalObjectPath: "/objects/uploads/c1/e0a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c.webp",
        pathCrecheId: 1,
        user: tutorSameTenant,
      });

      expect(hasAccess).toBe(false);
    });
  });
});
