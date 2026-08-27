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
    useListOrders: vi.fn(),
    useUpdateOrderStatus: vi.fn(),
    useApproveReceipt: vi.fn(),
  };
});

let mockSearchString = "?tab=orders";
vi.mock("wouter", async () => {
  const actual: any = await vi.importActual("wouter");
  return {
    ...actual,
    useSearch: () => mockSearchString,
    useLocation: () => ["/financial", vi.fn()],
  };
});

describe("Orders Tab Dedicated Characterization Tests (R33F.B4)", () => {
  let mockUpdateStatusMutate: any;
  let mockApproveReceiptMutate: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchString = "?tab=orders";

    mockUpdateStatusMutate = vi.fn();
    mockApproveReceiptMutate = vi.fn();

    (useFinancialModule.useUpdateOrderStatus as any).mockReturnValue({
      mutate: mockUpdateStatusMutate,
      isPending: false,
    });

    (useFinancialModule.useApproveReceipt as any).mockReturnValue({
      mutate: mockApproveReceiptMutate,
      isPending: false,
    });
  });

  it("renders Orders financial tab with representative statuses, totals and expected actions", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          deliveryAddress: "Rua dos Pets, 123",
          deliveryFee: 1500,
          total: 8500,
          tutor: { name: "Ana Lima", phone: "11999998888" },
          items: [{ name: "Ração Premium", quantity: 1, totalPrice: 7000 }],
          invoiceStatus: "pending",
          invoiceId: 201,
          invoiceAmount: 8500,
        },
        {
          id: 102,
          status: "paid",
          deliveryMethod: "pickup",
          deliveryFee: 0,
          total: 4500,
          tutor: { name: "Bruno Costa" },
          items: [{ name: "Brinquedo Mordedor", quantity: 2, totalPrice: 4500 }],
          invoiceStatus: "paid",
        },
        {
          id: 103,
          status: "preparing",
          deliveryMethod: "delivery",
          deliveryAddress: "Av. Central, 456",
          deliveryFee: 1000,
          total: 6000,
          tutor: { name: "Carla Dias" },
          items: [{ name: "Shampoo Pet", quantity: 1, totalPrice: 5000 }],
          invoiceStatus: "paid",
        },
        {
          id: 104,
          status: "preparing",
          deliveryMethod: "pickup",
          deliveryFee: 0,
          total: 3000,
          tutor: { name: "Diego Ramos" },
          items: [{ name: "Petisco", quantity: 1, totalPrice: 3000 }],
          invoiceStatus: "paid",
        },
        {
          id: 105,
          status: "delivering",
          deliveryMethod: "delivery",
          deliveryAddress: "Rua Verde, 789",
          deliveryFee: 1200,
          total: 9200,
          tutor: { name: "Eduardo Rocha" },
          items: [{ name: "Cama Pet", quantity: 1, totalPrice: 8000 }],
          invoiceStatus: "paid",
        },
        {
          id: 106,
          status: "ready_for_pickup",
          deliveryMethod: "pickup",
          deliveryFee: 0,
          total: 2500,
          tutor: { name: "Fernanda Melo" },
          items: [{ name: "Coleira", quantity: 1, totalPrice: 2500 }],
          invoiceStatus: "paid",
        },
        {
          id: 107,
          status: "delivered",
          deliveryMethod: "delivery",
          deliveryFee: 1000,
          total: 5000,
          tutor: { name: "Gabriel Alves" },
          items: [{ name: "Guia", quantity: 1, totalPrice: 4000 }],
          invoiceStatus: "paid",
        },
        {
          id: 108,
          status: "cancelled",
          deliveryMethod: "pickup",
          deliveryFee: 0,
          total: 1000,
          tutor: { name: "Helena Prado" },
          items: [{ name: "Bolinha", quantity: 1, totalPrice: 1000 }],
          invoiceStatus: "cancelled",
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    expect(screen.getByText("Pedidos da Loja")).toBeInTheDocument();

    // Order 101 - pending_payment
    expect(screen.getByText("#101")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Ana Lima")).toBeInTheDocument();
    expect(screen.getByText("Rua dos Pets, 123")).toBeInTheDocument();
    expect(screen.getByText("Confirmar Pagamento")).toBeInTheDocument();
    expect(screen.getByText("Cancelar")).toBeInTheDocument();

    // Order 102 - paid
    expect(screen.getByText("#102")).toBeInTheDocument();
    expect(screen.getByText("Pago")).toBeInTheDocument();
    expect(screen.getByText("Iniciar Separação")).toBeInTheDocument();

    // Order 103 - preparing delivery
    expect(screen.getByText("#103")).toBeInTheDocument();
    expect(screen.getAllByText("Separando").length).toBe(2);
    expect(screen.getByText("Saiu p/ Entrega")).toBeInTheDocument();

    // Order 104 - preparing pickup
    expect(screen.getByText("#104")).toBeInTheDocument();
    expect(screen.getAllByText("Pronto p/ Retirada").length).toBe(2);

    // Order 105 - delivering & 106 - ready_for_pickup
    expect(screen.getByText("#105")).toBeInTheDocument();
    expect(screen.getByText("Em Rota")).toBeInTheDocument();
    expect(screen.getByText("#106")).toBeInTheDocument();
    expect(screen.getAllByText("Marcar Entregue").length).toBe(2);

    // Order 107 - delivered & 108 - cancelled
    expect(screen.getByText("#107")).toBeInTheDocument();
    expect(screen.getByText("Entregue")).toBeInTheDocument();
    expect(screen.getByText("#108")).toBeInTheDocument();
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
  });

  it("transitions paid order to preparing without payment modal when invoice is not pending", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 102,
          status: "paid",
          deliveryMethod: "pickup",
          total: 4500,
          tutor: { name: "Bruno Costa" },
          items: [{ name: "Brinquedo", quantity: 1, totalPrice: 4500 }],
          invoiceStatus: "paid",
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    const initBtn = screen.getByText("Iniciar Separação");
    fireEvent.click(initBtn);

    expect(screen.queryByText("Fatura em Aberto ⚠️")).not.toBeInTheDocument();
    expect(mockApproveReceiptMutate).not.toHaveBeenCalled();
    expect(mockUpdateStatusMutate).toHaveBeenCalledWith(
      { orderId: 102, status: "preparing" },
      expect.any(Object)
    );
  });

  it("cancels pending-payment order directly without opening payment modal", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          total: 8500,
          tutor: { name: "Ana Lima" },
          items: [{ name: "Ração", quantity: 1, totalPrice: 8500 }],
          invoiceStatus: "pending",
          invoiceId: 201,
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    const cancelBtn = screen.getByText("Cancelar");
    fireEvent.click(cancelBtn);

    expect(screen.queryByText("Fatura em Aberto ⚠️")).not.toBeInTheDocument();
    expect(mockApproveReceiptMutate).not.toHaveBeenCalled();
    expect(mockUpdateStatusMutate).toHaveBeenCalledWith(
      { orderId: 101, status: "cancelled" },
      expect.any(Object)
    );
  });

  it("opens pending-invoice modal before advancing an order", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          total: 8500,
          tutor: { name: "Ana Lima" },
          items: [{ name: "Ração", quantity: 1, totalPrice: 8500 }],
          invoiceStatus: "pending",
          invoiceId: 201,
          invoiceAmount: 8500,
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    const confirmPaymentBtn = screen.getByText("Confirmar Pagamento");
    fireEvent.click(confirmPaymentBtn);

    expect(screen.getByText("Fatura em Aberto ⚠️")).toBeInTheDocument();
    expect(screen.getByText("Sim, confirmar pagamento e dar baixa na fatura")).toBeInTheDocument();
    expect(screen.getByText("Não, vai pagar depois (manter fatura aberta)")).toBeInTheDocument();
    expect(screen.getByText("Cancelar alteração")).toBeInTheDocument();

    expect(mockApproveReceiptMutate).not.toHaveBeenCalled();
    expect(mockUpdateStatusMutate).not.toHaveBeenCalled();
  });

  it("approves pending invoice and advances order only after payment succeeds", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          total: 8500,
          tutor: { name: "Ana Lima" },
          items: [{ name: "Ração", quantity: 1, totalPrice: 8500 }],
          invoiceStatus: "pending",
          invoiceId: 201,
          invoiceAmount: 8500,
        },
      ],
      isLoading: false,
    });

    mockApproveReceiptMutate.mockImplementation((id: number, options?: any) => {
      expect(mockUpdateStatusMutate).not.toHaveBeenCalled();
      if (options?.onSuccess) options.onSuccess({ success: true });
    });

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByText("Confirmar Pagamento"));
    expect(screen.getByText("Fatura em Aberto ⚠️")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Sim, confirmar pagamento e dar baixa na fatura"));

    expect(mockApproveReceiptMutate).toHaveBeenCalledWith(201, expect.any(Object));
    expect(mockUpdateStatusMutate).toHaveBeenCalledWith(
      { orderId: 101, status: "paid" },
      expect.any(Object)
    );
  });

  it("does not advance order when payment confirmation fails", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          total: 8500,
          tutor: { name: "Ana Lima" },
          items: [{ name: "Ração", quantity: 1, totalPrice: 8500 }],
          invoiceStatus: "pending",
          invoiceId: 201,
          invoiceAmount: 8500,
        },
      ],
      isLoading: false,
    });

    mockApproveReceiptMutate.mockImplementation((id: number, options?: any) => {
      if (options?.onError) options.onError(new Error("Cartão recusado"));
    });

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByText("Confirmar Pagamento"));
    fireEvent.click(screen.getByText("Sim, confirmar pagamento e dar baixa na fatura"));

    expect(mockApproveReceiptMutate).toHaveBeenCalledWith(201, expect.any(Object));
    expect(mockUpdateStatusMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Fatura em Aberto ⚠️")).toBeInTheDocument();
  });

  it("advances order without approving receipt when user chooses to keep invoice open", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          total: 8500,
          tutor: { name: "Ana Lima" },
          items: [{ name: "Ração", quantity: 1, totalPrice: 8500 }],
          invoiceStatus: "pending",
          invoiceId: 201,
          invoiceAmount: 8500,
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByText("Confirmar Pagamento"));
    fireEvent.click(screen.getByText("Não, vai pagar depois (manter fatura aberta)"));

    expect(mockApproveReceiptMutate).not.toHaveBeenCalled();
    expect(mockUpdateStatusMutate).toHaveBeenCalledWith(
      { orderId: 101, status: "paid" },
      expect.any(Object)
    );
  });

  it("preserves current partial-success behavior when payment succeeds but status update fails", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          total: 8500,
          tutor: { name: "Ana Lima" },
          items: [{ name: "Ração", quantity: 1, totalPrice: 8500 }],
          invoiceStatus: "pending",
          invoiceId: 201,
          invoiceAmount: 8500,
        },
      ],
      isLoading: false,
    });

    mockApproveReceiptMutate.mockImplementation((id: number, options?: any) => {
      if (options?.onSuccess) options.onSuccess({ success: true });
    });

    mockUpdateStatusMutate.mockImplementation((payload: any, options?: any) => {
      if (options?.onError) options.onError(new Error("Erro interno de status"));
    });

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByText("Confirmar Pagamento"));
    fireEvent.click(screen.getByText("Sim, confirmar pagamento e dar baixa na fatura"));

    expect(mockApproveReceiptMutate).toHaveBeenCalledWith(201, expect.any(Object));
    expect(mockUpdateStatusMutate).toHaveBeenCalledWith(
      { orderId: 101, status: "paid" },
      expect.any(Object)
    );
  });

  it("closes pending-invoice modal without triggering financial or status mutation", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          total: 8500,
          tutor: { name: "Ana Lima" },
          items: [{ name: "Ração", quantity: 1, totalPrice: 8500 }],
          invoiceStatus: "pending",
          invoiceId: 201,
          invoiceAmount: 8500,
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByText("Confirmar Pagamento"));
    expect(screen.getByText("Fatura em Aberto ⚠️")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancelar alteração"));

    expect(mockApproveReceiptMutate).not.toHaveBeenCalled();
    expect(mockUpdateStatusMutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText("Fatura em Aberto ⚠️")).not.toBeInTheDocument();
    });
  });

  it("preserves current payment invocation behavior when pending order has no invoiceId", async () => {
    (useFinancialModule.useListOrders as any).mockReturnValue({
      data: [
        {
          id: 101,
          status: "pending_payment",
          deliveryMethod: "delivery",
          total: 8500,
          tutor: { name: "Ana Lima" },
          items: [{ name: "Ração", quantity: 1, totalPrice: 8500 }],
          invoiceStatus: "pending",
          invoiceId: undefined,
          invoiceAmount: 8500,
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByText("Confirmar Pagamento"));
    fireEvent.click(screen.getByText("Sim, confirmar pagamento e dar baixa na fatura"));

    expect(mockApproveReceiptMutate).toHaveBeenCalledWith(undefined, expect.any(Object));
  });
});
