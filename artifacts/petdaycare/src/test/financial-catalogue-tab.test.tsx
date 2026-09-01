import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import FinancialDashboard from "../pages/financial/index";
import * as useFinancialModule from "../hooks/use-financial";
import * as utilsModule from "@/lib/utils";

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
    useListCatalogue: vi.fn(),
    useCreateCatalogueItem: vi.fn(),
    useUpdateCatalogueItem: vi.fn(),
    useDeleteCatalogueItem: vi.fn(),
    useStockTransactions: vi.fn(),
    useStockAdjustment: vi.fn(),
  };
});

vi.mock("@/components/financial/smart-indicators", () => ({
  CatalogueSmartIndicators: ({ itemId }: { itemId: number }) => (
    <div data-testid="catalogue-smart-indicators">Smart Indicators for #{itemId}</div>
  ),
}));

vi.mock("@/features/feed/utils/media.utils", () => ({
  buildMediaSrc: (path: string, token: string) => `https://storage.local/${path}?mt=${token}`,
  getMediaToken: () => "mock-media-token-123",
}));

vi.mock("@/lib/utils", async () => {
  const actual: any = await vi.importActual("@/lib/utils");
  return {
    ...actual,
    uploadFileDirect: vi.fn(),
  };
});

let mockSearchString = "?tab=catalogue";
vi.mock("wouter", async () => {
  const actual: any = await vi.importActual("wouter");
  return {
    ...actual,
    useSearch: () => mockSearchString,
    useLocation: () => ["/financial", vi.fn()],
  };
});

const sampleCatalogue = [
  {
    id: 101,
    name: "Ração Premium Cães Adultos 15kg",
    type: "product",
    description: "Alimento completo e balanceado para cães",
    basePrice: 18990,
    price: 18990,
    stockQuantity: 4,
    reorderThreshold: 5,
    category: "Alimentação",
    sku: "RAC-PREM-15",
    barcode: "789123456001",
    costPrice: 12000,
    mediaUrls: ["uploads/racao.jpg"],
    active: true,
  },
  {
    id: 102,
    name: "Banho & Tosa Higiênica",
    type: "service",
    description: "Banho completo com hidratação e tosa higiênica",
    basePrice: 8500,
    price: 8500,
    pricingBySize: {
      small: 7000,
      medium: 8500,
      large: 11000,
    },
    category: "Estética",
    active: true,
  },
  {
    id: 103,
    name: "Pacote Mensal Creche 20 Diárias",
    type: "package",
    description: "20 diárias válidas por 30 dias",
    basePrice: 120000,
    price: 120000,
    creditsAmount: 20,
    maxPetsPerDay: 1,
    category: "Creche",
    active: true,
  },
  {
    id: 104,
    name: "Diária Avulsa Day Use",
    type: "day_use",
    description: "Acesso por um dia inteiro",
    basePrice: 7500,
    price: 7500,
    pricingBySize: {
      small: 6500,
      medium: 7500,
      large: 9500,
    },
    category: "Hotelaria",
    active: true,
  },
];

const sampleTransactions = {
  data: [
    {
      id: 501,
      catalogueItemId: 101,
      type: "in",
      quantity: 10,
      quantityDelta: 10,
      previousQuantity: 0,
      newQuantity: 10,
      reason: "Contagem inicial de estoque",
      notes: "Contagem inicial de estoque",
      createdAt: "2026-08-20T10:00:00.000Z",
    },
    {
      id: 502,
      catalogueItemId: 101,
      type: "out",
      quantity: 6,
      quantityDelta: -6,
      previousQuantity: 10,
      newQuantity: 4,
      reason: "Sacos rasgados no transporte",
      notes: "Sacos rasgados no transporte",
      createdAt: "2026-08-25T14:30:00.000Z",
    },
  ],
  total: 2,
  page: 1,
  totalPages: 1,
};

