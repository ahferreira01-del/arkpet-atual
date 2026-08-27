import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent } from "./utils";
import FinancialDashboard from "../pages/financial/index";
import * as useFinancialModule from "../hooks/use-financial";

// Recharts ResponsiveContainer requires a constructable ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Admin Teste", email: "admin@arkpet.test", role: "creche_admin", crecheId: 1 },
    isLoading: false,
  }),
}));

vi.mock("../hooks/use-financial", async () => {
  const actual: any = await vi.importActual("../hooks/use-financial");
  return {
    ...actual,
    useListAuditLogs: vi.fn(),
    useDashboardCashFlow: vi.fn(),
    useDashboardDre: vi.fn(),
    useCreche: vi.fn(),
    useUpdateCrecheSettings: vi.fn(),
    useListAllInvoices: vi.fn(),
    useApproveReceipt: vi.fn(),
    useVoidInvoice: vi.fn(),
    useRefundInvoice: vi.fn(),
  };
});

// Mock wouter useSearch and useLocation
let mockSearchString = "?tab=cashflow";
vi.mock("wouter", async () => {
  const actual: any = await vi.importActual("wouter");
  return {
    ...actual,
    useSearch: () => mockSearchString,
    useLocation: () => ["/financial", vi.fn()],
  };
});

