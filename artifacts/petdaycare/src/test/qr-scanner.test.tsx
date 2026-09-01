import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import QrScanner from "@/pages/staff/qr-scanner";
import * as authModule from "@/hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";
import jsQR from "jsqr";

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({
    user: { id: 10, name: "Staff User", role: "staff", crecheId: 1 },
    isLoading: false,
  })),
}));

vi.mock("jsqr", () => ({
  default: vi.fn(),
}));

const mockCheckInMutate = vi.fn();
let mockTasksData: any[] = [];
let mockTasksLoading = false;
let mockTasksError = false;

vi.mock("@workspace/api-client-react", () => ({
  useCheckIn: vi.fn(() => ({
    mutate: mockCheckInMutate,
    isPending: false,
  })),
  useListTasks: vi.fn(() => ({
    data: mockTasksData,
    isLoading: mockTasksLoading,
    isError: mockTasksError,
  })),
  getListBookingsQueryKey: vi.fn((crecheId) => [`/api/creches/${crecheId}/bookings`]),
  getListPetsQueryKey: vi.fn((crecheId) => [`/api/creches/${crecheId}/pets`]),
  getGetCrecheStatsQueryKey: vi.fn((crecheId) => [`/api/creches/${crecheId}/stats`]),
  getListTasksQueryKey: vi.fn((crecheId, params) => [
    `/api/creches/${crecheId}/tasks`,
    ...(params ? [params] : []),
  ]),
}));

