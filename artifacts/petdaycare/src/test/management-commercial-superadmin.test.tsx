import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import Billing from "../pages/billing/index";
import { SubscriptionBanner } from "../components/layout/subscription-banner";
import { PlanVersioningModal } from "../pages/admin/PlanVersioningModal";
import { CommercialSupportModal } from "../pages/admin/commercial-support-modal";
import { TutorCommercialModal } from "../components/commercial/tutor-commercial-modal";
import ProposalsPage from "../pages/admin/proposals";
import AdminCreches from "../pages/admin/creches";
import AdminUsers from "../pages/admin/users";
import * as apiClient from "@workspace/api-client-react";
import * as authHook from "@/hooks/use-auth";
import * as financialHook from "@/hooks/use-financial";

vi.mock("@workspace/api-client-react", () => ({
  useGetBillingPlans: vi.fn(),
  useGetBillingSubscription: vi.fn(),
  useCreateBillingCheckout: vi.fn(),
  useCreateBillingPortal: vi.fn(),
  useListCreches: vi.fn(),
  useCreateCreche: vi.fn(),
  useUpdateCreche: vi.fn(),
  useListUsers: vi.fn(),
  useUpdateUser: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/hooks/use-financial", () => ({
  useListCatalogue: vi.fn(),
}));

