import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import { TutorCommercialModal } from "../components/commercial/tutor-commercial-modal";
import * as useFinancialModule from "../hooks/use-financial";

vi.mock("../hooks/use-financial", () => ({
  useListCatalogue: vi.fn(),
}));

describe("TutorCommercialModal Frontend Component Tests (R37.B)", () => {
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
      name: "Banho & Tosa Completo",
      type: "service",
      basePrice: "90.00",
      crecheId: 1,
    },
  ];

  const mockConditions = [
    {
      id: 101,
      crecheId: 1,
      tutorId: 5,
      catalogueItemId: 10,
      conditionType: "PERCENTAGE_DISCOUNT",
      percentageBps: 1500, // 15%
      customPriceCents: null,
      fixedDiscountCents: null,
      validFrom: "2026-09-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      status: "ACTIVE",
      reason: "Desconto especial de fidelidade anual",
      itemName: "Day Use Avulso",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useFinancialModule.useListCatalogue as any).mockReturnValue({
      data: mockCatalogue,
      isLoading: false,
    });

    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url.includes("/commercial-conditions/preview")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              pricingSourceType: "TUTOR_CONDITION",
              baseUnitPrice: "50.00",
              unitDiscount: "7.50",
              effectiveUnitPrice: "42.50",
            }),
        });
      }
      if (options?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 102, status: "ACTIVE" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockConditions),
      });
    });
  });

  it("1. renders modal with tutor name, condition list, and prominent contractual disclaimer", async () => {
    renderWithProviders(
      <TutorCommercialModal
        isOpen={true}
        onClose={vi.fn()}
        crecheId={1}
        tutorId={5}
        tutorName="Carlos Silva"
      />
    );

    expect(screen.getByText(/Condições Comerciais — Carlos Silva/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Esta condição não altera cobranças já emitidas/i)
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Day Use Avulso")).toBeInTheDocument();
      expect(screen.getByText(/15% de desconto/i)).toBeInTheDocument();
      expect(screen.getByText(/Desconto especial de fidelidade anual/i)).toBeInTheDocument();
      expect(screen.getByText("Ativa")).toBeInTheDocument();
    });
  });

  it("2. switches to 'Nova Condição' tab and renders item selection and inputs", async () => {
    renderWithProviders(
      <TutorCommercialModal
        isOpen={true}
        onClose={vi.fn()}
        crecheId={1}
        tutorId={5}
        tutorName="Carlos Silva"
      />
    );

    const newConditionTab = screen.getByRole("button", { name: /Nova Condição/i });
    fireEvent.click(newConditionTab);

    expect(screen.getByText(/Item do Catálogo \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Tipo de Condição \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Motivo \/ Justificativa Comercial \*/i)).toBeInTheDocument();
  });

  it("3. performs price simulation calculation dry-run without mutating state", async () => {
    renderWithProviders(
      <TutorCommercialModal
        isOpen={true}
        onClose={vi.fn()}
        crecheId={1}
        tutorId={5}
        tutorName="Carlos Silva"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Nova Condição/i }));

    // Select catalogue item
    const selectItem = screen.getByLabelText(/Item do Catálogo/i);
    fireEvent.change(selectItem, { target: { value: "10" } });

    // Enter discount percentage
    const valueInput = screen.getByPlaceholderText(/Ex: 10/i);
    fireEvent.change(valueInput, { target: { value: "15" } });

    // Click simulate
    const simulateBtn = screen.getByRole("button", { name: /Simular Preço/i });
    fireEvent.click(simulateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Simulação Autorizada pelo Servidor/i)).toBeInTheDocument();
      expect(screen.getByText("R$ 50.00")).toBeInTheDocument();
      expect(screen.getByText("- R$ 7.50")).toBeInTheDocument();
      expect(screen.getByText("R$ 42.50")).toBeInTheDocument();
    });
  });

  it("4. opens revoke confirmation when clicking Revogar button on active condition", async () => {
    renderWithProviders(
      <TutorCommercialModal
        isOpen={true}
        onClose={vi.fn()}
        crecheId={1}
        tutorId={5}
        tutorName="Carlos Silva"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Revogar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Revogar"));

    expect(
      screen.getByText(/Confirmar revogação da condição #101/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Motivo da revogação \(obrigatório para auditoria\)/i)
    ).toBeInTheDocument();
  });
});
