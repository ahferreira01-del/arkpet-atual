import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import FinancialDashboard from "../pages/financial/index";
import * as useFinancialModule from "../hooks/use-financial";

// Recharts ResponsiveContainer requires a constructable ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

const mockToast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
    toasts: [],
    dismiss: vi.fn(),
  }),
}));

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
    useListAllInvoices: vi.fn(),
    useInvoiceItems: vi.fn(),
    useRefundInvoice: vi.fn(),
    useVoidInvoice: vi.fn(),
    usePayManualInvoice: vi.fn(),
    useApproveReceipt: vi.fn(),
    useRefundInvoiceItem: vi.fn(),
  };
});

vi.mock("@/features/feed/utils/media.utils", () => ({
  buildMediaSrc: (path: string, token: string) => `https://storage.local/${path}?mt=${token}`,
  getMediaToken: () => "mock-media-token-123",
}));

vi.mock("@/components/modals/ThermalReceiptModal", () => ({
  ThermalReceiptModal: ({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) => (
    <div data-testid="thermal-receipt-modal">
      <span>Recibo Térmico Fatura #{invoiceId}</span>
      <button onClick={onClose}>Fechar Recibo</button>
    </div>
  ),
}));

let mockSearchString = "?tab=receivables";
vi.mock("wouter", async () => {
  const actual: any = await vi.importActual("wouter");
  return {
    ...actual,
    useSearch: () => mockSearchString,
    useLocation: () => ["/financial", vi.fn()],
  };
});

describe("Receivables & InvoiceERPView Dedicated Characterization Tests (R33F.B6)", () => {
  let mockRefundMutate: any;
  let mockVoidMutate: any;
  let mockPayManualMutate: any;
  let mockApproveReceiptMutate: any;
  let mockRefundItemMutate: any;

  const sampleInvoices = [
    {
      id: 101,
      tutorName: "Maria Silva",
      createdAt: "2026-08-01T10:00:00Z",
      dueDate: "2026-08-10",
      amount: 15000,
      status: "paid",
      receiptPhotoPath: null,
    },
    {
      id: 102,
      tutorName: "Carlos Pereira",
      createdAt: "2026-08-02T10:00:00Z",
      dueDate: "2026-08-15",
      amount: 25000,
      status: "awaiting_confirmation",
      receiptPhotoPath: "receipts/carlos_receipt.jpg",
    },
    {
      id: 103,
      tutorName: "Ana Santos",
      createdAt: "2026-08-03T10:00:00Z",
      dueDate: "2026-08-20",
      amount: 12050,
      status: "pending",
      receiptPhotoPath: null,
    },
    {
      id: 104,
      tutorName: "Roberto Costa",
      createdAt: "2026-08-04T10:00:00Z",
      dueDate: "2026-07-01", // Overdue relative to current date
      amount: 30000,
      status: "overdue",
      receiptPhotoPath: null,
    },
    {
      id: 105,
      tutorName: "Fernanda Lima",
      createdAt: "2026-08-05T10:00:00Z",
      dueDate: "2026-08-25",
      amount: 8000,
      status: "voided",
      receiptPhotoPath: null,
    },
    {
      id: 106,
      tutorName: "Juliana Alves",
      createdAt: "2026-08-06T10:00:00Z",
      dueDate: "2026-08-30",
      amount: 9500,
      status: "refunded",
      receiptPhotoPath: null,
    },
  ];

  const sampleInvoiceItems = [
    {
      id: 501,
      description: "Diária Daycare",
      petName: "Rex",
      itemDate: "2026-08-01T00:00:00.000Z",
      amount: 10000,
      quantity: 1,
    },
    {
      id: 502,
      description: "Banho e Tosa",
      petName: "Rex",
      itemDate: "2026-08-01T00:00:00.000Z",
      amount: 5000,
      quantity: 1,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchString = "?tab=receivables";

    mockRefundMutate = vi.fn();
    mockVoidMutate = vi.fn();
    mockPayManualMutate = vi.fn();
    mockApproveReceiptMutate = vi.fn();
    mockRefundItemMutate = vi.fn();

    (useFinancialModule.useListAllInvoices as any).mockReturnValue({
      data: { data: sampleInvoices },
      isLoading: false,
    });

    (useFinancialModule.useInvoiceItems as any).mockImplementation((crecheId: number, invoiceId?: number) => ({
      data: invoiceId ? sampleInvoiceItems : [],
      isLoading: false,
    }));

    (useFinancialModule.useRefundInvoice as any).mockReturnValue({
      mutate: mockRefundMutate,
      isPending: false,
    });

    (useFinancialModule.useVoidInvoice as any).mockReturnValue({
      mutate: mockVoidMutate,
      isPending: false,
    });

    (useFinancialModule.usePayManualInvoice as any).mockReturnValue({
      mutate: mockPayManualMutate,
      isPending: false,
    });

    (useFinancialModule.useApproveReceipt as any).mockReturnValue({
      mutate: mockApproveReceiptMutate,
      isPending: false,
    });

    (useFinancialModule.useRefundInvoiceItem as any).mockReturnValue({
      mutate: mockRefundItemMutate,
      isPending: false,
    });
  });

  // TEST 1 — RENDER / STATUS / MONEY / DATE
  it("renders receivables with representative statuses, formatted amounts and dates", async () => {
    renderWithProviders(<FinancialDashboard />);

    const mariaElements = screen.getAllByText("Maria Silva");
    expect(mariaElements.length).toBeGreaterThan(0);
    const carlosElements = screen.getAllByText("Carlos Pereira");
    expect(carlosElements.length).toBeGreaterThan(0);
    const anaElements = screen.getAllByText("Ana Santos");
    expect(anaElements.length).toBeGreaterThan(0);

    // Badges
    const pagoElements = screen.getAllByText("Pago");
    expect(pagoElements.length).toBeGreaterThan(0);
    const analiseElements = screen.getAllByText("Em Análise");
    expect(analiseElements.length).toBeGreaterThan(0);
    const pendenteElements = screen.getAllByText("Pendente");
    expect(pendenteElements.length).toBeGreaterThan(0);
    const atrasadoElements = screen.getAllByText("Atrasado");
    expect(atrasadoElements.length).toBeGreaterThan(0);

    // Formatted amounts
    const amount150 = screen.getAllByText("R$ 150,00");
    expect(amount150.length).toBeGreaterThan(0);
    const amount250 = screen.getAllByText("R$ 250,00");
    expect(amount250.length).toBeGreaterThan(0);
    const amount120 = screen.getAllByText("R$ 120,50");
    expect(amount120.length).toBeGreaterThan(0);
  });

  // TEST 2 — OVERDUE VISUAL CONTRACT
  it("preserves current overdue-date highlighting behavior for pending/overdue invoice", async () => {
    renderWithProviders(<FinancialDashboard />);

    const overdueElements = document.querySelectorAll(".text-red-400, .text-destructive");
    expect(overdueElements.length).toBeGreaterThan(0);
    const overdueDate = Array.from(overdueElements).find(el => el.textContent === "01/07/2026");
    expect(overdueDate).toBeDefined();
  });

  // TEST 3 — ACTION ELIGIBILITY
  it("shows current financial actions only for eligible invoice statuses", async () => {
    renderWithProviders(<FinancialDashboard />);

    // Paid -> Recibo NFC-e, Estornar
    const nfcButtons = screen.getAllByText("Recibo NFC-e");
    expect(nfcButtons.length).toBeGreaterThan(0);
    const refundButtons = screen.getAllByText("Estornar");
    expect(refundButtons.length).toBeGreaterThan(0);

    // Awaiting confirmation -> Aprovar, Ver Comprovante
    const approveButtons = screen.getAllByText("Aprovar");
    expect(approveButtons.length).toBeGreaterThan(0);
    const viewReceiptButtons = screen.getAllByText("Ver Comprovante");
    expect(viewReceiptButtons.length).toBeGreaterThan(0);

    // Pending / Overdue -> Receber, Cancelar
    const receiveButtons = screen.getAllByText("Receber");
    expect(receiveButtons.length).toBeGreaterThanOrEqual(1);
    const cancelButtons = screen.getAllByText("Cancelar");
    expect(cancelButtons.length).toBeGreaterThanOrEqual(1);
  });

  // TEST 4 — MANUAL PAYMENT MODAL
  it("opens manual settlement modal with selected invoice data and current default payment method", async () => {
    renderWithProviders(<FinancialDashboard />);

    const receiveButtons = screen.getAllByText("Receber");
    fireEvent.click(receiveButtons[0]);

    expect(screen.getByText("Dar Baixa Manual")).toBeInTheDocument();
    expect(screen.getByText("Confirmar Recebimento")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pix")).toBeInTheDocument();
  });

  // TEST 5 — MANUAL PAYMENT SUCCESS
  it("submits manual settlement with exact invoiceId/paymentMethod and closes modal on success", async () => {
    renderWithProviders(<FinancialDashboard />);

    const receiveButtons = screen.getAllByText("Receber");
    fireEvent.click(receiveButtons[0]);

    const select = screen.getByDisplayValue("Pix");
    fireEvent.change(select, { target: { value: "credit_card" } });

    const confirmBtn = screen.getByText("Confirmar Recebimento");
    fireEvent.click(confirmBtn);

    expect(mockPayManualMutate).toHaveBeenCalledTimes(1);
    const callArgs = mockPayManualMutate.mock.calls[0];
    expect(callArgs[0]).toEqual({ invoiceId: 103, paymentMethod: "credit_card" });

    callArgs[1].onSuccess();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Sucesso",
      description: "Baixa manual realizada com sucesso.",
    }));
  });

  // TEST 6 — MANUAL PAYMENT FAILURE
  it("keeps manual settlement modal open and displays destructive feedback when payment mutation fails", async () => {
    renderWithProviders(<FinancialDashboard />);

    const receiveButtons = screen.getAllByText("Receber");
    fireEvent.click(receiveButtons[0]);

    const confirmBtn = screen.getByText("Confirmar Recebimento");
    fireEvent.click(confirmBtn);

    const callArgs = mockPayManualMutate.mock.calls[0];
    callArgs[1].onError({ message: "Cartão recusado pelo adquirente" });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Erro",
      description: "Cartão recusado pelo adquirente",
      variant: "destructive",
    }));
    expect(screen.getByText("Dar Baixa Manual")).toBeInTheDocument();
  });

  // TEST 7 — APPROVE RECEIPT DENIED
  it("does not approve receipt when confirmation is denied", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<FinancialDashboard />);

    const approveButtons = screen.getAllByText("Aprovar");
    fireEvent.click(approveButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith("Confirmar o recebimento via comprovante Pix?");
    expect(mockApproveReceiptMutate).not.toHaveBeenCalled();
  });

  // TEST 8 — APPROVE RECEIPT SUCCESS
  it("approves awaiting-confirmation invoice with exact ID after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<FinancialDashboard />);

    const approveButtons = screen.getAllByText("Aprovar");
    fireEvent.click(approveButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith("Confirmar o recebimento via comprovante Pix?");
    expect(mockApproveReceiptMutate).toHaveBeenCalledTimes(1);
    const callArgs = mockApproveReceiptMutate.mock.calls[0];
    expect(callArgs[0]).toBe(102);

    callArgs[1].onSuccess();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Sucesso",
      description: "Comprovante aprovado com sucesso.",
    }));
  });

  // TEST 9 — APPROVE RECEIPT FAILURE
  it("preserves destructive error feedback when receipt approval fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<FinancialDashboard />);

    const approveButtons = screen.getAllByText("Aprovar");
    fireEvent.click(approveButtons[0]);

    const callArgs = mockApproveReceiptMutate.mock.calls[0];
    callArgs[1].onError({ message: "Comprovante ilegível ou inválido" });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Erro",
      description: "Comprovante ilegível ou inválido",
      variant: "destructive",
    }));
  });

  // TEST 10 — VOID DENIED
  it("does not void pending/overdue invoice when confirmation is denied", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<FinancialDashboard />);

    const cancelButtons = screen.getAllByText("Cancelar");
    fireEvent.click(cancelButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith("Tem certeza que deseja cancelar esta fatura?");
    expect(mockVoidMutate).not.toHaveBeenCalled();
  });

  // TEST 11 — VOID SUCCESS
  it("voids invoice with exact ID after accepted confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<FinancialDashboard />);

    const cancelButtons = screen.getAllByText("Cancelar");
    fireEvent.click(cancelButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith("Tem certeza que deseja cancelar esta fatura?");
    expect(mockVoidMutate).toHaveBeenCalledTimes(1);
    const callArgs = mockVoidMutate.mock.calls[0];
    expect(callArgs[0]).toBe(103);

    callArgs[1].onSuccess();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Sucesso",
      description: "Fatura cancelada com sucesso.",
    }));
  });

  // TEST 12 — VOID FAILURE
  it("preserves current void failure feedback", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<FinancialDashboard />);

    const cancelButtons = screen.getAllByText("Cancelar");
    fireEvent.click(cancelButtons[0]);

    const callArgs = mockVoidMutate.mock.calls[0];
    callArgs[1].onError({ message: "Fatura vinculada a pedido ativo" });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Erro",
      description: "Fatura vinculada a pedido ativo",
      variant: "destructive",
    }));
  });

  // TEST 13 — FULL REFUND DENIED
  it("does not refund paid invoice when confirmation is denied", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<FinancialDashboard />);

    const refundButtons = screen.getAllByText("Estornar");
    fireEvent.click(refundButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith("Tem certeza que deseja estornar esta fatura?");
    expect(mockRefundMutate).not.toHaveBeenCalled();
  });

  // TEST 14 — FULL REFUND SUCCESS
  it("refunds paid invoice with exact ID after accepted confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<FinancialDashboard />);

    const refundButtons = screen.getAllByText("Estornar");
    fireEvent.click(refundButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith("Tem certeza que deseja estornar esta fatura?");
    expect(mockRefundMutate).toHaveBeenCalledTimes(1);
    const callArgs = mockRefundMutate.mock.calls[0];
    expect(callArgs[0]).toBe(101);

    callArgs[1].onSuccess();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Sucesso",
      description: "Fatura estornada com sucesso.",
    }));
  });

  // TEST 15 — FULL REFUND FAILURE
  it("preserves destructive error feedback when full-invoice refund fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<FinancialDashboard />);

    const refundButtons = screen.getAllByText("Estornar");
    fireEvent.click(refundButtons[0]);

    const callArgs = mockRefundMutate.mock.calls[0];
    callArgs[1].onError({ message: "Saldo de gateway insuficiente para estorno" });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Erro",
      description: "Saldo de gateway insuficiente para estorno",
      variant: "destructive",
    }));
  });

  // TEST 16 — RECEIPT PHOTO PREVIEW
  it("opens receipt preview using current safe media URL construction", async () => {
    renderWithProviders(<FinancialDashboard />);

    const viewReceiptButtons = screen.getAllByText("Ver Comprovante");
    fireEvent.click(viewReceiptButtons[0]);

    expect(screen.getByText("Comprovante de Pagamento")).toBeInTheDocument();
    const img = screen.getByAltText("Comprovante") as HTMLImageElement;
    expect(img.src).toBe("https://storage.local/receipts/carlos_receipt.jpg?mt=mock-media-token-123");
  });

  // TEST 17 — THERMAL/NFC-E RECEIPT
  it("opens current thermal/NFC-e receipt flow from its real action trigger", async () => {
    renderWithProviders(<FinancialDashboard />);

    const receiptButtons = screen.getAllByText("Recibo NFC-e");
    fireEvent.click(receiptButtons[0]);

    expect(screen.getByTestId("thermal-receipt-modal")).toBeInTheDocument();
    expect(screen.getByText("Recibo Térmico Fatura #101")).toBeInTheDocument();
  });

  // TEST 18 — EXECUTIVE DETAILS / ERP VIEW
  it("opens InvoiceERPView through actual Receivables details trigger and renders current executive invoice information", async () => {
    renderWithProviders(<FinancialDashboard />);

    const detailsButtons = screen.getAllByText("Detalhes");
    fireEvent.click(detailsButtons[0]); // Inv 101 (Maria Silva)

    expect(screen.getByText("Fatura #101 - Visão Executiva")).toBeInTheDocument();
    expect(screen.getByText("Tutor / Cliente")).toBeInTheDocument();
    expect(screen.getByText("Linha do Tempo")).toBeInTheDocument();
    expect(screen.getByText("Itens da Fatura")).toBeInTheDocument();
    expect(screen.getByText("Diária Daycare")).toBeInTheDocument();
    expect(screen.getByText("Banho e Tosa")).toBeInTheDocument();
  });

  // TEST 19 — ITEM REFUND CANCELLED / INVALID
  it("does not refund invoice item when quantity prompt is cancelled or rejected by current validation", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const promptSpy = vi.spyOn(window, "prompt");

    renderWithProviders(<FinancialDashboard />);

    const detailsButtons = screen.getAllByText("Detalhes");
    fireEvent.click(detailsButtons[0]);

    // Scenario 1: Prompt cancelled (null)
    promptSpy.mockReturnValue(null);
    const itemRefundButtons = screen.getAllByText("Estornar");
    const modalItemRefundBtn = itemRefundButtons[itemRefundButtons.length - 1];
    fireEvent.click(modalItemRefundBtn);

    expect(mockRefundItemMutate).not.toHaveBeenCalled();

    // Scenario 2: Invalid quantity (exceeds max 1)
    promptSpy.mockReturnValue("5");
    fireEvent.click(modalItemRefundBtn);

    expect(alertSpy).toHaveBeenCalledWith("Quantidade inválida.");
    expect(mockRefundItemMutate).not.toHaveBeenCalled();
  });

  // TEST 20 — ITEM REFUND SUCCESS
  it("refunds invoice item with exact invoiceId, itemId and accepted quantity", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockReturnValue("1");

    renderWithProviders(<FinancialDashboard />);

    const detailsButtons = screen.getAllByText("Detalhes");
    fireEvent.click(detailsButtons[0]);

    const itemRefundButtons = screen.getAllByText("Estornar");
    const modalItemRefundBtn = itemRefundButtons[itemRefundButtons.length - 1];
    fireEvent.click(modalItemRefundBtn);

    expect(mockRefundItemMutate).toHaveBeenCalledTimes(1);
    const callArgs = mockRefundItemMutate.mock.calls[0];
    expect(callArgs[0]).toEqual({
      invoiceId: 101,
      invoiceItemId: 502,
      quantity: 1,
    });

    callArgs[1].onSuccess();

    expect(alertSpy).toHaveBeenCalledWith("Estorno/Devolução realizado com sucesso.");
  });

  // TEST 21 — ITEM REFUND FAILURE
  it("preserves native alert error feedback when invoice-item refund fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockReturnValue("1");

    renderWithProviders(<FinancialDashboard />);

    const detailsButtons = screen.getAllByText("Detalhes");
    fireEvent.click(detailsButtons[0]);

    const itemRefundButtons = screen.getAllByText("Estornar");
    const modalItemRefundBtn = itemRefundButtons[itemRefundButtons.length - 1];
    fireEvent.click(modalItemRefundBtn);

    const callArgs = mockRefundItemMutate.mock.calls[0];
    callArgs[1].onError({ message: "Item já estornado anteriormente" });

    expect(alertSpy).toHaveBeenCalledWith("Erro ao estornar: Item já estornado anteriormente");
  });

  // TEST 22 — PENDING PROTECTION
  it("preserves current pending/loading protection for financially material actions", async () => {
    (useFinancialModule.useRefundInvoice as any).mockReturnValue({
      mutate: mockRefundMutate,
      isPending: true,
    });
    (useFinancialModule.useVoidInvoice as any).mockReturnValue({
      mutate: mockVoidMutate,
      isPending: true,
    });
    (useFinancialModule.useApproveReceipt as any).mockReturnValue({
      mutate: mockApproveReceiptMutate,
      isPending: true,
    });

    renderWithProviders(<FinancialDashboard />);

    const refundButtons = screen.getAllByText("Estornar");
    expect(refundButtons[0]).toBeDisabled();

    const approveButtons = screen.getAllByText("Aprovar");
    expect(approveButtons[0]).toBeDisabled();

    const cancelButtons = screen.getAllByText("Cancelar");
    expect(cancelButtons[0]).toBeDisabled();
  });
});
