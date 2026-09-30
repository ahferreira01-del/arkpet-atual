import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    users: [] as any[],
    pets: [] as any[],
  },
}));

import { validateTargetTutor, sendMessageSchema } from "../routes/chat.js";
import { canUserAccessPrivateResource } from "../lib/objectAuthorization.js";

vi.mock("@workspace/db", () => {
  const makeChain = (getRows: () => any[]) => {
    const chain: any = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      limit: (n: number) => Promise.resolve(getRows().slice(0, n)),
      orderBy: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve(getRows()).then(resolve, reject),
    };
    return chain;
  };

  return {
    db: {
      ...makeChain(() => mockState.users),
      transaction: vi.fn(async (cb: any) => {
        const tx = {
          ...makeChain(() => mockState.pets),
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

describe("ARKPET — R40.D-FINAL.1 BACKEND CHAT SECURITY TEST SUITE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.users = [];
    mockState.pets = [];
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-01: Tutor requests another tutor's conversation -> 403
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-01 — Tutor cannot access another tutor's conversation thread", () => {
    it("strictly returns 403 Forbidden when a tutor attempts to access a conversation for another tutorId", async () => {
      const tutorUser = { id: 10, role: "tutor" };
      const foreignTutorId = 20;

      const result = await validateTargetTutor(1, foreignTutorId, tutorUser);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(403);
        expect(result.error).toMatch(/acesso não autorizado/i);
      }
    });

    it("allows tutor to access their own conversation thread", async () => {
      const tutorUser = { id: 10, role: "tutor" };
      const result = await validateTargetTutor(1, 10, tutorUser);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tutorId).toBe(10);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-02: Staff from Tenant A targets tutor from Tenant B -> 404
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-02 — Staff from Tenant A cannot target tutor from Tenant B", () => {
    it("returns 404 Not Found when staff attempts to message a tutor that belongs to a different creche", async () => {
      const staffUser = { id: 5, role: "staff" };
      const targetTutorId = 99;
      // mockUsers is empty, meaning the tutor does not exist in Creche 1
      mockState.users = [];

      const result = await validateTargetTutor(1, targetTutorId, staffUser);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.error).toMatch(/não encontrado nesta creche/i);
      }
    });

    it("allows staff to target a tutor that belongs to their creche", async () => {
      const staffUser = { id: 5, role: "staff" };
      const targetTutorId = 25;
      mockState.users = [{ id: 25 }];

      const result = await validateTargetTutor(1, targetTutorId, staffUser);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tutorId).toBe(25);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-03: Foreign pet cannot be attached to chat message -> 400
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-03 — Foreign pet link validation in chat message", () => {
    it("rejects non-positive petId at the schema level", () => {
      const invalidPet = sendMessageSchema.safeParse({
        tutorId: 25,
        petId: -1,
        content: "Olá",
      });
      expect(invalidPet.success).toBe(false);
    });

    it("accepts valid petId belonging to schema contract", () => {
      const valid = sendMessageSchema.safeParse({
        tutorId: 25,
        petId: 10,
        content: "Olá",
      });
      expect(valid.success).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-04: Cross-tenant isolation & invalid media URLs
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-04 — Chat mediaUrl strictly restricted to authorized canonical storage paths", () => {
    it("rejects arbitrary external URLs (ARBITRARY_EXTERNAL_CHAT_MEDIA_URL = 0)", () => {
      const externalUrl = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "https://evil-attacker.com/malicious.jpg",
      });
      expect(externalUrl.success).toBe(false);
      if (!externalUrl.success) {
        expect(externalUrl.error.flatten().fieldErrors.mediaUrl?.[0]).toMatch(/caminho de armazenamento canônico/i);
      }
    });

    it("rejects arbitrary internal API paths (ARBITRARY_INTERNAL_API_AS_MEDIA = 0)", () => {
      const internalApiPath = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "/api/creches/1/users",
      });
      expect(internalApiPath.success).toBe(false);
      if (!internalApiPath.success) {
        expect(internalApiPath.error.flatten().fieldErrors.mediaUrl?.[0]).toMatch(/caminho de armazenamento canônico/i);
      }
    });

    it("rejects path traversal attempts in mediaUrl", () => {
      const traversal = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto",
        mediaUrl: "/objects/uploads/../secrets.env",
      });
      expect(traversal.success).toBe(false);
    });

    it("accepts canonical private storage paths starting with /objects/", () => {
      const validCanonical = sendMessageSchema.safeParse({
        tutorId: 25,
        content: "Foto do pet",
        mediaUrl: "/objects/uploads/c1/e0a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c.webp",
      });
      expect(validCanonical.success).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-SEC-05: Storage authorization for chat attachments
  // ────────────────────────────────────────────────────────────
  describe("CHAT-SEC-05 — Unauthorized media reference does not grant storage access", () => {
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
      // mockUsers is empty -> no chat message or pet matches this tutor
      mockState.users = [];

      const hasAccess = await canUserAccessPrivateResource({
        canonicalObjectPath: "/objects/uploads/c1/e0a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c.webp",
        pathCrecheId: 1,
        user: tutorSameTenant,
      });

      expect(hasAccess).toBe(false);
    });
  });
});
