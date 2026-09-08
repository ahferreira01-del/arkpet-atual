import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requestAssistedImplementation,
  reviewImplementationRequest,
  sendImplementationQuote,
  acceptImplementationQuote,
  createImplementationCheckoutSession,
  handlePlatformServicePaymentWebhook,
  scheduleImplementation,
  startImplementation,
  completeImplementation,
  cancelImplementation,
  PlatformServiceError,
} from "../services/platformServices.js";
import {
  platformServiceRequestsTable,
  crechesTable,
  type PlatformServiceRequest,
} from "@workspace/db/schema";

describe("Platform Services (Implantação Assistida) Domain Unit Tests (R36.G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Customer Request & Uniqueness", () => {
    it("creates an implementation request in 'requested' status with zero charge and no checkout session", async () => {
      const creche = { id: 10, name: "Creche Pet Feliz" };
      const createdRow: PlatformServiceRequest = {
        id: 1,
        crecheId: 10,
        serviceType: "ASSISTED_IMPLEMENTATION",
        status: "requested",
        requestedByUserId: 5,
        customerNotes: "Gostaria de apoio para configurar o sistema inicial",
        quotedPriceCents: null,
        quoteSnapshotJson: null,
        scopeNotes: null,
        quotedBy: null,
        quotedAt: null,
        acceptedAt: null,
        acceptedByUserId: null,
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
        paidAt: null,
        scheduledFor: null,
        startedAt: null,
        completedAt: null,
        completedBy: null,
        completionNotes: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        refundStatus: "NONE",
        adminNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === crechesTable) return Promise.resolve([creche]);
                if (table === platformServiceRequestsTable) return Promise.resolve([]); // no active requests
                return Promise.resolve([]);
              }),
            })),
          })),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdRow]),
          }),
        }),
      };

      const result = await requestAssistedImplementation({
        crecheId: 10,
        userId: 5,
        userEmail: "gestor@petfeliz.com",
        customerNotes: "Gostaria de apoio para configurar o sistema inicial",
        dbClient: mockDb,
      });

      expect(result.status).toBe("requested");
      expect(result.id).toBe(1);
      expect(result.quotedPriceCents).toBeNull();
      expect(result.stripeCheckoutSessionId).toBeNull();
    });

    it("rejects request if an active request already exists for the creche (partial uniqueness)", async () => {
      const creche = { id: 10, name: "Creche Pet Feliz" };
      const activeRequest = {
        id: 1,
        crecheId: 10,
        status: "under_review",
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === crechesTable) return Promise.resolve([creche]);
                if (table === platformServiceRequestsTable) return Promise.resolve([activeRequest]);
                return Promise.resolve([]);
              }),
            })),
          })),
        })),
      };

      await expect(
        requestAssistedImplementation({
          crecheId: 10,
          userId: 5,
          userEmail: "gestor@petfeliz.com",
          dbClient: mockDb,
        }),
      ).rejects.toThrow("Já existe uma solicitação de implantação assistida em andamento para esta creche.");
    });
  });

  describe("2. Master Admin Review & Quotation", () => {
    it("transitions requested -> under_review and requires admin reason for audit", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "requested",
        adminNotes: null,
      };

      const updated = {
        ...existing,
        status: "under_review",
        adminNotes: "Analisando complexidade das turmas",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await reviewImplementationRequest({
        id: 1,
        crecheId: 10,
        adminId: 1,
        adminEmail: "admin@arkpet.com",
        adminNotes: "Analisando complexidade das turmas",
        reason: "Iniciando análise técnica da creche",
        dbClient: mockDb,
      });

      expect(result.status).toBe("under_review");
      expect(result.adminNotes).toBe("Analisando complexidade das turmas");
    });

    it("sends free quote (0 BRL) and freezes quote snapshot", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "under_review",
      };

      const quoted = {
        ...existing,
        status: "proposal_sent",
        quotedPriceCents: 0,
        quoteSnapshotJson: {
          quotedPriceCents: 0,
          notes: "Cortesia de lançamento ArkPet",
          quotedAt: new Date().toISOString(),
          quotedBy: "admin@arkpet.com",
        },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([quoted]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await sendImplementationQuote({
        id: 1,
        crecheId: 10,
        adminId: 1,
        adminEmail: "admin@arkpet.com",
        quotedPriceCents: 0,
        adminNotes: "Cortesia de lançamento ArkPet",
        reason: "Aprovada cortesia promocional de implantação",
        dbClient: mockDb,
      });

      expect(result.status).toBe("proposal_sent");
      expect(result.quotedPriceCents).toBe(0);
      expect((result.quoteSnapshotJson as any).quotedPriceCents).toBe(0);
    });

    it("sends paid quote (e.g. 500.00 BRL) and freezes quote snapshot", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "under_review",
      };

      const quoted = {
        ...existing,
        status: "proposal_sent",
        quotedPriceCents: 50000,
        quoteSnapshotJson: {
          quotedPriceCents: 50000,
          notes: "Implantação completa com migração de dados",
          quotedAt: new Date().toISOString(),
          quotedBy: "admin@arkpet.com",
        },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([quoted]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await sendImplementationQuote({
        id: 1,
        crecheId: 10,
        adminId: 1,
        adminEmail: "admin@arkpet.com",
        quotedPriceCents: 50000,
        adminNotes: "Implantação completa com migração de dados",
        reason: "Orçamento padrão com migração",
        dbClient: mockDb,
      });

      expect(result.status).toBe("proposal_sent");
      expect(result.quotedPriceCents).toBe(50000);
      expect((result.quoteSnapshotJson as any).quotedPriceCents).toBe(50000);
    });
  });

  describe("3. Customer Quote Acceptance (Free vs Paid)", () => {
    it("accepts free quote: transitions directly to accepted (does NOT auto-schedule)", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "proposal_sent",
        quotedPriceCents: 0,
        scheduledFor: null,
      };

      const accepted = {
        ...existing,
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByUserId: 5,
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([accepted]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await acceptImplementationQuote({
        id: 1,
        crecheId: 10,
        userId: 5,
        userEmail: "gestor@petfeliz.com",
        dbClient: mockDb,
      });

      expect(result.status).toBe("accepted");
      expect(result.scheduledFor).toBeNull(); // Must NOT become scheduled until master admin sets date
    });

    it("accepts paid quote: transitions to payment_pending (requires Stripe payment)", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "proposal_sent",
        quotedPriceCents: 50000,
      };

      const paymentPending = {
        ...existing,
        status: "payment_pending",
        acceptedAt: new Date(),
        acceptedByUserId: 5,
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([paymentPending]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await acceptImplementationQuote({
        id: 1,
        crecheId: 10,
        userId: 5,
        userEmail: "gestor@petfeliz.com",
        dbClient: mockDb,
      });

      expect(result.status).toBe("payment_pending");
    });
  });

  describe("4. Stripe Checkout Session Lifecycle & State Machine", () => {
    it("creates a payment mode checkout session with card only and deterministic idempotency key", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "payment_pending",
        quotedPriceCents: 50000,
        stripeCheckoutSessionId: null,
      };

      const mockStripe: any = {
        checkout: {
          sessions: {
            create: vi.fn().mockResolvedValue({
              id: "cs_test_platform_123",
              url: "https://checkout.stripe.com/pay/cs_test_platform_123",
              status: "open",
            }),
          },
        },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...existing, stripeCheckoutSessionId: "cs_test_platform_123" }]),
            }),
          }),
        }),
      };

      const result = await createImplementationCheckoutSession({
        id: 1,
        crecheId: 10,
        userId: 5,
        successUrl: "https://app.arkpet.com/billing?success=1",
        cancelUrl: "https://app.arkpet.com/billing?canceled=1",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(result.sessionId).toBe("cs_test_platform_123");
      expect(result.checkoutUrl).toBe("https://checkout.stripe.com/pay/cs_test_platform_123");

      // Verify Stripe session params
      const [createArgs, createOpts] = mockStripe.checkout.sessions.create.mock.calls[0];
      expect(createArgs.mode).toBe("payment");
      expect(createArgs.payment_method_types).toEqual(["card"]);
      expect(createArgs.line_items[0].price_data.unit_amount).toBe(50000);
      expect(createArgs.line_items[0].price_data.currency).toBe("brl");
      expect(createArgs.metadata.serviceType).toBe("ASSISTED_IMPLEMENTATION");
      expect(createArgs.metadata.crecheId).toBe("10");
      expect(createArgs.client_reference_id).toBe("1");
      expect(createOpts.idempotencyKey).toContain("checkout-impl-1-");
    });

    it("reuses existing open Checkout session without creating duplicate", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "payment_pending",
        quotedPriceCents: 50000,
        stripeCheckoutSessionId: "cs_test_open_session",
      };

      const mockStripe: any = {
        checkout: {
          sessions: {
            retrieve: vi.fn().mockResolvedValue({
              id: "cs_test_open_session",
              status: "open",
              url: "https://checkout.stripe.com/pay/cs_test_open_session",
            }),
            create: vi.fn(),
          },
        },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
      };

      const result = await createImplementationCheckoutSession({
        id: 1,
        crecheId: 10,
        userId: 5,
        successUrl: "https://app.arkpet.com/billing?success=1",
        cancelUrl: "https://app.arkpet.com/billing?canceled=1",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(result.sessionId).toBe("cs_test_open_session");
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("reconciles to paid if existing session was already paid in Stripe", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        serviceType: "ASSISTED_IMPLEMENTATION",
        status: "payment_pending",
        quotedPriceCents: 50000,
        stripeCheckoutSessionId: "cs_test_paid_session",
      };

      const mockStripe: any = {
        checkout: {
          sessions: {
            retrieve: vi.fn().mockResolvedValue({
              id: "cs_test_paid_session",
              mode: "payment",
              status: "complete",
              payment_status: "paid",
              amount_total: 50000,
              currency: "brl",
              client_reference_id: "1",
              payment_intent: "pi_test_123",
              metadata: {
                serviceType: "ASSISTED_IMPLEMENTATION",
                crecheId: "10",
              },
            }),
            create: vi.fn(),
          },
        },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...existing, status: "paid" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await createImplementationCheckoutSession({
        id: 1,
        crecheId: 10,
        userId: 5,
        successUrl: "https://app.arkpet.com/billing?success=1",
        cancelUrl: "https://app.arkpet.com/billing?canceled=1",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(result.status).toBe("paid");
      expect(result.sessionId).toBe("cs_test_paid_session");
      expect(result.checkoutUrl).toBeNull();
    });
  });

  describe("5. Stripe Payment Webhook Handling", () => {
    it("confirms payment, marks status 'paid', stores paymentIntentId, and terminates platform branch", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        serviceType: "ASSISTED_IMPLEMENTATION",
        status: "payment_pending",
        quotedPriceCents: 50000,
      };

      const updated = {
        ...existing,
        status: "paid",
        paidAt: new Date(),
        stripePaymentIntentId: "pi_test_webhook_paid",
        amountPaidCents: 50000,
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const session: any = {
        id: "cs_test_webhook",
        mode: "payment",
        payment_status: "paid",
        client_reference_id: "1",
        amount_total: 50000,
        currency: "brl",
        payment_intent: "pi_test_webhook_paid",
        metadata: {
          serviceType: "ASSISTED_IMPLEMENTATION",
          crecheId: "10",
        },
      };

      await handlePlatformServicePaymentWebhook(session, mockDb);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled(); // audit log
    });

    it("rejects webhook if amount differs from quotedPriceCents (fail-closed)", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        serviceType: "ASSISTED_IMPLEMENTATION",
        status: "payment_pending",
        quotedPriceCents: 50000,
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
      };

      const session: any = {
        id: "cs_test_webhook",
        mode: "payment",
        payment_status: "paid",
        client_reference_id: "1",
        amount_total: 20000, // mismatch: expected 50000
        currency: "brl",
        payment_intent: "pi_test_mismatch",
        metadata: {
          serviceType: "ASSISTED_IMPLEMENTATION",
          crecheId: "10",
        },
      };

      await expect(handlePlatformServicePaymentWebhook(session, mockDb)).rejects.toThrow(
        /Valor pago .* diverge do valor orçado/i,
      );
    });

    it("ignores duplicate webhook idempotently when status is already 'paid'", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        serviceType: "ASSISTED_IMPLEMENTATION",
        status: "paid", // already paid
        quotedPriceCents: 50000,
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn(),
      };

      const session: any = {
        id: "cs_test_webhook",
        mode: "payment",
        payment_status: "paid",
        client_reference_id: "1",
        amount_total: 50000,
        currency: "brl",
        payment_intent: "pi_test_dup",
        metadata: {
          serviceType: "ASSISTED_IMPLEMENTATION",
          crecheId: "10",
        },
      };

      await handlePlatformServicePaymentWebhook(session, mockDb);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("rejects webhook if tenant metadata mismatches record crecheId", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        serviceType: "ASSISTED_IMPLEMENTATION",
        status: "payment_pending",
        quotedPriceCents: 50000,
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
      };

      const session: any = {
        id: "cs_test_webhook",
        mode: "payment",
        payment_status: "paid",
        client_reference_id: "1",
        amount_total: 50000,
        currency: "brl",
        metadata: {
          serviceType: "ASSISTED_IMPLEMENTATION",
          crecheId: "999", // wrong tenant
        },
      };

      await expect(handlePlatformServicePaymentWebhook(session, mockDb)).rejects.toThrow(
        "Metadados de creche divergem da solicitação",
      );
    });
  });

  describe("6. Operational Fulfillment Lifecycle (Schedule -> In Progress -> Complete)", () => {
    it("allows Master Admin to schedule implementation with date and notes", async () => {
      const scheduledDate = new Date("2026-10-15T14:00:00Z");
      const existing = {
        id: 1,
        crecheId: 10,
        status: "paid",
      };

      const updated = {
        ...existing,
        status: "scheduled",
        scheduledFor: scheduledDate,
        adminNotes: "Sessão agendada com equipe pedagógica",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await scheduleImplementation({
        id: 1,
        crecheId: 10,
        adminId: 1,
        adminEmail: "admin@arkpet.com",
        scheduledFor: scheduledDate,
        adminNotes: "Sessão agendada com equipe pedagógica",
        reason: "Definida data com gestor da creche",
        dbClient: mockDb,
      });

      expect(result.status).toBe("scheduled");
      expect(result.scheduledFor).toEqual(scheduledDate);
    });

    it("allows Master Admin to start implementation (scheduled -> in_progress)", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "scheduled",
      };

      const updated = {
        ...existing,
        status: "in_progress",
        startedAt: new Date(),
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await startImplementation({
        id: 1,
        crecheId: 10,
        adminId: 1,
        adminEmail: "admin@arkpet.com",
        reason: "Início da sessão de onboarding ao vivo",
        dbClient: mockDb,
      });

      expect(result.status).toBe("in_progress");
      expect(result.startedAt).toBeDefined();
    });

    it("allows Master Admin to complete implementation (in_progress -> completed)", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "in_progress",
      };

      const updated = {
        ...existing,
        status: "completed",
        completedAt: new Date(),
        completedBy: "admin@arkpet.com",
        completionNotes: "Treinamento finalizado e turmas cadastradas com sucesso",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await completeImplementation({
        id: 1,
        crecheId: 10,
        adminId: 1,
        adminEmail: "admin@arkpet.com",
        completionNotes: "Treinamento finalizado e turmas cadastradas com sucesso",
        reason: "Conclusão de todas as etapas de implantação",
        dbClient: mockDb,
      });

      expect(result.status).toBe("completed");
      expect(result.completedBy).toBe("admin@arkpet.com");
      expect(result.completionNotes).toContain("Treinamento finalizado");
    });
  });

  describe("7. Cancellation & Refund Review Boundary", () => {
    it("rejects customer cancellation when status is paid, scheduled, or in_progress", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "paid",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
      };

      await expect(
        cancelImplementation({
          id: 1,
          crecheId: 10,
          actorRole: "creche_admin",
          actorId: 5,
          actorEmail: "gestor@petfeliz.com",
          reason: "Desisti do serviço",
          dbClient: mockDb,
        }),
      ).rejects.toThrow("Serviços pagos, agendados ou em andamento só podem ser cancelados através do suporte da plataforma com análise de reembolso.");
    });

    it("flags REFUND_REVIEW_REQUIRED when paid/scheduled request is cancelled by Master Admin", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "paid",
        quotedPriceCents: 50000,
        stripeCheckoutSessionId: null,
      };

      const updated = {
        ...existing,
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: "admin@arkpet.com",
        cancellationReason: "Cancelamento solicitado formalmente pelo cliente",
        refundStatus: "REFUND_REVIEW_REQUIRED",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await cancelImplementation({
        id: 1,
        crecheId: 10,
        actorRole: "master_admin",
        actorId: 1,
        actorEmail: "admin@arkpet.com",
        reason: "Cancelamento solicitado formalmente pelo cliente",
        dbClient: mockDb,
      });

      expect(result.status).toBe("cancelled");
      expect(result.refundStatus).toBe("REFUND_REVIEW_REQUIRED");
    });

    it("expires open Stripe checkout session when unpaid request is cancelled", async () => {
      const existing = {
        id: 1,
        crecheId: 10,
        status: "payment_pending",
        stripeCheckoutSessionId: "cs_test_cancel_me",
      };

      const updated = {
        ...existing,
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: "admin@arkpet.com",
        cancellationReason: "Cliente não tem mais interesse",
        refundStatus: "NONE",
      };

      const mockStripe: any = {
        checkout: {
          sessions: {
            retrieve: vi.fn().mockResolvedValue({ id: "cs_test_cancel_me", status: "open" }),
            expire: vi.fn().mockResolvedValue({ id: "cs_test_cancel_me", status: "expired" }),
          },
        },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await cancelImplementation({
        id: 1,
        crecheId: 10,
        actorRole: "master_admin",
        actorId: 1,
        actorEmail: "admin@arkpet.com",
        reason: "Cliente não tem mais interesse",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(result.status).toBe("cancelled");
      expect(mockStripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_test_cancel_me");
    });
  });
});
