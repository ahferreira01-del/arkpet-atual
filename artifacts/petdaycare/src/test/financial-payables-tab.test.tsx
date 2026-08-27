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
    useListExpenses: vi.fn(),
    useCreateExpense: vi.fn(),
    useUpdateExpense: vi.fn(),
    useDeleteExpense: vi.fn(),
    usePayExpense: vi.fn(),
  };
});

let mockSearchString = "?tab=payables";
vi.mock("wouter", async () => {
  const actual: any = await vi.importActual("wouter");
  return {
    ...actual,
    useSearch: () => mockSearchString,
    useLocation: () => ["/financial", vi.fn()],
  };
});

describe("Payables Tab Dedicated Characterization Tests (R33F.B5)", () => {
  let mockCreateMutate: any;
  let mockUpdateMutate: any;
  let mockDeleteMutate: any;
  let mockPayMutate: any;

  const sampleExpenses = [
    {
      id: 101,
      description: "Conta de Luz",
      category: "operacional",
      amount: 25000,
      dueDate: "2026-09-01T12:00:00.000Z",
      isPaid: false,
    },
    {
      id: 102,
      description: "Internet Fibra",
      category: "administrativo",
      amount: 12000,
      dueDate: "2026-08-20T12:00:00.000Z",
      isPaid: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchString = "?tab=payables";

    mockCreateMutate = vi.fn();
    mockUpdateMutate = vi.fn();
    mockDeleteMutate = vi.fn();
    mockPayMutate = vi.fn();

    (useFinancialModule.useListExpenses as any).mockReturnValue({
      data: sampleExpenses,
      isLoading: false,
    });

    (useFinancialModule.useCreateExpense as any).mockReturnValue({
      mutate: mockCreateMutate,
      isPending: false,
    });

    (useFinancialModule.useUpdateExpense as any).mockReturnValue({
      mutate: mockUpdateMutate,
      isPending: false,
    });

    (useFinancialModule.useDeleteExpense as any).mockReturnValue({
      mutate: mockDeleteMutate,
      isPending: false,
    });

    (useFinancialModule.usePayExpense as any).mockReturnValue({
      mutate: mockPayMutate,
      isPending: false,
    });
  });

  it("renders Payables financial tab with registered expenses, current status, formatted amount and due date", async () => {
    renderWithProviders(<FinancialDashboard />);

    expect(screen.getByText("Despesas Registradas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nova Despesa/i })).toBeInTheDocument();

    // Expense 101 (Unpaid)
    expect(screen.getAllByText("Conta de Luz").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-R$ 250,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("01/09/2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pendente").length).toBeGreaterThan(0);

    // Expense 102 (Paid)
    expect(screen.getAllByText("Internet Fibra").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-R$ 120,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("20/08/2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pago").length).toBeGreaterThan(0);

    // Pagar button exists for unpaid expense
    const payButtons = screen.getAllByRole("button", { name: "Pagar" });
    expect(payButtons.length).toBeGreaterThan(0);
  });

  it("opens New Expense modal with current default form state", async () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Nova Despesa/i }));

    expect(screen.getByRole("heading", { name: "Nova Despesa" })).toBeInTheDocument();

    const descInput = screen.getByPlaceholderText("Ex: Conta de Luz") as HTMLInputElement;
    const catInput = screen.getByPlaceholderText("Ex: operacional") as HTMLInputElement;
    const amountInput = screen.getByPlaceholderText("Ex: 150.00") as HTMLInputElement;

    expect(descInput.value).toBe("");
    expect(catInput.value).toBe("operacional");
    expect(amountInput.value).toBe("");
  });

  it("rejects expense submission when required fields are missing", async () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Nova Despesa/i }));

    const saveButton = screen.getByRole("button", { name: "Salvar Despesa" });
    fireEvent.click(saveButton);

    expect(mockToast).toHaveBeenCalledWith({
      title: "Erro",
      description: "Preencha todos os campos obrigatórios.",
      variant: "destructive",
    });
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("rejects invalid or negative monetary amount according to current parser contract", async () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Nova Despesa/i }));

    const descInput = screen.getByPlaceholderText("Ex: Conta de Luz");
    const catInput = screen.getByPlaceholderText("Ex: operacional");
    const amountInput = screen.getByPlaceholderText("Ex: 150.00");
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;

    fireEvent.change(descInput, { target: { value: "Taxa Bancária" } });
    fireEvent.change(catInput, { target: { value: "financeiro" } });
    fireEvent.change(dateInput, { target: { value: "2026-09-01" } });
    fireEvent.change(amountInput, { target: { value: "-50.00" } });

    const saveButton = screen.getByRole("button", { name: "Salvar Despesa" });
    fireEvent.click(saveButton);

    expect(mockToast).toHaveBeenCalledWith({
      title: "Erro",
      description: "O valor deve ser um formato monetário válido e positivo.",
      variant: "destructive",
    });
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("preserves current behavior allowing a zero-value expense when form amount is '0'", async () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Nova Despesa/i }));

    const descInput = screen.getByPlaceholderText("Ex: Conta de Luz");
    const catInput = screen.getByPlaceholderText("Ex: operacional");
    const amountInput = screen.getByPlaceholderText("Ex: 150.00");
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;

    fireEvent.change(descInput, { target: { value: "Ajuste Isento" } });
    fireEvent.change(catInput, { target: { value: "operacional" } });
    fireEvent.change(dateInput, { target: { value: "2026-09-01" } });
    fireEvent.change(amountInput, { target: { value: "0" } });

    const saveButton = screen.getByRole("button", { name: "Salvar Despesa" });
    fireEvent.click(saveButton);

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    expect(mockCreateMutate).toHaveBeenCalledWith(
      {
        description: "Ajuste Isento",
        category: "operacional",
        dueDate: "2026-09-01",
        amount: 0,
      },
      expect.any(Object)
    );
  });

  it("creates expense converting Reais input to integer cents and closes form on success", async () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Nova Despesa/i }));

    const descInput = screen.getByPlaceholderText("Ex: Conta de Luz");
    const catInput = screen.getByPlaceholderText("Ex: operacional");
    const amountInput = screen.getByPlaceholderText("Ex: 150.00");
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;

    fireEvent.change(descInput, { target: { value: "Material de Limpeza" } });
    fireEvent.change(catInput, { target: { value: "operacional" } });
    fireEvent.change(dateInput, { target: { value: "2026-09-05" } });
    fireEvent.change(amountInput, { target: { value: "150.25" } });

    const saveButton = screen.getByRole("button", { name: "Salvar Despesa" });
    fireEvent.click(saveButton);

    expect(mockCreateMutate).toHaveBeenCalledWith(
      {
        description: "Material de Limpeza",
        category: "operacional",
        dueDate: "2026-09-05",
        amount: 15025,
      },
      expect.any(Object)
    );

    // Simulate success
    const options = mockCreateMutate.mock.calls[0][1];
    options.onSuccess();

    expect(mockToast).toHaveBeenCalledWith({
      title: "Sucesso",
      description: "Despesa registrada.",
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Nova Despesa" })).not.toBeInTheDocument();
    });
  });

  it("opens Edit Expense modal with cents-to-Reais amount and current ISO date initialization", async () => {
    renderWithProviders(<FinancialDashboard />);

    const menuButtons = screen.getAllByRole("button", { name: "Mais opções da despesa" });
    fireEvent.pointerDown(menuButtons[0], { button: 0 });
    fireEvent.click(menuButtons[0]);

    const editItem = screen.getByText("Editar");
    fireEvent.click(editItem);

    expect(screen.getByRole("heading", { name: "Editar Despesa" })).toBeInTheDocument();

    const descInput = screen.getByPlaceholderText("Ex: Conta de Luz") as HTMLInputElement;
    const catInput = screen.getByPlaceholderText("Ex: operacional") as HTMLInputElement;
    const amountInput = screen.getByPlaceholderText("Ex: 150.00") as HTMLInputElement;
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;

    expect(descInput.value).toBe("Conta de Luz");
    expect(catInput.value).toBe("operacional");
    expect(amountInput.value).toBe("250");
    expect(dateInput.value).toBe("2026-09-01");
  });

  it("updates existing expense with exact ID and converted cents payload", async () => {
    renderWithProviders(<FinancialDashboard />);

    const menuButtons = screen.getAllByRole("button", { name: "Mais opções da despesa" });
    fireEvent.pointerDown(menuButtons[0], { button: 0 });
    fireEvent.click(menuButtons[0]);

    const editItem = screen.getByText("Editar");
    fireEvent.click(editItem);

    const amountInput = screen.getByPlaceholderText("Ex: 150.00");
    fireEvent.change(amountInput, { target: { value: "300.00" } });

    const saveButton = screen.getByRole("button", { name: "Salvar Alterações" });
    fireEvent.click(saveButton);

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        id: 101,
        description: "Conta de Luz",
        category: "operacional",
        dueDate: "2026-09-01",
        amount: 30000,
      },
      expect.any(Object)
    );

    // Simulate success
    const options = mockUpdateMutate.mock.calls[0][1];
    options.onSuccess();

    expect(mockToast).toHaveBeenCalledWith({
      title: "Sucesso",
      description: "Despesa atualizada com sucesso.",
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Editar Despesa" })).not.toBeInTheDocument();
    });
  });

  it("does not delete expense when destructive confirmation is denied", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderWithProviders(<FinancialDashboard />);

    const menuButtons = screen.getAllByRole("button", { name: "Mais opções da despesa" });
    fireEvent.pointerDown(menuButtons[0], { button: 0 });
    fireEvent.click(menuButtons[0]);

    const deleteItem = screen.getByText("Excluir");
    fireEvent.click(deleteItem);

    expect(confirmSpy).toHaveBeenCalledWith("Tem certeza que deseja excluir esta despesa?");
    expect(mockDeleteMutate).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("deletes expense with exact ID when destructive confirmation is accepted", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<FinancialDashboard />);

    const menuButtons = screen.getAllByRole("button", { name: "Mais opções da despesa" });
    fireEvent.pointerDown(menuButtons[0], { button: 0 });
    fireEvent.click(menuButtons[0]);

    const deleteItem = screen.getByText("Excluir");
    fireEvent.click(deleteItem);

    expect(confirmSpy).toHaveBeenCalledWith("Tem certeza que deseja excluir esta despesa?");
    expect(mockDeleteMutate).toHaveBeenCalledWith(101, expect.any(Object));

    // Simulate success
    const options = mockDeleteMutate.mock.calls[0][1];
    options.onSuccess();

    expect(mockToast).toHaveBeenCalledWith({
      title: "Sucesso",
      description: "Despesa excluída com sucesso.",
    });

    confirmSpy.mockRestore();
  });

  it("pays unpaid expense immediately without intermediate confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");

    renderWithProviders(<FinancialDashboard />);

    const payButtons = screen.getAllByRole("button", { name: "Pagar" });
    fireEvent.click(payButtons[0]);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockPayMutate).toHaveBeenCalledWith(101, expect.any(Object));

    // Simulate success
    const options = mockPayMutate.mock.calls[0][1];
    options.onSuccess();

    expect(mockToast).toHaveBeenCalledWith({
      title: "Sucesso",
      description: "Despesa paga e baixada no fluxo de caixa.",
    });

    confirmSpy.mockRestore();
  });

  it("preserves current payment failure feedback", async () => {
    renderWithProviders(<FinancialDashboard />);

    const payButtons = screen.getAllByRole("button", { name: "Pagar" });
    fireEvent.click(payButtons[0]);

    expect(mockPayMutate).toHaveBeenCalledWith(101, expect.any(Object));

    // Simulate failure
    const options = mockPayMutate.mock.calls[0][1];
    options.onError(new Error("Erro de comunicação com o gateway bancário"));

    expect(mockToast).toHaveBeenCalledWith({
      title: "Erro",
      description: "Erro de comunicação com o gateway bancário",
      variant: "destructive",
    });
  });
});
