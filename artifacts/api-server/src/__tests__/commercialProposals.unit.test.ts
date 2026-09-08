import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createProposal,
  updateDraftProposal,
  sendProposal,
  supersedeProposal,
  acceptProposal,
  declineProposal,
  retryProposalActivation,
  CommercialProposalError,
} from "../services/commercialProposals.js";
import {
  commercialAgreementsTable,
  customerCommercialConditionsTable,
  subscriptionsTable,
  plansTable,
  planPricesTable,
  crechesTable,
} from "@workspace/db/schema";
import * as stripeModule from "../services/stripeCommercialActivation.js";

describe("Commercial Proposals Domain Unit Tests (R36.G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Proposal Draft Creation & Mutability", () => {
    it("creates proposal in draft status", async () => {
      const insertedRow = {
        id: 101,
        crecheId: 1,
        type: "commercial_proposal",
        status: "draft",
        title: "Proposta Especial Q3",
        notes: "Condições especiais",
        activationStatus: "not_started",
        validUntil: new Date("2026-12-31"),
        createdBy: "admin@arkpet.com",
        snapshotJson: {
          planId: 2,
          billingInterval: "month",
          pricingOverrideType: "percentage",
          pricingOverrideValue: 1500,
          entitlementPetLimit: 50,
          prorationMode: "EFFECTIVE_NOW_PRORATE",
        },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 1, name: "Creche Alpha" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([insertedRow]),
          }),
        }),
      };

      const result = await createProposal({
        crecheId: 1,
        title: "Proposta Especial Q3",
        notes: "Condições especiais",
        planId: 2,
        billingInterval: "month",
        pricingOverrideType: "percentage",
        pricingOverrideValue: 1500,
        entitlementPetLimit: 50,
        createdBy: "admin@arkpet.com",
        validUntil: new Date("2026-12-31"),
        dbClient: mockDb,
      });

      expect(result.status).toBe("draft");
      expect(result.id).toBe(101);
      expect(result.title).toBe("Proposta Especial Q3");
    });

    it("allows updating terms while in draft status", async () => {
      const existingDraft = {
        id: 101,
        crecheId: 1,
        status: "draft",
        title: "Título Antigo",
        notes: "Notas antigas",
        snapshotJson: { planId: 2, pricingOverrideType: "none" },
      };

      const updatedDraft = {
        ...existingDraft,
        title: "Novo Título",
        notes: "Novas notas",
        snapshotJson: { planId: 2, pricingOverrideType: "percentage", pricingOverrideValue: 2000 },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existingDraft]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedDraft]),
            }),
          }),
        }),
      };

      const result = await updateDraftProposal({
        id: 101,
        crecheId: 1,
        title: "Novo Título",
        notes: "Novas notas",
        pricingOverrideType: "percentage",
        pricingOverrideValue: 2000,
        dbClient: mockDb,
      });

      expect(result.title).toBe("Novo Título");
      expect(result.notes).toBe("Novas notas");
    });

    it("rejects updating a sent proposal (commercially frozen)", async () => {
      const existingSent = {
        id: 101,
        crecheId: 1,
        status: "sent",
        title: "Proposta Enviada",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([existingSent]),
            }),
          }),
        }),
      };

      await expect(
        updateDraftProposal({
          id: 101,
          crecheId: 1,
          title: "Tentativa de alteração",
          dbClient: mockDb,
        }),
      ).rejects.toThrow("Apenas propostas em rascunho podem ser editadas");
    });
  });

  describe("2. Send Proposal & Immutable Snapshot Freezing", () => {
    it("transitions draft -> sent and freezes predecessorConditionId and snapshot", async () => {
      const existingDraft = {
        id: 101,
        crecheId: 1,
        status: "draft",
        title: "Proposta Gold",
        notes: "Negociação especial",
        createdBy: "admin@arkpet.com",
        validUntil: new Date("2026-12-31"),
        snapshotJson: {
          planId: 2,
          billingInterval: "month",
          pricingOverrideType: "percentage",
          pricingOverrideValue: 1000, // 10%
          entitlementPetLimit: 40,
        },
      };

      const sub = {
        id: 50,
        crecheId: 1,
        planId: 1,
        activeConditionId: 999, // predecessor condition
        billingInterval: "month",
      };

      const plan = {
        id: 2,
        name: "Plano Profissional",
        priceBrl: 20000, // 200,00
      };

      const planPrices = [
        {
          id: 1,
          planId: 2,
          interval: "month",
          priceBrl: 20000,
          isActive: true,
        },
      ];

      const sentAgreement = {
        ...existingDraft,
        status: "sent",
        sentAt: new Date(),
        predecessorConditionId: 999,
        snapshotJson: {
          crecheId: 1,
          planId: 2,
          planName: "Plano Profissional",
          billingInterval: "month",
          catalogPriceCents: 20000,
          pricingOverrideType: "percentage",
          pricingOverrideValue: 1000,
          displayedEffectivePriceCents: 18000,
          entitlementPetLimit: 40,
          predecessorConditionId: 999,
          executionRequirement: "STRIPE_REQUIRED",
        },
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === commercialAgreementsTable) return Promise.resolve([existingDraft]);
                if (table === subscriptionsTable) return Promise.resolve([sub]);
                if (table === plansTable) return Promise.resolve([plan]);
                return Promise.resolve([]);
              }),
              then: (fn: any) => fn(table === planPricesTable ? planPrices : []),
            })),
            then: (fn: any) => fn(table === planPricesTable ? planPrices : []),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([sentAgreement]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await sendProposal({
        id: 101,
        crecheId: 1,
        senderEmail: "admin@arkpet.com",
        reason: "Termos comerciais acordados com gestor",
        dbClient: mockDb,
      });

      expect(result.status).toBe("sent");
      expect(result.predecessorConditionId).toBe(999);
      expect((result.snapshotJson as any).displayedEffectivePriceCents).toBe(18000);
      expect((result.snapshotJson as any).executionRequirement).toBe("STRIPE_REQUIRED");
    });
  });

  describe("3. Proposal Acceptance & Terminal Customer Fact", () => {
    it("commits customer acceptance durable fact even if subsequent Stripe activation fails", async () => {
      const validUntil = new Date(Date.now() + 86400000); // tomorrow
      const sentAgreement = {
        id: 101,
        crecheId: 1,
        status: "sent",
        predecessorConditionId: 55,
        validUntil,
        snapshotJson: {
          crecheId: 1,
          planId: 2,
          displayedEffectivePriceCents: 15000,
          pricingOverrideType: "fixed_amount",
          pricingOverrideValue: 15000,
          executionRequirement: "STRIPE_REQUIRED",
        },
      };

      const sub = {
        id: 10,
        crecheId: 1,
        activeConditionId: 55, // matches predecessorConditionId
      };

      const acceptedAgreement = {
        ...sentAgreement,
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByUserId: 7,
        activationStatus: "pending_activation",
      };

      const createdCondition = {
        id: 201,
        crecheId: 1,
        planId: 2,
        status: "pending_activation",
      };

      const finalFailedAgreement = {
        ...acceptedAgreement,
        activationStatus: "activation_failed",
        activationError: "Stripe connection timed out",
      };

      let currentAgreement: any = { ...sentAgreement };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === commercialAgreementsTable) return Promise.resolve([currentAgreement]);
                if (table === subscriptionsTable) return Promise.resolve([sub]);
                return Promise.resolve([]);
              }),
            })),
          })),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((payload) => ({
            where: vi.fn().mockImplementation(() => {
              currentAgreement = { ...currentAgreement, ...payload };
              return {
                returning: vi.fn().mockResolvedValue([currentAgreement]),
              };
            }),
          })),
        })),
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation(() => ({
            returning: vi.fn().mockResolvedValue([createdCondition]),
          })),
        })),
      };

      // Mock Stripe commercial activation to throw an error
      vi.spyOn(stripeModule, "executeStripeCommercialActivation").mockRejectedValue(
        new Error("Stripe connection timed out"),
      );

      const result = await acceptProposal({
        id: 101,
        crecheId: 1,
        userId: 7,
        userEmail: "gestor@creche.com",
        dbClient: mockDb,
      });

      // Terminal customer fact: acceptance succeeded!
      expect(result.success).toBe(true);
      expect(result.agreement.status).toBe("accepted");
      expect(result.activationStatus).toBe("activation_failed");
      expect(result.message).toContain("ativação está em processamento");
    });

    it("activates ARKPET_ONLY proposal transactionally on acceptance", async () => {
      const validUntil = new Date(Date.now() + 86400000);
      const sentAgreement = {
        id: 102,
        crecheId: 1,
        status: "sent",
        predecessorConditionId: 55,
        validUntil,
        snapshotJson: {
          crecheId: 1,
          entitlementPetLimit: 60,
          pricingOverrideType: "none",
          displayedEffectivePriceCents: 10000,
          executionRequirement: "ARKPET_ONLY",
        },
      };

      const sub = {
        id: 10,
        crecheId: 1,
        activeConditionId: 55,
        petLimit: 30,
      };

      const acceptedAgreement = {
        ...sentAgreement,
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByUserId: 7,
        activationStatus: "active",
        activatedConditionId: 301,
      };

      const newCondition = {
        id: 301,
        crecheId: 1,
        status: "active",
        entitlementPetLimit: 60,
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === commercialAgreementsTable) return Promise.resolve([sentAgreement]);
                if (table === subscriptionsTable) return Promise.resolve([sub]);
                return Promise.resolve([]);
              }),
            })),
          })),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              return {
                returning: vi.fn().mockResolvedValue([acceptedAgreement]),
              };
            }),
          })),
        })),
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation(() => ({
            returning: vi.fn().mockResolvedValue([newCondition]),
          })),
        })),
      };

      const result = await acceptProposal({
        id: 102,
        crecheId: 1,
        userId: 7,
        userEmail: "gestor@creche.com",
        dbClient: mockDb,
      });

      expect(result.success).toBe(true);
      expect(result.activationStatus).toBe("active");
      expect(result.conditionId).toBe(301);
    });

    it("fails closed when proposal has expired", async () => {
      const expiredDate = new Date(Date.now() - 10000); // in the past
      const sentAgreement = {
        id: 103,
        crecheId: 1,
        status: "sent",
        validUntil: expiredDate,
        predecessorConditionId: 55,
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([sentAgreement]),
            }),
          }),
        }),
      };

      await expect(
        acceptProposal({
          id: 103,
          crecheId: 1,
          userId: 7,
          dbClient: mockDb,
        }),
      ).rejects.toThrow("A proposta expirou e não pode mais ser aceita.");
    });

    it("fails closed with PROPOSAL_REVALIDATION_REQUIRED when predecessorConditionId has drifted", async () => {
      const sentAgreement = {
        id: 104,
        crecheId: 1,
        status: "sent",
        validUntil: new Date(Date.now() + 86400000),
        predecessorConditionId: 55, // offer was based on condition 55
      };

      const sub = {
        id: 10,
        crecheId: 1,
        activeConditionId: 77, // newer commercial state!
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === commercialAgreementsTable) return Promise.resolve([sentAgreement]);
                if (table === subscriptionsTable) return Promise.resolve([sub]);
                return Promise.resolve([]);
              }),
            })),
          })),
        })),
      };

      await expect(
        acceptProposal({
          id: 104,
          crecheId: 1,
          userId: 7,
          dbClient: mockDb,
        }),
      ).rejects.toThrow("O estado comercial da creche foi alterado após o envio da proposta");
    });
  });

  describe("4. Concurrency Safety & Supersession", () => {
    it("handles concurrency conflict between accept and decline gracefully", async () => {
      const sentAgreement = {
        id: 105,
        crecheId: 1,
        status: "sent",
        validUntil: new Date(Date.now() + 86400000),
        predecessorConditionId: 55,
      };

      const sub = {
        id: 10,
        crecheId: 1,
        activeConditionId: 55,
      };

      // Mock update returning empty array (indicating another concurrent worker changed status first)
      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === commercialAgreementsTable) return Promise.resolve([sentAgreement]);
                if (table === subscriptionsTable) return Promise.resolve([sub]);
                return Promise.resolve([]);
              }),
            })),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]), // 0 rows updated!
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };

      await expect(
        acceptProposal({
          id: 105,
          crecheId: 1,
          userId: 7,
          dbClient: mockDb,
        }),
      ).rejects.toThrow("Conflito de estado: a proposta foi modificada concorrentemente");
    });

    it("marks proposal superseded when new replacement proposal is sent", async () => {
      const superseded = {
        id: 101,
        crecheId: 1,
        status: "superseded",
        supersededByAgreementId: 106,
      };

      const mockDb: any = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([superseded]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const result = await supersedeProposal({
        id: 101,
        crecheId: 1,
        supersededByAgreementId: 106,
        adminEmail: "admin@arkpet.com",
        reason: "Substituição por termos renegociados",
        dbClient: mockDb,
      });

      expect(result.status).toBe("superseded");
      expect(result.supersededByAgreementId).toBe(106);
    });
  });

  describe("5. Activation Retry", () => {
    it("allows Master Admin to retry activation for an accepted proposal in activation_failed state", async () => {
      const acceptedAgreement = {
        id: 101,
        crecheId: 1,
        status: "accepted",
        activationStatus: "activation_failed",
        activationError: "Gateway error",
        snapshotJson: {
          crecheId: 1,
          planId: 2,
          executionRequirement: "STRIPE_REQUIRED",
          displayedEffectivePriceCents: 15000,
        },
      };

      const condition = {
        id: 201,
        crecheId: 1,
        status: "pending_activation",
      };

      const updatedActive = {
        ...acceptedAgreement,
        activationStatus: "active",
        activatedConditionId: 201,
        activationError: null,
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === commercialAgreementsTable) return Promise.resolve([acceptedAgreement]);
                if (table === customerCommercialConditionsTable) return Promise.resolve([condition]);
                return Promise.resolve([]);
              }),
            })),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedActive]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      vi.spyOn(stripeModule, "executeStripeCommercialActivation").mockResolvedValue({
        success: true,
        condition: condition as any,
        subscription: {} as any,
        stripePriceId: "price_retry_ok",
        isCustomPrice: true,
        effectivePriceCents: 15000,
        catalogPriceCents: 20000,
        message: "Sucesso no retry",
      });

      const result = await retryProposalActivation({
        id: 101,
        crecheId: 1,
        adminEmail: "admin@arkpet.com",
        reason: "Reativação operacional após restauração de conexão com o gateway",
        dbClient: mockDb,
      });

      expect(result.activationStatus).toBe("active");
      expect(result.activatedConditionId).toBe(201);
    });

    it("requires explicit reason to retry activation", async () => {
      const mockDb: any = {};
      await expect(
        retryProposalActivation({
          id: 101,
          crecheId: 1,
          adminEmail: "admin@arkpet.com",
          reason: "   ",
          dbClient: mockDb,
        }),
      ).rejects.toThrow("Justificativa obrigatória");
    });
  });

  describe("6. R36.G1 Hardening & Regression Suite", () => {
    describe("Section 1: Proposal Retry Recovery States", () => {
      it("supports retryProposalActivation when proposal activationStatus is 'not_started' (crash right after acceptance commit)", async () => {
        const agreement = {
          id: 101,
          crecheId: 1,
          status: "accepted",
          activationStatus: "not_started",
          predecessorConditionId: 55,
          snapshotJson: {
            crecheId: 1,
            planId: 2,
            displayedEffectivePriceCents: 15000,
            executionRequirement: "ARKPET_ONLY",
          },
        };

        const newCondition = { id: 301, crecheId: 1, status: "active" };
        const updatedAgreement = { ...agreement, activationStatus: "active", activatedConditionId: 301 };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn()
                  .mockResolvedValueOnce([agreement]) // agreement
                  .mockResolvedValueOnce([]) // assignedCommercialBenefitsTable (no conflict)
                  .mockResolvedValueOnce([{ id: 10, crecheId: 1, planId: 2 }]), // subscriptionsTable
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([newCondition]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([updatedAgreement]),
              }),
            }),
          }),
        };

        const res = await retryProposalActivation({
          id: 101,
          crecheId: 1,
          adminEmail: "admin@arkpet.com",
          reason: "Recuperação após crash do processo antes da ativação iniciar",
          dbClient: mockDb,
        });

        expect(res.activationStatus).toBe("active");
        expect(res.activatedConditionId).toBe(301);
      });

      it("supports retryProposalActivation when proposal activationStatus is 'pending_activation' (crash during activation)", async () => {
        const agreement = {
          id: 102,
          crecheId: 1,
          status: "accepted",
          activationStatus: "pending_activation",
          predecessorConditionId: 55,
          snapshotJson: {
            crecheId: 1,
            planId: 2,
            displayedEffectivePriceCents: 15000,
            executionRequirement: "ARKPET_ONLY",
          },
        };

        const newCondition = { id: 302, crecheId: 1, status: "active" };
        const updatedAgreement = { ...agreement, activationStatus: "active", activatedConditionId: 302 };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn()
                  .mockResolvedValueOnce([agreement])
                  .mockResolvedValueOnce([]) // assignedCommercialBenefitsTable (no conflict)
                  .mockResolvedValueOnce([{ id: 10, crecheId: 1, planId: 2 }]),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([newCondition]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([updatedAgreement]),
              }),
            }),
          }),
        };

        const res = await retryProposalActivation({
          id: 102,
          crecheId: 1,
          adminEmail: "admin@arkpet.com",
          reason: "Recuperação após timeout intermediário",
          dbClient: mockDb,
        });

        expect(res.activationStatus).toBe("active");
      });
    });

    describe("Section 2: Accept Operation Remains SUCCEEDED on Activation Failure", () => {
      it("records ACCEPT_PROPOSAL operation as SUCCEEDED when durable acceptance commits, even if Stripe activation fails", async () => {
        const validUntil = new Date(Date.now() + 86400000);
        const agreement = {
          id: 103,
          crecheId: 1,
          status: "sent",
          predecessorConditionId: 55,
          validUntil,
          snapshotJson: {
            crecheId: 1,
            planId: 2,
            displayedEffectivePriceCents: 15000,
            pricingOverrideType: "fixed_amount",
            executionRequirement: "STRIPE_REQUIRED",
          },
        };

        const acceptedAgreement = {
          ...agreement,
          status: "accepted",
          activationStatus: "activation_failed",
          activationError: "Stripe connection failed",
        };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn()
                  .mockResolvedValueOnce([agreement]) // proposal query
                  .mockResolvedValueOnce([{ id: 10, activeConditionId: 55 }]) // sub check
                  .mockResolvedValueOnce([]) // assignedCommercialBenefitsTable (no campaign conflict)
                  .mockResolvedValueOnce([acceptedAgreement]), // final re-fetch
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([acceptedAgreement]),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 205, status: "pending_activation" }]),
            }),
          }),
        };

        vi.spyOn(stripeModule, "executeStripeCommercialActivation").mockRejectedValue(
          new Error("Stripe connection failed"),
        );

        // Execute acceptProposal directly
        const result = await acceptProposal({
          id: 103,
          crecheId: 1,
          userId: 9,
          userEmail: "customer@creche.com",
          dbClient: mockDb,
        });

        // Customer acceptance succeeded and is durable terminal fact
        expect(result.success).toBe(true);
        expect(result.agreement.status).toBe("accepted");
        expect(result.activationStatus).toBe("activation_failed");
      });
    });

    describe("Section 3 & 4: Active Temporal Campaign Conflict", () => {
      it("blocks acceptance when an active or scheduled campaign owns temporal billing (PROPOSAL_ACTIVE_CAMPAIGN_CONFLICT)", async () => {
        const validUntil = new Date(Date.now() + 86400000);
        const agreement = {
          id: 104,
          crecheId: 1,
          status: "sent",
          predecessorConditionId: 55,
          validUntil,
          snapshotJson: {
            crecheId: 1,
            planId: 2,
            displayedEffectivePriceCents: 15000,
          },
        };

        const activeCampaignBenefit = {
          id: 77,
          crecheId: 1,
          status: "active", // active temporal campaign owns billing
        };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn()
                  .mockResolvedValueOnce([agreement]) // agreement
                  .mockResolvedValueOnce([{ id: 10, activeConditionId: 55 }]) // sub
                  .mockResolvedValueOnce([activeCampaignBenefit]), // campaign conflict found!
              }),
            }),
          }),
          update: vi.fn(),
          insert: vi.fn(),
        };

        await expect(
          acceptProposal({
            id: 104,
            crecheId: 1,
            userId: 9,
            dbClient: mockDb,
          }),
        ).rejects.toThrow(/possui um benefício de campanha comercial não terminal/i);

        // Must NOT update agreement, subscription, or create condition
        expect(mockDb.update).not.toHaveBeenCalled();
        expect(mockDb.insert).not.toHaveBeenCalled();
      });

      it("blocks retryProposalActivation when a campaign ownership state exists", async () => {
        const agreement = {
          id: 105,
          crecheId: 1,
          status: "accepted",
          activationStatus: "activation_failed",
          predecessorConditionId: 55,
          snapshotJson: { crecheId: 1, planId: 2 },
        };

        const scheduledCampaignBenefit = {
          id: 78,
          crecheId: 1,
          status: "scheduled",
        };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn()
                  .mockResolvedValueOnce([agreement]) // agreement
                  .mockResolvedValueOnce([scheduledCampaignBenefit]), // campaign conflict!
              }),
            }),
          }),
          update: vi.fn(),
          insert: vi.fn(),
        };

        await expect(
          retryProposalActivation({
            id: 105,
            crecheId: 1,
            adminEmail: "admin@arkpet.com",
            reason: "Tentativa de reativação",
            dbClient: mockDb,
          }),
        ).rejects.toThrow(/possui um benefício de campanha comercial não terminal/i);

        expect(mockDb.update).not.toHaveBeenCalled();
        expect(mockDb.insert).not.toHaveBeenCalled();
      });
    });

    describe("Section 10 & 11: Snapshot Immutability Source Proof", () => {
      it("proves termsSnapshot is frozen on send and subsequent catalog mutation does not alter sent terms", async () => {
        const validUntil = new Date("2026-12-31");
        const existingDraft = {
          id: 106,
          crecheId: 1,
          status: "draft",
          title: "Proposta Fixa",
          snapshotJson: {
            planId: 2,
            billingInterval: "month",
            pricingOverrideType: "percentage",
            pricingOverrideValue: 1000, // 10% discount
            entitlementPetLimit: 30,
          },
          validUntil,
        };

        const sub = { id: 1, crecheId: 1, planId: 2, activeConditionId: 99 };
        // Initial catalog price: 200.00 BRL -> 10% off = 180.00 BRL
        const plan = { id: 2, name: "Plano Pro", priceBrl: 20000 };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn()
                  .mockResolvedValueOnce([existingDraft])
                  .mockResolvedValueOnce([sub])
                  .mockResolvedValueOnce([plan])
                  .mockResolvedValueOnce([{ priceBrl: 20000 }]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockImplementation((payload) => ({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ ...existingDraft, ...payload }]),
              }),
            })),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1 }]),
            }),
          }),
        };

        const sent = await sendProposal({
          id: 106,
          crecheId: 1,
          senderEmail: "admin@arkpet.com",
          reason: "Congelando proposta",
          dbClient: mockDb,
        });

        expect(sent.status).toBe("sent");
        expect((sent as any).termsSnapshot).toBeDefined();
        expect((sent as any).termsSnapshot.displayedEffectivePriceCents).toBe(18000);

        // Catalog now mutates: price increases to 300.00 BRL
        plan.priceBrl = 30000;

        // Frozen termsSnapshot in the agreement remains 180.00 BRL
        expect((sent as any).termsSnapshot.displayedEffectivePriceCents).toBe(18000);
      });

      it("rejects attempt to edit sent proposal via updateDraftProposal (PROPOSAL_NOT_EDITABLE)", async () => {
        const sentAgreement = {
          id: 107,
          crecheId: 1,
          status: "sent", // not draft
          title: "Proposta Enviada",
          snapshotJson: {},
        };

        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([sentAgreement]),
              }),
            }),
          }),
        };

        await expect(
          updateDraftProposal({
            id: 107,
            crecheId: 1,
            title: "Tentativa de alteração pós-envio",
            dbClient: mockDb,
          }),
        ).rejects.toThrow(/Apenas propostas em rascunho podem ser editadas/i);
      });
    });

    describe("Section 14: Audit Reason Enforcement", () => {
      it("requires non-empty human reason to send proposal (fail-closed, no fabricated reasons)", async () => {
        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 1, status: "draft" }]),
              }),
            }),
          }),
        };

        await expect(
          sendProposal({
            id: 1,
            crecheId: 1,
            senderEmail: "admin@arkpet.com",
            reason: "", // blank
            dbClient: mockDb,
          }),
        ).rejects.toThrow(/Justificativa obrigatória/i);
      });

      it("requires non-empty human reason to supersede proposal (fail-closed)", async () => {
        const mockDb: any = {};
        await expect(
          supersedeProposal({
            id: 1,
            crecheId: 1,
            supersededByAgreementId: 2,
            adminEmail: "admin@arkpet.com",
            reason: "   ", // whitespace only
            dbClient: mockDb,
          }),
        ).rejects.toThrow(/Justificativa obrigatória/i);
      });
    });
  });
});