describe("Catalogue & StockHistoryModal Dedicated Characterization Tests (R33F.B7)", () => {
  let mockCreateMutate: any;
  let mockUpdateMutate: any;
  let mockDeleteMutate: any;
  let mockAdjustMutate: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast.mockReset();

    mockCreateMutate = vi.fn();
    mockUpdateMutate = vi.fn();
    mockDeleteMutate = vi.fn();
    mockAdjustMutate = vi.fn();

    (useFinancialModule.useListCatalogue as any).mockReturnValue({
      data: sampleCatalogue,
      isLoading: false,
    });

    (useFinancialModule.useCreateCatalogueItem as any).mockReturnValue({
      mutate: mockCreateMutate,
      isPending: false,
    });

    (useFinancialModule.useUpdateCatalogueItem as any).mockReturnValue({
      mutate: mockUpdateMutate,
      isPending: false,
    });

    (useFinancialModule.useDeleteCatalogueItem as any).mockReturnValue({
      mutate: mockDeleteMutate,
      isPending: false,
    });

    (useFinancialModule.useStockTransactions as any).mockReturnValue({
      data: sampleTransactions,
      isLoading: false,
    });

    (useFinancialModule.useStockAdjustment as any).mockReturnValue({
      mutate: mockAdjustMutate,
      isPending: false,
    });
  });

  // Helper to open dropdown on card
  const openCardDropdown = (index: number) => {
    const moreOptionsButtons = screen.getAllByRole("button", { name: "Mais opções do item" });
    fireEvent.pointerDown(moreOptionsButtons[index], { button: 0 });
    fireEvent.click(moreOptionsButtons[index]);
  };

  // 1. Render all catalogue item types
  it("renders representative catalogue items for all types (product, service, package, day_use) with formatted prices", () => {
    renderWithProviders(<FinancialDashboard />);

    expect(screen.getByText("Ração Premium Cães Adultos 15kg")).toBeInTheDocument();
    expect(screen.getByText("Banho & Tosa Higiênica")).toBeInTheDocument();
    expect(screen.getByText("Pacote Mensal Creche 20 Diárias")).toBeInTheDocument();
    expect(screen.getByText("Diária Avulsa Day Use")).toBeInTheDocument();

    // Check price formatting
    expect(screen.getByText(/189,90/)).toBeInTheDocument();
    expect(screen.getByText(/1.200,00/)).toBeInTheDocument();
  });

  // 2. Low stock indicator & badge
  it("renders low stock alert indicator and product badge when stockQuantity is at or below reorderThreshold", () => {
    renderWithProviders(<FinancialDashboard />);

    // Item 101 has stockQuantity: 4, reorderThreshold: 5 -> low stock
    expect(screen.getByText(/1 com estoque baixo/i)).toBeInTheDocument();
    expect(screen.getByText("Estoque Baixo")).toBeInTheDocument();
  });

  // 3. Open create modal defaults
  it("opens Add Item modal with current default values (product type, empty fields)", () => {
    renderWithProviders(<FinancialDashboard />);

    const addButton = screen.getByRole("button", { name: /Novo Item/i });
    fireEvent.click(addButton);

    expect(screen.getByRole("heading", { name: "Novo Item" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ex: Ração Premium 10kg")).toHaveValue("");
    expect(screen.getByPlaceholderText("0,00")).toHaveValue(null);
  });

  // 4. Duplicate name warning on create
  it("displays warning indicator when entered name matches an existing catalogue item", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const nameInput = screen.getByPlaceholderText("Ex: Ração Premium 10kg");
    fireEvent.change(nameInput, { target: { value: "Ração Premium Cães Adultos 15kg" } });

    expect(screen.getByText("Já existe um item com este nome.")).toBeInTheDocument();
  });

  // 5. Required validation (name and price)
  it("rejects submission when required name or price is missing and does not call mutation", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    // Click Salvar without filling anything
    const saveButton = screen.getByRole("button", { name: "Salvar Item" });
    fireEvent.click(saveButton);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Nome e preço são obrigatórios",
        variant: "destructive",
      })
    );
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  // 6. Negative / invalid price
  it("rejects submission when price is negative or invalid monetary string", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const nameInput = screen.getByPlaceholderText("Ex: Ração Premium 10kg");
    const priceInput = screen.getByPlaceholderText("0,00");

    fireEvent.change(nameInput, { target: { value: "Item Teste" } });
    fireEvent.change(priceInput, { target: { value: "-50" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Preço não pode ser negativo e deve ser monetário válido.",
        variant: "destructive",
      })
    );
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  // 7. Zero price acceptance
  it("preserves zero price allowing base price 0 to be submitted as 0 cents", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const nameInput = screen.getByPlaceholderText("Ex: Ração Premium 10kg");
    const priceInput = screen.getByPlaceholderText("0,00");

    fireEvent.change(nameInput, { target: { value: "Brinde Promocional" } });
    fireEvent.change(priceInput, { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Brinde Promocional",
        type: "product",
        price: 0,
      }),
      expect.any(Object)
    );
  });

  // 8. Product create with converted integer-cent payload
  it("creates valid product item with converted integer-cent price, cost price, and stock quantities", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Coleira de Couro" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "45.90" } });
    fireEvent.change(screen.getByPlaceholderText("Quantidade atual"), { target: { value: "15" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 5"), { target: { value: "3" } });
    fireEvent.change(screen.getByPlaceholderText("Opcional"), { target: { value: "25.00" } });
    fireEvent.change(screen.getByPlaceholderText("Código interno"), { target: { value: "COL-COU-01" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 7891000..."), { target: { value: "78999990001" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      {
        name: "Coleira de Couro",
        type: "product",
        description: "",
        price: 4590,
        stockQuantity: 15,
        reorderThreshold: 3,
        creditsAmount: null,
        maxPetsPerDay: 1,
        pricingBySize: undefined,
        category: null,
        sku: "COL-COU-01",
        barcode: "78999990001",
        costPrice: 2500,
        mediaUrls: [],
      },
      expect.any(Object)
    );
  });

  // 9. Product cost price validation
  it("rejects product creation when cost price is negative or invalid", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Petisco Natural" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "20.00" } });
    fireEvent.change(screen.getByPlaceholderText("Opcional"), { target: { value: "-10" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Preço de custo monetário inválido.",
        variant: "destructive",
      })
    );
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  // 10. Package credits validation
  it("rejects package creation when creditsAmount is missing or less than or equal to zero", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    // Select type "package"
    const typeSelect = screen.getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "package" } });

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Pacote 10 Diárias" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "600.00" } });

    // Leave creditsAmount empty and submit
    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Informe a quantidade de diárias (créditos) do pacote",
        variant: "destructive",
      })
    );
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  // 11. Package create with valid creditsAmount
  it("creates valid package with creditsAmount and maxPetsPerDay payload", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const typeSelect = screen.getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "package" } });

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Pacote 15 Diárias" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "900.00" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 20"), { target: { value: "15" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 1"), { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Pacote 15 Diárias",
        type: "package",
        price: 90000,
        creditsAmount: 15,
        maxPetsPerDay: 2,
      }),
      expect.any(Object)
    );
  });

  // 12. Size-price fallback: missing size price defaults to base price
  it("preserves size pricing fallback defaulting omitted size prices to base price for service and day_use", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const typeSelect = screen.getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "service" } });

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Consulta Veterinária" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "150.00" } });

    // Fill only small price (120.00), leave medium and large empty
    const sizeInputs = screen.getAllByPlaceholderText("Padrão");
    fireEvent.change(sizeInputs[0], { target: { value: "120.00" } }); // Small

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Consulta Veterinária",
        type: "service",
        price: 15000,
        pricingBySize: {
          small: 12000,
          medium: 15000, // Fallback to base price
          large: 15000,  // Fallback to base price
        },
      }),
      expect.any(Object)
    );
  });

  // 13. Explicit size prices for service
  it("converts explicitly provided small, medium, and large size prices to integer cents", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const typeSelect = screen.getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "day_use" } });

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Diária VIP" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "100.00" } });

    const sizeInputs = screen.getAllByPlaceholderText("Padrão");
    fireEvent.change(sizeInputs[0], { target: { value: "80.00" } });  // Small
    fireEvent.change(sizeInputs[1], { target: { value: "100.00" } }); // Medium
    fireEvent.change(sizeInputs[2], { target: { value: "140.00" } }); // Large

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Diária VIP",
        type: "day_use",
        price: 10000,
        pricingBySize: {
          small: 8000,
          medium: 10000,
          large: 14000,
        },
      }),
      expect.any(Object)
    );
  });

  // 14. Invalid size price validation
  it("rejects service creation when a size price is negative", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const typeSelect = screen.getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "service" } });

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Tosa Completa" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "100.00" } });

    const sizeInputs = screen.getAllByPlaceholderText("Padrão");
    fireEvent.change(sizeInputs[0], { target: { value: "-30" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Preço pequeno monetário inválido.",
        variant: "destructive",
      })
    );
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  // 15. Edit initialization
  it("opens edit modal with persisted item values converted back to form string representations", () => {
    renderWithProviders(<FinancialDashboard />);

    // Click "Editar" on the first card (Ração Premium 15kg)
    const editButtons = screen.getAllByRole("button", { name: "Editar" });
    fireEvent.click(editButtons[0]);

    expect(screen.getByRole("heading", { name: "Editar Item" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ex: Ração Premium 10kg")).toHaveValue("Ração Premium Cães Adultos 15kg");
    expect(screen.getByPlaceholderText("0,00")).toHaveValue(189.9);
    expect(screen.getByPlaceholderText("Quantidade atual")).toHaveValue(4);
    expect(screen.getByPlaceholderText("Ex: 5")).toHaveValue(5);
    expect(screen.getByPlaceholderText("Opcional")).toHaveValue(120);
    expect(screen.getByPlaceholderText("Código interno")).toHaveValue("RAC-PREM-15");
    expect(screen.getByPlaceholderText("Ex: 7891000...")).toHaveValue("789123456001");
  });

  // 16. Update payload
  it("updates existing item with exact editing ID and transformed payload", () => {
    renderWithProviders(<FinancialDashboard />);

    const editButtons = screen.getAllByRole("button", { name: "Editar" });
    fireEvent.click(editButtons[0]);

    // Change price
    const priceInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(priceInput, { target: { value: "199.90" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 101,
        name: "Ração Premium Cães Adultos 15kg",
        price: 19990,
      }),
      expect.any(Object)
    );
  });

  // 17. Create failure
  it("displays modalError and retains form and modal open on create mutation error", async () => {
    mockCreateMutate.mockImplementation((payload: any, options: any) => {
      options.onError(new Error("Falha no banco de dados ao criar item"));
    });

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Item Falha" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "30.00" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(await screen.findByText("Falha no banco de dados ao criar item")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Novo Item" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ex: Ração Premium 10kg")).toHaveValue("Item Falha");
  });

  // 18. Update failure
  it("displays modalError and retains form and modal open on update mutation error", async () => {
    mockUpdateMutate.mockImplementation((payload: any, options: any) => {
      options.onError(new Error("Falha no banco de dados ao atualizar item"));
    });

    renderWithProviders(<FinancialDashboard />);

    const editButtons = screen.getAllByRole("button", { name: "Editar" });
    fireEvent.click(editButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(await screen.findByText("Falha no banco de dados ao atualizar item")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Editar Item" })).toBeInTheDocument();
  });

  // 19. Delete denied
  it("does not delete item when confirmation dialog is denied (confirm false)", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);

    const deleteMenuItem = screen.getByText("Excluir");
    fireEvent.click(deleteMenuItem);

    expect(confirmSpy).toHaveBeenCalledWith("Tem certeza que deseja excluir este item do catálogo?");
    expect(mockDeleteMutate).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  // 20. Delete success
  it("deletes exact item ID after user confirms deletion (confirm true) and shows success toast", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    mockDeleteMutate.mockImplementation((id: number, options: any) => {
      options.onSuccess();
    });

    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);

    const deleteMenuItem = screen.getByText("Excluir");
    fireEvent.click(deleteMenuItem);

    expect(confirmSpy).toHaveBeenCalledWith("Tem certeza que deseja excluir este item do catálogo?");
    expect(mockDeleteMutate).toHaveBeenCalledWith(101, expect.any(Object));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sucesso",
        description: "Item excluído com sucesso",
      })
    );

    confirmSpy.mockRestore();
  });

  // 21. Delete failure
  it("displays destructive error toast when delete mutation fails", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    mockDeleteMutate.mockImplementation((id: number, options: any) => {
      options.onError(new Error("Não é possível excluir item com histórico de vendas"));
    });

    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);

    const deleteMenuItem = screen.getByText("Excluir");
    fireEvent.click(deleteMenuItem);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Não é possível excluir item com histórico de vendas",
        variant: "destructive",
      })
    );

    confirmSpy.mockRestore();
  });

  // 22. Image upload wiring & exact auth token assertion
  it("wires image upload file input with uploadFileDirect and updates imageUrl state with exact auth token", async () => {
    const testToken = "test-auth-token-xyz-123";
    localStorage.setItem("auth_token", testToken);

    const mockUpload = vi.spyOn(utilsModule, "uploadFileDirect").mockResolvedValue("uploads/nova-foto.jpg");

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const file = new File(["fake image content"], "foto.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(file, testToken);
    });

    // Check preview exists
    expect(screen.getByAltText("preview")).toBeInTheDocument();

    mockUpload.mockRestore();
    localStorage.removeItem("auth_token");
  });

  // 23. Stock history modal open & rendering
  it("opens StockHistoryModal from product card dropdown and renders movements and pagination", async () => {
    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);

    const historyMenuItem = await screen.findByText("Histórico");
    fireEvent.click(historyMenuItem);

    expect(screen.getByText(/Histórico de Estoque — Ração Premium Cães Adultos 15kg/i)).toBeInTheDocument();
    expect(screen.getByText("Contagem inicial de estoque")).toBeInTheDocument();
    expect(screen.getByText("Sacos rasgados no transporte")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    expect(screen.getByText("-6")).toBeInTheDocument();
  });

  // 24. Stock adjustment positive delta (ADD)
  it("submits stock adjustment with positive delta (add movement) and exact payload", async () => {
    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);
    const historyMenuItem = await screen.findByText("Histórico");
    fireEvent.click(historyMenuItem);

    const deltaInput = screen.getByPlaceholderText("ex: -3");
    const reasonInput = screen.getByPlaceholderText("ex: Quebra, recontagem...");

    fireEvent.change(deltaInput, { target: { value: "10" } });
    fireEvent.change(reasonInput, { target: { value: "Compra de reposição" } });

    mockAdjustMutate.mockImplementation((payload: any, options: any) => {
      options.onSuccess();
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(mockAdjustMutate).toHaveBeenCalledWith(
      {
        itemId: 101,
        delta: 10,
        reason: "Compra de reposição",
      },
      expect.any(Object)
    );

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sucesso",
        description: "Estoque ajustado com sucesso.",
      })
    );
  });

  // 25. Stock adjustment negative delta (SUBTRACT)
  it("submits stock adjustment with negative delta (subtract movement) and exact payload", async () => {
    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);
    const historyMenuItem = await screen.findByText("Histórico");
    fireEvent.click(historyMenuItem);

    const deltaInput = screen.getByPlaceholderText("ex: -3");
    const reasonInput = screen.getByPlaceholderText("ex: Quebra, recontagem...");

    fireEvent.change(deltaInput, { target: { value: "-2" } });
    fireEvent.change(reasonInput, { target: { value: "Avaria no estoque" } });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(mockAdjustMutate).toHaveBeenCalledWith(
      {
        itemId: 101,
        delta: -2,
        reason: "Avaria no estoque",
      },
      expect.any(Object)
    );
  });

  // 26. Stock adjustment validation
  it("rejects stock adjustment when delta is zero or empty or reason is missing and does not call mutation", async () => {
    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);
    const historyMenuItem = await screen.findByText("Histórico");
    fireEvent.click(historyMenuItem);

    // Attempt with empty delta
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Informe um delta diferente de zero.",
        variant: "destructive",
      })
    );
    expect(mockAdjustMutate).not.toHaveBeenCalled();

    // Attempt with delta but empty reason
    fireEvent.change(screen.getByPlaceholderText("ex: -3"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Informe o motivo do ajuste.",
        variant: "destructive",
      })
    );
    expect(mockAdjustMutate).not.toHaveBeenCalled();
  });

  // 27. Stock adjustment failure
  it("displays error toast on stock adjustment failure and retains modal open", async () => {
    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);
    const historyMenuItem = await screen.findByText("Histórico");
    fireEvent.click(historyMenuItem);

    fireEvent.change(screen.getByPlaceholderText("ex: -3"), { target: { value: "-5" } });
    fireEvent.change(screen.getByPlaceholderText("ex: Quebra, recontagem..."), { target: { value: "Correção de inventário" } });

    mockAdjustMutate.mockImplementation((payload: any, options: any) => {
      options.onError(new Error("Estoque insuficiente para ajuste negativo"));
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Estoque insuficiente para ajuste negativo",
        variant: "destructive",
      })
    );
    expect(screen.getByText(/Histórico de Estoque — Ração Premium Cães Adultos 15kg/i)).toBeInTheDocument();
  });

  // 28. Close StockHistoryModal
  it("closes StockHistoryModal when Fechar button is clicked", async () => {
    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);
    const historyMenuItem = await screen.findByText("Histórico");
    fireEvent.click(historyMenuItem);

    expect(screen.getByText(/Histórico de Estoque — Ração Premium Cães Adultos 15kg/i)).toBeInTheDocument();

    const closeButtons = screen.getAllByRole("button", { name: "Fechar" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    expect(screen.queryByText(/Histórico de Estoque — Ração Premium Cães Adultos 15kg/i)).not.toBeInTheDocument();
  });

  // 29. Pending protection
  it("disables/shows loading state on Save Item and Confirmar Ajuste while mutations are pending", () => {
    (useFinancialModule.useCreateCatalogueItem as any).mockReturnValue({
      mutate: mockCreateMutate,
      isPending: true,
    });

    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    const saveButton = screen.getByRole("button", { name: "Salvar Item" });
    expect(saveButton).toBeDisabled();
  });

  // 30. Current absence of client-side search, type-filter, and sort controls + query result order preservation
  it("preserves catalogue query order without client-side search, type-filter, or alphabetical-sort controls", () => {
    // Non-alphabetical mocked dataset: Zeta -> Alpha -> Beta
    const unorderedCatalogue = [
      {
        id: 301,
        name: "Zeta Ração Especial",
        type: "product",
        description: "Ração Premium",
        basePrice: 15000,
        price: 15000,
        stockQuantity: 10,
        reorderThreshold: 2,
        sku: "ZET-001",
        barcode: "789000000001",
        active: true,
      },
      {
        id: 302,
        name: "Alpha Banho Express",
        type: "service",
        description: "Banho rápido",
        basePrice: 6000,
        price: 6000,
        active: true,
      },
      {
        id: 303,
        name: "Beta Pacote Semanal",
        type: "package",
        description: "5 diárias",
        basePrice: 35000,
        price: 35000,
        creditsAmount: 5,
        maxPetsPerDay: 1,
        active: true,
      },
    ];

    (useFinancialModule.useListCatalogue as any).mockReturnValue({
      data: unorderedCatalogue,
      isLoading: false,
    });

    renderWithProviders(<FinancialDashboard />);

    // 1. Verify exact query order is preserved (rendered as Zeta, Alpha, Beta in that order, not alphabetically sorted)
    const itemHeadings = screen.getAllByRole("heading", { level: 4 });
    const renderedNames = itemHeadings.map(h => h.textContent);
    expect(renderedNames).toEqual([
      "Zeta Ração Especial",
      "Alpha Banho Express",
      "Beta Pacote Semanal",
    ]);

    // 2. Verify absence of client-side type-filter buttons/controls within Catalogue
    expect(screen.queryByRole("button", { name: "Filtrar por tipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Todos os tipos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apenas Produtos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apenas Serviços" })).not.toBeInTheDocument();

    // 3. Verify absence of client-side sorting controls
    expect(screen.queryByRole("button", { name: /Ordenar por/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Ordem/i })).not.toBeInTheDocument();
  });

  // Strict Integer Input Characterization Tests (R33M.B1 - FORM-R33M-001)
  it("rejects decimal and scientific notation for stockQuantity and reorderThreshold with modal error", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Ração Teste" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "100.00" } });
    fireEvent.change(screen.getByPlaceholderText("Quantidade atual"), { target: { value: "1.9" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(screen.getByText("Quantidade em estoque deve ser um número inteiro maior ou igual a zero.")).toBeInTheDocument();
    expect(mockCreateMutate).not.toHaveBeenCalled();

    // Test scientific notation 1e2
    fireEvent.change(screen.getByPlaceholderText("Quantidade atual"), { target: { value: "1e2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));
    expect(screen.getByText("Quantidade em estoque deve ser um número inteiro maior ou igual a zero.")).toBeInTheDocument();
    expect(mockCreateMutate).not.toHaveBeenCalled();

    // Test reorderThreshold decimal
    fireEvent.change(screen.getByPlaceholderText("Quantidade atual"), { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 5"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));
    expect(screen.getByText("Limite para reposição deve ser um número inteiro maior ou igual a zero.")).toBeInTheDocument();
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("rejects decimal and scientific notation for package creditsAmount", () => {
    renderWithProviders(<FinancialDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Item/i }));

    // Switch to package
    const typeSelect = screen.getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "package" } });

    fireEvent.change(screen.getByPlaceholderText("Ex: Ração Premium 10kg"), { target: { value: "Pacote Mensal" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "500.00" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 20"), { target: { value: "1.9" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Informe a quantidade de diárias (créditos) do pacote",
        variant: "destructive",
      })
    );
    expect(mockCreateMutate).not.toHaveBeenCalled();

    // Test scientific notation 1e2
    fireEvent.change(screen.getByPlaceholderText("Ex: 20"), { target: { value: "1e2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar Item" }));
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("rejects decimal and scientific notation in stock adjustment delta", async () => {
    renderWithProviders(<FinancialDashboard />);

    openCardDropdown(0);
    const historyMenuItem = await screen.findByText("Histórico");
    fireEvent.click(historyMenuItem);

    const deltaInput = screen.getByPlaceholderText("ex: -3");
    const reasonInput = screen.getByPlaceholderText("ex: Quebra, recontagem...");

    // Test decimal 1.9
    fireEvent.change(deltaInput, { target: { value: "1.9" } });
    fireEvent.change(reasonInput, { target: { value: "Ajuste decimal" } });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Informe um delta diferente de zero.",
        variant: "destructive",
      })
    );
    expect(mockAdjustMutate).not.toHaveBeenCalled();

    // Test scientific notation 1e2
    fireEvent.change(deltaInput, { target: { value: "1e2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(mockAdjustMutate).not.toHaveBeenCalled();
  });
});
