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
        amountPaidCents: null,
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
        stripeCheckoutSessionId: "cs_test_webhook",
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
        stripeCheckoutSessionId: "cs_test_webhook",
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
        stripeCheckoutSessionId: "cs_test_webhook",
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
        stripeCheckoutSessionId: "cs_test_webhook",
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

  describe("8. R36.G1 Hardening & Concurrency Protection Suite", () => {
    describe("Section 5: Quote Acceptance Isolation from Stripe SDK", () => {
      it("accepts implementation quote and transitions to payment_pending without interacting with Stripe SDK", async () => {
        const existing: any = {
          id: 50,
          crecheId: 10,
          serviceType: "ASSISTED_IMPLEMENTATION",
          status: "proposal_sent",
          quotedPriceCents: 45000,
          quoteSnapshotJson: { quotedPriceCents: 45000, scopeNotes: "Setup completo" },
          customerNotes: null,
          scopeNotes: "Setup completo",
          quotedBy: "admin@arkpet.com",
          quotedAt: new Date(),
          requestedByUserId: 1,
          acceptedAt: null,
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
          refundStatus: null,
          adminNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const updated = {
          ...existing,
          status: "payment_pending",
          acceptedAt: new Date(),
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

        const result = await acceptImplementationQuote({
          id: 50,
          crecheId: 10,
          userId: 1,
          userEmail: "owner@petcreche.com",
          dbClient: mockDb,
        });

        expect(result.status).toBe("payment_pending");
        expect(mockDb.update).toHaveBeenCalled();
      });
    });

    describe("Section 6 & 7: Strict payment_status verification & Trusted Reconciliation", () => {
      it("ignores checkout session reconciliation in createImplementationCheckoutSession if payment_status is not 'paid' even if status is 'complete'", async () => {
        const existing: any = {
          id: 51,
          crecheId: 10,
          serviceType: "ASSISTED_IMPLEMENTATION",
          status: "payment_pending",
          quotedPriceCents: 50000,
          quoteSnapshotJson: { quotedPriceCents: 50000 },
          stripeCheckoutSessionId: "cs_async_unpaid",
          customerNotes: null,
          scopeNotes: null,
          quotedBy: null,
          quotedAt: null,
          requestedByUserId: 1,
          acceptedAt: null,
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
          refundStatus: null,
          adminNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockStripe: any = {
          checkout: {
            sessions: {
              retrieve: vi.fn().mockResolvedValue({
                id: "cs_async_unpaid",
                status: "complete",
                payment_status: "unpaid",
                url: "https://checkout.stripe.com/pay/cs_async_unpaid",
              }),
              create: vi.fn().mockResolvedValue({
                id: "cs_new_session",
                url: "https://checkout.stripe.com/pay/cs_new_session",
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
                returning: vi.fn().mockResolvedValue([existing]),
              }),
            }),
          }),
        };

        const res = await createImplementationCheckoutSession({
          id: 51,
          crecheId: 10,
          userId: 1,
          successUrl: "https://app.arkpet.com/success",
          cancelUrl: "https://app.arkpet.com/cancel",
          dbClient: mockDb,
          stripeClient: mockStripe,
        });

        // Did not reconcile to paid because payment_status was unpaid; created fresh session
        expect(res.status).not.toBe("paid");
        expect(res.sessionId).toBe("cs_new_session");
      });

      it("rejects webhook if session.id does not match stored stripeCheckoutSessionId (SESSION_ID_MISMATCH)", async () => {
        const existing = {
          id: 52,
          crecheId: 10,
          serviceType: "ASSISTED_IMPLEMENTATION",
          status: "payment_pending",
          quotedPriceCents: 50000,
          quoteSnapshotJson: { quotedPriceCents: 50000 },
          stripeCheckoutSessionId: "cs_legitimate_session",
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

        const rogueSession: any = {
          id: "cs_rogue_or_stale_session",
          mode: "payment",
          payment_status: "paid",
          client_reference_id: "52",
          amount_total: 50000,
          currency: "brl",
          metadata: {
            serviceType: "ASSISTED_IMPLEMENTATION",
            crecheId: "10",
            serviceRequestId: "52",
          },
        };

        await expect(handlePlatformServicePaymentWebhook(rogueSession, mockDb)).rejects.toMatchObject({
          code: "SESSION_ID_MISMATCH",
        });
      });

      it("rejects webhook if metadata.environment mismatches process.env.NODE_ENV (ENVIRONMENT_MISMATCH)", async () => {
        const existing = {
          id: 53,
          crecheId: 10,
          serviceType: "ASSISTED_IMPLEMENTATION",
          status: "payment_pending",
          quotedPriceCents: 50000,
          quoteSnapshotJson: { quotedPriceCents: 50000 },
          stripeCheckoutSessionId: "cs_test_env",
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

        const mismatchedEnvSession: any = {
          id: "cs_test_env",
          mode: "payment",
          payment_status: "paid",
          client_reference_id: "53",
          amount_total: 50000,
          currency: "brl",
          metadata: {
            serviceType: "ASSISTED_IMPLEMENTATION",
            crecheId: "10",
            serviceRequestId: "53",
            environment: "production_foreign_cluster",
          },
        };

        await expect(handlePlatformServicePaymentWebhook(mismatchedEnvSession, mockDb)).rejects.toMatchObject({
          code: "ENVIRONMENT_MISMATCH",
        });
      });
    });

    describe("Section 8 & 9: Concurrent Payment vs. Cancellation (CAS Protection)", () => {
      it("rejects customer cancellation if payment webhook reconciles concurrently (reconciliation won)", async () => {
        const initialPending = {
          id: 54,
          crecheId: 10,
          status: "payment_pending",
          stripeCheckoutSessionId: "cs_race_1",
        };

        const concurrentPaid = {
          id: 54,
          crecheId: 10,
          status: "paid",
          stripeCheckoutSessionId: "cs_race_1",
          amountPaidCents: 50000,
        };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn()
                  .mockResolvedValueOnce([initialPending])
                  .mockResolvedValueOnce([concurrentPaid]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };

        const mockStripe: any = {
          checkout: {
            sessions: {
              retrieve: vi.fn().mockResolvedValue({ id: "cs_race_1", payment_status: "paid" }),
            },
          },
        };

        await expect(
          cancelImplementation({
            id: 54,
            crecheId: 10,
            actorRole: "creche_admin",
            actorId: 99,
            actorEmail: "customer@creche.com",
            reason: "Quero cancelar agora",
            dbClient: mockDb,
            stripeClient: mockStripe,
          }),
        ).rejects.toMatchObject({
          code: "CUSTOMER_CANCELLATION_NOT_ALLOWED",
        });
      });

      it("marks refundStatus as REFUND_REVIEW_REQUIRED when payment webhook arrives after request was cancelled (cancellation won)", async () => {
        const cancelledRequest = {
          id: 55,
          crecheId: 10,
          serviceType: "ASSISTED_IMPLEMENTATION",
          status: "cancelled",
          quotedPriceCents: 50000,
          quoteSnapshotJson: { quotedPriceCents: 50000 },
          stripeCheckoutSessionId: "cs_race_cancel_first",
          refundStatus: "NONE",
        };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn()
                  .mockResolvedValueOnce([cancelledRequest])
                  .mockResolvedValueOnce([cancelledRequest]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
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
          id: "cs_race_cancel_first",
          mode: "payment",
          payment_status: "paid",
          client_reference_id: "55",
          amount_total: 50000,
          currency: "brl",
          payment_intent: "pi_late_arrival",
          metadata: {
            serviceType: "ASSISTED_IMPLEMENTATION",
            crecheId: "10",
            serviceRequestId: "55",
          },
        };

        await handlePlatformServicePaymentWebhook(session, mockDb);

        expect(mockDb.update).toHaveBeenCalledTimes(2);
        expect(mockDb.insert).toHaveBeenCalled();
      });
    });

    describe("Section 10 & 11: Quote Immutability", () => {
      it("blocks sending quote if request is not in under_review status (PROPOSAL_NOT_UNDER_REVIEW)", async () => {
        const alreadySent = {
          id: 56,
          crecheId: 10,
          status: "proposal_sent",
          quotedPriceCents: 50000,
        };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([alreadySent]),
              }),
            }),
          }),
        };

        await expect(
          sendImplementationQuote({
            id: 56,
            crecheId: 10,
            quotedPriceCents: 60000,
            scopeNotes: "Novo escopo",
            adminEmail: "admin@arkpet.com",
            reason: "Tentativa de re-orçar",
            dbClient: mockDb,
          }),
        ).rejects.toMatchObject({
          code: "INVALID_STATUS",
        });
      });
    });

    describe("Section 14: Audit Reason Enforcement", () => {
      it("strictly requires non-empty reason for scheduling, starting, completing, and cancelling", async () => {
        await expect(
          scheduleImplementation({
            id: 57,
            crecheId: 10,
            scheduledFor: new Date(),
            adminEmail: "admin@arkpet.com",
            reason: "   ",
          }),
        ).rejects.toMatchObject({ code: "REASON_REQUIRED" });

        await expect(
          startImplementation({
            id: 57,
            crecheId: 10,
            adminEmail: "admin@arkpet.com",
            reason: "",
          }),
        ).rejects.toMatchObject({ code: "REASON_REQUIRED" });

        await expect(
          completeImplementation({
            id: 57,
            crecheId: 10,
            completionNotes: "Notas",
            adminEmail: "admin@arkpet.com",
            reason: " ",
          }),
        ).rejects.toMatchObject({ code: "REASON_REQUIRED" });

        await expect(
          cancelImplementation({
            id: 57,
            crecheId: 10,
            actorRole: "master_admin",
            actorEmail: "admin@arkpet.com",
            reason: "   ",
          }),
        ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      });
    });
  });
});
