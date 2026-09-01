import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import NewBooking from "../pages/bookings/new";
import * as authModule from "../hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";
import * as financialModule from "../hooks/use-financial";

const mockToast = vi.fn();
vi.mock("../hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

const mockSetLocation = vi.fn();
vi.mock("wouter", async () => {
  const actual = await vi.importActual<any>("wouter");
  return {
    ...actual,
    useLocation: () => ["/bookings/new", mockSetLocation],
  };
});

vi.mock("../hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListPets: vi.fn(),
  useCreateBooking: vi.fn(),
  getListBookingsQueryKey: vi.fn(() => ["bookings"]),
  getGetCrecheStatsQueryKey: vi.fn(() => ["stats"]),
  getListTasksQueryKey: vi.fn(() => ["tasks"]),
}));

vi.mock("../hooks/use-financial", () => ({
  useListCatalogue: vi.fn(),
  usePackagesBalance: vi.fn(),
  useServiceCredits: vi.fn(),
}));

describe("NewBooking Wizard Component Tests", () => {
  const mockPets = [
    { id: 1, name: "Rex", breed: "Golden Retriever", tutorId: 10, crecheId: 1 },
    { id: 2, name: "Thor", breed: "Bulldog", tutorId: 11, crecheId: 1 },
  ];

  const mockCatalogue = [
    { id: 201, name: "Creche Diária", type: "service", price: 7000, crecheId: 1 },
    { id: 202, name: "Banho Completo", type: "service", price: 6000, crecheId: 1 },
  ];

  let mockMutateAsync: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync = vi.fn();

    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, role: "creche_admin", crecheId: 1 },
      isLoading: false,
    });
    (apiClientModule.useListPets as any).mockReturnValue({
      data: { items: mockPets },
      isLoading: false,
    });
    (apiClientModule.useCreateBooking as any).mockReturnValue({
      mutateAsync: mockMutateAsync,
      mutate: vi.fn(),
      isPending: false,
    });
    (financialModule.useListCatalogue as any).mockReturnValue({
      data: mockCatalogue,
      isLoading: false,
    });
    (financialModule.usePackagesBalance as any).mockReturnValue({
      data: { packages: [] },
      isLoading: false,
    });
    (financialModule.useServiceCredits as any).mockReturnValue({
      data: [],
      isLoading: false,
    });
  });

  it("renders Step 1 (Escolher Pets) with available pets", () => {
    renderWithProviders(<NewBooking />);

    expect(screen.getByText("Nova Reserva")).toBeInTheDocument();
    expect(screen.getByText("Escolher Pets")).toBeInTheDocument();
    expect(screen.getByText("Rex")).toBeInTheDocument();
    expect(screen.getByText("Thor")).toBeInTheDocument();
  });

  it("advances from Step 1 to Step 2 when a pet is selected", () => {
    renderWithProviders(<NewBooking />);

    // Select Rex
    fireEvent.click(screen.getByText("Rex"));

    // Click 'Próximo'
    const nextButton = screen.getByRole("button", { name: "Próximo" });
    fireEvent.click(nextButton);

    // Step 2 should now show services
    expect(screen.getByText("Qual serviço você deseja?")).toBeInTheDocument();
    expect(screen.getByText("Creche Diária")).toBeInTheDocument();
    expect(screen.getByText("Banho Completo")).toBeInTheDocument();
  });

  it("advances through Step 2 to Step 3 when a service is selected", () => {
    renderWithProviders(<NewBooking />);

    // Step 1: Select pet
    fireEvent.click(screen.getByText("Rex"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 2: Select service
    fireEvent.click(screen.getByText("Creche Diária"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 3: Agendamento
    expect(screen.getByText("Para quando?")).toBeInTheDocument();
    expect(screen.getByText("Data de Entrada")).toBeInTheDocument();
  });

  it("advances to Step 4 (Confirmação) and renders summary", () => {
    renderWithProviders(<NewBooking />);

    // Step 1: Select pet
    fireEvent.click(screen.getByText("Rex"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 2: Select service
    fireEvent.click(screen.getByText("Creche Diária"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 3: Dates
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 4: Confirmation
    expect(screen.getByText("Revisão Final")).toBeInTheDocument();
    expect(screen.getByText("Resumo Financeiro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar Reserva" })).toBeInTheDocument();
  });

  // Multi-Pet Partial-Success Characterization Tests (R33M.B2 - FORM-R33M-003)
  it("creates all bookings successfully and navigates to /bookings when all pets resolve", async () => {
    mockMutateAsync.mockResolvedValue({ id: 101 });
    renderWithProviders(<NewBooking />);

    // Step 1: Select both pets (Rex and Thor)
    fireEvent.click(screen.getByText("Rex"));
    fireEvent.click(screen.getByText("Thor"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 2: Select service
    fireEvent.click(screen.getByText("Creche Diária"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 3: Dates
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 4: Submit
    const confirmButton = screen.getByRole("button", { name: "Confirmar Reserva" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Reserva Efetuada",
          description: "Criadas 2 reservas com sucesso.",
        })
      );
      expect(mockSetLocation).toHaveBeenCalledWith("/bookings");
    });
  });

  it("handles multi-pet partial success: reports per-pet results, retains wizard open, and removes successful pets from retry set", async () => {
    // Rex (pet 1) succeeds, Thor (pet 2) fails
    mockMutateAsync.mockImplementation(({ data }: any) => {
      if (data.petId === 1) {
        return Promise.resolve({ id: 101, petId: 1 });
      }
      return Promise.reject(new Error("Pet já possui reserva no período."));
    });

    renderWithProviders(<NewBooking />);

    // Step 1: Select both Rex and Thor
    fireEvent.click(screen.getByText("Rex"));
    fireEvent.click(screen.getByText("Thor"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 2: Select service
    fireEvent.click(screen.getByText("Creche Diária"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 3: Dates
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    // Step 4: Submit first attempt
    const confirmButton = screen.getByRole("button", { name: "Confirmar Reserva" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Reserva parcial criada",
          description: expect.stringContaining("Rex"),
        })
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("Thor"),
        })
      );
      // Must NOT navigate away on partial failure
      expect(mockSetLocation).not.toHaveBeenCalled();
    });

    // Reset mock to succeed on retry
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ id: 102, petId: 2 });

    // Step 4: Click Confirm again to retry
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Reserva" }));

    await waitFor(() => {
      // Retry MUST only submit Thor (pet 2), NOT Rex (pet 1)
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            petId: 2,
          }),
        })
      );
      expect(mockSetLocation).toHaveBeenCalledWith("/bookings");
    });
  });

  it("handles failure order independence when first pet fails and second succeeds", async () => {
    // Rex (pet 1) fails, Thor (pet 2) succeeds
    mockMutateAsync.mockImplementation(({ data }: any) => {
      if (data.petId === 1) {
        return Promise.reject(new Error("Capacidade diária esgotada."));
      }
      return Promise.resolve({ id: 102, petId: 2 });
    });

    renderWithProviders(<NewBooking />);

    fireEvent.click(screen.getByText("Rex"));
    fireEvent.click(screen.getByText("Thor"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    fireEvent.click(screen.getByText("Creche Diária"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Reserva" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Reserva parcial criada",
          description: expect.stringContaining("Thor"),
        })
      );
      expect(mockSetLocation).not.toHaveBeenCalled();
    });

    // On retry, only Rex (pet 1) is submitted
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ id: 101, petId: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Reserva" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            petId: 1,
          }),
        })
      );
      expect(mockSetLocation).toHaveBeenCalledWith("/bookings");
    });
  });

  it("handles all-failure multi-pet booking creation without removing any pets from retry selection", async () => {
    mockMutateAsync.mockRejectedValue(new Error("Erro geral do servidor"));
    renderWithProviders(<NewBooking />);

    fireEvent.click(screen.getByText("Rex"));
    fireEvent.click(screen.getByText("Thor"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    fireEvent.click(screen.getByText("Creche Diária"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Reserva" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Erro ao criar reserva",
          variant: "destructive",
        })
      );
      expect(mockSetLocation).not.toHaveBeenCalled();
    });

    // Both pets must remain selected on retry
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ id: 103 });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Reserva" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2);
      expect(mockSetLocation).toHaveBeenCalledWith("/bookings");
    });
  });
});
