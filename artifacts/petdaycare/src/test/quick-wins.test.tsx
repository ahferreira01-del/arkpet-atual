import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import { Modal } from "@/components/ui/modal";
import NewBooking from "@/pages/bookings/new";
import TutorStore from "@/pages/tutor/store";
import { FeedTab } from "@/components/feed-tab";
import FinancialDashboard from "@/pages/financial/index";
import TutorFinancial from "@/pages/tutor/financial";
import Chat from "@/pages/chat/index";
import Dashboard from "@/pages/dashboard";
import StaffTasks from "@/pages/staff/index";
import * as authModule from "@/hooks/use-auth";
import * as toastModule from "@/hooks/use-toast";
import * as apiClientModule from "@workspace/api-client-react";
import * as financialModule from "@/hooks/use-financial";
import QRCode from "qrcode";

// Mock ResizeObserver as a proper constructible class
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

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
    user: { id: 1, name: "Admin User", role: "creche_admin", crecheId: 1 },
    isLoading: false,
  })),
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(),
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListPets: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
  useCreateBooking: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useListBookings: vi.fn(() => ({ data: [], isLoading: false })),
  useListTasks: vi.fn(() => ({ data: [], isLoading: false })),
  useGetCrecheStats: vi.fn(() => ({ data: {}, isLoading: false })),
  useListCrecheStaff: vi.fn(() => ({ data: [], isLoading: false })),
  useCompleteTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useAddFeedPost: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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
  useGetCreche: vi.fn(() => ({
    data: { id: 1, name: "Creche Pet", pixKey: "12345678900", pixName: "Creche Pet" },
    isLoading: false,
  })),
  getGetCrecheQueryKey: vi.fn(() => ["creche", 1]),
  useListConversations: vi.fn(() => ({
    data: [
      {
        tutorId: 2,
        tutorName: "Carlos Tutor",
        tutorPhone: "11999999999",
        lastMessage: "Olá!",
        lastMessageTime: "2026-08-26T10:00:00.000Z",
        unreadCount: 0,
        pets: [{ id: 1, name: "Rex" }],
      },
    ],
    isLoading: false,
  })),
  getListConversationsQueryKey: vi.fn(() => ["conversations", 1]),
  useListMessages: vi.fn(() => ({
    data: Array.from({ length: 50 }, (_, i) => ({
      id: 100 - i,
      senderId: 2,
      senderName: "Carlos Tutor",
      content: `Mensagem ${i + 1}`,
      createdAt: "2026-08-26T10:00:00.000Z",
      tutorId: 2,
    })),
    isLoading: false,
  })),
  useSendMessage: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  listMessages: vi.fn(),
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
  useCreche: vi.fn(() => ({
    data: { id: 1, name: "Creche Pet", pixKey: "12345678900", pixName: "Creche Pet" },
    isLoading: false,
  })),
  useCreateOrder: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePackagesBalance: vi.fn(() => ({ data: { packages: [] }, isLoading: false })),
  useServiceCredits: vi.fn(() => ({ data: [], isLoading: false })),
  useListAllInvoices: vi.fn(() => ({
    data: [
      {
        id: 1,
        invoiceNumber: "INV-001",
        tutorName: "Carlos",
        tutorPhone: "11999999999",
        totalAmount: 15000,
        status: "pending",
        dueDate: "2026-08-30",
        items: [{ description: "Diária", quantity: 1, unitPrice: 15000, total: 15000 }],
      },
    ],
    isLoading: false,
  })),
  useListExpenses: vi.fn(() => ({
    data: [
      {
        id: 1,
        description: "Ração Fornecedor",
        amount: 20000,
        status: "pending",
        category: "Alimentação",
        dueDate: "2026-08-30",
      },
    ],
    isLoading: false,
  })),
  useDashboardCashFlow: vi.fn(() => ({ data: { series: [] }, isLoading: false })),
  useDashboardDre: vi.fn(() => ({ data: { revenue: 0, expenses: 0, profit: 0 }, isLoading: false })),
  useListOrders: vi.fn(() => ({ data: [], isLoading: false })),
  useListAuditLogs: vi.fn(() => ({ data: [], isLoading: false })),
  useInvoiceItems: vi.fn(() => ({ data: [], isLoading: false })),
  usePayExpense: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateExpense: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteExpense: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateExpense: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateCatalogueItem: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateCatalogueItem: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteCatalogueItem: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useStockTransactions: vi.fn(() => ({ data: [], isLoading: false })),
  useStockAdjustment: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useFinancialSearch: vi.fn(() => ({ data: [], isLoading: false })),
  useFinancialReport: vi.fn(() => ({ data: {}, isLoading: false })),
  useDashboardKPIs: vi.fn(() => ({ data: {}, isLoading: false })),
  useDashboardCharts: vi.fn(() => ({ data: {}, isLoading: false })),
  useDashboardSales: vi.fn(() => ({ data: {}, isLoading: false })),
  useTutorSmartIndicators: vi.fn(() => ({ data: {}, isLoading: false })),
  useCatalogueSmartIndicators: vi.fn(() => ({ data: {}, isLoading: false })),
  useListBatches: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateBatch: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useTutorInvoices: vi.fn(() => ({
    data: [
      {
        id: 1,
        invoiceNumber: "FAT-001",
        amount: 15000,
        totalAmount: 15000,
        status: "pending",
        dueDate: "2026-08-30",
        items: [{ description: "Diária", quantity: 1, unitPrice: 15000, total: 15000 }],
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
  })),
  useStripeCheckout: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateCrecheSettings: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePayManualInvoice: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useApproveReceipt: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRefundInvoice: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useVoidInvoice: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateOrderStatus: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRefundInvoiceItem: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

describe("R33D.B2 Residual Quick Wins Accessibility & Error Handling Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Financial action menu trigger buttons with accessible names", async () => {
    // 1. Test Receivables (Faturas) tab
    window.history.pushState({}, "", "/financial?tab=receivables");
    const { unmount: unmount1 } = renderWithProviders(<FinancialDashboard />);
    const invoiceMenuButton = await screen.findByRole("button", { name: "Mais opções da fatura" });
    expect(invoiceMenuButton).toBeInTheDocument();
    unmount1();

    // 2. Test Payables (Despesas) tab
    window.history.pushState({}, "", "/financial?tab=payables");
    const { unmount: unmount2 } = renderWithProviders(<FinancialDashboard />);
    const expenseMenuButtons = await screen.findAllByRole("button", { name: "Mais opções da despesa" });
    expect(expenseMenuButtons.length).toBeGreaterThanOrEqual(1);
    unmount2();

    // 3. Test Catalogue (Catálogo) tab
    window.history.pushState({}, "", "/financial?tab=catalogue");
    const { unmount: unmount3 } = renderWithProviders(<FinancialDashboard />);
    const catalogueMenuButton = await screen.findByRole("button", { name: "Mais opções do item" });
    expect(catalogueMenuButton).toBeInTheDocument();
    unmount3();
  });

  it("surfaces error feedback toast when Tutor PIX QR Code generation fails", async () => {
    (QRCode.toDataURL as any).mockRejectedValue(new Error("QR generation error"));

    renderWithProviders(<TutorFinancial />);

    // Switch to "Faturas" tab on TutorFinancial
    const faturasTab = screen.getByRole("button", { name: "Faturas" });
    fireEvent.click(faturasTab);

    // Click "Pagar" / "Pagar com Pix" button for the pending invoice
    const payButton = await screen.findByRole("button", { name: /pagar/i });
    expect(payButton).toBeInTheDocument();
    fireEvent.click(payButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Erro ao gerar QR Code",
          description: "Não foi possível gerar o código QR do Pix.",
          variant: "destructive",
        })
      );
    });
  });

  it("surfaces error feedback toast when Chat historical pagination fails", async () => {
    (apiClientModule.listMessages as any).mockRejectedValue(new Error("Network timeout"));

    renderWithProviders(<Chat />);

    // Click on conversation with Carlos Tutor
    const tutorConv = screen.getByText("Carlos Tutor");
    expect(tutorConv).toBeInTheDocument();
    fireEvent.click(tutorConv);

    // Find and click "Ver mensagens anteriores"
    const loadOlderButton = await screen.findByRole("button", { name: "Ver mensagens anteriores" });
    expect(loadOlderButton).toBeInTheDocument();
    fireEvent.click(loadOlderButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Erro ao carregar mensagens",
          description: "Não foi possível carregar o histórico de mensagens.",
          variant: "destructive",
        })
      );
    });

    // Verify button resets and is enabled
    expect(loadOlderButton).not.toBeDisabled();
  });
});

