import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent } from "./utils";
import { POSSaleModal } from "../components/financial/pos-sale-modal";
import * as useFinancialModule from "../hooks/use-financial";

vi.mock("../hooks/use-financial", () => ({
  useListCatalogue: vi.fn(),
  usePosSale: vi.fn(),
}));

describe("POSSaleModal Component Tests", () => {
  const mockCatalogue = [
    {
      id: 101,
      name: "Ração Premium 1kg",
      type: "product",
      price: 5000, // R$ 50,00
      trackStock: true,
      stockQuantity: 10,
      crecheId: 1,
    },
    {
      id: 102,
      name: "Banho e Tosa",
      type: "service",
      price: 8000, // R$ 80,00
      trackStock: false,
      crecheId: 1,
    },
  ];

  const mockMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useFinancialModule.useListCatalogue as any).mockReturnValue({
      data: mockCatalogue,
      isLoading: false,
    });
    (useFinancialModule.usePosSale as any).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });
  });

  it("renders modal with catalogue items when open", () => {
    renderWithProviders(
      <POSSaleModal isOpen={true} onClose={vi.fn()} crecheId={1} />
    );

    expect(screen.getByText("Venda Balcão (PDV)")).toBeInTheDocument();
    expect(screen.getByText("Ração Premium 1kg")).toBeInTheDocument();
    expect(screen.getByText("Banho e Tosa")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 50,00").length).toBeGreaterThanOrEqual(1);
  });

  it("adds an item to the cart and calculates the total correctly", () => {
    renderWithProviders(
      <POSSaleModal isOpen={true} onClose={vi.fn()} crecheId={1} />
    );

    const addButtons = screen.getAllByRole("button", { name: /Adicionar/i });
    fireEvent.click(addButtons[0]); // Add Ração Premium 1kg (R$ 50,00)

    expect(screen.getByText("Total a pagar")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 50,00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Finalizar Venda" })).not.toBeDisabled();
  });

  it("increases item quantity and updates total in the cart", () => {
    renderWithProviders(
      <POSSaleModal isOpen={true} onClose={vi.fn()} crecheId={1} />
    );

    const addButtons = screen.getAllByRole("button", { name: /Adicionar/i });
    fireEvent.click(addButtons[0]); // Quantity 1 (R$ 50,00)
    fireEvent.click(addButtons[0]); // Quantity 2 (R$ 100,00)

    expect(screen.getAllByText("R$ 100,00").length).toBeGreaterThanOrEqual(1);
  });

  it("calls posSaleMutation with proper payload when clicking finalize", () => {
    renderWithProviders(
      <POSSaleModal isOpen={true} onClose={vi.fn()} crecheId={1} />
    );

    const addButtons = screen.getAllByRole("button", { name: /Adicionar/i });
    fireEvent.click(addButtons[1]); // Add Banho e Tosa (R$ 80,00)

    const finalizeButton = screen.getByRole("button", { name: "Finalizar Venda" });
    fireEvent.click(finalizeButton);

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ catalogueItemId: 102, quantity: 1 }],
        paymentMethod: "cash",
      }),
      expect.any(Object)
    );
  });
});
