import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent } from "./utils";
import NewBooking from "../pages/bookings/new";
import * as authModule from "../hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";
import * as financialModule from "../hooks/use-financial";

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

  beforeEach(() => {
    vi.clearAllMocks();
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, role: "creche_admin", crecheId: 1 },
      isLoading: false,
    });
    (apiClientModule.useListPets as any).mockReturnValue({
      data: { items: mockPets },
      isLoading: false,
    });
    (apiClientModule.useCreateBooking as any).mockReturnValue({
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
});