describe("Financial Tabs Characterization Tests (R33F.B1, R33F.B2 & R33F.B3)", () => {
  const mockUpdateCrecheSettingsMutate = vi.fn();
  const mockApproveReceiptMutate = vi.fn();
  const mockVoidInvoiceMutate = vi.fn();
  const mockRefundInvoiceMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock data for CashFlow
    (useFinancialModule.useDashboardCashFlow as any).mockReturnValue({
      data: [
        { date: "2026-08-01", total: 10000, type: "income" },
        { date: "2026-08-02", total: 4000, type: "expense" },
      ],
      isLoading: false,
    });
    (useFinancialModule.useDashboardDre as any).mockReturnValue({
      data: {},
      isLoading: false,
    });

    // Default mock data for AuditTab
    (useFinancialModule.useListAuditLogs as any).mockReturnValue({
      data: [
        {
          id: 1,
          action: "INVOICE_PAID",
          userName: "Admin Teste",
          createdAt: "2026-08-20T10:00:00.000Z",
          details: "Fatura #101 recebida manualmente",
        },
      ],
      isLoading: false,
    });
    (useFinancialModule.useCreche as any).mockReturnValue({
      data: { id: 1, name: "Creche Pet Feliz", auditEnabled: true },
      isLoading: false,
    });
    (useFinancialModule.useUpdateCrecheSettings as any).mockReturnValue({
      mutate: mockUpdateCrecheSettingsMutate,
      isPending: false,
    });

    // Default mock data for ReceiptsTab
    (useFinancialModule.useListAllInvoices as any).mockReturnValue({
      data: {
        data: [
          {
            id: 101,
            tutorName: "Carlos Silva",
            amount: 15000,
            dueDate: "2026-08-25T12:00:00.000Z",
            status: "awaiting_confirmation",
            receiptPhotoPath: "receipts/rec_101.jpg",
          },
        ],
      },
      isLoading: false,
    });
    (useFinancialModule.useApproveReceipt as any).mockReturnValue({
      mutate: mockApproveReceiptMutate,
      isPending: false,
    });
    (useFinancialModule.useVoidInvoice as any).mockReturnValue({
      mutate: mockVoidInvoiceMutate,
      isPending: false,
    });
    (useFinancialModule.useRefundInvoice as any).mockReturnValue({
      mutate: mockRefundInvoiceMutate,
      isPending: false,
    });
  });

  it("renders CashFlow financial summary with totals and evolution chart", async () => {
    mockSearchString = "?tab=cashflow";
    renderWithProviders(<FinancialDashboard />);

    // Assert summary cards are visible
    expect(screen.getByText("Entradas")).toBeInTheDocument();
    expect(screen.getByText("Saídas")).toBeInTheDocument();
    expect(screen.getByText("Saldo Líquido")).toBeInTheDocument();

    // Assert formatted monetary values
    expect(screen.getByText("R$ 100,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 60,00")).toBeInTheDocument();

    // Assert chart section heading
    expect(screen.getByText("Evolução Diária")).toBeInTheDocument();
  });

  it("renders Audit financial tab with representative audit records", async () => {
    mockSearchString = "?tab=audit";
    renderWithProviders(<FinancialDashboard />);

    // Assert audit trail title & records
    expect(screen.getByText("Trilha de Auditoria Financeira")).toBeInTheDocument();
    expect(screen.getByText("Desativar Auditoria")).toBeInTheDocument();
    expect(screen.getAllByText("INVOICE_PAID").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Admin Teste").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Fatura #101 recebida manualmente").length).toBeGreaterThanOrEqual(1);
  });

  it("triggers audit setting toggle mutation when toggle button is clicked", async () => {
    mockSearchString = "?tab=audit";
    renderWithProviders(<FinancialDashboard />);

    const toggleBtn = screen.getByText("Desativar Auditoria");
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);

    expect(mockUpdateCrecheSettingsMutate).toHaveBeenCalledWith(
      { auditEnabled: false },
      expect.any(Object)
    );
  });

  it("renders Receipts financial tab with pending confirmation items and formatted currency", async () => {
    mockSearchString = "?tab=receipts";
    renderWithProviders(<FinancialDashboard />);

    expect(screen.getByText("Comprovantes Pendentes de Aprovação")).toBeInTheDocument();
    expect(screen.getAllByText("Carlos Silva").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("R$ 150,00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ver Comprovante").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Aprovar").length).toBeGreaterThanOrEqual(1);
  });

  it("opens receipt preview image modal from pending receipt", async () => {
    mockSearchString = "?tab=receipts";
    renderWithProviders(<FinancialDashboard />);

    const previewButtons = screen.getAllByText("Ver Comprovante");
    expect(previewButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(previewButtons[0]);

    expect(screen.getByText("Comprovante de Pagamento")).toBeInTheDocument();
    const img = screen.getByAltText("Comprovante");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src");
  });

  it("triggers receipt approval mutation with expected invoice id", async () => {
    mockSearchString = "?tab=receipts";
    renderWithProviders(<FinancialDashboard />);

    const approveButtons = screen.getAllByText("Aprovar");
    expect(approveButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(approveButtons[0]);

    expect(mockApproveReceiptMutate).toHaveBeenCalledWith(
      101,
      expect.any(Object)
    );
  });

  it("renders Defaulters financial tab with overdue invoices, daysLate calculation and total overdue card", async () => {
    mockSearchString = "?tab=defaulters";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));

    (useFinancialModule.useListAllInvoices as any).mockReturnValue({
      data: {
        data: [
          {
            id: 201,
            tutorName: "Mariana Souza",
            amount: 25000,
            dueDate: "2026-08-20",
            status: "overdue",
          },
          {
            id: 202,
            tutorName: "Bruno Lima",
            amount: 15000,
            dueDate: "2026-08-24",
            status: "pending",
          },
          {
            id: 203,
            tutorName: "Cliente Em Dia",
            amount: 50000,
            dueDate: "2026-08-28",
            status: "pending",
          },
        ],
      },
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    // Total in default card
    expect(screen.getByText("Total em Inadimplência")).toBeInTheDocument();
    expect(screen.getByText("R$ 400,00")).toBeInTheDocument();

    // Table title & overdue rows
    expect(screen.getByText("Faturas Inadimplentes")).toBeInTheDocument();
    expect(screen.getAllByText("Mariana Souza").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Bruno Lima").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Cliente Em Dia")).not.toBeInTheDocument();

    // Days late calculations
    expect(screen.getAllByText("6 dias").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("2 dias").length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
  });

  it("opens WhatsApp collection link with encoded message for overdue invoice", async () => {
    mockSearchString = "?tab=defaulters";
    const mockOpen = vi.spyOn(window, "open").mockImplementation(() => null as any);

    (useFinancialModule.useListAllInvoices as any).mockReturnValue({
      data: {
        data: [
          {
            id: 201,
            tutorName: "Mariana Souza",
            amount: 25000,
            dueDate: "2026-08-20",
            status: "overdue",
          },
        ],
      },
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    const cobrarButtons = screen.getAllByText("Cobrar");
    expect(cobrarButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(cobrarButtons[0]);

    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/?text=Ol%C3%A1%20Mariana%20Souza%2C%20notamos%20que%20h%C3%A1%20uma%20fatura%20em%20aberto%20no%20valor%20de%20"),
      "_blank"
    );

    mockOpen.mockRestore();
  });

  it("does not trigger void mutation when cancellation confirmation is denied", async () => {
    mockSearchString = "?tab=defaulters";
    const mockConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    (useFinancialModule.useListAllInvoices as any).mockReturnValue({
      data: {
        data: [
          {
            id: 201,
            tutorName: "Mariana Souza",
            amount: 25000,
            dueDate: "2026-08-20",
            status: "overdue",
          },
        ],
      },
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    const cancelarButtons = screen.getAllByText("Cancelar");
    expect(cancelarButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(cancelarButtons[0]);

    expect(mockConfirm).toHaveBeenCalledWith("Tem certeza que deseja cancelar esta fatura?");
    expect(mockVoidInvoiceMutate).not.toHaveBeenCalled();

    mockConfirm.mockRestore();
  });

  it("triggers void invoice mutation when cancellation confirmation is accepted", async () => {
    mockSearchString = "?tab=defaulters";
    const mockConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    (useFinancialModule.useListAllInvoices as any).mockReturnValue({
      data: {
        data: [
          {
            id: 201,
            tutorName: "Mariana Souza",
            amount: 25000,
            dueDate: "2026-08-20",
            status: "overdue",
          },
        ],
      },
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    const cancelarButtons = screen.getAllByText("Cancelar");
    expect(cancelarButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(cancelarButtons[0]);

    expect(mockConfirm).toHaveBeenCalledWith("Tem certeza que deseja cancelar esta fatura?");
    expect(mockVoidInvoiceMutate).toHaveBeenCalledWith(
      201,
      expect.any(Object)
    );

    mockConfirm.mockRestore();
  });
});
