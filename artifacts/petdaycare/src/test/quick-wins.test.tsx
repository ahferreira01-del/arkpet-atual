import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import { Modal } from "@/components/ui/modal";
import NewBooking from "@/pages/bookings/new";
import TutorStore from "@/pages/tutor/store";
import { FeedTab } from "@/components/feed-tab";
import * as authModule from "@/hooks/use-auth";
import * as toastModule from "@/hooks/use-toast";
import * as apiClientModule from "@workspace/api-client-react";
import * as financialModule from "@/hooks/use-financial";

const mockToast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
    toasts: [],
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, role: "creche_admin", crecheId: 1 },
    isLoading: false,
  })),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListPets: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
  useCreateBooking: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useListFeed: vi.fn(() => ({
    data: [
      {
        id: 101,
        type: "photo",
        content: "Foto no parque",
        createdAt: "2026-08-26T10:00:00.000Z",
        author: { name: "Tia Ana" },
        pets: [{ petId: 1, petName: "Rex" }],
      },
    ],
    isLoading: false,
    isError: false,
  })),
  getListFeedQueryKey: vi.fn(() => ["feed", 1]),
  getListBookingsQueryKey: vi.fn(() => ["bookings"]),
  getGetCrecheStatsQueryKey: vi.fn(() => ["stats"]),
  getListTasksQueryKey: vi.fn(() => ["tasks"]),
}));

vi.mock("@/hooks/use-financial", () => ({
  useListCatalogue: vi.fn(() => ({
    data: [
      {
        id: 1,
        name: "Ração Premium",
        type: "product",
        basePrice: 5000,
        isActive: true,
        stockQuantity: 10,
      },
    ],
    isLoading: false,
  })),
  useCreche: vi.fn(() => ({ data: { name: "Creche Pet" } })),
  useCreateOrder: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePackagesBalance: vi.fn(() => ({ data: { packages: [] }, isLoading: false })),
  useServiceCredits: vi.fn(() => ({ data: [], isLoading: false })),
}));

describe("R33D.B1 Quick Wins Accessibility & Error Handling Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Modal close button with accessible name 'Fechar'", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <Modal isOpen={true} onClose={onClose} title="Teste de Acessibilidade">
        <p>Conteúdo do modal</p>
      </Modal>
    );

    const closeButton = screen.getByRole("button", { name: "Fechar" });
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders NewBooking back button with accessible name 'Voltar para reservas'", () => {
    renderWithProviders(<NewBooking />);

    const backButton = screen.getByRole("button", { name: "Voltar para reservas" });
    expect(backButton).toBeInTheDocument();
  });

  it("renders TutorStore cart buttons with accessible names (Diminuir, Aumentar, Remover)", async () => {
    renderWithProviders(<TutorStore />);

    // Add item to cart
    const addButton = screen.getByRole("button", { name: /adicionar ao carrinho/i });
    expect(addButton).toBeInTheDocument();
    fireEvent.click(addButton);

    // Open cart modal via floating badge button
    const cartButton = screen.getByText("1").closest("button");
    expect(cartButton).toBeInTheDocument();
    fireEvent.click(cartButton!);

    // Verify accessible names inside the cart modal
    const decrementButton = screen.getByRole("button", { name: "Diminuir quantidade" });
    const incrementButton = screen.getByRole("button", { name: "Aumentar quantidade" });
    const removeButton = screen.getByRole("button", { name: "Remover item do carrinho" });

    expect(decrementButton).toBeInTheDocument();
    expect(incrementButton).toBeInTheDocument();
    expect(removeButton).toBeInTheDocument();

    // Verify interaction works
    fireEvent.click(incrementButton);
    fireEvent.click(decrementButton);
  });

  it("surfaces error feedback toast when Feed post edit fails", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Server error" }),
    });

    renderWithProviders(<FeedTab crecheId={1} />);

    // Click edit pencil button
    const editButton = screen.getByTitle("Editar legenda");
    expect(editButton).toBeInTheDocument();
    fireEvent.click(editButton);

    // Click "Salvar" button
    const saveButton = screen.getByRole("button", { name: "Salvar" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Erro ao editar publicação",
          variant: "destructive",
        })
      );
    });

    global.fetch = originalFetch;
  });

  it("surfaces error feedback toast when Feed post delete fails", async () => {
    const originalConfirm = window.confirm;
    window.confirm = () => true;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Server error" }),
    });

    renderWithProviders(<FeedTab crecheId={1} />);

    // Find delete button
    const deleteButtons = screen.getAllByRole("button");
    // Find the button with Trash2 icon
    const deleteBtn = deleteButtons.find(b => b.querySelector(".lucide-trash-2"));
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Erro ao excluir publicação",
          variant: "destructive",
        })
      );
    });

    window.confirm = originalConfirm;
    global.fetch = originalFetch;
  });
});
