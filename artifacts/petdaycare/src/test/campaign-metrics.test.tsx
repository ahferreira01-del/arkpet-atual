import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import { CampaignOverviewMetricsCard } from "../pages/marketing/campaigns/components/campaign-overview-metrics-card";
import { CampaignMetricsSection } from "../pages/marketing/campaigns/components/campaign-metrics-section";
import { CrmOriginCampaignsSection } from "../pages/marketing/campaigns/components/crm-origin-campaigns-section";

describe("Commercial Metrics & Reporting Frontend (R37.E0.1 — Section 26)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Overview KPIs rendering
  it("1. renders overview KPIs accurately with audited metrics", async () => {
    const mockOverview = {
      crecheId: 1,
      period: "30d",
      hasFinancialAccess: true,
      campaignsByStatus: { total: 5, active: 3, scheduled: 1, paused: 1, ended: 0, revoked: 0, draft: 0 },
      redemptionCohort: { totalReservedInPeriod: 12, uniqueTutorsInCohort: 8, currentlyApplied: 6, currentlyReserved: 4, currentlyReleased: 2 },
      applicationsInPeriod: { redemptionsFirstAppliedCount: 6, uniqueTutorsAppliedCount: 5 },
      financial: {
        grossAppliedBaseAmountCents: 100000,
        grossAppliedDiscountCents: 20000,
        grossAppliedFinalAmountCents: 80000,
        nonVoidedNonRefundedFinalAmountCents: 75000,
        monetaryApplicationsCount: 5,
        complimentaryApplicationsCount: 1,
        complimentaryBaseValueCents: 5000,
        invoiceStatusBreakdown: {
          pending: { lineCount: 1, finalChargedAmountCents: 10000 },
          awaitingConfirmation: { lineCount: 1, finalChargedAmountCents: 15000 },
          overdue: { lineCount: 1, finalChargedAmountCents: 5000 },
          paid: { lineCount: 2, finalChargedAmountCents: 45000 },
          voided: { lineCount: 0, finalChargedAmountCents: 0 },
          refunded: { lineCount: 1, finalChargedAmountCents: 5000 },
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockOverview),
    });

    renderWithProviders(<CampaignOverviewMetricsCard crecheId={1} isCrecheAdmin={true} />);

    expect(screen.getByText("Desempenho Comercial das Campanhas")).toBeInTheDocument();
    expect(screen.getByText("Auditado")).toBeInTheDocument();

    await waitFor(() => {
      // Resgates no período = 12, 8 tutores únicos
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("8 tutores únicos")).toBeInTheDocument();

      // Aplicações efetivas = 6, 5 tutores aplicaram
      expect(screen.getByText("6")).toBeInTheDocument();
      expect(screen.getByText("5 tutores aplicaram")).toBeInTheDocument();

      // Descontos concedidos
      expect(screen.getByText("R$ 200,00")).toBeInTheDocument();

      // Cobrado Líquido
      expect(screen.getByText("R$ 750,00")).toBeInTheDocument();
    });
  });

  // 2. Period selector interaction (7d, 30d, 90d, all)
  it("2. handles period selector interactions (7d, 30d, 90d, all)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          crecheId: 1,
          hasFinancialAccess: true,
          campaignsByStatus: { total: 0, active: 0, scheduled: 0, paused: 0, ended: 0, revoked: 0, draft: 0 },
          redemptionCohort: { totalReservedInPeriod: 0, uniqueTutorsInCohort: 0 },
          applicationsInPeriod: { redemptionsFirstAppliedCount: 0, uniqueTutorsAppliedCount: 0 },
          financial: null,
        }),
    });
    global.fetch = fetchMock;

    renderWithProviders(<CampaignOverviewMetricsCard crecheId={1} isCrecheAdmin={true} />);

    // Default period is 30d
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("period=30d"),
        expect.anything()
      );
    });

    // Click 7d
    fireEvent.click(screen.getByRole("button", { name: /7 dias/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("period=7d"),
        expect.anything()
      );
    });

    // Click 90d
    fireEvent.click(screen.getByRole("button", { name: /90 dias/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("period=90d"),
        expect.anything()
      );
    });

    // Click all
    fireEvent.click(screen.getByRole("button", { name: /Todo o período/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("period=all"),
        expect.anything()
      );
    });
  });

  // 3. Campaign detail metrics modal / section
  it("3. renders campaign detail metrics modal with structured layout", async () => {
    const mockDetail = {
      campaignId: 42,
      campaignName: "Promo de Verão",
      status: "ACTIVE",
      audienceType: "SELECTED_TUTORS",
      audienceAvailability: "EXACT_MATERIALIZED",
      currentSelectedAudienceSize: 20,
      crmAudienceAtCreation: 20,
      utilizationRatePercentage: 25.0,
      redemptionSummary: {
        totalRedemptions: 6,
        reservedCount: 1,
        partiallyAppliedCount: 1,
        appliedCount: 4,
        releasedCount: 0,
        uniqueTutorsCount: 5,
        uniqueTutorsAppliedCount: 5,
      },
      hasFinancialAccess: true,
      financial: {
        grossAppliedBaseAmountCents: 40000,
        grossAppliedDiscountCents: 10000,
        grossAppliedFinalAmountCents: 30000,
        nonVoidedNonRefundedFinalAmountCents: 30000,
        monetaryApplicationsCount: 5,
        complimentaryApplicationsCount: 0,
        complimentaryBaseValueCents: 0,
        invoiceStatusBreakdown: {
          paid: { lineCount: 5, finalChargedAmountCents: 30000 },
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={42} />);

    await waitFor(() => {
      expect(screen.getByText("Desempenho e Utilização da Campanha")).toBeInTheDocument();
      expect(screen.getByText("Fonte da Verdade")).toBeInTheDocument();
      expect(screen.getByText("20 tutores")).toBeInTheDocument();
      expect(screen.getByText("CRM na criação: 20")).toBeInTheDocument();
      expect(screen.getByText("25.0%")).toBeInTheDocument();
      expect(screen.getByText("5 tutores únicos")).toBeInTheDocument();
      expect(screen.getByText("R$ 400,00")).toBeInTheDocument();
      expect(screen.getByText("R$ 100,00")).toBeInTheDocument();
      expect(screen.getAllByText(/300,00/).length).toBeGreaterThanOrEqual(1);
    });
  });

  // 4. ALL_ACTIVE_TUTORS shows "Não disponível historicamente"
  it("4. displays 'Não disponível historicamente' and null utilization rate for ALL_ACTIVE_TUTORS", async () => {
    const mockDetail = {
      campaignId: 43,
      campaignName: "Black Friday Geral",
      status: "ACTIVE",
      audienceType: "ALL_ACTIVE_TUTORS",
      audienceAvailability: "UNAVAILABLE_HISTORICAL",
      currentSelectedAudienceSize: null,
      crmAudienceAtCreation: null,
      utilizationRatePercentage: null,
      redemptionSummary: {
        totalRedemptions: 10,
        reservedCount: 2,
        partiallyAppliedCount: 1,
        appliedCount: 7,
        releasedCount: 0,
        uniqueTutorsCount: 8,
        uniqueTutorsAppliedCount: 7,
      },
      hasFinancialAccess: true,
      financial: null,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={43} />);

    await waitFor(() => {
      expect(screen.getByText("Todos Ativos")).toBeInTheDocument();
      expect(screen.getByText("Não disponível historicamente")).toBeInTheDocument();
      expect(screen.getByText("N/D (Público Geral)")).toBeInTheDocument();
    });
  });

  // 5. SELECTED_TUTORS shows exact audience and utilization %
  it("5. displays exact audience and utilization % for SELECTED_TUTORS", async () => {
    const mockDetail = {
      campaignId: 44,
      status: "ACTIVE",
      audienceType: "SELECTED_TUTORS",
      audienceAvailability: "EXACT_MATERIALIZED",
      currentSelectedAudienceSize: 10,
      utilizationRatePercentage: 40.0,
      redemptionSummary: {
        totalRedemptions: 4,
        uniqueTutorsAppliedCount: 4,
      },
      hasFinancialAccess: false,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={44} />);

    await waitFor(() => {
      expect(screen.getByText("10 tutores")).toBeInTheDocument();
      expect(screen.getByText("40.0%")).toBeInTheDocument();
    });
  });

  // 6. Utilization rate calculation with multiple bookings for same tutor
  it("6. reflects unique applied tutor calculation without inflation from multi-bookings", async () => {
    const mockDetail = {
      campaignId: 45,
      status: "ACTIVE",
      audienceType: "SELECTED_TUTORS",
      currentSelectedAudienceSize: 2,
      utilizationRatePercentage: 50.0,
      redemptionSummary: {
        totalRedemptions: 3,
        uniqueTutorsAppliedCount: 1,
      },
      hasFinancialAccess: false,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={45} />);

    await waitFor(() => {
      expect(screen.getByText("50.0%")).toBeInTheDocument();
      expect(screen.getByText("1 tutores únicos")).toBeInTheDocument();
      expect(screen.getByText("Total de resgates: 3")).toBeInTheDocument();
    });
  });

  // 7. Staff role hides financial section (hasFinancialAccess === false)
  it("7. hides financial metrics and shows restriction notice when hasFinancialAccess is false", async () => {
    const mockDetail = {
      campaignId: 46,
      status: "ACTIVE",
      audienceType: "SELECTED_TUTORS",
      currentSelectedAudienceSize: 5,
      utilizationRatePercentage: 20.0,
      redemptionSummary: { totalRedemptions: 1, uniqueTutorsAppliedCount: 1 },
      hasFinancialAccess: false,
      financial: null,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={46} />);

    await waitFor(() => {
      expect(
        screen.getByText("Métricas financeiras restritas ao perfil de administrador da creche.")
      ).toBeInTheDocument();
      expect(screen.queryByText("Impacto Financeiro Auditado")).not.toBeInTheDocument();
      expect(screen.queryByText("Valor Base Bruto")).not.toBeInTheDocument();
    });
  });

  // 8. Complimentary zero-value card rendering
  it("8. renders complimentary zero-value benefits card correctly", async () => {
    const mockDetail = {
      campaignId: 47,
      status: "ACTIVE",
      audienceType: "SELECTED_TUTORS",
      currentSelectedAudienceSize: 5,
      utilizationRatePercentage: 20.0,
      redemptionSummary: { totalRedemptions: 1, uniqueTutorsAppliedCount: 1 },
      hasFinancialAccess: true,
      financial: {
        grossAppliedBaseAmountCents: 8000,
        grossAppliedDiscountCents: 8000,
        grossAppliedFinalAmountCents: 0,
        nonVoidedNonRefundedFinalAmountCents: 0,
        monetaryApplicationsCount: 0,
        complimentaryApplicationsCount: 1,
        complimentaryBaseValueCents: 8000,
        invoiceStatusBreakdown: {},
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={47} />);

    await waitFor(() => {
      expect(screen.getByText("Itens com Diária Cortesia (Zero Valor):")).toBeInTheDocument();
      expect(screen.getByText(/1 aplicações \(R\$ 80,00 em benefício\)/i)).toBeInTheDocument();
    });
  });

  // 9. Six invoice status buckets (pending, awaiting_confirmation, overdue, paid, voided, refunded)
  it("9. renders all six invoice status buckets in financial breakdown", async () => {
    const mockDetail = {
      campaignId: 48,
      status: "ACTIVE",
      audienceType: "SELECTED_TUTORS",
      currentSelectedAudienceSize: 10,
      utilizationRatePercentage: 60.0,
      redemptionSummary: { totalRedemptions: 6, uniqueTutorsAppliedCount: 6 },
      hasFinancialAccess: true,
      financial: {
        grossAppliedBaseAmountCents: 60000,
        grossAppliedDiscountCents: 12000,
        grossAppliedFinalAmountCents: 48000,
        nonVoidedNonRefundedFinalAmountCents: 32000,
        monetaryApplicationsCount: 6,
        complimentaryApplicationsCount: 0,
        complimentaryBaseValueCents: 0,
        invoiceStatusBreakdown: {
          paid: { lineCount: 1, finalChargedAmountCents: 8000 },
          pending: { lineCount: 1, finalChargedAmountCents: 8000 },
          awaitingConfirmation: { lineCount: 1, finalChargedAmountCents: 8000 },
          overdue: { lineCount: 1, finalChargedAmountCents: 8000 },
          voided: { lineCount: 1, finalChargedAmountCents: 8000 },
          refunded: { lineCount: 1, finalChargedAmountCents: 8000 },
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={48} />);

    await waitFor(() => {
      expect(screen.getByText("Status das Faturas com a Campanha:")).toBeInTheDocument();
      expect(screen.getByText("Pagas (1):")).toBeInTheDocument();
      expect(screen.getByText("Pendentes (1):")).toBeInTheDocument();
      expect(screen.getByText("Confirmação (1):")).toBeInTheDocument();
      expect(screen.getByText("Vencidas (1):")).toBeInTheDocument();
      expect(screen.getByText("Canceladas (1):")).toBeInTheDocument();
      expect(screen.getByText("Reembolsadas (1):")).toBeInTheDocument();
    });
  });

  // 10. Empty campaign state handling (zero state, no NaN)
  it("10. handles empty campaign state without errors or NaN", async () => {
    const mockDetail = {
      campaignId: 49,
      status: "DRAFT",
      audienceType: "SELECTED_TUTORS",
      audienceAvailability: "EXACT_MATERIALIZED",
      currentSelectedAudienceSize: 0,
      crmAudienceAtCreation: null,
      utilizationRatePercentage: null,
      redemptionSummary: {
        totalRedemptions: 0,
        reservedCount: 0,
        partiallyAppliedCount: 0,
        appliedCount: 0,
        releasedCount: 0,
        uniqueTutorsCount: 0,
        uniqueTutorsAppliedCount: 0,
      },
      hasFinancialAccess: true,
      financial: null,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={49} />);

    await waitFor(() => {
      expect(screen.getByText("0 tutores")).toBeInTheDocument();
      expect(screen.getByText("0 tutores únicos")).toBeInTheDocument();
      expect(screen.getByText("N/D (Rascunho)")).toBeInTheDocument();
      expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
    });
  });

  // 11. Absence of forbidden vocabulary ("conversão", etc.)
  it("11. strictly avoids forbidden non-causal vocabulary across rendered metrics", async () => {
    const mockCrm = {
      crecheId: 1,
      totalCampaignsCreatedFromOpportunity: 1,
      byOpportunityType: { inactiveTutorsCount: 1, newTutorsCount: 0, neverUsedServiceCount: 0 },
      campaigns: [
        {
          campaignId: 50,
          campaignName: "Campanha Reativação",
          opportunityType: "INACTIVE_TUTORS",
          sourceAuthority: "STRUCTURED_AFTER_STATE",
          crmAudienceAtCreation: 10,
          currentSelectedAudienceSize: 10,
          uniqueTutorsApplied: 2,
          finalChargedAmountCents: 16000,
          discountGrantedCents: 4000,
          hasFinancialAccess: true,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockCrm),
    });

    const { container } = renderWithProviders(<CrmOriginCampaignsSection crecheId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Reativação")).toBeInTheDocument();
      expect(screen.getByText("Tutores que Utilizaram:")).toBeInTheDocument();
      expect(screen.getByText("Valor Faturado / Desconto:")).toBeInTheDocument();
    });

    const textContent = container.textContent || "";
    expect(textContent.toLowerCase()).not.toContain("conversão");
    expect(textContent.toLowerCase()).not.toContain("conversões");
    expect(textContent.toLowerCase()).not.toContain("conversion");
    expect(textContent.toLowerCase()).not.toContain("retorno e os resgates");
    expect(textContent.toLowerCase()).not.toContain("taxa de adesão");
  });

  // 12. RELEASED redemptions displayed as "Reservas liberadas" (never "Expirados")
  it("12. displays RELEASED redemptions strictly as 'Reservas liberadas'", async () => {
    const mockDetail = {
      campaignId: 51,
      status: "ACTIVE",
      audienceType: "SELECTED_TUTORS",
      currentSelectedAudienceSize: 5,
      utilizationRatePercentage: 0,
      redemptionSummary: {
        totalRedemptions: 3,
        reservedCount: 0,
        partiallyAppliedCount: 0,
        appliedCount: 0,
        releasedCount: 3,
        uniqueTutorsCount: 2,
        uniqueTutorsAppliedCount: 0,
      },
      hasFinancialAccess: false,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    const { container } = renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={51} />);

    await waitFor(() => {
      expect(screen.getByText("Reservas liberadas")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    const textContent = container.textContent || "";
    expect(textContent).not.toContain("Expirados");
    expect(textContent).not.toContain("Liberados/Expirados");
  });

  // 13. Currency BRL formatting (R$ 0,00)
  it("13. formats monetary values with standard Brazilian Real currency formatting", async () => {
    const mockDetail = {
      campaignId: 52,
      status: "ACTIVE",
      audienceType: "SELECTED_TUTORS",
      currentSelectedAudienceSize: 5,
      utilizationRatePercentage: 20.0,
      redemptionSummary: { totalRedemptions: 1, uniqueTutorsAppliedCount: 1 },
      hasFinancialAccess: true,
      financial: {
        grossAppliedBaseAmountCents: 12550,
        grossAppliedDiscountCents: 2550,
        grossAppliedFinalAmountCents: 10000,
        nonVoidedNonRefundedFinalAmountCents: 10000,
        monetaryApplicationsCount: 1,
        complimentaryApplicationsCount: 0,
        complimentaryBaseValueCents: 0,
        invoiceStatusBreakdown: {
          paid: { lineCount: 1, finalChargedAmountCents: 10000 },
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    renderWithProviders(<CampaignMetricsSection crecheId={1} campaignId={52} />);

    await waitFor(() => {
      expect(screen.getByText(/125,50/)).toBeInTheDocument();
      expect(screen.getByText(/^R\$\s*25,50$/)).toBeInTheDocument();
      expect(screen.getAllByText(/100,00/).length).toBeGreaterThan(0);
    });
  });
});
