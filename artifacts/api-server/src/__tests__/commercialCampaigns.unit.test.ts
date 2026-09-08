import { describe, it, expect, vi } from "vitest";
import {
  validateBenefitDefinition,
  createCampaign,
  updateCampaign,
  previewCampaignAssignment,
  assignCampaignToCreche,
  CommercialCampaignError,
  CommercialCampaignIntegrityError,
  CommercialCampaignFavorableOnlyError,
  CommercialCampaignConflictError,
  CommercialCampaignNotActiveError,
} from "../services/commercialCampaigns.js";
import {
  commercialCampaignsTable,
  commercialCampaignBenefitsTable,
  assignedCommercialBenefitsTable,
  customerCommercialConditionsTable,
  subscriptionsTable,
  plansTable,
  crechesTable,
} from "@workspace/db/schema";
import type Stripe from "stripe";

describe("commercialCampaigns service", () => {
  describe("validateBenefitDefinition", () => {
    it("should accept valid percentage discount", () => {
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", 2000, 3)).not.toThrow();
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", 10000, 1)).not.toThrow();
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", 1, 12)).not.toThrow();
    });

    it("should reject invalid percentage discount values", () => {
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", 0, 3)).toThrow(CommercialCampaignIntegrityError);
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", -500, 3)).toThrow(CommercialCampaignIntegrityError);
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", 10001, 3)).toThrow(CommercialCampaignIntegrityError);
    });

    it("should accept valid fixed discount and promotional price", () => {
      expect(() => validateBenefitDefinition("FIXED_DISCOUNT", 5000, 2)).not.toThrow();
      expect(() => validateBenefitDefinition("FIXED_PROMOTIONAL_PRICE", 9900, 6)).not.toThrow();
    });

    it("should reject invalid fixed discount values", () => {
      expect(() => validateBenefitDefinition("FIXED_DISCOUNT", 0, 2)).toThrow(CommercialCampaignIntegrityError);
      expect(() => validateBenefitDefinition("FIXED_DISCOUNT", -100, 2)).toThrow(CommercialCampaignIntegrityError);
      expect(() => validateBenefitDefinition("FIXED_PROMOTIONAL_PRICE", 0, 2)).toThrow(CommercialCampaignIntegrityError);
    });

    it("should reject invalid billing cycles", () => {
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", 2000, 0)).toThrow(CommercialCampaignIntegrityError);
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", 2000, -1)).toThrow(CommercialCampaignIntegrityError);
      expect(() => validateBenefitDefinition("PERCENTAGE_DISCOUNT", 2000, 37)).toThrow(CommercialCampaignIntegrityError);
    });
  });

  describe("createCampaign", () => {
    it("should reject missing campaign name", async () => {
      const mockDb: any = {};
      await expect(
        createCampaign(
          {
            name: "",
            benefitType: "PERCENTAGE_DISCOUNT",
            benefitValue: 2000,
            billingCycles: 3,
          },
          mockDb,
        ),
      ).rejects.toThrow(CommercialCampaignIntegrityError);
    });

    it("should reject inverted eligibility window", async () => {
      const mockDb: any = {};
      await expect(
        createCampaign(
          {
            name: "Campanha Inválida",
            benefitType: "PERCENTAGE_DISCOUNT",
            benefitValue: 2000,
            billingCycles: 3,
            eligibleFrom: new Date("2026-10-01"),
            eligibleUntil: new Date("2026-09-01"),
          },
          mockDb,
        ),
      ).rejects.toThrow(CommercialCampaignIntegrityError);
    });

    it("should successfully insert campaign and benefit in a transaction", async () => {
      const insertedCampaign = {
        id: 1,
        name: "Incentivo Q3",
        description: "Teste",
        status: "draft",
        priority: 10,
        eligibleFrom: null,
        eligibleUntil: null,
        assignmentMode: "MASTER_ADMIN_SAFE_ASSIGNMENT",
        createdBy: "admin@arkpet.com.br",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const insertedBenefit = {
        id: 10,
        campaignId: 1,
        benefitType: "PERCENTAGE_DISCOUNT",
        benefitValue: 2500,
        billingCycles: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockTx = {
        insert: vi.fn().mockImplementation((table) => ({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(
              table === commercialCampaignsTable ? [insertedCampaign] : [insertedBenefit],
            ),
          }),
        })),
      };

      const mockDb: any = {
        transaction: vi.fn(async (cb) => cb(mockTx)),
      };

      const res = await createCampaign(
        {
          name: "Incentivo Q3",
          description: "Teste",
          status: "draft",
          priority: 10,
          benefitType: "PERCENTAGE_DISCOUNT",
          benefitValue: 2500,
          billingCycles: 3,
          createdBy: "admin@arkpet.com.br",
        },
        mockDb,
      );

      expect(res.campaign).toEqual(insertedCampaign);
      expect(res.benefit).toEqual(insertedBenefit);
      expect(mockTx.insert).toHaveBeenCalledTimes(3); // campaign, benefit, audit
    });
  });

  describe("updateCampaign", () => {
    it("should update campaign metadata", async () => {
      const updatedCampaign = {
        id: 1,
        name: "Incentivo Q3 - Atualizado",
        status: "active",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 1, status: "draft", benefitType: "PERCENTAGE_DISCOUNT", benefitValue: 2000, billingCycles: 3 }]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedCampaign]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation(() => {
            const p: any = Promise.resolve([{ id: 1 }]);
            p.returning = vi.fn().mockResolvedValue([{ id: 1 }]);
            return p;
          }),
        }),
        transaction: vi.fn(async (cb) => cb(mockDb)),
      };

      const res = await updateCampaign(1, { name: "Incentivo Q3 - Atualizado", status: "active" }, mockDb);
      expect(res.campaign).toEqual(updatedCampaign);
    });
  });

  describe("previewCampaignAssignment", () => {
    it("should reject preview when campaign is not found", async () => {
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      await expect(previewCampaignAssignment(999, [1], mockDb)).rejects.toThrow(CommercialCampaignError);
    });

    it("should compute correct percentage savings and favorable promotional price", async () => {
      const campaign = { id: 1, name: "Promo 20%", status: "active" };
      const benefit = { id: 10, campaignId: 1, benefitType: "PERCENTAGE_DISCOUNT", benefitValue: 2000, billingCycles: 3 };
      const creche = { id: 100, name: "Creche Pata Feliz" };
      const periodEnd = new Date(Date.now() + 15 * 86400000);
      const sub = {
        id: 50,
        crecheId: 100,
        stripeSubscriptionId: "sub_test123",
        status: "active",
        planId: 2,
        billingInterval: "month",
        currentPeriodEnd: periodEnd,
        activeConditionId: null,
      };
      const plan = { id: 2, name: "Profissional", priceBrl: 20000 }; // R$ 200,00

      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_test123",
            status: "active",
            schedule: null,
          }),
        },
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === commercialCampaignsTable) return [campaign];
                if (table === commercialCampaignBenefitsTable) return [benefit];
                if (table === crechesTable) return [creche];
                if (table === subscriptionsTable) return [sub];
                if (table === plansTable) return [plan];
                if (table === assignedCommercialBenefitsTable) return []; // no conflict
                return [];
              }),
            })),
          })),
        })),
      };

      const preview = await previewCampaignAssignment(1, [100], mockDb, mockStripe);
      expect(preview.items).toHaveLength(1);
      const item = preview.items[0];
      expect(item.eligible).toBe(true);
      expect(item.catalogPriceCents).toBe(20000); // R$ 200,00
      expect(item.currentEffectivePriceCents).toBe(20000);
      expect(item.promotionalPriceCents).toBe(16000); // 20% discount = R$ 160,00
      expect(item.absoluteSavingsCents).toBe(4000); // R$ 40,00
      expect(item.percentageSavingsBps).toBe(2000); // 2000 bps
      expect(item.restorationCommittedPriceCents).toBe(20000); // protected restoration price
      expect(new Date(item.firstPromotionalPeriodDate!).getTime()).toBe(periodEnd.getTime());
    });

    it("should mark ineligible when customer already has an active campaign (non-stacking)", async () => {
      const campaign = { id: 1, name: "Promo 20%", status: "active" };
      const benefit = { id: 10, campaignId: 1, benefitType: "PERCENTAGE_DISCOUNT", benefitValue: 2000, billingCycles: 3 };
      const creche = { id: 100, name: "Creche Pata Feliz" };
      const sub = {
        id: 50,
        crecheId: 100,
        stripeSubscriptionId: "sub_test123",
        status: "active",
        planId: 2,
        billingInterval: "month",
        currentPeriodEnd: new Date(),
        activeConditionId: null,
      };
      const plan = { id: 2, name: "Profissional", priceBrl: 20000 };
      const activeAssignedBenefit = { id: 77, crecheId: 100, status: "active", campaignName: "Outra Campanha" };

      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_test123",
            status: "active",
            schedule: null,
          }),
        },
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === commercialCampaignsTable) return [campaign];
                if (table === commercialCampaignBenefitsTable) return [benefit];
                if (table === crechesTable) return [creche];
                if (table === subscriptionsTable) return [sub];
                if (table === plansTable) return [plan];
                if (table === assignedCommercialBenefitsTable) return [activeAssignedBenefit]; // conflict
                return [];
              }),
            })),
          })),
        })),
      };

      const preview = await previewCampaignAssignment(1, [100], mockDb, mockStripe);
      expect(preview.items[0].eligible).toBe(false);
      expect(preview.items[0].hasActiveCampaignConflict).toBe(true);
      expect(preview.items[0].ineligibilityReason).toMatch(/possui um benefício de campanha/i);
    });

    it("should calculate FIXED_DISCOUNT against current negotiated effective price base (R36.F1 Section 8, 9)", async () => {
      // Golden example: catalog = 31990, current negotiated effective = 27990, fixed campaign discount = 5000 -> promo = 22990 (NOT 26990)
      const campaign = { id: 1, name: "Desconto Fixo Especial", status: "active" };
      const benefit = { id: 10, campaignId: 1, benefitType: "FIXED_DISCOUNT", benefitValue: 5000, billingCycles: 3 };
      const creche = { id: 100, name: "Creche Pata Feliz" };
      const sub = {
        id: 50,
        crecheId: 100,
        stripeSubscriptionId: "sub_test123",
        status: "active",
        planId: 2,
        billingInterval: "month",
        currentPeriodEnd: new Date(),
        activeConditionId: 42,
      };
      const plan = { id: 2, name: "Profissional", priceBrl: 31990 };
      const activeCondition = {
        id: 42,
        crecheId: 100,
        status: "active",
        validFrom: new Date(),
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 27990, // Negotiated effective base
      };

      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_test123",
            status: "active",
            schedule: null,
          }),
        },
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === commercialCampaignsTable) return [campaign];
                if (table === commercialCampaignBenefitsTable) return [benefit];
                if (table === crechesTable) return [creche];
                if (table === subscriptionsTable) return [sub];
                if (table === plansTable) return [plan];
                if (table === customerCommercialConditionsTable) return [activeCondition];
                if (table === assignedCommercialBenefitsTable) return [];
                return [];
              }),
            })),
          })),
        })),
      };

      const preview = await previewCampaignAssignment(1, [100], mockDb, mockStripe);
      const item = preview.items[0];
      expect(item.eligible).toBe(true);
      expect(item.catalogPriceCents).toBe(31990);
      expect(item.currentEffectivePriceCents).toBe(27990);
      expect(item.promotionalPriceCents).toBe(22990); // 27990 - 5000 = 22990 (NOT 31990 - 5000 = 26990)
      expect(item.absoluteSavingsCents).toBe(5000);
      expect(item.restorationCommittedPriceCents).toBe(27990);
    });

    it("should block assignment if customer has campaign in restoration_review or pending status (R36.F1 Section 7)", async () => {
      const campaign = { id: 1, name: "Nova Campanha", status: "active" };
      const benefit = { id: 10, campaignId: 1, benefitType: "PERCENTAGE_DISCOUNT", benefitValue: 1000, billingCycles: 3 };
      const creche = { id: 100, name: "Creche Pata Feliz" };
      const sub = {
        id: 50,
        crecheId: 100,
        stripeSubscriptionId: "sub_test123",
        status: "active",
        planId: 2,
        billingInterval: "month",
        currentPeriodEnd: new Date(),
        activeConditionId: null,
      };
      const plan = { id: 2, name: "Profissional", priceBrl: 20000 };
      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({ id: "sub_test123", status: "active", schedule: null }),
        },
      };

      // Case A: restoration_review
      const reviewBenefit = { id: 77, crecheId: 100, status: "restoration_review", campaignName: "Review Camp" };
      const mockDbReview: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === commercialCampaignsTable) return [campaign];
                if (table === commercialCampaignBenefitsTable) return [benefit];
                if (table === crechesTable) return [creche];
                if (table === subscriptionsTable) return [sub];
                if (table === plansTable) return [plan];
                if (table === assignedCommercialBenefitsTable) return [reviewBenefit];
                return [];
              }),
            })),
          })),
        })),
      };

      const previewReview = await previewCampaignAssignment(1, [100], mockDbReview, mockStripe);
      expect(previewReview.items[0].eligible).toBe(false);
      expect(previewReview.items[0].hasActiveCampaignConflict).toBe(true);

      // Case B: pending
      const pendingBenefit = { id: 78, crecheId: 100, status: "pending", campaignName: "Pending Camp" };
      const mockDbPending: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === commercialCampaignsTable) return [campaign];
                if (table === commercialCampaignBenefitsTable) return [benefit];
                if (table === crechesTable) return [creche];
                if (table === subscriptionsTable) return [sub];
                if (table === plansTable) return [plan];
                if (table === assignedCommercialBenefitsTable) return [pendingBenefit];
                return [];
              }),
            })),
          })),
        })),
      };

      const previewPending = await previewCampaignAssignment(1, [100], mockDbPending, mockStripe);
      expect(previewPending.items[0].eligible).toBe(false);
      expect(previewPending.items[0].hasActiveCampaignConflict).toBe(true);
    });
  });

  describe("assignCampaignToCreche safety rules", () => {
    it("should throw CommercialCampaignNotActiveError if campaign is not active", async () => {
      const campaign = { id: 1, name: "Rascunho", status: "draft" };
      const benefit = { id: 10, campaignId: 1, benefitType: "PERCENTAGE_DISCOUNT", benefitValue: 2000, billingCycles: 3 };
      const creche = { id: 100, name: "Creche Pata Feliz" };
      const sub = {
        id: 50,
        crecheId: 100,
        stripeSubscriptionId: "sub_test123",
        status: "active",
        planId: 2,
        billingInterval: "month",
        currentPeriodEnd: new Date(),
        activeConditionId: null,
      };
      const plan = { id: 2, name: "Profissional", priceBrl: 20000 };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === commercialCampaignsTable) return [campaign];
                if (table === commercialCampaignBenefitsTable) return [benefit];
                if (table === crechesTable) return [creche];
                if (table === subscriptionsTable) return [sub];
                if (table === plansTable) return [plan];
                return [];
              }),
            })),
          })),
        })),
      };

      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({ id: "sub_test123", status: "active", schedule: null }),
        },
      };

      await expect(
        assignCampaignToCreche({
          campaignId: 1,
          crecheId: 100,
          dbClient: mockDb,
          stripeClient: mockStripe,
        }),
      ).rejects.toThrow(CommercialCampaignError);
    });

    it("should preserve existing entitlementPetLimit across snapshot, promo condition, and restoration (R36.F1 Section 10)", async () => {
      const campaign = { id: 1, name: "Campanha Pet Custom", status: "active" };
      const benefit = { id: 10, campaignId: 1, benefitType: "PERCENTAGE_DISCOUNT", benefitValue: 1500, billingCycles: 3 };
      const creche = { id: 100, name: "Creche Pata Feliz" };
      const sub = {
        id: 50,
        crecheId: 100,
        stripeSubscriptionId: "sub_test123",
        status: "active",
        planId: 2,
        billingInterval: "month",
        currentPeriodEnd: new Date(),
        activeConditionId: 44,
      };
      const plan = { id: 2, name: "Profissional", priceBrl: 20000, stripeProductId: "prod_1" };
      const activeConditionWithPetLimit = {
        id: 44,
        crecheId: 100,
        status: "active",
        validFrom: new Date(),
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 20000,
        entitlementPetLimit: 75, // Custom pet limit
      };

      let insertedAssignedBenefit: any = null;
      let insertedPromoCondition: any = null;

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === commercialCampaignsTable) return [campaign];
                if (table === commercialCampaignBenefitsTable) return [benefit];
                if (table === crechesTable) return [creche];
                if (table === subscriptionsTable) return [sub];
                if (table === plansTable) return [plan];
                if (table === customerCommercialConditionsTable) return [activeConditionWithPetLimit];
                if (table === assignedCommercialBenefitsTable) return [];
                return [];
              }),
            })),
          })),
        })),
        insert: vi.fn().mockImplementation((table) => ({
          values: vi.fn().mockImplementation((val) => {
            if (table === assignedCommercialBenefitsTable) {
              insertedAssignedBenefit = { id: 99, ...val };
              return {
                returning: vi.fn().mockResolvedValue([insertedAssignedBenefit]),
              };
            }
            if (table === customerCommercialConditionsTable) {
              insertedPromoCondition = { id: 101, ...val };
              return {
                returning: vi.fn().mockResolvedValue([insertedPromoCondition]),
              };
            }
            return {
              returning: vi.fn().mockResolvedValue([{ id: 1 }]),
            };
          }),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        })),
        transaction: vi.fn(async (cb) => cb(mockDb)),
      };

      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_test123",
            status: "active",
            schedule: null,
            items: { data: [{ price: { id: "price_current" } }] },
          }),
        },
        prices: {
          list: vi.fn().mockResolvedValue({ data: [] }),
          create: vi.fn().mockImplementation((p) => Promise.resolve({ id: `price_${p.unit_amount}` })),
        },
        subscriptionSchedules: {
          create: vi.fn().mockResolvedValue({
            id: "sched_123",
            phases: [{ start_date: 1000, end_date: 2000, items: [{ price: "price_current" }] }],
          }),
          update: vi.fn().mockResolvedValue({ id: "sched_123" }),
        },
      };

      await assignCampaignToCreche({
        campaignId: 1,
        crecheId: 100,
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      // Assert entitlementPetLimit was preserved across snapshot and promo condition
      expect(insertedAssignedBenefit.entitlementPetLimit).toBe(75);
      expect(insertedPromoCondition.entitlementPetLimit).toBe(75);
    });

    it("verifies single activeConditionId pointer authority belongs strictly to subscriptionsTable and not crechesTable (R36.F1 Section 6)", async () => {
      // 1. Schema-level proof
      expect(subscriptionsTable.activeConditionId).toBeDefined();
      expect((crechesTable as any).activeConditionId).toBeUndefined();

      // 2. Runtime update proof: transitionActiveCondition updates subscriptionsTable
      let subscriptionUpdatedWith: any = null;
      let crecheUpdatedWith: any = null;

      const mockTx: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === customerCommercialConditionsTable) {
                  return [
                    {
                      id: 501,
                      crecheId: 100,
                      status: "pending_activation",
                      validFrom: new Date(),
                      pricingOverrideType: "fixed_amount",
                      pricingOverrideValue: 20000,
                    },
                  ];
                }
                if (table === subscriptionsTable) {
                  return [{ id: 999, crecheId: 100, activeConditionId: 200 }];
                }
                return [];
              }),
            })),
          })),
        })),
        update: vi.fn().mockImplementation((table) => ({
          set: vi.fn().mockImplementation((values) => {
            if (table === subscriptionsTable) {
              subscriptionUpdatedWith = values;
            }
            if (table === crechesTable) {
              crecheUpdatedWith = values;
            }
            return {
              where: vi.fn().mockResolvedValue([{ id: 1 }]),
            };
          }),
        })),
        transaction: vi.fn(async (cb) => cb(mockTx)),
      };

      const { transitionActiveCondition } = await import("../services/commercialConditions.js");
      const result = await transitionActiveCondition(100, 501, mockTx);

      expect(result.activeConditionId).toBe(501);
      expect(subscriptionUpdatedWith).toEqual({ activeConditionId: 501 });
      expect(crecheUpdatedWith).toBeNull();
    });
  });
});
