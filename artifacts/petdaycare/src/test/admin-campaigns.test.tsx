import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import AdminCampaigns from "../pages/admin/campaigns";

vi.mock("@workspace/api-client-react", () => ({
  useListCreches: vi.fn(() => ({
    data: [
      { id: 10, name: "Creche Pata Feliz" },
      { id: 20, name: "Creche Amigo Fiel" },
    ],
    isLoading: false,
  })),
}));

describe("Master Admin Campaigns Management UI Tests (R36.F)", () => {
  const mockCampaigns = [
    {
      id: 1,
      name: "Campanha Q3 2026 - 20% OFF",
      description: "Desconto temporário de 20% por 3 ciclos",
      status: "active",
      eligibleFrom: null,
      eligibleUntil: null,
      priority: 100,
      assignmentMode: "manual_single",
      createdBy: "master_admin",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      benefit: {
        id: 10,
        campaignId: 1,
        benefitType: "PERCENTAGE_DISCOUNT",
        benefitValue: 2000,
        billingCycles: 3,
      },
      stats: {
        assignedCount: 2,
        activeCount: 1,
        completedCount: 1,
      },
    },
    {
      id: 2,
      name: "Campanha Fixa R$ 50 OFF",
      description: "Desconto fixo de 50 reais",
      status: "draft",
      eligibleFrom: null,
      eligibleUntil: null,
      priority: 50,
      assignmentMode: "manual_single",
      createdBy: "master_admin",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      benefit: {
        id: 11,
        campaignId: 2,
        benefitType: "FIXED_DISCOUNT",
        benefitValue: 5000,
        billingCycles: 6,
      },
      stats: {
        assignedCount: 0,
        activeCount: 0,
        completedCount: 0,
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "mock_master_admin_token");
  });

  it("1. renders campaign list, metrics summary, and campaign cards", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    expect(screen.getByText(/Campanhas & Benefícios Temporais/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
      expect(screen.getByText("Campanha Fixa R$ 50 OFF")).toBeInTheDocument();
    });

    // Verify benefit badges and texts
    expect(screen.getByText("20% de Desconto (2000 bps)")).toBeInTheDocument();
    expect(screen.getByText(/3 ciclo\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/6 ciclo\(s\)/)).toBeInTheDocument();
  });

  it("2. switches to create tab and renders campaign creation form", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Click "Nova Campanha" tab button
    const createTab = screen.getByRole("button", { name: /Nova Campanha/i });
    fireEvent.click(createTab);

    // Verify form fields
    expect(screen.getByText("Cadastrar Nova Campanha Comercial")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ex: Incentivo de Expansão Q3")).toBeInTheDocument();
    expect(screen.getByText("Configuração do Benefício Recorrente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Criar Campanha/i })).toBeInTheDocument();
  });

  it("3. opens assignment modal, executes dry-run preview on selection, and shows financial impact", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/preview")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            campaign: mockCampaigns[0],
            benefit: mockCampaigns[0].benefit,
            items: [
              {
                crecheId: 10,
                crecheName: "Creche Pata Feliz",
                targetPlanName: "Plano Intermediário",
                billingInterval: "month",
                catalogPriceCents: 31990,
                currentEffectivePriceCents: 31990,
                promotionalPriceCents: 25592,
                restorationCommittedPriceCents: 31990,
                absoluteSavingsCents: 6398,
                percentageSavingsBps: 2000,
                billingCycles: 3,
                eligible: true,
                hasActiveCampaignConflict: false,
                hasExistingStripeSchedule: false,
              },
            ],
          }),
        } as any;
      }
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Click "Atribuir Creche" on the active campaign
    const assignButtons = screen.getAllByRole("button", { name: /Atribuir Creche/i });
    fireEvent.click(assignButtons[0]);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText(/Atribuir Campanha: Campanha Q3 2026 - 20% OFF/i)).toBeInTheDocument();
    });

    // Select target creche
    const selectElement = screen.getByDisplayValue("Selecione uma creche...");
    fireEvent.change(selectElement, { target: { value: "10" } });

    // Verify fetch was called with preview
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/preview"),
        expect.anything()
      );
    });

    // Expect preview results to show savings and safety confirmation
    await waitFor(() => {
      expect(screen.getByText(/Creche Elegível com Sucesso/i)).toBeInTheDocument();
      expect(screen.getByText(/Novo Preço Promocional/i)).toBeInTheDocument();
      expect(screen.getByText(/Compromissos Contratuais & Temporais/i)).toBeInTheDocument();
    });
  });
});
