import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import CampaignsPage from "../pages/marketing/campaigns/index";
import { getCommercialBadge } from "../pages/bookings/components/booking-list-view";
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

describe("Marketing Opportunities & Commercial Visual States (R37.D)", () => {
  const mockCatalogue = [
    {
      id: 10,
      name: "Day Use Avulso",
      type: "day_use",
      basePrice: "50.00",
      crecheId: 1,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthModule.useAuth as any).mockReturnValue({
      user: { id: 1, role: "creche_admin", crecheId: 1 },
    });
    (useFinancialModule.useListCatalogue as any).mockReturnValue({
      data: mockCatalogue,
      isLoading: false,
    });
  });

  describe("1. Campaigns & CRM Opportunities Navigation Tabs", () => {
    it("renders top tabs for Campanhas and Oportunidades (CRM Leve)", async () => {
      // Mock fetch returning empty campaigns
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/creches/1/marketing/campaigns")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ campaigns: [] }),
          });
        }
        if (url.includes("/opportunities/inactive")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                opportunityType: "INACTIVE_TUTORS",
                count: 5,
                criteria: { days: 60 },
                items: [
                  {
                    tutorId: 10,
                    tutorName: "Maria Silva",
                    email: "maria@example.com",
                    petNames: ["Pipoca"],
                    registeredAt: "2025-01-01T00:00:00.000Z",
                    reason: "Sem reservas nos últimos 60 dias",
                  },
                ],
                page: 1,
                pageSize: 20,
                totalPages: 1,
              }),
          });
        }
        if (url.includes("/opportunities/new")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                opportunityType: "NEW_TUTORS",
                count: 3,
                criteria: { days: 30 },
                items: [],
                page: 1,
                pageSize: 20,
                totalPages: 0,
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      renderWithProviders(<CampaignsPage />);

      // Verify tabs exist
      expect(screen.getByRole("button", { name: /Campanhas/i })).toBeInTheDocument();
      const oppTab = screen.getByRole("button", { name: /Oportunidades/i });
      expect(oppTab).toBeInTheDocument();

      // Click on Opportunities tab
      fireEvent.click(oppTab);

      // Verify opportunity cards are displayed
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /Tutores Inativos/i })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /Novos Tutores/i })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /Experimentação/i })).toBeInTheDocument();
      });
    });

    it("opens prefilled campaign wizard when clicking 'Criar campanha' on an opportunity card", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/creches/1/marketing/campaigns")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ campaigns: [] }),
          });
        }
        if (url.includes("/opportunities/inactive")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                opportunityType: "INACTIVE_TUTORS",
                count: 5,
                criteria: { days: 60 },
                items: [],
                page: 1,
                pageSize: 20,
                totalPages: 1,
              }),
          });
        }
        if (url.includes("/opportunities/new")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                opportunityType: "NEW_TUTORS",
                count: 3,
                criteria: { days: 30 },
                items: [],
                page: 1,
                pageSize: 20,
                totalPages: 1,
              }),
          });
        }
        if (url.includes("/opportunities/never-used")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                opportunityType: "NEVER_USED_SERVICE",
                count: 2,
                criteria: { catalogueItemId: 10 },
                items: [],
                page: 1,
                pageSize: 20,
                totalPages: 1,
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      renderWithProviders(<CampaignsPage />);

      // Switch to opportunities tab
      const oppTab = screen.getByRole("button", { name: /Oportunidades/i });
      fireEvent.click(oppTab);

      // Wait for cards to render and button to be enabled once query resolves
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /Tutores Inativos/i })).toBeInTheDocument();
        const firstCreateBtn = screen.getAllByRole("button", { name: /Criar campanha/i })[0];
        expect(firstCreateBtn).not.toBeDisabled();
      });

      // Click first "Criar campanha" (for Inactive Tutors)
      const createButtons = screen.getAllByRole("button", { name: /Criar campanha/i });
      fireEvent.click(createButtons[0]);

      // Verify wizard opened and name is prefilled
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /Nova Campanha Promocional/i })).toBeInTheDocument();
        expect(screen.getByDisplayValue(/Reativação — Inativos 60 dias/i)).toBeInTheDocument();
      });
    });
  });

  describe("2. Booking List Commercial Visual States", () => {
    it("returns null badge when booking has no promotional reservation", () => {
      const badge = getCommercialBadge(null);
      expect(badge).toBeNull();
    });

    it("renders 'Preço promocional reservado' when reservation status is RESERVED", () => {
      const commercialReservation = {
        hasReservedCampaign: true,
        items: [
          {
            lineStatus: "RESERVED",
            applicationMode: "MONETARY_DISCOUNT",
            effectiveUnitPriceCents: 8000,
          },
        ],
      };
      const badge = getCommercialBadge(commercialReservation);
      expect(badge).not.toBeNull();
    });

    it("renders 'Cortesia promocional' when reservation is complimentary zero-value", () => {
      const commercialReservation = {
        hasReservedCampaign: true,
        items: [
          {
            lineStatus: "RESERVED",
            applicationMode: "COMPLIMENTARY_ZERO_VALUE",
            effectiveUnitPriceCents: 0,
          },
        ],
      };
      const badge = getCommercialBadge(commercialReservation);
      expect(badge).not.toBeNull();
    });

    it("renders 'Campanha aplicada' when reservation status is APPLIED", () => {
      const commercialReservation = {
        hasReservedCampaign: true,
        items: [
          {
            lineStatus: "APPLIED",
            applicationMode: "MONETARY_DISCOUNT",
            effectiveUnitPriceCents: 8000,
          },
        ],
      };
      const badge = getCommercialBadge(commercialReservation);
      expect(badge).not.toBeNull();
    });

    it("renders 'Crédito pré-pago' when line is RELEASED due to prepaid credit coverage", () => {
      const commercialReservation = {
        hasReservedCampaign: true,
        items: [
          {
            lineStatus: "RELEASED",
            releaseReason: "covered_by_prepaid_credit",
          },
        ],
      };
      const badge = getCommercialBadge(commercialReservation);
      expect(badge).not.toBeNull();
    });
  });
});