describe("QR Scanner Post-Scan Operational Task Summary Suite (R34.C1A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTasksData = [];
    mockTasksLoading = false;
    mockTasksError = false;

    // Default fetch mock
    global.fetch = vi.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/by-qr/valid-token-thor")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 101,
              name: "Thor",
              tutorName: "Carlos Silva",
              photoUrl: "/uploads/thor.jpg",
              isCheckedIn: false,
              hasActiveBooking: true,
              bookingId: 501,
            }),
        } as Response);
      }
      if (urlStr.includes("/by-qr/token-no-booking")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 102,
              name: "Luna",
              tutorName: "Mariana Souza",
              photoUrl: null,
              isCheckedIn: false,
              hasActiveBooking: false,
              bookingId: null,
            }),
        } as Response);
      }
      if (urlStr.includes("/by-qr/invalid-token")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "Pet não encontrado para este QR Code." }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled fetch URL: ${urlStr}`));
    });

    // Mock mediaDevices
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(() =>
          Promise.resolve({
            getTracks: () => [{ stop: vi.fn() }],
          })
        ),
      },
      writable: true,
      configurable: true,
    });

    // Mock requestAnimationFrame / cancelAnimationFrame
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(Date.now()), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      clearTimeout(id);
    });
  });

  it("1. renders initial state with 'Escanear QR Code' button", () => {
    renderWithProviders(<QrScanner />);

    expect(screen.getByText("QR Scanner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Escanear QR Code/i })).toBeInTheDocument();
  });

  it("2. resolves pet identity on valid QR decode and renders post-scan found state", async () => {
    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4, // HAVE_ENOUGH_DATA
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    const scanButton = screen.getByRole("button", { name: /Escanear QR Code/i });
    fireEvent.click(scanButton);

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(screen.getByText("Carlos Silva")).toBeInTheDocument();
    expect(screen.getByText("Em casa")).toBeInTheDocument();
    expect(screen.getByText("Reserva Ativa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar Check-in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Outro Pet/i })).toBeInTheDocument();
  });

  it("3. renders error state when QR token is not found on backend", async () => {
    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "invalid-token" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Ops, algo falhou")).toBeInTheDocument();
    });

    expect(screen.getByText("Pet não encontrado para este QR Code.")).toBeInTheDocument();
  });

  it("4. does NOT trigger check-in mutation automatically upon QR decode (call count = 0)", async () => {
    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(mockCheckInMutate).toHaveBeenCalledTimes(0);
  });

  it("5. executes check-in mutation with exact crecheId and bookingId when Confirmar Check-in is clicked", async () => {
    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    const checkInBtn = screen.getByRole("button", { name: /Confirmar Check-in/i });
    fireEvent.click(checkInBtn);

    expect(mockCheckInMutate).toHaveBeenCalledTimes(1);
    expect(mockCheckInMutate).toHaveBeenCalledWith(
      { crecheId: 1, bookingId: 501 },
      expect.any(Object)
    );
  });

  it("6. transitions to 'Check-in Concluído' screen on successful check-in", async () => {
    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    mockCheckInMutate.mockImplementation((params, options) => {
      options?.onSuccess?.({ id: 101, isCheckedIn: true });
    });

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Check-in/i }));

    await waitFor(() => {
      expect(screen.getByText("Check-in Concluído")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Próximo Pet/i })).toBeInTheDocument();
  });

  it("7. renders grouped pending task summary when scanned pet has same-type pending tasks", async () => {
    mockTasksData = [
      { id: 1, petId: 101, type: "feeding", status: "pending", title: "Ração manhã" },
      { id: 2, petId: 101, type: "feeding", status: "pending", title: "Ração tarde" },
    ];

    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(screen.getByText("Tarefas pendentes hoje")).toBeInTheDocument();
    expect(screen.getByText("2x Alimentação")).toBeInTheDocument();
  });

  it("8. renders multiple distinct task types (feeding, medication, walk)", async () => {
    mockTasksData = [
      { id: 1, petId: 101, type: "feeding", status: "pending", title: "Ração almoço" },
      { id: 2, petId: 101, type: "medication", status: "pending", title: "Antibiótico" },
      { id: 3, petId: 101, type: "walk", status: "pending", title: "Passeio 15h" },
    ];

    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(screen.getByText("Tarefas pendentes hoje")).toBeInTheDocument();
    expect(screen.getByText("1x Alimentação")).toBeInTheDocument();
    expect(screen.getByText("1x Medicação")).toBeInTheDocument();
    expect(screen.getByText("1x Passeio")).toBeInTheDocument();
  });

  it("9. isolates tasks belonging to another pet from scanned pet summary", async () => {
    mockTasksData = [
      { id: 1, petId: 101, type: "feeding", status: "pending", title: "Almoço do Thor" },
      { id: 2, petId: 999, type: "grooming", status: "pending", title: "Banho de outro pet" },
    ];

    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(screen.getByText("1x Alimentação")).toBeInTheDocument();
    expect(screen.queryByText(/Banho\/Tosa/i)).not.toBeInTheDocument();
  });

  it("10. renders 'Nenhuma tarefa pendente para hoje' when task query succeeds and scanned pet has 0 pending tasks", async () => {
    mockTasksData = [];

    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(screen.getByText("Tarefas pendentes hoje")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma tarefa pendente para hoje")).toBeInTheDocument();
  });

  it("11. does NOT render false zero while task query is loading", async () => {
    mockTasksLoading = true;
    mockTasksData = [];

    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(screen.queryByText("Nenhuma tarefa pendente para hoje")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar Check-in/i })).toBeInTheDocument();
  });

  it("12. does NOT render false zero and does NOT break core scanner when task query errors", async () => {
    mockTasksError = true;
    mockTasksData = [];

    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(screen.queryByText("Nenhuma tarefa pendente para hoje")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar Check-in/i })).toBeInTheDocument();
  });

  it("13. does NOT render medical badges (Alergia, Cuidados especiais) in QR scanner", async () => {
    const mockJsQR = vi.mocked(jsQR);
    mockJsQR.mockReturnValue({ data: "valid-token-thor" } as any);

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    })) as any;

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 4,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(screen.getByText("Thor")).toBeInTheDocument();
    });

    expect(screen.queryByText("Alergia")).not.toBeInTheDocument();
    expect(screen.queryByText("Cuidados especiais")).not.toBeInTheDocument();
  });

  it("14. renders camera error feedback when camera access is denied", async () => {
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(() => Promise.reject(new Error("Permission denied"))),
      },
      writable: true,
      configurable: true,
    });

    renderWithProviders(<QrScanner />);

    fireEvent.click(screen.getByRole("button", { name: /Escanear QR Code/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Não foi possível acessar a câmera. Verifique as permissões.")
      ).toBeInTheDocument();
    });
  });
});
