import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import CampaignsPage from "../pages/marketing/campaigns/index";
import * as useFinancialModule from "../hooks/use-financial";
import * as useAuthModule from "../hooks/use-auth";

vi.mock("../hooks/use-financial", () => ({
  useListCatalogue: vi.fn(),
}));

vi.mock("../hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

describe("Creche Promotional Campaigns Page (R37.C1)", () => {
  const mockCatalogue = [
    {
      id: 10,
      name: "Day Use Avulso",
      type: "day_use",
      basePrice: "50.00",
      crecheId: 1,
    },
    {
      id: 20,
      name: "Banho & Tosa",
      type: "service",
      basePrice: "90.00",
      crecheId: 1,
    },
  ];

  const mockCampaigns = [
    {
      id: 1,
      crecheId: 1,
      name: "Campanha Black Friday Creche",
      description: "Desconto especial de 20% em diárias avulsas",
      benefitType: "PERCENTAGE_DISCOUNT",
      percentageBps: 2000,
      fixedDiscountCents: null,
      fixedPromotionalPriceCents: null,
      audienceType: "ALL_ACTIVE_TUTORS",
      interactionPolicy: "ALLOW_IF_BETTER",
      usageLimitType: "UNLIMITED",
      status: "ACTIVE",
      priority: 100,
      validFrom: "2026-10-01T00:00:00.000Z",
      validUntil: "2026-11-01T00:00:00.000Z",
      items: [{ catalogueItemId: 10, itemName: "Day Use Avulso" }],
      tutors: [],
    },
    {
      id: 2,
      crecheId: 1,
      name: "Campanha Rascunho Férias",
      description: "Preço fixo promocional",
      benefitType: "FIXED_PROMOTIONAL_PRICE",
      percentageBps: null,
      fixedDiscountCents: null,
      fixedPromotionalPriceCents: 4000,
      audienceType: "SELECTED_TUTORS",
      interactionPolicy: "EXCLUDE_IF_TUTOR_CONDITION",
      usageLimitType: "ONCE_PER_TUTOR",
      status: "DRAFT",
      priority: 100,
      validFrom: "2026-12-01T00:00:00.000Z",
      validUntil: "2026-12-31T00:00:00.000Z",
      items: [{ catalogueItemId: 10, itemName: "Day Use Avulso" }],
      tutors: [{ tutorId: 5, tutorName: "Maria Santos" }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Admin Test", role: "creche_admin", crecheId: 1 },
      creche: { id: 1, name: "Creche Alpha" },
      activeRole: "creche_admin",
      isAuthenticated: true,
    });
    (useFinancialModule.useListCatalogue as any).mockReturnValue({
      data: mockCatalogue,
      isLoading: false,
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/campaigns")) {
        const isDraft = url.includes("status=DRAFT");
        const list = isDraft
          ? mockCampaigns.filter((c) => c.status === "DRAFT")
          : mockCampaigns;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              campaigns: list,
              kpis: {
                total: 2,
                active: 1,
                scheduled: 0,
                paused: 0,
                ended: 0,
                revoked: 0,
              },
            }),
        });
      }
      if (url.includes("/tutors")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 5, name: "Maria Santos", email: "maria@test.com" },
              { id: 8, name: "João Pedro", email: "joao@test.com" },
            ]),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    });
  });

  it("1. renders page header, KPI cards, and campaign cards", async () => {
    renderWithProviders(<CampaignsPage />);

    expect(screen.getByText(/Campanhas Promocionais/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Campanha Black Friday Creche")).toBeInTheDocument();
      expect(screen.getByText("Campanha Rascunho Férias")).toBeInTheDocument();
    });
  });

  it("2. filters campaigns by status tabs", async () => {
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Black Friday Creche")).toBeInTheDocument();
      expect(screen.getByText("Campanha Rascunho Férias")).toBeInTheDocument();
    });

    // Click "Rascunhos" filter tab
    const draftTab = screen.getByRole("button", { name: /^Rascunhos$/i });
    fireEvent.click(draftTab);

    await waitFor(() => {
      expect(screen.queryByText("Campanha Black Friday Creche")).not.toBeInTheDocument();
      expect(screen.getByText("Campanha Rascunho Férias")).toBeInTheDocument();
    });
  });

  it("3. displays 'Nova Campanha' button for creche_admin and opens creation wizard", async () => {
    renderWithProviders(<CampaignsPage />);

    const newBtn = screen.getByRole("button", { name: /Nova Campanha/i });
    expect(newBtn).toBeInTheDocument();

    fireEvent.click(newBtn);

    await waitFor(() => {
      expect(screen.getByText(/Nova Campanha Promocional/i)).toBeInTheDocument();
      expect(screen.getByText(/Identificação/i)).toBeInTheDocument();
      expect(screen.getByText(/Nome da Campanha \*/i)).toBeInTheDocument();
    });
  });

  it("4. opens action dialog when clicking Pause on active campaign", async () => {
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Black Friday Creche")).toBeInTheDocument();
    });

    const pauseBtn = screen.getByRole("button", { name: /Pausar/i });
    fireEvent.click(pauseBtn);

    await waitFor(() => {
      expect(screen.getByText(/Pausar Campanha/i)).toBeInTheDocument();
      expect(screen.getByText(/Motivo Administrativo \*/i)).toBeInTheDocument();
    });
  });
});
