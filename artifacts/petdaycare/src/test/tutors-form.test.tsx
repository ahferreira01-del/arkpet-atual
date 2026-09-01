import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Tutors from "@/pages/tutors/index";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

const mockMutateAsync = vi.fn();
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<any>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(() => ({
      data: [
        {
          id: 1,
          name: "Carlos Eduardo",
          email: "carlos@example.com",
          phone: "11999999999",
          isActive: true,
          pets: [],
        },
      ],
      isLoading: false,
    })),
    useMutation: vi.fn(() => ({
      mutateAsync: mockMutateAsync,
      mutate: vi.fn(),
      isPending: false,
    })),
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: 1, role: "creche_admin", crecheId: 10 },
  }),
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description, action, children }: any) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {action}
      {children}
    </div>
  ),
}));

vi.mock("@/components/financial/smart-indicators", () => ({
  TutorSmartIndicators: () => <div data-testid="tutor-smart-indicators" />,
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("Tutors Form Strict Integer Characterization Suite (R33M.B1 - FORM-R33M-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a tutor with valid integer mensalidadeDia (e.g. 15)", async () => {
    mockMutateAsync.mockResolvedValueOnce({ id: 2, name: "Mariana Costa" });
    renderWithProviders(<Tutors />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Tutor/i }));

    fireEvent.change(screen.getByPlaceholderText("Ex: Maria Oliveira"), { target: { value: "Mariana Costa" } });
    fireEvent.change(screen.getByPlaceholderText("tutor@email.com"), { target: { value: "mariana@email.com" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 10 (dia 10 de cada mês)"), { target: { value: "15" } });

    fireEvent.click(screen.getByRole("button", { name: "Criar Tutor" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Mariana Costa",
          email: "mariana@email.com",
          mensalidadeDia: 15,
        })
      );
    });
  });

  it("rejects decimal mensalidadeDia (e.g. 15.5) without calling mutation", async () => {
    renderWithProviders(<Tutors />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Tutor/i }));

    const nameInput = screen.getByPlaceholderText("Ex: Maria Oliveira");
    fireEvent.change(nameInput, { target: { value: "Mariana Costa" } });
    fireEvent.change(screen.getByPlaceholderText("tutor@email.com"), { target: { value: "mariana@email.com" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 10 (dia 10 de cada mês)"), { target: { value: "15.5" } });

    fireEvent.submit(nameInput.closest("form")!);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Dia de vencimento da mensalidade deve ser um número inteiro entre 1 e 31.",
        variant: "destructive",
      })
    );
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("rejects scientific notation mensalidadeDia (e.g. 1e2) without calling mutation", async () => {
    renderWithProviders(<Tutors />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Tutor/i }));

    const nameInput = screen.getByPlaceholderText("Ex: Maria Oliveira");
    fireEvent.change(nameInput, { target: { value: "Mariana Costa" } });
    fireEvent.change(screen.getByPlaceholderText("tutor@email.com"), { target: { value: "mariana@email.com" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 10 (dia 10 de cada mês)"), { target: { value: "1e2" } });

    fireEvent.submit(nameInput.closest("form")!);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Dia de vencimento da mensalidade deve ser um número inteiro entre 1 e 31.",
        variant: "destructive",
      })
    );
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("rejects out-of-range mensalidadeDia (0 and 32) without calling mutation", async () => {
    renderWithProviders(<Tutors />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Tutor/i }));

    const nameInput = screen.getByPlaceholderText("Ex: Maria Oliveira");
    fireEvent.change(nameInput, { target: { value: "Mariana Costa" } });
    fireEvent.change(screen.getByPlaceholderText("tutor@email.com"), { target: { value: "mariana@email.com" } });

    // 0
    fireEvent.change(screen.getByPlaceholderText("Ex: 10 (dia 10 de cada mês)"), { target: { value: "0" } });
    fireEvent.submit(nameInput.closest("form")!);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro",
        description: "Dia de vencimento da mensalidade deve ser um número inteiro entre 1 e 31.",
        variant: "destructive",
      })
    );
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // 32
    fireEvent.change(screen.getByPlaceholderText("Ex: 10 (dia 10 de cada mês)"), { target: { value: "32" } });
    fireEvent.submit(nameInput.closest("form")!);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("creates a tutor with omitted/empty mensalidadeDia as undefined", async () => {
    mockMutateAsync.mockResolvedValueOnce({ id: 3, name: "Roberto Silva" });
    renderWithProviders(<Tutors />);

    fireEvent.click(screen.getByRole("button", { name: /Novo Tutor/i }));

    fireEvent.change(screen.getByPlaceholderText("Ex: Maria Oliveira"), { target: { value: "Roberto Silva" } });
    fireEvent.change(screen.getByPlaceholderText("tutor@email.com"), { target: { value: "roberto@email.com" } });
    fireEvent.change(screen.getByPlaceholderText("Ex: 10 (dia 10 de cada mês)"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Criar Tutor" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Roberto Silva",
          email: "roberto@email.com",
          mensalidadeDia: undefined,
        })
      );
    });
  });
});