describe("R34.B1 Operational & Financial Visibility Suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Admin User", role: "creche_admin", crecheId: 1 },
      isLoading: false,
    });
  });

  // EVO-R34-001: Creche Dashboard financial attention banner
  it("renders financial attention alert on CrecheDashboard when awaiting PIX receipts count > 0", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/financial/invoices/awaiting-count")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 3 }),
        });
      }
      if (url.includes("/feed")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ posts: [], nextCursor: null }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Dashboard />);

    const alertText = await screen.findByText(/3 comprovantes aguardando validação/i);
    expect(alertText).toBeInTheDocument();

    const link = screen.getByRole("alert").closest("a");
    expect(link).toHaveAttribute("href", "/financial?tab=receipts");

    global.fetch = originalFetch;
  });

  it("does not render financial attention alert on CrecheDashboard when awaiting count is 0", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/financial/invoices/awaiting-count")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 0 }),
        });
      }
      if (url.includes("/feed")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ posts: [], nextCursor: null }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText(/comprovante.*aguardando validação/i)).not.toBeInTheDocument();
    });

    global.fetch = originalFetch;
  });

  it("does not render financial attention alert on CrecheDashboard when query fails", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/financial/invoices/awaiting-count")) {
        return Promise.reject(new Error("Network failure"));
      }
      if (url.includes("/feed")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ posts: [], nextCursor: null }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText(/comprovante.*aguardando validação/i)).not.toBeInTheDocument();
    });

    global.fetch = originalFetch;
  });

  // EVO-R34-002: Staff Tasks medical attention badges
  it("renders Alergia and Cuidados especiais badges on StaffTasks for pets with medical flags", async () => {
    (apiClientModule.useListPets as any).mockReturnValue({
      data: {
        items: [
          { id: 10, name: "Bob", tutorId: 1, isCheckedIn: true, allergies: "Frango", specialNeeds: "Medicação pós-cirúrgica" },
          { id: 20, name: "Mel", tutorId: 2, isCheckedIn: true, allergies: null, specialNeeds: null },
        ],
      },
      isLoading: false,
    });

    (apiClientModule.useListTasks as any).mockReturnValue({
      data: [
        {
          id: 1,
          petId: 10,
          petName: "Bob",
          title: "Alimentação especial",
          type: "feeding",
          priority: "high",
          scheduledFor: "2026-08-26T12:00:00.000Z",
          status: "pending",
          tutorId: 1,
          tutorName: "Maria Tutora",
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<StaffTasks />);

    const allergyBadge = await screen.findByText("Alergia");
    const specialNeedsBadge = await screen.findByText("Cuidados especiais");

    expect(allergyBadge).toBeInTheDocument();
    expect(specialNeedsBadge).toBeInTheDocument();
  });

  it("does not render medical badges on StaffTasks when pet has no allergies or specialNeeds", async () => {
    (apiClientModule.useListPets as any).mockReturnValue({
      data: {
        items: [
          { id: 20, name: "Mel", tutorId: 2, allergies: "  ", specialNeeds: null },
        ],
      },
      isLoading: false,
    });

    (apiClientModule.useListTasks as any).mockReturnValue({
      data: [
        {
          id: 2,
          petId: 20,
          petName: "Mel",
          title: "Passeio da tarde",
          type: "walk",
          priority: "medium",
          scheduledFor: "2026-08-26T15:00:00.000Z",
          status: "pending",
          tutorId: 2,
          tutorName: "João Tutor",
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<StaffTasks />);

    expect(screen.queryByText("Alergia")).not.toBeInTheDocument();
    expect(screen.queryByText("Cuidados especiais")).not.toBeInTheDocument();
  });
});