describe("R39.G Management, Commercial & Super Admin Modernization Test Suite", () => {
  const mockUserAdmin = {
    id: 1,
    name: "Admin Master",
    email: "admin@arkpet.com",
    role: "master_admin",
    crecheId: 10,
  };

  const mockPlans = [
    {
      id: 1,
      name: "Plano Profissional",
      description: "Ideal para creches em expansão",
      priceBrl: 19900,
      priceCents: 19900,
      quarterlyPriceCents: 53700,
      semiannualPriceCents: 101400,
      annualPriceCents: 191000,
      petLimit: 50,
      features: ["Até 50 pets", "Controle financeiro", "Suporte prioritário"],
      recommended: true,
      active: true,
    },
    {
      id: 99,
      name: "Enterprise",
      description: "Sob medida para redes",
      priceBrl: 0,
      priceCents: 0,
      petLimit: 500,
      features: ["Pets Ilimitados", "Suporte VIP"],
      active: true,
    },
  ];

  const mockSubscription = {
    id: 101,
    status: "active",
    billingInterval: "month",
    currentPeriodEnd: "2026-12-31T23:59:59.000Z",
    hasStripeCustomer: true,
    hasStripeSubscription: true,
    isGrandfathered: true,
    contractedPriceCents: 16900,
    activeCatalogPriceCents: 19900,
    plan: {
      id: 1,
      name: "Plano Profissional",
      priceCents: 19900,
    },
    quotas: {
      pets: {
        used: 42,
        limit: 50,
        available: 8,
        percent: 84,
      },
      staff: {
        used: 4,
        limit: 5,
        available: 1,
        percent: 80,
        unlimited: false,
      },
      storage: {
        usedBytes: 858993459, // ~819 MiB
        limitBytes: 1073741824, // 1 GiB
        availableBytes: 214748365,
        percent: 80,
      },
    },
    pricing: {
      catalogPriceCents: 19900,
      finalEffectivePriceCents: 16900,
      pricingOverrideType: "percentage",
      pricingOverrideValue: 1500,
    },
    scheduledChange: null,
  };

  const mockCreches = [
    {
      id: 10,
      name: "Creche Modelo",
      status: "active",
      currentOccupancy: 42,
      maxCapacity: 50,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 20,
      name: "Creche Histórica",
      status: "archived",
      currentOccupancy: 0,
      maxCapacity: 30,
      createdAt: "2025-06-01T00:00:00.000Z",
    },
  ];

  const mockUsers = [
    {
      id: 1,
      name: "Admin Master",
      email: "admin@arkpet.com",
      role: "master_admin",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 2,
      name: "Tutor Teste",
      email: "tutor@arkpet.com",
      role: "tutor",
      isActive: true,
      mustChangePassword: true,
      createdAt: "2026-02-01T00:00:00.000Z",
    },
  ];

  const mockVersions = [
    {
      id: 1,
      versionNumber: 1,
      status: "SUPERSEDED",
      effectiveFrom: "2025-01-01T00:00:00.000Z",
      effectiveUntil: "2026-01-01T00:00:00.000Z",
      changeReason: "Versão inicial",
      petLimit: 30,
      prices: [{ id: 101, interval: "month", priceCents: 15000 }],
    },
    {
      id: 2,
      versionNumber: 2,
      status: "ACTIVE",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "Reajuste inflacionário anual",
      petLimit: 50,
      prices: [{ id: 102, interval: "month", priceCents: 19900 }],
    },
    {
      id: 3,
      versionNumber: 3,
      status: "DRAFT",
      effectiveFrom: null,
      effectiveUntil: null,
      changeReason: "Proposta para 2027",
      petLimit: 60,
      prices: [{ id: 103, interval: "month", priceCents: 22000 }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (authHook.useAuth as any).mockReturnValue({
      user: mockUserAdmin,
      logout: vi.fn(),
    });
    (apiClient.useGetBillingPlans as any).mockReturnValue({
      data: mockPlans,
      isLoading: false,
    });
    (apiClient.useGetBillingSubscription as any).mockReturnValue({
      data: mockSubscription,
      isLoading: false,
    });
    (apiClient.useCreateBillingCheckout as any).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    (apiClient.useCreateBillingPortal as any).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    (apiClient.useListCreches as any).mockReturnValue({
      data: mockCreches,
      isLoading: false,
    });
    (apiClient.useCreateCreche as any).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    (apiClient.useUpdateCreche as any).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    (apiClient.useListUsers as any).mockReturnValue({
      data: mockUsers,
      isLoading: false,
    });
    (apiClient.useUpdateUser as any).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    (financialHook.useListCatalogue as any).mockReturnValue({
      data: [],
      isLoading: false,
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/commercial/plans/") && url.includes("/versions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ versions: mockVersions }),
        });
      }
      if (url.includes("/api/billing/proposals") || url.includes("/api/commercial/proposals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ proposals: [] }),
        });
      }
      if (url.includes("/api/billing/commercial-notifications")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ notifications: [], unreadCount: 0 }),
        });
      }
      if (url.includes("/api/commercial/platform-services")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ services: [] }),
        });
      }
      if (url.includes("/api/users/by-creche")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockUsers),
        });
      }
      if (url.includes("/commercial/support")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            creche: mockCreches[0],
            subscriptionState: "PROVISIONED",
            subscription: {
              status: "active",
              hasStripeCustomer: true,
              hasStripeSubscription: true,
            },
            plan: { id: 1, name: "Plano Profissional" },
            pricing: {
              catalogPriceCents: 19900,
              finalEffectivePriceCents: 16900,
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  // =========================================================================
  // TC-MGMT-BILL-01 to 05: Billing & Subscription Banners
  // =========================================================================
  describe("Billing Page & Subscription Lifecycle (TC-MGMT-BILL-01..05)", () => {
    it("TC-MGMT-BILL-01: renders current plan name, active status badge, and price", async () => {
      renderWithProviders(<Billing />);

      expect(screen.getByText("Assinatura")).toBeInTheDocument();
      expect(screen.getAllByText(/Plano Profissional/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/• Ativa/i)).toBeInTheDocument();
      expect(screen.getByText(/R\$ 169,00/i)).toBeInTheDocument();
    });

    it("TC-MGMT-BILL-02: SubscriptionBanner renders past_due warning and Regularizar button for admin", async () => {
      (authHook.useAuth as any).mockReturnValue({
        user: { ...mockUserAdmin, role: "creche_admin" },
      });
      (apiClient.useGetBillingSubscription as any).mockReturnValue({
        data: {
          ...mockSubscription,
          status: "past_due",
        },
      });

      renderWithProviders(<SubscriptionBanner />);

      expect(
        screen.getByText(/Há um pagamento pendente na assinatura da creche/i)
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /regularizar/i })).toBeInTheDocument();
    });

    it("TC-MGMT-BILL-02b: SubscriptionBanner renders trial_expired notice", async () => {
      (apiClient.useGetBillingSubscription as any).mockReturnValue({
        data: {
          ...mockSubscription,
          status: "trial",
          trialEndsAt: "2026-01-01T00:00:00.000Z", // expired in the past
        },
      });

      renderWithProviders(<SubscriptionBanner />);

      expect(
        screen.getByText(/O período de teste encerrou/i)
      ).toBeInTheDocument();
    });

    it("TC-MGMT-BILL-03: renders scheduled plan change notice when present", async () => {
      (apiClient.useGetBillingSubscription as any).mockReturnValue({
        data: {
          ...mockSubscription,
          scheduledChange: {
            targetPlanName: "Plano Enterprise",
            targetBillingInterval: "year",
            effectiveDate: "2027-01-01T00:00:00.000Z",
            targetPriceCents: 450000,
          },
        },
      });

      renderWithProviders(<Billing />);

      expect(screen.getByText(/Mudança de Plano Agendada/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Plano Enterprise/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("button", { name: /cancelar mudança/i })).toBeInTheDocument();
    });

    it("TC-MGMT-BILL-04: renders grandfathered contractual condition badge with discount", async () => {
      renderWithProviders(<Billing />);

      expect(screen.getByText(/Contrato Legado Preservado \(Grandfathered\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Preço Vigente no Catálogo:/i)).toBeInTheDocument();
    });

    it("TC-MGMT-BILL-05: renders assisted onboarding service card and WhatsApp support action", async () => {
      (authHook.useAuth as any).mockReturnValue({
        user: { ...mockUserAdmin, role: "creche_admin" },
      });
      renderWithProviders(<Billing />);

      expect(screen.getAllByText(/Implantação Assistida/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Falar no WhatsApp/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // TC-MGMT-STORAGE-01 to 03: Entitlement & Storage Accounting
  // =========================================================================
  describe("Entitlement & Storage Display (TC-MGMT-STORAGE-01..03)", () => {
    it("TC-MGMT-STORAGE-01: presents pet and staff quotas directly from backend payload without frontend calculation", async () => {
      renderWithProviders(<Billing />);

      // Backend provided 42 / 50 pets (84%)
      expect(screen.getByText("Pets Cadastrados")).toBeInTheDocument();
      expect(screen.getByText(/42 \/ 50 pets/i)).toBeInTheDocument();
      expect(screen.getByText("84%")).toBeInTheDocument();
      expect(screen.getByText(/8 vaga\(s\) restante\(s\)/i)).toBeInTheDocument();

      // Backend provided 4 / 5 staff (80%)
      expect(screen.getByText("Equipe e Convites")).toBeInTheDocument();
      expect(screen.getByText(/4 \/ 5 membros/i)).toBeInTheDocument();
    });

    it("TC-MGMT-STORAGE-02: displays warning indicators when quota usage reaches or exceeds 80%", async () => {
      renderWithProviders(<Billing />);

      const warningBadges = screen.getAllByText("Atenção (≥80%)");
      expect(warningBadges.length).toBeGreaterThanOrEqual(1);
    });

    it("TC-MGMT-STORAGE-03: renders formatted storage capacity in human-readable units (MiB / GiB)", async () => {
      renderWithProviders(<Billing />);

      expect(screen.getByText(/Armazenamento em Nuvem/i)).toBeInTheDocument();
      expect(screen.getByText(/819,2 MiB \/ 1 GiB/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // TC-MGMT-PLAN-01 to 04: Plan Versioning Engine
  // =========================================================================
  describe("Plan Versioning Engine (TC-MGMT-PLAN-01..04)", () => {
    const mockPlanForVersioning = {
      id: 1,
      name: "Plano Profissional",
      priceBrl: 19900,
      petLimit: 50,
    };

    it("TC-MGMT-PLAN-01: renders version history with ACTIVE, DRAFT, and SUPERSEDED badges", async () => {
      renderWithProviders(
        <PlanVersioningModal
          isOpen={true}
          onClose={vi.fn()}
          plan={mockPlanForVersioning}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Ativa \(Catálogo Vigente\)/i)).toBeInTheDocument();
        expect(screen.getByText(/Rascunho \(DRAFT\)/i)).toBeInTheDocument();
        expect(screen.getByText(/Substituída \(SUPERSEDED\)/i)).toBeInTheDocument();
      });
    });

    it("TC-MGMT-PLAN-02: draft activation requires changeReason before submission", async () => {
      renderWithProviders(
        <PlanVersioningModal
          isOpen={true}
          onClose={vi.fn()}
          plan={mockPlanForVersioning}
        />
      );

      await waitFor(() => {
        const activateBtn = screen.getByRole("button", { name: /ativar/i });
        expect(activateBtn).toBeInTheDocument();
        fireEvent.click(activateBtn);
      });

      expect(screen.getByText(/Ativar Versão v3 no Catálogo/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Descreva o motivo comercial/i)).toBeInTheDocument();
    });

    it("TC-MGMT-PLAN-03: draft version provides safe discard button without affecting active version", async () => {
      renderWithProviders(
        <PlanVersioningModal
          isOpen={true}
          onClose={vi.fn()}
          plan={mockPlanForVersioning}
        />
      );

      await waitFor(() => {
        const deleteBtn = screen.getByRole("button", { name: /excluir/i });
        expect(deleteBtn).toBeInTheDocument();
      });
    });

    it("TC-MGMT-PLAN-04: allows opening create draft version form", async () => {
      renderWithProviders(
        <PlanVersioningModal
          isOpen={true}
          onClose={vi.fn()}
          plan={mockPlanForVersioning}
        />
      );

      const newVersionBtn = screen.getByRole("button", { name: /criar rascunho/i });
      expect(newVersionBtn).toBeInTheDocument();
      fireEvent.click(newVersionBtn);

      expect(screen.getByText(/Novo Rascunho de Versão \(DRAFT\)/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Commercial Conditions, Overrides & Proposals
  // =========================================================================
  describe("Commercial Conditions & Proposals Administration", () => {
    it("TC-MGMT-COMM-01: CommercialSupportModal renders tenant diagnostic, catalog price, and effective price", async () => {
      renderWithProviders(
        <CommercialSupportModal
          isOpen={true}
          onClose={vi.fn()}
          creche={mockCreches[0]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Plano & Assinatura")).toBeInTheDocument();
        expect(screen.getByText("R$ 169,00/mês")).toBeInTheDocument();
      });
    });

    it("TC-MGMT-COMM-02: TutorCommercialModal renders prominent contractual disclaimer", async () => {
      renderWithProviders(
        <TutorCommercialModal
          isOpen={true}
          onClose={vi.fn()}
          tutorId={5}
          tutorName="João Silva"
          crecheId={10}
        />
      );

      expect(screen.getByText(/Condições Comerciais — João Silva/i)).toBeInTheDocument();
      expect(screen.getByText(/Aviso Contratual Importante/i)).toBeInTheDocument();
      expect(screen.getByText(/Esta condição não altera cobranças já emitidas/i)).toBeInTheDocument();
    });

    it("TC-MGMT-PROP-01: ProposalsPage renders formal proposals card and assisted services section", async () => {
      renderWithProviders(<ProposalsPage />);

      expect(screen.getByText(/Propostas & Serviços de Implantação/i)).toBeInTheDocument();
      expect(screen.getByText("Propostas Comerciais Formais")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Creches & Global Users Super Admin Administration
  // =========================================================================
  describe("Super Admin Creches & Users Management", () => {
    it("TC-MGMT-CRECHE-01: AdminCreches renders creche cards, status filter tabs, and occupancy counters", async () => {
      renderWithProviders(<AdminCreches />);

      await waitFor(() => {
        expect(screen.getByText("Creches")).toBeInTheDocument();
        expect(screen.getByText("Creche Modelo")).toBeInTheDocument();
        expect(screen.getByText(/Ocupação: 42\/50/i)).toBeInTheDocument();
      });
    });

    it("TC-MGMT-CRECHE-02: AdminCreches renders archive safeguards (SAAS-BR-003)", async () => {
      renderWithProviders(<AdminCreches />);

      const archiveButtons = screen.getAllByTitle("Arquivar Creche");
      expect(archiveButtons.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(archiveButtons[0]);

      expect(screen.getAllByText("Arquivar Creche").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByPlaceholderText(/Encerramento de atividades/i)).toBeInTheDocument();
    });

    it("TC-MGMT-USER-01: AdminUsers renders user directory with semantic role badges", async () => {
      renderWithProviders(<AdminUsers />);

      await waitFor(() => {
        expect(screen.getByText("Usuários")).toBeInTheDocument();
        expect(screen.getByText("Admin Master")).toBeInTheDocument();
        expect(screen.getAllByText("Master Admin").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("TC-MGMT-USER-02: AdminUsers displays provisional password indicator", async () => {
      renderWithProviders(<AdminUsers />);

      await waitFor(() => {
        expect(screen.getByText("Provisória")).toBeInTheDocument();
      });
    });
  });
});
